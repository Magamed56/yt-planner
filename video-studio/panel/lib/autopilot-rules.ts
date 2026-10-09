// Правила автопилота без сети и без серверных модулей: их считает и cron (lib/autopilot.ts),
// и превью «что будет в 06:00» в браузере. Проверка — scripts/state-test.ts, ops-test.ts.
import { decideReserve, pickCleanup, pickRetries } from "./ops";
import type { AutopilotSettings, PanelState } from "./state";

// Бесплатный Gemini TTS — около 10 запросов в сутки: больше 6 роликов за запуск не просим
// (сюда же входят повторы упавших сборок).
export const AUTOPILOT_MAX = 6;

export function decideAutopilot(state: Pick<PanelState, "youtubeError" | "rows" | "missingSecrets">, settings: Pick<AutopilotSettings, "enabled" | "days">, now: Date): { codes: string[]; skip: string | null } {
  // Без YouTube не видно расписания: ориентиры дат съехали бы, и собралось бы лишнее.
  if (state.youtubeError) return { codes: [], skip: `YouTube недоступен (${state.youtubeError}) — пропускаю, чтобы не собрать лишнего` };
  const horizon = now.getTime() + settings.days * 86_400_000;
  const need = state.rows.filter((r) => (r.stage === "topic" || r.stage === "script") && !r.running && r.when && Date.parse(r.when) <= horizon);
  if (!need.length) return { codes: [], skip: `всё, что выходит в ближайшие ${settings.days} дн., уже готово или в работе` };
  const missing = state.missingSecrets ?? [];
  if (missing.includes("GEMINI_API_KEY")) return { codes: [], skip: "в секретах GitHub нет GEMINI_API_KEY — без него голос был бы не Charon" };
  if (missing.includes("ANTHROPIC_API_KEY") && need.some((r) => r.stage === "topic")) return { codes: [], skip: "в секретах GitHub нет ANTHROPIC_API_KEY — сценарии писать нечем" };
  return { codes: need.slice(0, AUTOPILOT_MAX).map((r) => r.code), skip: null };
}


// Vercel Cron: «0 3 * * *» (vercel.json) — 03:00 UTC, 06:00 по Москве.
export const CRON_UTC_HOUR = 3;

export function nextCronAt(now: Date): Date {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_UTC_HOUR));
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

export interface AutopilotPreview {
  at: string; // ISO следующего запуска
  build: string[]; // соберёт (batch)
  buildSkip: string | null; // почему не соберёт ничего
  reserve: string[]; // запас сценариев (draft)
  retries: string[]; // повторит упавшие (названия)
  cleanup: { files: number; bytes: number };
}

// Что сделает следующий запуск автопилота с этими настройками, если до него ничего не изменится.
export function autopilotPreview(state: Pick<PanelState, "youtubeError" | "rows" | "missingSecrets" | "runs" | "releaseVideos">, settings: AutopilotSettings, now: Date): AutopilotPreview {
  const at = nextCronAt(now);
  const decided = settings.enabled ? decideAutopilot(state, settings, at) : { codes: [], skip: "автопилот выключен" };
  const reserve = settings.enabled ? decideReserve(state, settings.scriptReserve, decided.codes, AUTOPILOT_MAX).codes : [];
  const retries = settings.retryFailed ? pickRetries(state.runs, state.rows, at.getTime(), Math.max(0, AUTOPILOT_MAX - decided.codes.length), { batch: decided.codes, draft: reserve }).runs.map((r) => r.label) : [];
  const files = pickCleanup(state.releaseVideos, settings.keepReleaseDays, at.getTime());
  return { at: at.toISOString(), build: decided.codes, buildSkip: decided.skip, reserve, retries, cleanup: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) } };
}
