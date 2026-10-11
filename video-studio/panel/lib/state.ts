// Состояние очереди: план (60 тем) + сценарии + видео (релизы; неделя 1 — файлы на компьютере)
// + YouTube (загружено, запланировано, вышло) + запуски Actions. Этап ролика вычисляется, руками
// не ставится. buildState — чистая функция без сети (её проверяет scripts/state-test.ts).
import { channelFromJson, isoNoMs, localDate, longScheduleOf, upcomingSlots } from "../../src/pipeline/channel";
import { codesIn, mp4Code, normCode } from "../../src/pipeline/codes";
import { LONG_TOPICS_LOW, parseLongPlan } from "../../src/pipeline/long-plan";
import { parsePlan, scriptCode, type ContentPlan } from "../../src/pipeline/plan";
import { fillItemsOf, matchVideos, planUpdates, type ChannelVideo, type FillItem } from "../../src/pipeline/youtube-fill";
import { expectedVoice, realPhotosFirst, STOCK_SECRETS, STOCK_SECRETS_LABEL, type VoiceRef } from "./checks";
import type { GhRelease, GhRun, GhStep } from "./github";
import { expectedMs, minutesLabel, runProgress, stageOf, type RunProgress } from "./progress";
import { failedRun, releaseVideosOf, type ReleaseVideo } from "./ops";
import { STAGES, codesLabel, plural, runLabel, shiftDateKey, type Stage } from "./stages";
import type { StatsHistory } from "./history";
import { typicalRatio } from "./insights";
import { buildPulse, type Pulse } from "./pulse";
import { buildsVideo, parseRebuildList, rebuildProblem, releaseIsFresh, type Hold } from "./rebuild-hold";
import { isShorts, rowStats, viewsPerDay, type RowStats } from "./stats";

export { STAGES, STAGE_LABEL, codesLabel, plural, type Stage } from "./stages";

export interface Asset {
  id: number;
  name: string;
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  url: string;
  createdAt: string; // у релиза GitHub это дата коммита
  publishedAt: string | null; // когда релиз опубликован — по нему «свежий» и «старый»
  mp4: Asset;
  cover: Asset | null; // cover.jpg — вертикальный кадр (обложка Reels)
  thumb: Asset | null; // thumbnail.png — обложка YouTube 1280×720
  thumbJpg?: Asset | null; // thumbnail.jpg — та же обложка до 2 МБ (есть, если PNG для YouTube великоват)
  caption: Asset | null;
  qc: Asset | null; // qc.json — автопроверка после рендера (карточка: «Перед загрузкой проверьте»)
  description: Asset | null; // description.txt — тексты для YouTube, в нём блок «Видео и фото»
}

export interface YoutubeInfo {
  videoId: string;
  privacyStatus: string;
  publishAt: string | null;
  title: string;
  fileName: string | null;
}

export interface Row {
  code: string;
  title: string;
  pillar: string;
  hook: string;
  angle: string;
  facts: { claim: string; source: string }[];
  stage: Stage;
  scriptPath: string | null; // от папки video-studio: scripts/sut-08a-….json
  localVideo: boolean; // видео есть только на компьютере (неделя 1, в GitHub файла нет)
  release: ReleaseInfo | null;
  youtube: YoutubeInfo | null;
  cover: string | null; // картинка для очереди: обложка с YouTube, иначе cover.jpg / thumbnail.png из релиза
  hasTexts: boolean; // youtube-fill знает тексты (week1-videos.json / videos.json)
  textsDiffer: boolean; // на YouTube тексты не такие, как в файле
  when: string | null; // ISO: время выхода — точное (YouTube) или ориентир (следующие свободные слоты)
  whenExact: boolean;
  dateKey: string | null; // YYYY-MM-DD в поясе канала — для группировки по дням
  dateLabel: string;
  timeLabel: string;
  flags: string[];
  running: string | null; // что сейчас делает Actions с этим роликом
  stats?: RowStats | null; // просмотры, лайки, комментарии с YouTube (statistics того же videos.list)
  voice?: VoiceRef | null; // каким голосом должен быть озвучен (рубрика или канал) — для проверки релиза
  realPhotos?: boolean; // рубрика «настоящих фото» (history, nature, space): только Wikimedia — норма
  long?: boolean; // «Разбор» (L01…, content/long-plan.json): 16:9, ~7 минут, свои слоты вт/чт/сб 21:00
  // В content/rebuild.json и нет релиза новее since: старую версию в Studio не грузить (только у
  // этапа «видео»; уже загруженному в YouTube пометка не нужна).
  hold?: Hold;
}

export type RunKind = "draft" | "batch" | "render" | "fill" | "check" | "instagram" | "plan" | "titles" | "captions" | "other";

export interface RunInfo {
  id: number;
  workflow: string;
  file: string; // файл workflow: «video-studio.yml»
  title: string; // заголовок GitHub: «batch: 08a,08b»
  label: string; // по-русски: «Ролик · 08a, 08b»
  kind: RunKind;
  codes: string[];
  active: boolean;
  status: string;
  conclusion: string | null;
  createdAt: string;
  createdLabel: string;
  url: string;
  attempt: number; // номер попытки (после «Re-run» — 2 и дальше)
  progress?: RunProgress | null; // у идущего: этапы и ожидаемая длительность
  failedStage?: string | null; // упавший: этап, на котором сломался («Озвучка и видео»)
  failedStep?: string | null; // и сам шаг workflow
  durationLabel?: string | null; // закончившийся: сколько шёл
}

export interface Reminder {
  kind: "runway" | "youtube" | "upload" | "fill" | "problem" | "drift" | "run" | "secrets" | "long" | "rebuild";
  level: "error" | "warn" | "info";
  text: string;
  href?: string;
  codes?: string[]; // все коды роликов (в тексте после восьмого — «и ещё N»)
}

export interface SlotCell {
  iso: string;
  dateKey: string;
  dateLabel: string;
  time: string;
  occupant: string | null; // код ролика, «другое видео» или null — свободно
}

// «Конвейер»: до какого слота подряд, без пропусков, хватает роликов на этапе не ниже level.
export type CoverageLevel = "scheduled" | "video" | "script" | "topic";
export interface Coverage {
  level: CoverageLevel;
  untilIso: string | null; // последний слот непрерывного ряда; null — уже ближайший пуст
  untilLabel: string | null;
  slots: number;
}

// Первый будущий слот, на который на YouTube ничего не стоит, и кто его займёт по очереди.
export interface FirstGap {
  iso: string;
  label: string;
  code: string | null; // ориентир на это время (null — роликов в очереди не хватает)
  stage: Stage | null;
}

export interface AutopilotSettings {
  enabled: boolean;
  days: number; // ролики должны быть готовы за столько дней до выхода
  // Дальше — поля, добавленные позже: в старом JSON их нет, parseAutopilot ставит умолчания.
  retryFailed: boolean; // упавший за сутки запуск перезапустить один раз
  keepReleaseDays: number; // видео в релизах — столько дней после выхода; 0 — не удалять
  scriptReserve: number; // у ближайших N тем без видео сценарий пишется заранее (0–10)
  // «Разборы» (L01…): готовить их, как Shorts, за days дней — не больше одного за запуск; мало тем —
  // заказать новые (workflow «план тем», long). Нет поля (старый JSON) — включено.
  long?: boolean;
}

export interface AutopilotLast {
  at: string;
  action: string;
  codes: string[];
  note: string;
  atLabel?: string; // для показа — считает сервер (одинаково и в браузере)
}

export const AUTOPILOT_VAR = "PANEL_AUTOPILOT";
// Порядок выхода роликов, которых ещё нет в расписании YouTube (перетаскивание в календаре):
// коды по очереди. Нет переменной — по порядку плана.
export const QUEUE_ORDER_VAR = "PANEL_QUEUE_ORDER";
export const AUTOPILOT_LAST_VAR = "PANEL_AUTOPILOT_LAST";
export const DEFAULT_AUTOPILOT: AutopilotSettings = { enabled: false, days: 3, retryFailed: true, keepReleaseDays: 0, scriptReserve: 0, long: true };
export const KEEP_RELEASE_MAX = 365;
export const SCRIPT_RESERVE_MAX = 10;

const intIn = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function parseAutopilot(raw: string | null): AutopilotSettings {
  try {
    const j = JSON.parse(raw ?? "") as Partial<AutopilotSettings>;
    const d = DEFAULT_AUTOPILOT;
    return {
      enabled: j.enabled === true,
      days: intIn(j.days, 1, 14, d.days),
      retryFailed: typeof j.retryFailed === "boolean" ? j.retryFailed : d.retryFailed,
      keepReleaseDays: intIn(j.keepReleaseDays, 0, KEEP_RELEASE_MAX, d.keepReleaseDays),
      scriptReserve: intIn(j.scriptReserve, 0, SCRIPT_RESERVE_MAX, d.scriptReserve),
      long: typeof j.long === "boolean" ? j.long : true,
    };
  } catch {
    return { ...DEFAULT_AUTOPILOT };
  }
}

export function parseAutopilotLast(raw: string | null): AutopilotLast | null {
  try {
    const j = JSON.parse(raw ?? "") as AutopilotLast;
    return typeof j.at === "string" && typeof j.action === "string" ? { at: j.at, action: j.action, codes: Array.isArray(j.codes) ? j.codes : [], note: j.note ?? "" } : null;
  } catch {
    return null;
  }
}

export interface PanelState {
  generatedAt: string;
  updatedLabel: string;
  todayKey: string;
  tomorrowKey: string;
  channelName: string;
  timezone: string;
  slotTimes: string[];
  rows: Row[];
  counts: Record<Stage, number>;
  scheduleEnd: string | null; // последнее запланированное время выхода на канале
  scheduleEndLabel: string | null;
  runwayDays: number | null; // полных дней до первого пустого слота (кольцо-секундомер); null — YouTube недоступен
  runwayLabel: string | null; // до какого слота расписание без пропусков
  firstGap: FirstGap | null; // null — пропусков нет на SLOT_GRID_DAYS дней (или YouTube недоступен)
  coverage: Coverage[]; // запланировано → видео → сценарии → темы; пусто без YouTube
  topicsLeft: number; // тем плана без сценария
  topicsUntil: string | null; // ISO: когда выйдет последний ролик плана (ориентир)
  topicsUntilLabel: string | null;
  topicsDays: number | null; // на сколько дней хватит плана
  pulse: Pulse; // «Пульс»: ряд за неделю, события, последние вышедшие
  reminders: Reminder[];
  runs: RunInfo[];
  slotGrid: SlotCell[]; // слоты на SLOT_GRID_DAYS дней вперёд — перенос и «конвейер»
  youtubeError: string | null;
  missingSecrets: string[] | null; // null — неизвестно (у токена нет права Secrets: Read)
  autopilot: AutopilotSettings;
  autopilotLast: AutopilotLast | null;
  repo: string;
  branch: string;
  releaseVideos: ReleaseVideo[]; // mp4 в релизах у уже вышедших роликов — для уборки релизов
  // «Разборы» (L01…): свои слоты (вт/чт/сб 21:00) — отдельно от Shorts: запас расписания,
  // «конвейер» и первая дыра выше считаются только по Shorts.
  longSlotGrid: SlotCell[];
  longSlotTimes: string[];
  longWeekdays: number[]; // 0 — вс … 6 — сб
  longTopicsLeft: number; // тем «Разбора» без сценария
  longPlanError: string | null; // content/long-plan.json не разобрался — «Разборов» в очереди нет
}

export interface StateInput {
  now: Date;
  planJson: unknown;
  channelJson: unknown;
  scriptFiles: string[]; // имена файлов в video-studio/scripts
  fillLists: unknown[]; // week1-videos.json, videos.json (null — файла нет)
  releases: GhRelease[];
  runs: GhRun[];
  videos: ChannelVideo[] | null; // null — YouTube недоступен
  youtubeError: string | null;
  secretNames: string[] | null;
  autopilot: AutopilotSettings;
  autopilotLast: AutopilotLast | null;
  repo: string;
  branch: string;
  queueOrder?: string[]; // PANEL_QUEUE_ORDER
  history?: StatsHistory | null; // PANEL_STATS_HISTORY — для «Пульса» (в состояние — только сжатое)
  runSteps?: Record<number, GhStep[]>; // шаги идущих запусков (по id)
  longPlanJson?: unknown; // content/long-plan.json (null/нет — «Разборов» нет)
  rebuildJson?: unknown; // content/rebuild.json (null/нет/битый — никто не ждёт пересборки)
}

// «["09a","07a","L02"]» → коды; битое — пустой список (порядок плана). «Разборы» в том же
// списке: их очередь своя (свои слоты), но порядок хранится вместе.
export function parseQueueOrder(raw: string | null): string[] {
  try {
    const j: unknown = JSON.parse(raw ?? "");
    return Array.isArray(j) ? [...new Set(j.flatMap((c) => (typeof c === "string" && normCode(c) === c ? [c] : [])))] : [];
  } catch {
    return [];
  }
}

// Ролики без точного времени (ещё не в расписании YouTube) в порядке выхода: сначала по
// PANEL_QUEUE_ORDER, остальные — по порядку плана после них.
export function queueSort<T extends { code: string }>(rows: T[], order: string[]): T[] {
  const rank = new Map(order.map((c, i) => [c, i]));
  return rows
    .map((r, i) => ({ r, i, k: rank.get(r.code) ?? order.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.r);
}

// Столько же дней вперёд принимает moveVideoAction.
export const SLOT_GRID_DAYS = 60;
const COVERAGE_MIN: Record<CoverageLevel, number> = { scheduled: STAGES.indexOf("scheduled"), video: STAGES.indexOf("video"), script: STAGES.indexOf("script"), topic: 0 };

// Слот закрыт на уровне level, если на YouTube на это время что-то стоит (свой ролик или
// «другое видео»), либо ориентир на это время уже дошёл до этого этапа. Чистая функция.
export function coverage(rows: Pick<Row, "code" | "stage" | "when" | "whenExact">[], grid: SlotCell[], label: (iso: string) => string): { coverage: Coverage[]; firstGap: FirstGap | null } {
  const ahead = new Map(rows.filter((r) => !r.whenExact && r.when).map((r) => [Math.floor(Date.parse(r.when!) / 60_000), r]));
  const at = (c: SlotCell) => ahead.get(Math.floor(Date.parse(c.iso) / 60_000)) ?? null;
  const covered = (c: SlotCell, min: number) => {
    const r = at(c);
    return c.occupant !== null || (r !== null && STAGES.indexOf(r.stage) >= min);
  };
  const levels = (Object.keys(COVERAGE_MIN) as CoverageLevel[]).map((level) => {
    let n = 0;
    while (n < grid.length && covered(grid[n]!, COVERAGE_MIN[level])) n++;
    const until = n ? grid[n - 1]!.iso : null;
    return { level, untilIso: until, untilLabel: until ? label(until) : null, slots: n };
  });
  const gap = grid.find((c) => c.occupant === null);
  const who = gap ? at(gap) : null;
  return { coverage: levels, firstGap: gap ? { iso: gap.iso, label: label(gap.iso), code: who?.code ?? null, stage: who?.stage ?? null } : null };
}

const ACTIVE_RUN = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const RUNNING_LABEL: Partial<Record<RunKind, string>> = {
  draft: "пишется сценарий",
  batch: "сценарий и видео в работе",
  render: "собирается видео",
  fill: "заполняются тексты на YouTube",
  titles: "подбираются названия",
  captions: "переводятся субтитры",
};
const DAY_MS = 86_400_000;
// Слоты «Разборов» вперёд — те же ~60 дней, что у сетки Shorts (3 в неделю ≈ 26).
const LONG_GRID_SLOTS = Math.ceil((SLOT_GRID_DAYS / 7) * 3);
const ms = (t: string | number | Date) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const minute = (t: string | number | Date) => Math.floor(ms(t) / 60_000);

// Ключи, без которых конвейер в Actions работает не так, как задумано. Тексты и время на
// YouTube панель ставит сама (своими ключами Vercel), поэтому YT_* в GitHub ей не нужны.
const SECRET_NEEDS: { names: string[]; label: string; why: string }[] = [
  { names: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], label: "GEMINI_API_KEY", why: "без него Actions озвучит ролик голосом Edge, а не Charon" },
  { names: ["ANTHROPIC_API_KEY"], label: "ANTHROPIC_API_KEY", why: "сценарии пишет Claude" },
  // Хватит любого из двух: оба пустые — визуал берёт только Wikimedia и Openverse (src/pipeline/visuals).
  {
    names: STOCK_SECRETS,
    label: STOCK_SECRETS_LABEL,
    why: "без них кадры только из Wikimedia и часто мимо темы, стокового видео нет (ключи бесплатные: pexels.com/api, pixabay.com/api/docs)",
  },
];

function formatters(tz: string) {
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" });
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return {
    day: (t: number) => day.format(t),
    time: (t: number) => time.format(t),
    key: (t: number) => {
      const d = localDate(t, tz);
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    },
  };
}

function runInfo(r: GhRun, f: ReturnType<typeof formatters>): RunInfo {
  let kind: RunKind = "other";
  if (r.path.endsWith("/video-studio-youtube-fill.yml")) kind = "fill";
  else if (r.path.endsWith("/video-studio-check.yml")) kind = "check";
  else if (r.path.endsWith("/video-studio-instagram.yml")) kind = "instagram";
  else if (r.path.endsWith("/video-studio-plan.yml")) kind = "plan";
  else if (r.path.endsWith("/video-studio-titles.yml")) kind = "titles";
  else if (r.path.endsWith("/video-studio-captions.yml")) kind = "captions";
  else if (r.path.endsWith("/video-studio.yml")) kind = (/^(draft|render|batch)\b/.exec(r.display_title)?.[1] as RunKind | undefined) ?? "other";
  // «batch: 08a,08b», «batch: L01» — коды Shorts и «Разборов» (общий разбор — src/pipeline/codes.ts).
  const codes = codesIn(r.display_title);
  const t = Date.parse(r.created_at);
  return {
    id: r.id,
    workflow: r.name,
    file: r.path.split("/").pop() ?? r.path,
    title: r.display_title,
    label: runLabel(kind, r.display_title, codes),
    kind,
    codes,
    active: ACTIVE_RUN.has(r.status),
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    createdLabel: `${f.day(t)} ${f.time(t)}`,
    url: r.html_url,
    attempt: r.run_attempt ?? 1,
  };
}

// Запуски — свежие первыми; у идущих — этапы и «осталось ≈ N мин» по тому, сколько обычно
// идут удачные запуски того же вида. Нужен и очереди, и лёгкому /api/runs.
export function runInfos(ghRuns: GhRun[], steps: Record<number, GhStep[]> | undefined, tz: string): RunInfo[] {
  const f = formatters(tz);
  const runs = ghRuns.map((r) => runInfo(r, f)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const started = new Map(ghRuns.map((r) => [r.id, r.run_started_at ?? r.created_at]));
  const history = ghRuns
    .filter((r) => r.status === "completed" && r.conclusion === "success")
    .map((r) => {
      const info = runs.find((x) => x.id === r.id)!;
      return { kind: info.kind, codes: info.codes.length, ms: ms(r.updated_at) - ms(started.get(r.id)!) };
    });
  const ended = new Map(ghRuns.map((r) => [r.id, r.updated_at]));
  for (const r of runs) {
    if (r.active) {
      r.progress = runProgress(steps?.[r.id] ?? [], started.get(r.id)!, expectedMs(r.kind, r.codes.length, history));
      continue;
    }
    const took = ms(ended.get(r.id)!) - ms(started.get(r.id)!);
    r.durationLabel = Number.isFinite(took) && took > 0 ? minutesLabel(took) : null;
    const broke = r.conclusion === "failure" || r.conclusion === "timed_out" ? steps?.[r.id]?.find((s) => s.conclusion === "failure" || s.conclusion === "timed_out") : undefined;
    if (broke) {
      r.failedStep = broke.name;
      r.failedStage = stageOf(broke.name);
    }
  }
  return runs;
}

// Самый свежий релиз с файлом «08a-….mp4» (или «L01-….mp4») на каждый код — по времени
// публикации: created_at у релиза — дата коммита, и повтор старого запуска (тот же коммит) иначе
// проиграл бы прежнему релизу.
const releasedAt = (r: { publishedAt: string | null; createdAt: string }) => ms(r.publishedAt ?? r.createdAt);
function releasesByCode(releases: GhRelease[]): Map<string, ReleaseInfo> {
  const out = new Map<string, ReleaseInfo>();
  for (const r of releases) {
    if (r.draft) continue;
    const mp4 = r.assets.find((a) => mp4Code(a.name));
    if (!mp4) continue;
    const code = mp4Code(mp4.name)!;
    const prev = out.get(code);
    const publishedAt = r.published_at ?? null;
    if (prev && releasedAt(prev) >= releasedAt({ publishedAt, createdAt: r.created_at })) continue;
    out.set(code, {
      tag: r.tag_name,
      url: r.html_url,
      createdAt: r.created_at,
      publishedAt,
      mp4,
      cover: r.assets.find((a) => a.name === "cover.jpg") ?? null,
      thumb: r.assets.find((a) => a.name === "thumbnail.png") ?? null,
      thumbJpg: r.assets.find((a) => a.name === "thumbnail.jpg") ?? null,
      caption: r.assets.find((a) => a.name === "instagram.txt") ?? null,
      qc: r.assets.find((a) => a.name === "qc.json") ?? null,
      description: r.assets.find((a) => a.name === "description.txt") ?? null,
    });
  }
  return out;
}

export function buildState(input: StateInput): PanelState {
  const { now } = input;
  const nowMs = now.getTime();
  const plan = parsePlan(input.planJson);
  const channel = channelFromJson(input.channelJson ?? {});
  const tz = channel.schedule.timezone;
  const f = formatters(tz);
  const labelOf = (iso: string) => `${f.day(ms(iso))} ${f.time(ms(iso))}`;

  // «Разборы» — свой план (content/long-plan.json) и свои слоты; битый файл не роняет очередь Shorts.
  let longPlan: ContentPlan = { items: [] };
  let longPlanError: string | null = null;
  try {
    longPlan = parseLongPlan(input.longPlanJson ?? null);
  } catch (e) {
    longPlanError = e instanceof Error ? e.message : String(e);
  }
  const longSchedule = longScheduleOf(channel);
  const longCodes = new Set(longPlan.items.map((it) => it.id));
  const allItems = [...plan.items, ...longPlan.items];
  const pillarTitle = new Map([...(longPlan.pillars ?? []), ...(plan.pillars ?? [])].map((p) => [p.id, p.title]));

  // Сценарий — файл scripts/sut-<код>-….json, у «Разбора» — razbor-L01-….json (или ссылка в плане
  // на существующий файл).
  const scripts = new Map<string, string>();
  for (const name of input.scriptFiles) {
    const c = scriptCode(name);
    if (c && !scripts.has(c)) scripts.set(c, `scripts/${name}`);
  }
  for (const it of allItems) {
    if (it.script && !scripts.has(it.id) && input.scriptFiles.includes(it.script.replace(/^scripts\//, ""))) scripts.set(it.id, it.script);
  }

  // Ключ — код в каноническом виде («08a», «L01»), как id в планах.
  const texts = new Map<string, FillItem>();
  for (const list of input.fillLists) {
    for (const it of fillItemsOf(list)) {
      const key = it?.id ? (normCode(it.id) ?? it.id.toLowerCase()) : null;
      if (key && !texts.has(key)) texts.set(key, it);
    }
  }
  const releases = releasesByCode(input.releases);

  // YouTube: тот же поиск, что у youtube-fill (код в имени файла или названии, длительность).
  // Теме без текстов — заглушка с кодом и названием плана; длительность NaN — по ней не ищем.
  const videos = input.videos ?? [];
  const items: FillItem[] = allItems.map(
    (it) =>
      texts.get(it.id) ?? {
        id: it.id,
        file: it.id,
        durationSec: Number.NaN,
        title: it.title,
        description: "",
        tags: [],
        categoryId: "27",
        defaultLanguage: "ru",
        containsSyntheticMedia: true,
      },
  );
  const report = matchVideos(items, videos);
  const matched = new Map(report.matches.map((m) => [m.item.id, m.video]));
  const pending = new Map(report.pending.map((p) => [p.item.id, p.video]));
  const broken = new Map(report.broken.map((b) => [b.item.id, b.video]));
  const dups = new Map(report.duplicates.map((d) => [d.item.id, d.videos]));
  const differ = new Set(
    planUpdates({ ...report, matches: report.matches.filter((m) => texts.has(m.item.id)) }, { schedule: channel.schedule, mode: "none", now })
      .filter((p) => p.textsChanged)
      .map((p) => p.match.item.id),
  );

  const runs = runInfos(input.runs, input.runSteps, tz);
  const running = new Map<string, string>();
  for (const r of runs) if (r.active) for (const c of r.codes) if (!running.has(c)) running.set(c, RUNNING_LABEL[r.kind] ?? "идёт запуск");
  // «Ждёт пересборки» (content/rebuild.json) и какие из них собираются прямо сейчас.
  const rebuildList = parseRebuildList(input.rebuildJson ?? null);
  const rebuilding = new Set(runs.filter((r) => r.active && buildsVideo(r)).flatMap((r) => r.codes));

  const rows: Row[] = allItems.map((it) => {
    const long = longCodes.has(it.id);
    const v = matched.get(it.id) ?? pending.get(it.id) ?? dups.get(it.id)?.[0] ?? null;
    const release = releases.get(it.id) ?? null;
    const hasTexts = texts.has(it.id);
    const scriptPath = scripts.get(it.id) ?? null;
    const flags: string[] = [];
    const dup = dups.get(it.id);
    if (dup) flags.push(`загружен в Studio ${dup.length} ${plural(dup.length, "раз", "раза", "раз")} — удалите лишний`);
    if (pending.has(it.id)) flags.push("YouTube ещё обрабатывает загрузку — подождите 5–10 минут");
    const bad = broken.get(it.id);
    if (bad) flags.push(`загрузка в Studio не удалась (${bad.uploadStatus}) — загрузите файл заново`);

    let stage: Stage;
    let exact: string | null = null;
    if (v && v.privacyStatus === "public") {
      stage = "published";
      exact = v.publishedAt ?? v.publishAt;
    } else if (v && v.privacyStatus === "private" && v.publishAt && ms(v.publishAt) > nowMs) {
      stage = "scheduled";
      exact = v.publishAt;
    } else if (v) {
      stage = "studio";
      if (v.privacyStatus === "unlisted") flags.push("доступ по ссылке — время выхода ставят только приватным");
    } else if (release || hasTexts) stage = "video";
    else if (scriptPath) stage = "script";
    else stage = "topic";
    const mark = stage === "video" ? rebuildList.get(it.id) : undefined;
    const hold: Hold | null =
      mark && !releaseIsFresh(release, mark.since) ? { reason: mark.reason, since: mark.since, sinceLabel: labelOf(mark.since), rebuilding: rebuilding.has(it.id) } : null;

    return {
      code: it.id,
      title: it.title,
      pillar: pillarTitle.get(it.pillar) ?? it.pillar,
      hook: it.hook,
      angle: it.angle,
      facts: it.keyFacts.map((k) => ({ claim: k.claim, source: k.source })),
      stage,
      scriptPath,
      localVideo: !release && hasTexts,
      release,
      youtube: v ? { videoId: v.videoId, privacyStatus: v.privacyStatus, publishAt: v.publishAt, title: v.title, fileName: v.fileName } : null,
      // Ссылки YouTube на обложки (и у приватных) открываются без входа. Файлы релиза — через
      // /api/asset/<id>/file: там тип image/jpeg; временная ссылка GitHub отдаёт картинку как
      // «файл для скачивания», и телефон такую в <img> не показывает.
      cover: v?.thumbnailUrl ?? (release?.cover ? `/api/asset/${release.cover.id}/file` : release?.thumb ? `/api/asset/${release.thumb.id}/file` : null),
      hasTexts,
      textsDiffer: differ.has(it.id),
      when: exact,
      whenExact: exact !== null,
      dateKey: null,
      dateLabel: "",
      timeLabel: "",
      flags,
      running: running.get(it.id) ?? null,
      stats: v ? rowStats(v) : null,
      // Нужны только карточке с релизом — остальным строкам не раздуваем данные страницы.
      voice: release ? expectedVoice(channel, it.pillar) : null,
      realPhotos: release ? realPhotosFirst(it.pillar) : false,
      ...(long ? { long: true } : {}),
      ...(hold ? { hold } : {}),
    };
  });

  // «К обычному» у вышедших — по тем же роликам с YouTube, без лишних запросов.
  const typical = typicalRatio(
    videos
      .filter((v) => v.privacyStatus === "public" && v.publishedAt && Number.isFinite(ms(v.publishedAt)) && v.viewCount !== null && v.viewCount !== undefined)
      .map((v) => ({ videoId: v.videoId, publishedAt: v.publishedAt!, perDay: viewsPerDay(v.viewCount!, ms(v.publishedAt!), nowMs), shorts: isShorts(v.durationSec) })),
    now,
  );
  for (const r of rows) {
    const x = r.stage === "published" && r.youtube && r.stats ? typical.get(r.youtube.videoId) : undefined;
    if (x) Object.assign(r.stats!, { ratio: x.ratio, ratioLabel: x.label, verdict: x.verdict, basis: x.basis });
  }

  // Ориентир для остальных: следующие свободные слоты по порядку плана — так же их раздаст
  // youtube-fill, когда ролики загрузят в Studio.
  // «Разборы» — так же, но в свои слоты (вт/чт/сб 21:00): потоки друг у друга слоты не забирают.
  const taken = videos.filter((v) => v.privacyStatus === "private" && v.publishAt && ms(v.publishAt) > nowMs).map((v) => v.publishAt!);
  for (const long of [false, true]) {
    const waiting = queueSort(
      rows.filter((r) => Boolean(r.long) === long && r.stage !== "scheduled" && r.stage !== "published"),
      input.queueOrder ?? [],
    );
    const slots = upcomingSlots(long ? longSchedule : channel.schedule, waiting.length, { from: now, taken });
    waiting.forEach((r, i) => {
      r.when = slots[i] ? isoNoMs(slots[i]) : null;
    });
  }
  const shortRows = rows.filter((r) => !r.long);
  for (const r of rows) {
    if (!r.when) continue;
    const t = ms(r.when);
    r.dateKey = f.key(t);
    r.dateLabel = f.day(t);
    r.timeLabel = f.time(t);
  }
  rows.sort((a, b) => (a.when && b.when ? ms(a.when) - ms(b.when) : a.when ? -1 : b.when ? 1 : 0));

  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((r) => r.stage === s).length])) as Record<Stage, number>;
  const scheduleEnd = taken.length ? taken.reduce((a, b) => (ms(b) > ms(a) ? b : a)) : null;

  let missingSecrets: string[] | null = null;
  if (input.secretNames) {
    const have = new Set(input.secretNames);
    missingSecrets = SECRET_NEEDS.filter((s) => !s.names.some((n) => have.has(n))).map((s) => s.label);
  }

  const perDay = Math.max(1, channel.schedule.publishTimesLocal.length);
  const occupant = new Map<number, string>();
  for (const r of rows) if (r.stage === "scheduled" && r.when) occupant.set(minute(r.when), r.code);
  for (const t of taken) if (!occupant.has(minute(t))) occupant.set(minute(t), "другое видео");
  const cell = (d: Date): SlotCell => ({
    iso: isoNoMs(d),
    dateKey: f.key(d.getTime()),
    dateLabel: f.day(d.getTime()),
    time: f.time(d.getTime()),
    occupant: occupant.get(minute(d)) ?? null,
  });
  const slotGrid = upcomingSlots(channel.schedule, SLOT_GRID_DAYS * perDay, { from: now }).map(cell);
  const longSlotGrid = upcomingSlots(longSchedule, LONG_GRID_SLOTS * longSchedule.publishTimesLocal.length, { from: now }).map(cell);
  // Запас — до первого пустого слота, а не до последнего запланированного: дыра завтра в 12:00
  // важнее ролика, стоящего через неделю. Без YouTube о расписании судить нельзя. Только Shorts:
  // у «Разборов» свои слоты, их пропуск — не дыра в ежедневном расписании.
  const pipeline = input.youtubeError ? { coverage: [], firstGap: null } : coverage(shortRows, slotGrid, labelOf);
  const gap = pipeline.firstGap;
  const runwayDays = input.youtubeError ? null : gap ? Math.max(0, Math.floor((ms(gap.iso) - nowMs) / DAY_MS)) : SLOT_GRID_DAYS;
  const runwayLabel = pipeline.coverage.find((c) => c.level === "scheduled")?.untilLabel ?? null;

  // Когда кончится план: время выхода последнего ролика плана Shorts (ориентир).
  const planEnd = shortRows.reduce<string | null>((end, r) => (r.when && (!end || ms(r.when) > ms(end)) ? r.when : end), null);

  const reminders: Reminder[] = [];
  if (input.youtubeError) reminders.push({ kind: "youtube", level: "error", text: `YouTube недоступен: ${input.youtubeError}` });
  else if (!scheduleEnd) reminders.push({ kind: "runway", level: "warn", text: "В расписании YouTube пусто — ни один ролик не запланирован." });
  else if (gap) {
    const days = runwayDays ?? 0;
    const left = days < 1 ? "меньше суток" : `${days} ${plural(days, "день", "дня", "дней")}`;
    reminders.push({ kind: "runway", level: days < 2 ? "warn" : "info", text: `Первый пустой слот на YouTube — ${gap.label}: до него ${left}.` });
  }
  // Ждущие пересборки — не в «загрузить»: старая версия с ошибкой, новая вот-вот будет.
  const toUpload = rows.filter((r) => r.stage === "video" && !r.hold);
  if (toUpload.length) {
    const soon = toUpload.some((r) => r.when && ms(r.when) - nowMs < 2 * DAY_MS);
    reminders.push({
      kind: "upload",
      level: soon ? "warn" : "info",
      codes: toUpload.map((r) => r.code),
      text: `Ждут загрузки в Studio: ${codesLabel(toUpload.map((r) => r.code))}. Загрузите руками (имя файла начинается с кода), затем «Найти новые загрузки».`,
    });
  }
  const held = rows.filter((r) => r.hold);
  if (held.length) {
    const building = held.filter((r) => r.hold!.rebuilding).map((r) => r.code);
    const wait = held.filter((r) => !r.hold!.rebuilding);
    const reasons = [...new Set(held.map((r) => r.hold!.reason).filter(Boolean))];
    reminders.push({
      kind: "rebuild",
      // Ждёт, никто не собирает, а выходить ему меньше чем через двое суток, — пора пересобрать.
      level: wait.some((r) => r.when && ms(r.when) - nowMs < 2 * DAY_MS) ? "warn" : "info",
      codes: held.map((r) => r.code),
      text: [
        `Пересборка${reasons.length ? ` (${reasons.join("; ")})` : ""} — старые версии в Studio не загружайте.`,
        building.length ? `Идёт: ${codesLabel(building)}.` : "",
        wait.length ? `Ждут: ${codesLabel(wait.map((r) => r.code))} — «Пересобрать» в карточке ролика.` : "",
        "Готовый ролик сам вернётся в «Загрузить в Studio».",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  const rebuildNote = rebuildProblem(input.rebuildJson ?? null);
  if (rebuildNote) reminders.push({ kind: "rebuild", level: "warn", text: rebuildNote });
  const toFill = rows.filter((r) => r.stage === "studio" && !pending.has(r.code));
  if (toFill.length) {
    reminders.push({
      kind: "fill",
      level: "warn",
      text: `В Studio без времени выхода: ${codesLabel(toFill.map((r) => r.code))} → «Найти новые загрузки».`,
      codes: toFill.map((r) => r.code),
    });
  }
  const problems = rows.filter((r) => dups.has(r.code) || broken.has(r.code));
  if (problems.length) {
    reminders.push({
      kind: "problem",
      level: "error",
      text: `Проблемы с загрузкой в Studio: ${codesLabel(problems.map((r) => r.code))} — подробности в карточке ролика.`,
      codes: problems.map((r) => r.code),
    });
  }
  const drift = rows.filter((r) => r.textsDiffer);
  if (drift.length) {
    reminders.push({
      kind: "drift",
      level: "info",
      codes: drift.map((r) => r.code),
      text: `Тексты на YouTube отличаются от файла: ${codesLabel(drift.map((r) => r.code))}. Заполнение их не тронет, пока вы сами не отметите их в проверке.`,
    });
  }
  const lastDone = failedRun(runs, nowMs);
  if (lastDone) {
    const where = lastDone.failedStage ? ` на этапе «${lastDone.failedStage}»` : "";
    reminders.push({ kind: "run", level: "error", text: `Запуск «${lastDone.label}» (${lastDone.createdLabel}) не удался${where} — откройте лог.`, href: lastDone.url });
  }
  // «Разборы»: план не читается или тем почти не осталось (новые закажет автопилот).
  const longTopicsLeft = rows.filter((r) => r.long && r.stage === "topic").length;
  if (longPlanError) reminders.push({ kind: "long", level: "warn", text: `«Разборы» не показаны: ${longPlanError} Поправьте файл на GitHub.` });
  // Файла длинного плана нет — потока «Разборов» в этой ветке ещё нет: не напоминаем.
  else if (input.longPlanJson !== null && input.longPlanJson !== undefined && longTopicsLeft < LONG_TOPICS_LOW) {
    reminders.push({
      kind: "long",
      level: "info",
      href: "/runs#long",
      text: longPlan.items.length
        ? `Тем «Разбора» без сценария: ${longTopicsLeft}. Новые закажет автопилот (workflow «план тем», long) — или «+ темы «Разбора»» в «Запусках».`
        : "В плане «Разборов» (content/long-plan.json) пока нет тем — их закажет автопилот (workflow «план тем», long) или «+ темы «Разбора»» в «Запусках».",
    });
  }
  if (missingSecrets?.length) {
    // Одной причиной — один раз: «YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN — заполнение YouTube из Actions».
    const byWhy = new Map<string, string[]>();
    for (const s of SECRET_NEEDS) if (missingSecrets.includes(s.label)) byWhy.set(s.why, [...(byWhy.get(s.why) ?? []), s.label]);
    reminders.push({
      kind: "secrets",
      level: "warn",
      text: `В секретах GitHub нет: ${[...byWhy].map(([why, names]) => `${names.join(", ")} — ${why}`).join("; ")}.`,
      href: `https://github.com/${input.repo}/settings/secrets/actions`,
    });
  }


  const todayKey = f.key(nowMs);
  return {
    generatedAt: now.toISOString(),
    updatedLabel: f.time(nowMs),
    todayKey,
    tomorrowKey: shiftDateKey(todayKey, 1),
    channelName: channel.name ?? plan.channel ?? "Канал",
    timezone: tz,
    slotTimes: channel.schedule.publishTimesLocal,
    rows,
    counts,
    scheduleEnd,
    scheduleEndLabel: scheduleEnd ? labelOf(scheduleEnd) : null,
    runwayDays,
    runwayLabel,
    firstGap: gap,
    coverage: pipeline.coverage,
    topicsLeft: shortRows.filter((r) => r.stage === "topic").length,
    topicsUntil: planEnd,
    topicsUntilLabel: planEnd ? labelOf(planEnd) : null,
    topicsDays: planEnd ? Math.max(0, Math.floor((ms(planEnd) - nowMs) / DAY_MS)) : null,
    pulse: buildPulse(input.history ?? null, rows, runs, now),
    reminders,
    runs,
    slotGrid,
    youtubeError: input.youtubeError,
    missingSecrets,
    autopilot: input.autopilot,
    autopilotLast: input.autopilotLast ? { ...input.autopilotLast, atLabel: Number.isFinite(ms(input.autopilotLast.at)) ? labelOf(input.autopilotLast.at) : "" } : null,
    repo: input.repo,
    branch: input.branch,
    releaseVideos: releaseVideosOf(input.releases, new Map(rows.filter((r) => r.stage === "published" && r.when).map((r) => [r.code, r.when!]))),
    longSlotGrid,
    longSlotTimes: longSchedule.publishTimesLocal,
    longWeekdays: longSchedule.weekdays ?? [],
    longTopicsLeft,
    longPlanError,
  };
}
