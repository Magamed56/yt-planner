// Получение проверенного JSON от цепочки моделей. Правила (research/llm.md):
// - 400 → упрощаем запрос (json_schema → json_object → без формата);
// - 429/5xx/404/таймаут/отказ → следующая модель; неверный ключ → весь провайдер мимо;
// - ответ обрезан (finish_reason=length) → повтор с бóльшим max_tokens;
// - JSON не прошёл проверку → ОДИН ремонтный запрос со списком ошибок,
//   не помогло → следующая модель.

import type { z } from "zod";
import type { LlmUsage } from "../../contracts";
import { extractJson } from "../json";
import { buildRepairPrompt } from "../prompt";
import type { LlmCallInfo } from "../usage-log";
import { LlmError, type ChatTurn, type LlmTarget, type Logger, type Spent } from "./types";

export type Verdict<T> = { ok: true; value: T; warnings: string[] } | { ok: false; problems: string[]; warnings: string[] };

export class UsageBook {
  private readonly map = new Map<string, LlmUsage>();

  private entry(t: LlmTarget): LlmUsage {
    const key = `${t.provider}|${t.model}`;
    let u = this.map.get(key);
    if (!u) {
      u = { provider: t.provider, model: t.model, inputTokens: 0, outputTokens: 0, costUsd: 0, attempts: 0 };
      this.map.set(key, u);
    }
    return u;
  }

  add(t: LlmTarget, spent: Spent | null): void {
    const u = this.entry(t);
    u.attempts += 1;
    if (spent) {
      u.inputTokens += spent.inputTokens;
      u.outputTokens += spent.outputTokens;
      u.costUsd = Math.round((u.costUsd + spent.costUsd) * 1e6) / 1e6;
    }
  }

  list(): LlmUsage[] {
    return [...this.map.values()];
  }
}

export interface StructuredRequest<T> {
  chain: LlmTarget[];
  system: string;
  user: string;
  schemaName: string;
  zodSchema: z.ZodType;
  jsonSchema: Record<string, unknown>;
  validate: (raw: unknown) => Verdict<T>;
  what: string; // «сценарий», «план ролика», «часть 2 из 4» — для логов
  usage: UsageBook;
  log: Logger;
  maxTokens?: number; // желаемый стартовый лимит (иначе — по умолчанию цели)
  signal?: AbortSignal;
  webSearch?: { maxUses: number }; // серверный поиск (только Claude)
  onCall?: (call: LlmCallInfo) => void; // каждый запрос — в журнал расхода (usage.jsonl)
}

const MAX_LENGTH_RETRIES = 2;
const BUSY_RETRIES = 1; // повторов той же модели при 503

// Платные вызовы — в лог сразу: если генерация потом упадёт, человек всё
// равно видит, сколько уже ушло (бесплатные не шумят).
function logPaid(r: StructuredRequest<unknown>, target: LlmTarget, s: Spent): void {
  if (s.costUsd > 0) r.log.info(`[сценарий] ${target.label}: ${s.inputTokens} вх. + ${s.outputTokens} вых. токенов ≈ $${s.costUsd.toFixed(4)}`);
}

// Журнал не должен ронять генерацию.
function report(r: StructuredRequest<unknown>, call: LlmCallInfo): void {
  try {
    r.onCall?.(call);
  } catch {
    // ничего: учёт — вспомогательный
  }
}

export async function generateStructured<T>(r: StructuredRequest<T>): Promise<{ value: T; target: LlmTarget; sources: string[] }> {
  if (r.chain.length === 0) throw new Error("Цепочка LLM пуста — не задан ни один провайдер.");
  const failures: string[] = [];
  const skipProviders = new Set<string>();
  const sources = new Set<string>();

  for (const target of r.chain) {
    if (skipProviders.has(target.provider)) continue;
    if (r.signal?.aborted) throw new Error(`Генерация (${r.what}) отменена.`);
    let compat = 0;
    let maxTokens = Math.min(r.maxTokens ?? target.defaultMaxTokens, target.maxTokensCap);
    let lengthRetries = 0;
    let busyRetries = 0;
    let repaired = false;
    const turns: ChatTurn[] = [{ role: "user", content: r.user }];
    r.log.info(`[сценарий] ${r.what}: ${target.label}…`);

    for (;;) {
      let res;
      try {
        res = await target.complete({
          system: r.system,
          turns,
          schemaName: r.schemaName,
          zodSchema: r.zodSchema,
          jsonSchema: r.jsonSchema,
          maxTokens,
          compat,
          signal: r.signal,
          ...(r.webSearch ? { webSearch: r.webSearch } : {}),
        });
        r.usage.add(target, { inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd });
        logPaid(r, target, res);
        report(r, { provider: target.provider, model: res.servedBy || target.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd, ok: true });
        for (const u of res.sources ?? []) sources.add(u);
        if (res.webSearchRequests) r.log.info(`[сценарий] ${target.label}: веб-поиск — ${res.webSearchRequests} запр., источников в выдаче: ${res.sources?.length ?? 0}`);
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError(`${target.label}: ${(e as Error)?.message ?? String(e)}`, "unavailable", null, e);
        r.usage.add(target, err.spent ?? null);
        if (err.spent) logPaid(r, target, err.spent);
        report(r, {
          provider: target.provider,
          model: target.model,
          inputTokens: err.spent?.inputTokens ?? null,
          outputTokens: err.spent?.outputTokens ?? null,
          costUsd: err.spent?.costUsd ?? null,
          ok: false,
        });
        if (err.kind === "aborted") throw new Error(`Генерация (${r.what}) отменена.`, { cause: err });
        if (err.kind === "bad_request" && compat < target.maxCompat) {
          compat += 1;
          r.log.warn(`[сценарий] ${err.message} — упрощаю запрос (уровень ${compat}).`);
          continue;
        }
        if (err.kind === "auth") skipProviders.add(target.provider);
        // 503 «high demand» у Gemini проходит за секунды, а следующая модель
        // цепочки (Flash-Lite) пишет заметно слабее — сначала ждём и повторяем ту же.
        if (err.kind === "unavailable" && err.status === 503 && busyRetries < BUSY_RETRIES && !r.signal?.aborted) {
          busyRetries += 1;
          const waitMs = Number(process.env.LLM_BUSY_WAIT_MS ?? 10_000) * busyRetries;
          r.log.warn(`[сценарий] ${target.label}: сервис перегружен (HTTP 503) — жду ${Math.round(waitMs / 1000)} с и повторяю…`);
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
        r.log.warn(`[сценарий] ${err.message}`);
        failures.push(err.message);
        break;
      }

      if (res.truncated) {
        if (lengthRetries < MAX_LENGTH_RETRIES && maxTokens < target.maxTokensCap) {
          lengthRetries += 1;
          maxTokens = Math.min(target.maxTokensCap, maxTokens * 2);
          r.log.warn(`[сценарий] ${target.label}: ответ обрезан по лимиту — повторяю с max_tokens=${maxTokens}.`);
          continue;
        }
        const m = `${target.label}: ответ обрезан даже при max_tokens=${maxTokens}.`;
        r.log.warn(`[сценарий] ${m}`);
        failures.push(m);
        break;
      }

      let verdict: Verdict<T>;
      try {
        verdict = r.validate(extractJson(res.text));
      } catch (e) {
        verdict = { ok: false, problems: [`ответ не является корректным JSON: ${(e as Error).message}`], warnings: [] };
      }
      if (verdict.ok) {
        if (res.servedBy && !res.servedBy.includes(target.model)) r.log.info(`[сценарий] ${r.what}: ответила модель ${res.servedBy}.`);
        for (const w of verdict.warnings) r.log.info(`[сценарий] замечание: ${w}`);
        return { value: verdict.value, target, sources: [...sources] };
      }

      if (repaired) {
        const m = `${target.label}: после исправления JSON всё ещё с ошибками (${verdict.problems.slice(0, 3).join("; ")}${verdict.problems.length > 3 ? "; …" : ""}).`;
        r.log.warn(`[сценарий] ${m}`);
        failures.push(m);
        break;
      }
      repaired = true;
      r.log.warn(`[сценарий] ${target.label}: JSON с ошибками (${verdict.problems.length}) — прошу модель исправить.`);
      turns.push({
        role: "assistant",
        // «мысли» обратно не шлём — только лишние токены (у Groq лимит 8K/мин)
        content: res.text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "").trim() || res.text,
        ...(res.native !== undefined ? { native: { provider: target.provider, model: target.model, compat, content: res.native } } : {}),
      });
      turns.push({ role: "user", content: buildRepairPrompt(verdict.problems, verdict.warnings) });
    }
  }

  throw new Error(`Не удалось получить ${r.what} ни от одной модели:\n- ${failures.join("\n- ") || "все провайдеры пропущены"}`);
}
