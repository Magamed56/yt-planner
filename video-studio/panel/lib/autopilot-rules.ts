// Правила автопилота без сети и без серверных модулей: их считает и cron (lib/autopilot.ts),
// и превью «что будет в 06:00» в браузере. Проверка — scripts/state-test.ts, ops-test.ts.
import { LONG_TOPICS_LOW, LONG_TTS_REQUESTS } from "../../src/pipeline/long-plan";
import { decideReserve, pickCleanup, pickRetries } from "./ops";
import type { AutopilotSettings, PanelState } from "./state";

// Бесплатный Gemini TTS — около 10 запросов в сутки: больше 6 роликов за запуск не просим
// (сюда же входят повторы упавших сборок). «Разбор» — ≈ 3 запроса: в день его сборки Shorts
// за раз не больше 3.
export const AUTOPILOT_MAX = 6;
export const LONG_COST = LONG_TTS_REQUESTS;

// Shorts: ролики, которые выходят в ближайшие days дней и ещё без видео. «Разборы» — отдельно
// (decideLong): их меньше, и у них свой лимит.
export function decideAutopilot(
  state: Pick<PanelState, "youtubeError" | "rows" | "missingSecrets">,
  settings: Pick<AutopilotSettings, "enabled" | "days">,
  now: Date,
  max: number = AUTOPILOT_MAX,
): { codes: string[]; skip: string | null } {
  // Без YouTube не видно расписания: ориентиры дат съехали бы, и собралось бы лишнее.
  if (state.youtubeError) return { codes: [], skip: `YouTube недоступен (${state.youtubeError}) — пропускаю, чтобы не собрать лишнего` };
  const horizon = now.getTime() + settings.days * 86_400_000;
  const need = state.rows.filter((r) => !r.long && (r.stage === "topic" || r.stage === "script") && !r.running && r.when && Date.parse(r.when) <= horizon);
  if (!need.length) return { codes: [], skip: `всё, что выходит в ближайшие ${settings.days} дн., уже готово или в работе` };
  const missing = state.missingSecrets ?? [];
  if (missing.includes("GEMINI_API_KEY")) return { codes: [], skip: "в секретах GitHub нет GEMINI_API_KEY — без него голос был бы не Charon" };
  if (missing.includes("ANTHROPIC_API_KEY") && need.some((r) => r.stage === "topic")) return { codes: [], skip: "в секретах GitHub нет ANTHROPIC_API_KEY — сценарии писать нечем" };
  return { codes: need.slice(0, max).map((r) => r.code), skip: null };
}

export interface LongDecision {
  code: string | null; // какой «Разбор» собрать (не больше одного за запуск)
  skip: string | null; // почему не собирает
  orderTopics: boolean; // тем «Разбора» без сценария меньше трёх — заказать новые (workflow «план тем», long)
  topicsNote: string | null; // почему не заказывает (уже заказаны)
}

const PLAN_RECENT_MS = 86_400_000;

// «Разборы»: ближайший, который выходит в ближайшие days дней и ещё без видео, — один за запуск
// (≈ 3 озвучки и 40–60 минут раннера). Тем мало — новые темы, но не чаще раза в сутки.
export function decideLong(
  state: Pick<PanelState, "youtubeError" | "rows" | "missingSecrets" | "runs">,
  settings: Pick<AutopilotSettings, "days" | "long">,
  now: Date,
): LongDecision {
  const off: LongDecision = { code: null, skip: null, orderTopics: false, topicsNote: null };
  if (settings.long === false) return { ...off, skip: "«Разборы» выключены в настройках" };
  const long = state.rows.filter((r) => r.long);
  const left = long.filter((r) => r.stage === "topic").length;
  const planRun = state.runs.find((r) => r.kind === "plan" && /Разбор/.test(r.title) && (r.active || now.getTime() - Date.parse(r.createdAt) < PLAN_RECENT_MS));
  const orderTopics = left < LONG_TOPICS_LOW && !planRun;
  const topicsNote = left < LONG_TOPICS_LOW && planRun ? `темы «Разбора» уже заказаны (${planRun.active ? "запуск идёт" : "за последние сутки"})` : null;
  const result = (code: string | null, skip: string | null): LongDecision => ({ code, skip, orderTopics, topicsNote });
  if (!long.length) return result(null, "в плане «Разборов» нет тем");
  if (state.youtubeError) return result(null, "YouTube недоступен — «Разбор» не собираю, чтобы не собрать лишнего");
  const horizon = now.getTime() + Math.max(1, settings.days) * 86_400_000;
  const next = long.find((r) => (r.stage === "topic" || r.stage === "script") && !r.running && r.when && Date.parse(r.when) <= horizon);
  if (!next) return result(null, long.some((r) => r.running) ? "«Разбор» уже собирается" : `«Разбор», который выходит в ближайшие ${settings.days} дн., уже готов (или его нет)`);
  const missing = state.missingSecrets ?? [];
  if (missing.includes("GEMINI_API_KEY")) return result(null, "в секретах GitHub нет GEMINI_API_KEY — без него голос был бы не Charon");
  if (missing.includes("ANTHROPIC_API_KEY") && next.stage === "topic") return result(null, "в секретах GitHub нет ANTHROPIC_API_KEY — сценарий «Разбора» писать нечем");
  return result(next.code, null);
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
  long?: LongDecision; // «Разбор»: соберёт ли и закажет ли новые темы
}

// Один план запуска на cron и превью: сначала «Разбор» (≈ 3 озвучки), остаток лимита — Shorts.
export function autopilotPlan(
  state: Pick<PanelState, "youtubeError" | "rows" | "missingSecrets" | "runs">,
  settings: AutopilotSettings,
  now: Date,
): { long: LongDecision; shorts: { codes: string[]; skip: string | null }; budget: number } {
  const long = decideLong(state, settings, now);
  const max = AUTOPILOT_MAX - (long.code ? LONG_COST : 0);
  const shorts = decideAutopilot(state, settings, now, max);
  return { long, shorts, budget: Math.max(0, max - shorts.codes.length) };
}

// Что сделает следующий запуск автопилота с этими настройками, если до него ничего не изменится.
export function autopilotPreview(state: Pick<PanelState, "youtubeError" | "rows" | "missingSecrets" | "runs" | "releaseVideos">, settings: AutopilotSettings, now: Date): AutopilotPreview {
  const at = nextCronAt(now);
  const planned = settings.enabled ? autopilotPlan(state, settings, at) : null;
  const decided = planned ? planned.shorts : { codes: [], skip: "автопилот выключен" };
  const built = [...decided.codes, ...(planned?.long.code ? [planned.long.code] : [])];
  const reserve = settings.enabled ? decideReserve(state, settings.scriptReserve, built, AUTOPILOT_MAX).codes : [];
  const budget = planned ? planned.budget : AUTOPILOT_MAX;
  const retries = settings.retryFailed ? pickRetries(state.runs, state.rows, at.getTime(), budget, { batch: built, draft: reserve }).runs.map((r) => r.label) : [];
  const files = pickCleanup(state.releaseVideos, settings.keepReleaseDays, at.getTime());
  return {
    at: at.toISOString(),
    build: decided.codes,
    buildSkip: decided.skip,
    reserve,
    retries,
    cleanup: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) },
    ...(planned ? { long: planned.long } : {}),
  };
}
