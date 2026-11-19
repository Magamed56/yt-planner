// Claude через официальный SDK (@anthropic-ai/sdk). Особенности моделей
// 5.x (см. документацию Claude API, октябрь 2026):
// - размышления на Opus 5.5 выключить нельзя — параметр thinking не шлём,
//   глубину задаёт output_config.effort (по умолчанию medium);
// - JSON — через structured outputs (output_config.format), префилл запрещён;
// - отказ по политике приходит как HTTP 200 со stop_reason "refusal" —
//   поэтому включаем серверный fallback (beta server-side-fallback-2026-07-01,
//   fallbacks: "default"), а stop_reason проверяем ДО чтения content;
// - большой max_tokens — только стримингом, ответ собираем finalMessage().

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { claudeCostUsd, webSearchCostUsd } from "../pricing";
import { toClaudeJsonSchema } from "../schema";
import { LlmError, linkedAbort, type ChatTurn, type CompletionRequest, type CompletionResult, type LlmTarget } from "./types";

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

// Минимум, который нам нужен от клиента, — чтобы в тестах подставить мок.
export interface AnthropicLike {
  beta: {
    messages: {
      stream(
        body: BetaMessageStreamParams,
        options?: { signal?: AbortSignal; timeout?: number },
      ): { finalMessage(): Promise<BetaMessage>; readonly currentMessage?: BetaMessage | undefined };
    };
  };
}

export interface ClaudeConfig {
  model: string; // claude-opus-5-5 | claude-sonnet-5-5 | claude-haiku-4-5 …
  effort: ClaudeEffort;
  timeoutMs: number;
  client?: AnthropicLike; // по умолчанию new Anthropic() — ключ из ANTHROPIC_API_KEY
  apiKey?: string;
}

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// fallbacks: "default" документирован для этих моделей; Haiku 4.5 и старые
// модели его не принимают.
export const supportsDefaultFallbacks = (model: string) => /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/.test(model);
// effort не поддерживают Haiku 4.5 / Sonnet 4.5 и старше.
export const supportsEffort = (model: string) => !/haiku|sonnet-4-5|opus-4-[01]|claude-3/.test(model);

// Веб-поиск (план тем: источники фактов). web_search_20260209 — с динамической
// фильтрацией (Opus/Sonnet 4.6+ и 5.x); старым моделям — базовая версия.
const WEB_SEARCH_DYNAMIC = "web_search_20260209" as const;
const WEB_SEARCH_BASIC = "web_search_20250305" as const;
const supportsDynamicSearch = (model: string) => !/haiku|claude-3|sonnet-4-5|opus-4-[015]\b/.test(model);
const MAX_PAUSE_CONTINUES = 2; // pause_turn: длинный серверный цикл поиска продолжаем сами

// Все URL, которые модель реально видела: результаты поиска (в т.ч. вложенные,
// из динамической фильтрации) и цитаты в тексте.
export function collectSources(content: BetaContentBlock[]): string[] {
  const urls = new Set<string>();
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result" && r.url) urls.add(r.url);
    } else if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) if (c.type === "web_search_result_location" && c.url) urls.add(c.url);
    }
  }
  return [...urls];
}

// Ход ассистента для ремонтного запроса: блоки возвращаем без изменений (так
// требуют правила «preserved thinking»), но после серверного fallback всё до
// последней точки переключения, кроме текста, опускаем — как в документации.
export function replayContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  let lastFallback = -1;
  content.forEach((b, i) => {
    if (b.type === "fallback") lastFallback = i;
  });
  const out: BetaContentBlockParam[] = [];
  content.forEach((b, i) => {
    if (i < lastFallback && b.type !== "text") return;
    if (b.type === "text") out.push({ type: "text", text: b.text });
    else if (b.type === "thinking") out.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
    else if (b.type === "redacted_thinking") out.push({ type: "redacted_thinking", data: b.data });
  });
  return out;
}

// Текст ответа — только после последней точки переключения: частичный
// вывод отказавшейся модели в стриме остаётся, но он неполный.
export function finalText(content: BetaContentBlock[]): string {
  let start = 0;
  content.forEach((b, i) => {
    if (b.type === "fallback") start = i + 1;
  });
  return content
    .slice(start)
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
}

function toParams(turns: ChatTurn[], model: string, compat: number): BetaMessageParam[] {
  return turns.map((t) => {
    const n = t.native;
    if (t.role === "assistant" && n && n.provider === "claude" && n.model === model && n.compat === compat && Array.isArray(n.content)) {
      return { role: "assistant", content: n.content as BetaContentBlockParam[] };
    }
    return { role: t.role, content: t.content };
  });
}

function usageOf(msg: BetaMessage, requestedModel: string): { input: number; output: number; cost: number; searches: number } {
  const u = msg.usage;
  // usage.iterations — точный учёт по каждой попытке (в т.ч. fallback-моделей
  // по их собственным ценам); верхний usage — только последняя попытка.
  const parts =
    u.iterations && u.iterations.length > 0
      ? u.iterations.map((it) => ({
          model: ("model" in it && typeof it.model === "string" && it.model) || requestedModel,
          input: it.input_tokens ?? 0,
          cacheWrite: it.cache_creation_input_tokens ?? 0,
          cacheRead: it.cache_read_input_tokens ?? 0,
          output: it.output_tokens ?? 0,
        }))
      : [
          {
            model: msg.model || requestedModel,
            input: u.input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            output: u.output_tokens ?? 0,
          },
        ];
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const p of parts) {
    input += p.input + p.cacheWrite + p.cacheRead;
    output += p.output;
    cost += claudeCostUsd(p.model, p);
  }
  // Поиски оплачиваются отдельно от токенов.
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  cost += webSearchCostUsd(searches);
  return { input, output, cost: Math.round(cost * 1e6) / 1e6, searches };
}

function classify(label: string, e: unknown, timedOut: boolean, userAborted: boolean): LlmError {
  // Порядок — от частного к общему: подклассы APIError раньше самого APIError.
  if (e instanceof Anthropic.APIUserAbortError) {
    if (userAborted) return new LlmError(`${label}: отменено.`, "aborted", null, e);
    return new LlmError(`${label}: нет ответа за отведённое время${timedOut ? "" : " (запрос прерван)"}.`, "unavailable", null, e);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new LlmError(`${label}: таймаут соединения с api.anthropic.com.`, "unavailable", null, e);
  if (e instanceof Anthropic.APIConnectionError) return new LlmError(`${label}: нет связи с api.anthropic.com (${e.message}).`, "unavailable", null, e);
  if (e instanceof Anthropic.AuthenticationError) return new LlmError(`${label}: ключ ANTHROPIC_API_KEY неверный.`, "auth", 401, e);
  if (e instanceof Anthropic.PermissionDeniedError) return new LlmError(`${label}: у ключа нет доступа к этой модели.`, "auth", 403, e);
  if (e instanceof Anthropic.NotFoundError) return new LlmError(`${label}: модель не найдена (проверьте LLM_MODEL).`, "unavailable", 404, e);
  if (e instanceof Anthropic.RateLimitError) return new LlmError(`${label}: превышен лимит запросов (429), попробуйте позже.`, "unavailable", 429, e);
  // Пустой баланс приходит как 400 invalid_request_error, а не 402 —
  // упрощать запрос бессмысленно, сразу к другому провайдеру.
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return new LlmError(`${label}: на балансе Anthropic закончились средства — пополните счёт или выберите бесплатный LLM_PROVIDER.`, "auth", 400, e);
  }
  if (e instanceof Anthropic.BadRequestError) return new LlmError(`${label}: запрос отклонён (400): ${e.message.slice(0, 300)}`, "bad_request", 400, e);
  if (e instanceof Anthropic.InternalServerError) return new LlmError(`${label}: сбой или перегрузка на стороне Anthropic (${e.status}).`, "unavailable", e.status ?? null, e);
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return new LlmError(`${label}: на балансе Anthropic закончились средства (402) — пополните счёт или выберите бесплатный LLM_PROVIDER.`, "auth", 402, e);
    return new LlmError(`${label}: ошибка API ${e.status ?? ""}: ${e.message.slice(0, 300)}`, "unavailable", e.status ?? null, e);
  }
  return new LlmError(`${label}: ${(e as Error)?.message ?? String(e)}`, "unavailable", null, e);
}

export function claudeTarget(cfg: ClaudeConfig): LlmTarget {
  const label = `Claude · ${cfg.model}`;
  let client: AnthropicLike | null = cfg.client ?? null;
  const getClient = (): AnthropicLike => {
    if (client) return client;
    try {
      // maxRetries: 1 — повторы и так делает цепочка моделей; timeout — наш.
      client = new Anthropic({ ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}), maxRetries: 1, timeout: cfg.timeoutMs });
      return client;
    } catch (e) {
      throw new LlmError(`${label}: не найден ключ — задайте ANTHROPIC_API_KEY (${(e as Error).message}).`, "auth", null, e);
    }
  };

  return {
    provider: "claude",
    model: cfg.model,
    label,
    maxCompat: 2, // 1 — без fallbacks/beta; 2 — ещё и без structured outputs
    defaultMaxTokens: 32_000,
    maxTokensCap: 64_000,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const c = getClient();
      // Веб-поиск (compat 0 — с динамической фильтрацией, 1 — базовый, 2 — без
      // поиска). Цитаты у поиска включены всегда, а с output_config.format они
      // несовместимы (400) — поэтому с поиском схема ответа идёт текстом.
      const search = req.webSearch && req.compat < 2 ? req.webSearch : null;
      const useFallbacks = req.compat < 1 && supportsDefaultFallbacks(cfg.model);
      const useFormat = req.compat < 2 && !search;
      // Схема — из той же zod-схемы (см. toClaudeJsonSchema). Ответ разбираем
      // сами, а не через messages.parse(): при несовпадении со схемой SDK
      // бросил бы исключение, и мы потеряли бы и текст, и учёт токенов, а нам
      // нужно отправить модели список ошибок в ремонтном запросе.
      const schema = toClaudeJsonSchema(req.zodSchema);
      const system = useFormat
        ? req.system
        : `${req.system}\n\nJSON-схема ответа (строго ей следуй, верни один объект):\n${JSON.stringify(req.jsonSchema)}`;
      const tools = search
        ? [{ type: req.compat < 1 && supportsDynamicSearch(cfg.model) ? WEB_SEARCH_DYNAMIC : WEB_SEARCH_BASIC, name: "web_search" as const, max_uses: Math.max(1, Math.round(search.maxUses)) }]
        : null;
      const params: BetaMessageStreamParams = {
        model: cfg.model,
        max_tokens: req.maxTokens,
        // Системный промпт стабилен между частями и ремонтом — кэшируем.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: toParams(req.turns, cfg.model, req.compat),
        output_config: {
          ...(supportsEffort(cfg.model) ? { effort: cfg.effort } : {}),
          ...(useFormat ? { format: { type: "json_schema", schema } } : {}),
        },
        ...(tools ? { tools } : {}),
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      };

      const { signal, cleanup, timedOut } = linkedAbort(cfg.timeoutMs, req.signal);
      let msg: BetaMessage | null = null;
      let stream: ReturnType<AnthropicLike["beta"]["messages"]["stream"]> | null = null;
      let spent = { input: 0, output: 0, cost: 0, searches: 0 };
      const add = (m: BetaMessage) => {
        const u = usageOf(m, cfg.model);
        spent = { input: spent.input + u.input, output: spent.output + u.output, cost: Math.round((spent.cost + u.cost) * 1e6) / 1e6, searches: spent.searches + u.searches };
      };
      const sources = new Set<string>();
      try {
        let messages = params.messages;
        for (let round = 0; ; round++) {
          stream = c.beta.messages.stream({ ...params, messages }, { signal, timeout: cfg.timeoutMs });
          msg = await stream.finalMessage();
          stream = null;
          add(msg);
          for (const u of collectSources(msg.content)) sources.add(u);
          if (msg.stop_reason !== "pause_turn" || round >= MAX_PAUSE_CONTINUES) break;
          // Серверный цикл поиска встал на паузу: возвращаем ход как есть — API продолжит с места остановки.
          messages = [...messages, { role: "assistant", content: msg.content as unknown as BetaContentBlockParam[] }];
        }
      } catch (e) {
        const err = classify(label, e, timedOut(), !!req.signal?.aborted);
        // Стрим оборвался (таймаут, сеть) — уже принятые токены оплачены:
        // берём учёт из снимка сообщения (вход точный, выход — не меньше).
        const snap = stream?.currentMessage;
        if (snap?.usage) add(snap);
        if (spent.input || spent.output || spent.cost) err.spent = { inputTokens: spent.input, outputTokens: spent.output, costUsd: spent.cost };
        throw err;
      } finally {
        cleanup();
      }
      if (!msg) throw new LlmError(`${label}: пустой ответ.`, "unavailable");

      const { input, output, cost } = spent;
      if (msg.stop_reason === "refusal") {
        const cat = msg.stop_details?.category ?? "не указана";
        const err = new LlmError(`${label}: модель отказалась писать сценарий (категория: ${cat}). Попробуйте переформулировать тему.`, "refusal");
        err.spent = { inputTokens: input, outputTokens: output, costUsd: cost };
        throw err;
      }
      const text = finalText(msg.content);
      return {
        text,
        truncated: msg.stop_reason === "max_tokens",
        inputTokens: input,
        outputTokens: output,
        costUsd: cost,
        servedBy: msg.model || cfg.model,
        // С поиском ремонтный ход — просто текстом: блоки поиска пришлось бы
        // возвращать целиком (с encrypted_content), а без них thinking-блоки
        // считались бы правкой истории.
        native: search ? undefined : replayContent(msg.content),
        ...(search ? { sources: [...sources], webSearchRequests: spent.searches } : {}),
      };
    },
  };
}
