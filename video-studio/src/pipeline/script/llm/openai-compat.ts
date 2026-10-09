// Клиент OpenAI-совместимого /chat/completions на чистом fetch: Gemini
// (AI Studio), Groq, OpenRouter, Ollama и любой свой сервер. Без SDK —
// так меньше зависимостей и проще подменить fetch в тестах.
//
// Уровни совместимости (compat) — на случай 400 от капризной модели:
//   0 — response_format json_schema + доп. параметры (extraBody)
//   1 — json_object, без extraBody, схема — текстом в системном промпте
//   2 — без response_format вовсе
//   3 — то же, но системный промпт вклеен в первое сообщение (Gemma на
//       Gemini API в прошлом отвергала system), и без reasoningBody
// reasoningBody (reasoning_effort) держим на уровнях 0–2: это бюджет
// размышлений, а не формат ответа. Если его снять вместе с json_schema,
// модель начинает думать «по умолчанию» и выедает max_tokens (у Groq —
// ещё и лимит 8K токенов в минуту) — ответ обрезается.

import { LlmError, linkedAbort, type CompletionRequest, type CompletionResult, type FetchLike, type LlmTarget } from "./types";

export interface CompatConfig {
  provider: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>; // только на compat 0
  reasoningBody?: Record<string, unknown>; // compat 0–2 (см. выше)
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  defaultMaxTokens: number;
  maxTokensCap: number;
  timeoutMs: number;
  fetch: FetchLike;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: { message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  error?: { message?: string; code?: unknown } | string;
}

function contentToText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  }
  return "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function errorDetail(body: string): string {
  let detail = body.slice(0, 300).replace(/\s+/g, " ").trim();
  try {
    const j = JSON.parse(body) as unknown;
    const first = Array.isArray(j) ? j[0] : j; // Gemini иногда отдаёт [ {error} ]
    const e = (first as { error?: unknown })?.error;
    const m = typeof e === "string" ? e : (e as { message?: unknown })?.message;
    if (typeof m === "string" && m) detail = m.slice(0, 300);
  } catch {
    // не JSON — показываем как есть
  }
  return detail;
}

export function classifyHttp(label: string, status: number, body: string, retryAfter: string | null): LlmError {
  const detail = errorDetail(body);
  const tail = `${detail ? ` Ответ: ${detail}` : ""}${retryAfter ? ` (Retry-After: ${retryAfter} с)` : ""}`;
  // Gemini недоступен в регионе — ключ тут ни при чём, но и повторять бессмысленно.
  if (/location is not supported|not available in your country/i.test(detail)) {
    return new LlmError(`${label}: сервис недоступен в вашем регионе (HTTP ${status}).${tail}`, "auth", status);
  }
  // Gemini отвечает на неверный ключ кодом 400 (INVALID_ARGUMENT), а не 401 —
  // без этой проверки мы бы зря «упрощали» запрос по 4 раза на каждую модель.
  if (/valid API key|API key not valid|API_KEY_INVALID|invalid api key|invalid Authorization header|Incorrect API key/i.test(detail)) {
    return new LlmError(`${label}: ключ API неверный или не задан (HTTP ${status}).${tail}`, "auth", status);
  }
  if (status === 401 || status === 403) return new LlmError(`${label}: HTTP ${status} — ключ API неверный или без доступа к модели.${tail}`, "auth", status);
  if (status === 402) return new LlmError(`${label}: HTTP 402 — на счёте нет средств.${tail}`, "auth", status);
  if (status === 404) return new LlmError(`${label}: HTTP 404 — модель не найдена или снята с поддержки.${tail}`, "unavailable", status);
  if (status === 429) return new LlmError(`${label}: HTTP 429 — исчерпан лимит запросов бесплатного тарифа.${tail}`, "unavailable", status);
  if (status === 400 || status === 422) return new LlmError(`${label}: HTTP ${status} — запрос отклонён.${tail}`, "bad_request", status);
  if (status >= 500) return new LlmError(`${label}: HTTP ${status} — сбой на стороне сервиса.${tail}`, "unavailable", status);
  return new LlmError(`${label}: HTTP ${status}.${tail}`, "unavailable", status);
}

export function buildMessages(req: CompletionRequest): ChatMessage[] {
  let system = req.system;
  if (req.compat >= 1) {
    // Без json_schema модель видит схему только в тексте — даём её явно.
    system += `\n\nJSON-схема ответа (строго ей следуй, верни один объект):\n${JSON.stringify(req.jsonSchema)}`;
  }
  const turns: ChatMessage[] = req.turns.map((t) => ({ role: t.role, content: t.content }));
  if (req.compat >= 3) {
    const [first, ...rest] = turns;
    return [{ role: "user", content: `${system}\n\n---\n\n${first?.content ?? ""}` }, ...rest];
  }
  return [{ role: "system", content: system }, ...turns];
}

export function buildBody(cfg: CompatConfig, req: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: buildMessages(req),
    [cfg.maxTokensField ?? "max_tokens"]: req.maxTokens,
    stream: false,
  };
  if (req.compat === 0) {
    body.response_format = { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema } };
    Object.assign(body, cfg.extraBody ?? {});
  } else if (req.compat === 1) {
    body.response_format = { type: "json_object" };
  }
  if (req.compat <= 2) Object.assign(body, cfg.reasoningBody ?? {});
  return body;
}

export function openAiCompatTarget(cfg: CompatConfig): LlmTarget {
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  return {
    provider: cfg.provider,
    model: cfg.model,
    label: cfg.label,
    maxCompat: 3,
    defaultMaxTokens: cfg.defaultMaxTokens,
    maxTokensCap: cfg.maxTokensCap,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const { signal, cleanup, timedOut } = linkedAbort(cfg.timeoutMs, req.signal);
      let status = 0;
      let text = "";
      let retryAfter: string | null = null;
      try {
        const res = await cfg.fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
            ...cfg.headers,
          },
          body: JSON.stringify(buildBody(cfg, req)),
          signal,
        });
        status = res.status;
        retryAfter = res.headers.get("retry-after");
        text = await res.text();
      } catch (e) {
        if (req.signal?.aborted) throw new LlmError(`${cfg.label}: отменено.`, "aborted", null, e);
        if (timedOut()) throw new LlmError(`${cfg.label}: нет ответа за ${Math.round(cfg.timeoutMs / 1000)} с.`, "unavailable", null, e);
        const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
        throw new LlmError(`${cfg.label}: не удалось подключиться к ${hostOf(url)} (${code}).`, "unavailable", null, e);
      } finally {
        cleanup();
      }
      if (status < 200 || status >= 300) throw classifyHttp(cfg.label, status, text, retryAfter);

      let data: ChatResponse;
      try {
        data = JSON.parse(text) as ChatResponse;
      } catch {
        throw new LlmError(`${cfg.label}: сервис вернул не-JSON (${text.slice(0, 120)}…).`, "unavailable", status);
      }
      if (data.error) {
        // OpenRouter иногда отвечает 200 с {error} внутри
        const m = typeof data.error === "string" ? data.error : data.error.message ?? JSON.stringify(data.error);
        throw new LlmError(`${cfg.label}: ошибка провайдера: ${String(m).slice(0, 300)}`, "unavailable", status);
      }
      const choice = data.choices?.[0];
      const content = contentToText(choice?.message?.content);
      const finish = (choice?.finish_reason ?? "").toLowerCase();
      const truncated = finish === "length" || finish === "max_tokens";
      if (!content.trim() && !truncated) throw new LlmError(`${cfg.label}: пустой ответ (finish_reason=${finish || "нет"}).`, "unavailable", status);

      const prompt = data.usage?.prompt_tokens ?? 0;
      const completion = data.usage?.completion_tokens ?? 0;
      const total = data.usage?.total_tokens ?? 0;
      // Gemini через compat считает «мысли» в total, но не в completion —
      // берём разницу, чтобы размышления попали в output.
      const outputTokens = Math.max(completion, total - prompt);
      return {
        text: content,
        truncated,
        inputTokens: prompt,
        outputTokens,
        costUsd: 0,
        servedBy: data.model ?? cfg.model,
      };
    },
  };
}
