// Цепочка моделей из переменных окружения. Сначала — модели основного
// провайдера (LLM_PROVIDER), затем запасные: LLM_FALLBACKS, а если она не
// задана — все БЕСПЛАТНЫЕ облачные провайдеры, для которых есть ключ.
// Платный Claude и локальная Ollama в запасные сами не попадают — только явно.

import { claudeTarget, type AnthropicLike, type ClaudeEffort } from "./claude";
import { openAiCompatTarget } from "./openai-compat";
import { envNumber, type FetchLike, type LlmTarget, type Logger } from "./types";

export type LlmProviderName = "gemini" | "claude" | "groq" | "openrouter" | "ollama" | "custom";
export const LLM_PROVIDERS: LlmProviderName[] = ["gemini", "claude", "groq", "openrouter", "ollama", "custom"];

const ALIASES: Record<string, LlmProviderName> = {
  google: "gemini",
  "ai-studio": "gemini",
  aistudio: "gemini",
  anthropic: "claude",
  local: "ollama",
  openai: "custom",
  "openai-compatible": "custom",
};

export type Env = Record<string, string | undefined>;

export interface ChainDeps {
  env: Env;
  fetch: FetchLike;
  anthropic?: AnthropicLike;
  log: Logger;
}

const DEFAULT_MODELS: Record<Exclude<LlmProviderName, "custom">, string[]> = {
  // У каждой модели Gemini своя бесплатная квота — поэтому три ступени на одном ключе.
  gemini: ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemma-4-31b-it"],
  groq: ["qwen/qwen3.8-27b"],
  openrouter: ["google/gemma-4-31b-it:free"],
  ollama: ["gemma4:12b"],
  claude: ["claude-opus-5-5"],
};

export const KEY_HELP: Record<LlmProviderName, string> = {
  gemini: "GEMINI_API_KEY (бесплатно: https://aistudio.google.com/app/apikey)",
  groq: "GROQ_API_KEY (бесплатно: https://console.groq.com/keys)",
  openrouter: "OPENROUTER_API_KEY (бесплатные модели :free: https://openrouter.ai/keys)",
  claude: "ANTHROPIC_API_KEY (платно: https://platform.claude.com/settings/keys)",
  ollama: "локальный сервер Ollama: ollama serve, затем ollama pull gemma4:12b",
  custom: "LLM_BASE_URL и LLM_MODEL (+ LLM_API_KEY, если сервер требует ключ)",
};

export function normalizeProvider(raw: string | undefined): LlmProviderName | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if ((LLM_PROVIDERS as string[]).includes(v)) return v as LlmProviderName;
  return ALIASES[v] ?? null;
}

const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

function geminiKey(env: Env): string | undefined {
  return nonEmpty(env.GEMINI_API_KEY) ?? nonEmpty(env.GOOGLE_API_KEY);
}

function hasKey(p: LlmProviderName, env: Env): boolean {
  switch (p) {
    case "gemini":
      return !!geminiKey(env);
    case "groq":
      return !!nonEmpty(env.GROQ_API_KEY);
    case "openrouter":
      return !!nonEmpty(env.OPENROUTER_API_KEY);
    case "claude":
      // SDK умеет и ANTHROPIC_AUTH_TOKEN / профиль `ant auth login`.
      return !!(nonEmpty(env.ANTHROPIC_API_KEY) ?? nonEmpty(env.ANTHROPIC_AUTH_TOKEN));
    case "ollama":
      return true;
    case "custom":
      return !!nonEmpty(env.LLM_BASE_URL) && !!nonEmpty(env.LLM_MODEL);
  }
}

function makeTarget(p: LlmProviderName, model: string, deps: ChainDeps, primary: boolean): LlmTarget {
  const { env } = deps;
  const timeout = (ms: number) => envNumber(env, "LLM_TIMEOUT_MS", ms);
  const common = { fetch: deps.fetch };
  switch (p) {
    case "gemini":
      return openAiCompatTarget({
        ...common,
        provider: p,
        label: `Gemini · ${model}`,
        baseUrl: (primary && nonEmpty(env.LLM_BASE_URL)) || "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: geminiKey(env),
        model,
        // low — быстрее и бережёт бюджет вывода (мысли входят в max_tokens).
        // Gemma reasoning_effort не понимает — не шлём, чтобы не ловить 400.
        reasoningBody: /^gemma/.test(model) ? {} : { reasoning_effort: "low" },
        defaultMaxTokens: 8192,
        maxTokensCap: 32768,
        timeoutMs: timeout(90_000),
      });
    case "groq":
      return openAiCompatTarget({
        ...common,
        provider: p,
        label: `Groq · ${model}`,
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: nonEmpty(env.GROQ_API_KEY),
        model,
        reasoningBody: /qwen/.test(model) ? { reasoning_effort: "none" } : {},
        maxTokensField: "max_completion_tokens",
        // бесплатный лимит — 8K токенов в минуту на запрос+ответ, а системный
        // промпт с примером уже ~4K: просим немного, при обрыве — до 6000
        defaultMaxTokens: 4000,
        maxTokensCap: 6000,
        timeoutMs: timeout(90_000),
      });
    case "openrouter":
      return openAiCompatTarget({
        ...common,
        provider: p,
        label: `OpenRouter · ${model}`,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: nonEmpty(env.OPENROUTER_API_KEY),
        model,
        headers: { "HTTP-Referer": "https://github.com/video-studio", "X-OpenRouter-Title": "video-studio" },
        // models — серверный перебор бесплатных моделей, response-healing чинит JSON
        extraBody: {
          models: [...new Set([model, "qwen/qwen3.8-27b:free", "openrouter/free"])],
          plugins: [{ id: "response-healing" }],
        },
        defaultMaxTokens: 8192,
        maxTokensCap: 16384,
        timeoutMs: timeout(120_000),
      });
    case "ollama":
      return openAiCompatTarget({
        ...common,
        provider: p,
        label: `Ollama · ${model}`,
        baseUrl: (primary && nonEmpty(env.LLM_BASE_URL)) || nonEmpty(env.OLLAMA_BASE_URL) || "http://localhost:11434/v1",
        model,
        defaultMaxTokens: 8192,
        maxTokensCap: 16384,
        // на слабом ПК локальная модель пишет медленно
        timeoutMs: timeout(600_000),
      });
    case "custom":
      return openAiCompatTarget({
        ...common,
        provider: p,
        label: `LLM · ${model}`,
        baseUrl: nonEmpty(env.LLM_BASE_URL) ?? "",
        apiKey: nonEmpty(env.LLM_API_KEY),
        model,
        defaultMaxTokens: 8192,
        maxTokensCap: 32768,
        timeoutMs: timeout(180_000),
      });
    case "claude": {
      const effortRaw = (env.LLM_EFFORT ?? "").trim().toLowerCase();
      const effort: ClaudeEffort = (["low", "medium", "high", "xhigh", "max"] as const).find((e) => e === effortRaw) ?? "medium";
      return claudeTarget({
        model,
        effort,
        timeoutMs: timeout(300_000),
        client: deps.anthropic,
        apiKey: nonEmpty(env.ANTHROPIC_API_KEY),
      });
    }
  }
}

// LLM_MODEL ставится первой; бесплатные модели провайдера остаются запасными
// (у каждой своя квота). У платного Claude — только выбранная модель: молча
// переходить на более дорогую нельзя.
function modelsFor(p: LlmProviderName, override: string | undefined): string[] {
  const defaults = p === "custom" ? [] : DEFAULT_MODELS[p];
  if (override && p === "claude") return [override];
  return override ? [override, ...defaults.filter((m) => m !== override)] : [...defaults];
}

// Запасной элемент цепочки: "groq" или "groq:qwen/qwen3.8-27b".
function parseFallback(entry: string): { provider: LlmProviderName; model?: string } | null {
  const i = entry.indexOf(":");
  const p = normalizeProvider(i >= 0 ? entry.slice(0, i) : entry);
  if (!p) return null;
  const model = i >= 0 ? entry.slice(i + 1).trim() || undefined : undefined;
  return { provider: p, model };
}

export function resolveChain(deps: ChainDeps): LlmTarget[] {
  const { env, log } = deps;
  const rawProvider = nonEmpty(env.LLM_PROVIDER);
  const primary = normalizeProvider(rawProvider) ?? (rawProvider ? null : nonEmpty(env.LLM_BASE_URL) ? "custom" : "gemini");
  if (!primary) {
    throw new Error(`Неизвестный LLM_PROVIDER="${rawProvider}". Доступно: ${LLM_PROVIDERS.join(", ")}.`);
  }

  const chain: LlmTarget[] = [];
  const seen = new Set<string>();
  const push = (p: LlmProviderName, model: string, isPrimary: boolean) => {
    const key = `${p}|${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    chain.push(makeTarget(p, model, deps, isPrimary));
  };

  if (primary === "custom" && !hasKey("custom", env)) {
    throw new Error(`LLM_PROVIDER=custom: задайте ${KEY_HELP.custom}.`);
  }
  if (hasKey(primary, env) || primary === "claude") {
    // Для Claude пробуем даже без переменной: SDK найдёт профиль `ant auth login`.
    for (const m of modelsFor(primary, nonEmpty(env.LLM_MODEL))) push(primary, m, true);
  } else {
    log.warn(`[сценарий] Для LLM_PROVIDER=${primary} нужен ${KEY_HELP[primary]} — пробую запасные провайдеры.`);
  }

  const fbRaw = nonEmpty(env.LLM_FALLBACKS);
  if (fbRaw?.toLowerCase() === "none") return chain;
  if (fbRaw) {
    for (const entry of fbRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const fb = parseFallback(entry);
      if (!fb) {
        log.warn(`[сценарий] LLM_FALLBACKS: неизвестный провайдер «${entry}» — пропускаю.`);
        continue;
      }
      if (!hasKey(fb.provider, env)) {
        log.info(`[сценарий] Запасной ${fb.provider} пропущен: нужен ${KEY_HELP[fb.provider]}.`);
        continue;
      }
      for (const m of fb.model ? [fb.model] : modelsFor(fb.provider, undefined)) push(fb.provider, m, false);
    }
  } else {
    for (const p of ["gemini", "groq", "openrouter"] as const) {
      if (p !== primary && hasKey(p, env)) for (const m of modelsFor(p, undefined)) push(p, m, false);
    }
  }
  return chain;
}
