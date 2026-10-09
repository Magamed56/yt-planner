// Автопилот: раз в день (Vercel Cron) смотрит, готовы ли ролики, которые выйдут в ближайшие
// N дней, и для недостающих запускает «video-studio: ролик» — mode batch, plan = коды:
// сценарий пишет Claude, ролик собирается в релиз. В Studio не грузит — это руками.
// Следом — запас сценариев (draft на ближайшие темы), повтор упавших сборок и уборка видео
// из релизов вышедших роликов (выбор — чистые функции lib/ops.ts). Повтор и уборка — со
// своими настройками, поэтому работают и при выключенном автопилоте.
import { deleteReleaseAsset, dispatchWorkflow, getVariable, rerunFailedJobs, setVariable } from "./github";
import { loadState } from "./load";
import { CLEANUP_MAX, decideReserve, pickCleanup, pickRetries } from "./ops";
import { AUTOPILOT_LAST_VAR, AUTOPILOT_VAR, codesLabel, parseAutopilot, type AutopilotLast, type AutopilotSettings, type PanelState } from "./state";

// Бесплатный Gemini TTS — около 10 запросов в сутки: больше 6 роликов за запуск не просим
// (сюда же входят повторы упавших сборок).
export const AUTOPILOT_MAX = 6;

// Входные данные сборки автопилота. voice_fallback = none: кончилась квота Gemini — ролик не
// озвучивается молча голосом Edge, а запуск падает («квота Gemini закончилась — ролик соберётся
// при повторе»): его перезапускает повтор упавших, а ролик без видео автопилот берёт и назавтра.
// Ручные «Собрать видео» и «Пересобрать» оставляют запасной голос (с пометкой в qc.json).
export function autopilotBuildInputs(codes: string[]): Record<string, string> {
  return { mode: "batch", plan: codes.join(","), upload: "release", voice_fallback: "none" };
}

export function decideAutopilot(state: PanelState, settings: Pick<AutopilotSettings, "enabled" | "days">, now: Date): { codes: string[]; skip: string | null } {
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

export interface AutopilotRun {
  last: AutopilotLast;
  did: string[]; // что сделано
  notes: string[]; // что пропущено и почему
  errors: string[]; // что не вышло (GitHub отказал)
  state?: PanelState; // загруженная очередь — её же берёт утренняя сводка на телефон (без лишней квоты)
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_048_576))} МБ`;

export async function runAutopilot(source: "cron" | "manual", now = new Date()): Promise<AutopilotRun> {
  const settings = parseAutopilot(await getVariable(AUTOPILOT_VAR).catch(() => null));
  const who = source === "cron" ? "по расписанию" : "вручную";
  const builds = source === "manual" || settings.enabled;
  if (!builds && !settings.retryFailed && !(settings.keepReleaseDays > 0)) {
    return { last: { at: now.toISOString(), action: "автопилот выключен", codes: [], note: "" }, did: [], notes: [], errors: [] };
  }
  // У функции Vercel 60 с: долгие циклы (повторы, удаление файлов) обрываем заранее.
  const deadline = Date.now() + 40_000;
  const state = await loadState(now);
  const did: string[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  const failed = (what: string, e: unknown) => {
    errors.push(`${what}: ${errorText(e)}`);
    notes.push(`${what}: ${errorText(e)}`);
  };
  const built: string[] = [];
  const drafted: string[] = [];

  if (builds) {
    const { codes, skip } = decideAutopilot(state, settings, now);
    if (skip) notes.push(skip);
    else {
      try {
        await dispatchWorkflow("video-studio.yml", autopilotBuildInputs(codes));
        built.push(...codes);
        did.push(`${codesLabel(codes)} — сценарии и видео (batch, в релиз)`);
      } catch (e) {
        failed("сборка не запущена", e);
      }
    }
    // Запас — отдельным черновиком после сборки: workflow выполняет запуски по одному, по очереди.
    const reserve = decideReserve(state, settings.scriptReserve, built, AUTOPILOT_MAX);
    if (reserve.skip) notes.push(reserve.skip);
    if (reserve.codes.length) {
      try {
        await dispatchWorkflow("video-studio.yml", { mode: "draft", plan: reserve.codes.join(",") });
        drafted.push(...reserve.codes);
        did.push(`запас сценариев: ${codesLabel(reserve.codes)} (draft)`);
      } catch (e) {
        failed("запас сценариев не запущен", e);
      }
    }
  } else notes.push("автопилот выключен — только обслуживание");

  if (settings.retryFailed) {
    const { runs, skipped } = pickRetries(state.runs, state.rows, now.getTime(), Math.max(0, AUTOPILOT_MAX - built.length), { batch: built, draft: drafted });
    const retried: string[] = [];
    for (const r of runs) {
      if (Date.now() > deadline) break;
      try {
        await rerunFailedJobs(r.id);
        retried.push(`«${r.title}» (${r.createdLabel})`);
      } catch (e) {
        failed(`повтор «${r.title}» не удался`, e);
      }
    }
    if (retried.length) did.push(`повтор упавших: ${retried.join(", ")}`);
    notes.push(...skipped.map((s) => `не повторяю ${s}`));
  }

  if (settings.keepReleaseDays > 0) {
    if (state.youtubeError) notes.push("уборка релизов пропущена: YouTube недоступен — не видно, что уже вышло");
    else {
      const files = pickCleanup(state.releaseVideos, settings.keepReleaseDays, now.getTime());
      const removed: typeof files = [];
      for (const f of files.slice(0, CLEANUP_MAX)) {
        if (Date.now() > deadline) break;
        try {
          await deleteReleaseAsset(f.assetId);
          removed.push(f);
        } catch (e) {
          failed(`не удалён ${f.name}`, e);
          break; // без прав или при сбое GitHub остальные тоже не удалятся
        }
      }
      if (removed.length) {
        const size = removed.reduce((n, f) => n + f.size, 0);
        did.push(`удалены видео из релизов: ${codesLabel([...new Set(removed.map((f) => f.code))])} (${mb(size)}; обложки и тексты остались)`);
      }
      if (files.length > removed.length && !errors.length) notes.push(`ещё видео к удалению: ${files.length - removed.length} — в следующий раз`);
    }
  }

  const last: AutopilotLast = {
    at: now.toISOString(),
    action: `${who}: ${did.length ? "сделано" : "ничего не запущено"}`,
    codes: [...built, ...drafted],
    note: [...did, ...notes].join("; "),
  };
  // Без права Variables: Write отметка не сохранится — сами запуски от этого не зависят.
  await setVariable(AUTOPILOT_LAST_VAR, JSON.stringify(last)).catch(() => {});
  return { last, did, notes, errors, state };
}
