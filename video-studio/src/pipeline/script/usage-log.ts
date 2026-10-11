// Журнал расхода: content/usage.jsonl — по строке JSON на каждый вызов LLM и на
// озвучку ролика. Его коммитит workflow, так владелец видит квоты и деньги за
// месяц без консолей провайдеров. Запись — «по мере возможности»: журнал не
// должен ронять сборку ролика. USAGE_LOG=0 — не писать, USAGE_LOG=путь — свой файл.

import fs from "node:fs";
import path from "node:path";

export interface UsageRecord {
  at: string; // "2026-10-09T10:37:08Z"
  kind: "script" | "tts";
  code: string | null; // «08a», если известен
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  calls: number | null;
  chars: number | null;
  runId: string | null; // GITHUB_RUN_ID в Actions
  keyIndex?: number; // озвучка Gemini при двух ключах: каким озвучено (2 — хоть одна сцена вторым); без второго ключа поля нет
}

// Один запрос к LLM (успешный или нет) — так его отдаёт генератор (ScriptDeps.onLlmCall).
export interface LlmCallInfo {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ok: boolean;
}

export const usageNow = (d: Date = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const runIdFrom = (env: Record<string, string | undefined>) => env.GITHUB_RUN_ID?.trim() || null;

export function llmUsageRecord(call: LlmCallInfo, code: string | null, env: Record<string, string | undefined> = process.env, at = usageNow()): UsageRecord {
  return {
    at,
    kind: "script",
    code,
    provider: call.provider,
    model: call.model || null,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: call.costUsd,
    calls: 1,
    chars: null,
    runId: runIdFrom(env),
  };
}

export interface TtsUsage {
  provider: string;
  model: string | null;
  calls: number | null;
  chars: number | null;
  costUsd: number | null;
  keyIndex?: number | null; // номер ключа Gemini (1 | 2), не сам ключ
}

export function ttsUsageRecord(u: TtsUsage, code: string | null, env: Record<string, string | undefined> = process.env, at = usageNow()): UsageRecord {
  return { at, kind: "tts", code, provider: u.provider, model: u.model, inputTokens: null, outputTokens: null, costUsd: u.costUsd, calls: u.calls, chars: u.chars, runId: runIdFrom(env), ...(u.keyIndex ? { keyIndex: u.keyIndex } : {}) };
}

export function usageLogFile(root: string, env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.USAGE_LOG ?? "").trim();
  if (/^(0|off|false|no|none)$/i.test(v)) return null;
  if (v) return path.isAbsolute(v) ? v : path.resolve(root, v);
  return path.join(root, "content", "usage.jsonl");
}

export function appendUsage(root: string, records: UsageRecord[], env: Record<string, string | undefined> = process.env): string | null {
  if (!records.length) return null;
  const file = usageLogFile(root, env);
  if (!file) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return file;
  } catch (e) {
    console.warn(`  ⚠ журнал расхода не записан (${e instanceof Error ? e.message : String(e)}) — на сборку это не влияет`);
    return null;
  }
}

// Для CLI: копим вызовы LLM (ScriptDeps.onLlmCall) и дописываем их одной пачкой —
// и после успеха, и после ошибки (квота/деньги уже потрачены).
export function collectLlmUsage(root: string, code: string | null): { onLlmCall: (c: LlmCallInfo) => void; flush: () => void } {
  const calls: LlmCallInfo[] = [];
  return {
    onLlmCall: (c) => calls.push(c),
    flush: () => {
      appendUsage(root, calls.map((c) => llmUsageRecord(c, code)));
      calls.length = 0;
    },
  };
}

// Сколько POST-запросов ушло через fetch за время fn: так считаются запросы
// сетевых TTS (Gemini, ElevenLabs, свой сервер) без правок модуля озвучки.
// GET (скачивание модели Piper) не считаем. Edge работает через WebSocket —
// у него запросы = озвученные сцены (считает вызывающий).
export async function countPostRequests<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; posts: number }> {
  const original = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "POST") posts += 1;
    return original(input, init);
  }) as typeof fetch;
  try {
    return { value: await fn(), posts };
  } catch (error) {
    return { error, posts };
  } finally {
    globalThis.fetch = original;
  }
}
