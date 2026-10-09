// Общий интерфейс «цели» LLM: одна модель одного провайдера. Цепочка целей
// перебирается по порядку (см. runner.ts), каждая цель умеет только одно —
// отправить запрос и вернуть текст ответа с токенами.

import type { z } from "zod";

// unavailable — 429/5xx/404/таймаут/сеть: идём к следующей модели;
// auth        — ключ неверный/нет денег: пропускаем ВСЕ модели этого провайдера;
// bad_request — 400: упрощаем запрос (compat-уровень) и пробуем снова;
// refusal     — модель отказалась отвечать: следующая цель;
// aborted     — отменено пользователем: прекращаем всё.
export type LlmErrorKind = "unavailable" | "auth" | "bad_request" | "refusal" | "aborted";

export interface Spent {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | null;
  spent?: Spent; // токены, потраченные на неудачный ответ (например, отказ)
  constructor(message: string, kind: LlmErrorKind, status: number | null = null, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  // Родной ответ провайдера (например, блоки Claude с thinking) — чтобы в
  // ремонтном запросе вернуть ход ассистента без изменений.
  native?: { provider: string; model: string; compat: number; content: unknown };
}

export interface CompletionRequest {
  system: string;
  turns: ChatTurn[];
  schemaName: string;
  zodSchema: z.ZodType; // для Claude structured outputs
  jsonSchema: Record<string, unknown>; // упрощённая схема для OpenAI-совместимых
  maxTokens: number;
  compat: number; // 0 — все возможности; больше — запрос проще (после 400)
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  truncated: boolean; // finish_reason=length / stop_reason=max_tokens
  inputTokens: number;
  outputTokens: number; // включая токены размышлений
  costUsd: number;
  servedBy: string; // модель, которая фактически ответила
  native?: unknown;
}

export interface LlmTarget {
  provider: string; // gemini | claude | groq | openrouter | ollama | custom
  model: string;
  label: string; // для логов: "Gemini · gemini-3.8-flash"
  maxCompat: number;
  defaultMaxTokens: number;
  maxTokensCap: number;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// Таймаут + внешний сигнал в одном контроллере (AbortSignal.any есть не везде).
export function linkedAbort(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ctrl = new AbortController();
  let timed = false;
  const timer = setTimeout(() => {
    timed = true;
    ctrl.abort(new Error("timeout"));
  }, timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
    timedOut: () => timed,
  };
}

export function envNumber(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
