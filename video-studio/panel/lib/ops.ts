// Обслуживание по расписанию (Vercel Cron, после автопилота): запас сценариев, повтор упавших
// сборок, уборка видео из релизов. Только чистые функции и импорты типов: их проверяет
// scripts/ops-test.ts без сети, а превью уборки считает и браузер (карточка автопилота).
import type { GhRelease } from "./github";
import type { PanelState, Row, RunInfo } from "./state";

export const DAY_MS = 86_400_000;
// Как в state.ts: файл ролика в релизе — «08a-….mp4».
const MP4_WITH_CODE = /^(\d{2}[a-z])-.+\.mp4$/i;

// ---- запас сценариев (идея 23) ----

// Ближайшие n тем без видео (по порядку плана) должны иметь сценарий: его можно проверить и
// поправить в панели до сборки. Темы, которые уже собираются (пакет этого запуска или идущий
// batch/render), в запас не входят — сценарий им напишет сама сборка.
export function decideReserve(
  state: Pick<PanelState, "rows" | "runs" | "missingSecrets">,
  n: number,
  building: string[],
  max: number,
): { codes: string[]; skip: string | null } {
  if (!(n > 0)) return { codes: [], skip: null };
  const busy = new Set([...building, ...state.runs.filter((r) => r.active && (r.kind === "batch" || r.kind === "render")).flatMap((r) => r.codes)]);
  // Строки этапов «тема»/«сценарий» идут по ориентирам слотов — это порядок плана (state.ts).
  const window = state.rows.filter((r) => (r.stage === "topic" || r.stage === "script") && !busy.has(r.code)).slice(0, n);
  const need = window.filter((r) => r.stage === "topic" && !r.running);
  if (!need.length) return { codes: [], skip: window.length ? `запас сценариев (${n}) уже есть или пишется` : "в плане не осталось тем без видео" };
  if ((state.missingSecrets ?? []).includes("ANTHROPIC_API_KEY")) return { codes: [], skip: "запас сценариев: в секретах GitHub нет ANTHROPIC_API_KEY" };
  return { codes: need.slice(0, max).map((r) => r.code), skip: null };
}

// ---- повтор упавших сборок (идея 55) ----

const FAILED_RUN_FRESH_MS = 2 * 86_400_000;

// Последний завершённый запуск конвейера, если он упал не больше двух суток назад: о нём
// напоминают панель, карточка «Сейчас» и утреннее уведомление. Проверки и прочее — не в счёт.
export function failedRun(runs: RunInfo[], nowMs: number): RunInfo | null {
  const last = runs.find((r) => !r.active && r.kind !== "other" && r.kind !== "check");
  return last?.conclusion === "failure" && nowMs - Date.parse(last.createdAt) < FAILED_RUN_FRESH_MS ? last : null;
}


const RETRY_KINDS = new Set(["draft", "batch", "render"]);
const RETRY_CONCLUSIONS = new Set(["failure", "timed_out"]);
export const RETRY_MAX = 3;

// Сколько озвучек потратит повтор: rerun-failed-jobs пересобирает весь запуск, и пакет
// озвучивает все свои ролики заново (черновик — ни одного).
export const retryCost = (r: RunInfo) => (r.kind === "draft" ? 0 : Math.max(1, r.codes.length));

// Упавшие (failure/timed_out) за последние сутки запуски «video-studio: ролик» с первой
// попытки — перезапустить один раз. Не трогаем то, что уже готово или запущено заново (в том
// числе только что этим же запуском автопилота — launched), и не выходим за лимит озвучек
// budget (общий с автопилотом).
// Какие коды упавшего запуска ещё нужно сделать: не готовые и не запущенные заново позже (в том
// числе только что этим же запуском автопилота — launched). Общее у автоповтора и «Повторить».
function retryTodo(r: RunInfo, runs: RunInfo[], rows: Pick<Row, "code" | "stage">[], launched: { batch: string[]; draft: string[] }): { todo: string[]; covered: boolean } {
  const stage = new Map(rows.map((x) => [x.code, x.stage]));
  // Черновику достаточно сценария, сборке нужно видео (или ролик уже дальше по этапам).
  const done = (code: string) => {
    const st = stage.get(code);
    return st !== undefined && st !== "topic" && (r.kind === "draft" || st !== "script");
  };
  const t = Date.parse(r.createdAt);
  const later = runs.filter((x) => x.id !== r.id && RETRY_KINDS.has(x.kind) && Date.parse(x.createdAt) > t && (x.active || x.conclusion === "success"));
  // Сценарий черновика пишет и пакет, а видео черновик не соберёт.
  const isCovered = (code: string) =>
    launched.batch.includes(code) || (r.kind === "draft" && launched.draft.includes(code)) || later.some((x) => x.codes.includes(code) && (x.kind !== "draft" || r.kind === "draft"));
  const todo = r.codes.filter((c) => !done(c) && !isCovered(c));
  return { todo, covered: r.codes.length ? !todo.length : later.some((x) => x.title === r.title) };
}

// Упавшие (failure/timed_out) за последние сутки запуски «video-studio: ролик» с первой
// попытки — перезапустить один раз. Не трогаем то, что уже готово или запущено заново, и не
// выходим за лимит озвучек budget (общий с автопилотом).
export function pickRetries(
  runs: RunInfo[],
  rows: Pick<Row, "code" | "stage">[],
  now: number,
  budget: number,
  launched: { batch: string[]; draft: string[] } = { batch: [], draft: [] },
): { runs: RunInfo[]; skipped: string[] } {
  const failed = runs
    .filter((r) => {
      const t = Date.parse(r.createdAt);
      return RETRY_KINDS.has(r.kind) && !r.active && RETRY_CONCLUSIONS.has(r.conclusion ?? "") && r.attempt === 1 && now >= t && now - t <= DAY_MS;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: RunInfo[] = [];
  const skipped: string[] = [];
  let left = budget;
  for (const r of failed) {
    if (retryTodo(r, runs, rows, launched).covered) {
      skipped.push(`«${r.title}» — уже готово или запущено заново`);
      continue;
    }
    if (out.length >= RETRY_MAX) {
      skipped.push(`«${r.title}» — не больше ${RETRY_MAX} повторов за раз`);
      continue;
    }
    const cost = retryCost(r);
    if (cost > left) {
      skipped.push(`«${r.title}» — не хватает лимита озвучек на сегодня`);
      continue;
    }
    left -= cost;
    out.push(r);
  }
  return { runs: out, skipped };
}

// «Повторить» руками (карточка «Сейчас», «Запуски»): упавший запуск ролика, не отменённый,
// меньше трёх попыток, а его ролики ещё не готовы и не запущены заново. Повтор — это
// rerun-failed-jobs, не новый запуск: защита от повторного запуска (lib/dispatch.ts) его не держит.
export const RETRY_ATTEMPTS_MAX = 3;
export function canRetry(run: RunInfo, state: Pick<PanelState, "runs" | "rows">): { ok: true; cost: number } | { ok: false; reason: string } {
  if (run.active) return { ok: false, reason: "запуск ещё идёт" };
  if (!RETRY_KINDS.has(run.kind)) return { ok: false, reason: "повтор — только у сценариев и сборок" };
  if (!RETRY_CONCLUSIONS.has(run.conclusion ?? "")) return { ok: false, reason: run.conclusion === "cancelled" ? "запуск отменён — запустите заново" : "запуск не падал" };
  if (run.attempt >= RETRY_ATTEMPTS_MAX) return { ok: false, reason: `уже ${run.attempt} попытки — смотрите лог` };
  if (retryTodo(run, state.runs, state.rows, { batch: [], draft: [] }).covered) return { ok: false, reason: "уже готово или запущено заново" };
  return { ok: true, cost: retryCost(run) };
}

// ---- уборка видео из релизов (идея 62) ----

export interface ReleaseVideo {
  code: string;
  tag: string;
  assetId: number;
  name: string;
  size: number;
  publishedAt: string; // когда ролик вышел на YouTube
}

export const CLEANUP_MAX = 20;

// mp4 из релизов только тех роликов, что уже вышли (publishedAt — по коду): релизы
// невышедших сюда не попадают вовсе. Остальные файлы релиза (json, txt, srt, png, jpg) не трогаем.
export function releaseVideosOf(releases: GhRelease[], publishedAt: Map<string, string>): ReleaseVideo[] {
  const out: ReleaseVideo[] = [];
  for (const r of releases) {
    if (r.draft) continue;
    for (const a of r.assets) {
      const code = MP4_WITH_CODE.exec(a.name)?.[1]?.toLowerCase();
      const at = code ? publishedAt.get(code) : undefined;
      if (code && at) out.push({ code, tag: r.tag_name, assetId: a.id, name: a.name, size: a.size, publishedAt: at });
    }
  }
  return out.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.name.localeCompare(b.name));
}

// Что удалить: видео роликов, вышедших больше keepDays дней назад. 0 — не удалять ничего.
export function pickCleanup(files: ReleaseVideo[], keepDays: number, now: number): ReleaseVideo[] {
  if (!(Number.isInteger(keepDays) && keepDays > 0)) return [];
  return files.filter((f) => {
    const t = Date.parse(f.publishedAt);
    return Number.isFinite(t) && now - t > keepDays * DAY_MS;
  });
}
