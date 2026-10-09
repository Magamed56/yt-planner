// Состояние очереди: план (60 тем) + сценарии + видео (релизы; неделя 1 — файлы на компьютере)
// + YouTube (загружено, запланировано, вышло) + запуски Actions. Этап ролика вычисляется, руками
// не ставится. buildState — чистая функция без сети (её проверяет scripts/state-test.ts).
import { channelFromJson, isoNoMs, localDate, upcomingSlots } from "../../src/pipeline/channel";
import { parsePlan, scriptCode } from "../../src/pipeline/plan";
import { fillItemsOf, matchVideos, planUpdates, type ChannelVideo, type FillItem } from "../../src/pipeline/youtube-fill";
import { expectedVoice, realPhotosFirst, STOCK_SECRETS, STOCK_SECRETS_LABEL, type VoiceRef } from "./checks";
import type { GhRelease, GhRun, GhStep } from "./github";
import { expectedMs, runProgress, type RunProgress } from "./progress";
import { releaseVideosOf, type ReleaseVideo } from "./ops";
import { STAGES, codesLabel, plural, shiftDateKey, type Stage } from "./stages";
import { rowStats, type RowStats } from "./stats";

export { STAGES, STAGE_LABEL, codesLabel, plural, type Stage } from "./stages";

export interface Asset {
  id: number;
  name: string;
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  url: string;
  createdAt: string;
  mp4: Asset;
  cover: Asset | null; // cover.jpg — вертикальный кадр (обложка Reels)
  thumb: Asset | null; // thumbnail.png — обложка YouTube 1280×720
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
}

export type RunKind = "draft" | "batch" | "render" | "fill" | "check" | "instagram" | "other";

export interface RunInfo {
  id: number;
  workflow: string;
  title: string;
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
}

export interface Reminder {
  kind: "runway" | "youtube" | "upload" | "fill" | "problem" | "drift" | "run" | "secrets" | "instagram";
  level: "error" | "warn" | "info";
  text: string;
  href?: string;
}

export interface SlotCell {
  iso: string;
  dateKey: string;
  dateLabel: string;
  time: string;
  occupant: string | null; // код ролика, «другое видео» или null — свободно
}

export interface AutopilotSettings {
  enabled: boolean;
  days: number; // ролики должны быть готовы за столько дней до выхода
  // Дальше — поля, добавленные позже: в старом JSON их нет, parseAutopilot ставит умолчания.
  retryFailed: boolean; // упавший за сутки запуск перезапустить один раз
  keepReleaseDays: number; // видео в релизах — столько дней после выхода; 0 — не удалять
  scriptReserve: number; // у ближайших N тем без видео сценарий пишется заранее (0–10)
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
export const DEFAULT_AUTOPILOT: AutopilotSettings = { enabled: false, days: 3, retryFailed: true, keepReleaseDays: 0, scriptReserve: 0 };
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
  runwayDays: number | null; // сколько полных дней расписания впереди (для кольца-секундомера)
  reminders: Reminder[];
  runs: RunInfo[];
  slotGrid: SlotCell[]; // слоты на 14 дней вперёд — для переноса
  youtubeError: string | null;
  missingSecrets: string[] | null; // null — неизвестно (у токена нет права Secrets: Read)
  autopilot: AutopilotSettings;
  autopilotLast: AutopilotLast | null;
  repo: string;
  branch: string;
  releaseVideos: ReleaseVideo[]; // mp4 в релизах у уже вышедших роликов — для уборки релизов
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
  runSteps?: Record<number, GhStep[]>; // шаги идущих запусков (по id)
}

// «["09a","07a"]» → коды; битое — пустой список (порядок плана).
export function parseQueueOrder(raw: string | null): string[] {
  try {
    const j: unknown = JSON.parse(raw ?? "");
    return Array.isArray(j) ? [...new Set(j.filter((c): c is string => typeof c === "string" && /^\d{2}[a-z]$/.test(c)))] : [];
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

const ACTIVE_RUN = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const RUNNING_LABEL: Partial<Record<RunKind, string>> = {
  draft: "пишется сценарий",
  batch: "сценарий и видео в работе",
  render: "собирается видео",
  fill: "заполняются тексты на YouTube",
};
const MP4_WITH_CODE = /^(\d{2}[a-z])-.+\.mp4$/i;
const DAY_MS = 86_400_000;
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
  else if (r.path.endsWith("/video-studio.yml")) kind = (/^(draft|render|batch)\b/.exec(r.display_title)?.[1] as RunKind | undefined) ?? "other";
  const codes = [...new Set([...r.display_title.matchAll(/(?:^|[^0-9a-z])(\d{2}[a-z])(?=$|[^0-9a-z])/gi)].map((m) => m[1]!.toLowerCase()))];
  const t = Date.parse(r.created_at);
  return {
    id: r.id,
    workflow: r.name,
    title: r.display_title,
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

// Самый свежий релиз с файлом «08a-….mp4» на каждый код.
function releasesByCode(releases: GhRelease[]): Map<string, ReleaseInfo> {
  const out = new Map<string, ReleaseInfo>();
  for (const r of releases) {
    if (r.draft) continue;
    const mp4 = r.assets.find((a) => MP4_WITH_CODE.test(a.name));
    if (!mp4) continue;
    const code = MP4_WITH_CODE.exec(mp4.name)![1]!.toLowerCase();
    const prev = out.get(code);
    if (prev && ms(prev.createdAt) >= ms(r.created_at)) continue;
    out.set(code, {
      tag: r.tag_name,
      url: r.html_url,
      createdAt: r.created_at,
      mp4,
      cover: r.assets.find((a) => a.name === "cover.jpg") ?? null,
      thumb: r.assets.find((a) => a.name === "thumbnail.png") ?? null,
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
  const pillarTitle = new Map((plan.pillars ?? []).map((p) => [p.id, p.title]));

  // Сценарий — файл scripts/sut-<код>-….json (или ссылка в плане на существующий файл).
  const scripts = new Map<string, string>();
  for (const name of input.scriptFiles) {
    const c = scriptCode(name);
    if (c && !scripts.has(c)) scripts.set(c, `scripts/${name}`);
  }
  for (const it of plan.items) {
    if (it.script && !scripts.has(it.id) && input.scriptFiles.includes(it.script.replace(/^scripts\//, ""))) scripts.set(it.id, it.script);
  }

  const texts = new Map<string, FillItem>();
  for (const list of input.fillLists) {
    for (const it of fillItemsOf(list)) if (it?.id && !texts.has(it.id.toLowerCase())) texts.set(it.id.toLowerCase(), it);
  }
  const releases = releasesByCode(input.releases);

  // YouTube: тот же поиск, что у youtube-fill (код в имени файла или названии, длительность).
  // Теме без текстов — заглушка с кодом и названием плана; длительность NaN — по ней не ищем.
  const videos = input.videos ?? [];
  const items: FillItem[] = plan.items.map(
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

  const runs = input.runs.map((r) => runInfo(r, f)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  // Сколько обычно идут удачные запуски того же вида — для «осталось ≈ N мин».
  const started = new Map(input.runs.map((r) => [r.id, r.run_started_at ?? r.created_at]));
  const history = input.runs
    .filter((r) => r.status === "completed" && r.conclusion === "success")
    .map((r) => {
      const info = runs.find((x) => x.id === r.id)!;
      return { kind: info.kind, codes: info.codes.length, ms: ms(r.updated_at) - ms(started.get(r.id)!) };
    });
  for (const r of runs) {
    if (!r.active) continue;
    const steps = input.runSteps?.[r.id];
    r.progress = runProgress(steps ?? [], started.get(r.id)!, expectedMs(r.kind, r.codes.length, history));
  }
  const running = new Map<string, string>();
  for (const r of runs) if (r.active) for (const c of r.codes) if (!running.has(c)) running.set(c, RUNNING_LABEL[r.kind] ?? "идёт запуск");

  const rows: Row[] = plan.items.map((it) => {
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
    };
  });

  // Ориентир для остальных: следующие свободные слоты по порядку плана — так же их раздаст
  // youtube-fill, когда ролики загрузят в Studio.
  const taken = videos.filter((v) => v.privacyStatus === "private" && v.publishAt && ms(v.publishAt) > nowMs).map((v) => v.publishAt!);
  const waiting = queueSort(
    rows.filter((r) => r.stage !== "scheduled" && r.stage !== "published"),
    input.queueOrder ?? [],
  );
  const slots = upcomingSlots(channel.schedule, waiting.length, { from: now, taken });
  waiting.forEach((r, i) => {
    r.when = slots[i] ? isoNoMs(slots[i]) : null;
  });
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

  const reminders: Reminder[] = [];
  if (input.youtubeError) reminders.push({ kind: "youtube", level: "error", text: `YouTube недоступен: ${input.youtubeError}` });
  else if (!scheduleEnd) reminders.push({ kind: "runway", level: "warn", text: "В расписании YouTube пусто — ни один ролик не запланирован." });
  else {
    const days = Math.floor((ms(scheduleEnd) - nowMs) / DAY_MS);
    const left = days < 1 ? "меньше суток" : `${days} ${plural(days, "день", "дня", "дней")}`;
    reminders.push({ kind: "runway", level: days < 2 ? "warn" : "info", text: `Расписание YouTube заполнено до ${labelOf(scheduleEnd)} — осталось ${left}.` });
  }
  const toUpload = rows.filter((r) => r.stage === "video");
  if (toUpload.length) {
    const soon = toUpload.some((r) => r.when && ms(r.when) - nowMs < 2 * DAY_MS);
    reminders.push({
      kind: "upload",
      level: soon ? "warn" : "info",
      text: `Ждут загрузки в Studio: ${codesLabel(toUpload.map((r) => r.code))}. Загрузите руками (имя файла начинается с кода), затем «Найти новые загрузки».`,
    });
  }
  const toFill = rows.filter((r) => r.stage === "studio" && !pending.has(r.code));
  if (toFill.length) {
    reminders.push({ kind: "fill", level: "warn", text: `В Studio без времени выхода: ${codesLabel(toFill.map((r) => r.code))} → «Найти новые загрузки».` });
  }
  const problems = rows.filter((r) => dups.has(r.code) || broken.has(r.code));
  if (problems.length) {
    reminders.push({ kind: "problem", level: "error", text: `Проблемы с загрузкой в Studio: ${codesLabel(problems.map((r) => r.code))} — подробности в карточке ролика.` });
  }
  const drift = rows.filter((r) => r.textsDiffer);
  if (drift.length) {
    reminders.push({
      kind: "drift",
      level: "info",
      text: `Тексты на YouTube отличаются от файла: ${codesLabel(drift.map((r) => r.code))}. Заполнение их не тронет, пока вы сами не отметите их в проверке.`,
    });
  }
  const lastDone = runs.find((r) => !r.active && r.kind !== "other" && r.kind !== "check");
  if (lastDone?.conclusion === "failure" && nowMs - ms(lastDone.createdAt) < 2 * DAY_MS) {
    reminders.push({ kind: "run", level: "error", text: `Запуск «${lastDone.title}» (${lastDone.createdLabel}) не удался — откройте лог.`, href: lastDone.url });
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
  reminders.push({
    kind: "instagram",
    level: "info",
    text: "Instagram ждёт токен EAA (проверка Meta). Пока Reels можно выложить с телефона: в карточке ролика — видео, обложка и подпись.",
  });

  const perDay = Math.max(1, channel.schedule.publishTimesLocal.length);
  const occupant = new Map<number, string>();
  for (const r of rows) if (r.stage === "scheduled" && r.when) occupant.set(minute(r.when), r.code);
  for (const t of taken) if (!occupant.has(minute(t))) occupant.set(minute(t), "другое видео");
  const slotGrid = upcomingSlots(channel.schedule, 14 * perDay, { from: now }).map((d) => ({
    iso: isoNoMs(d),
    dateKey: f.key(d.getTime()),
    dateLabel: f.day(d.getTime()),
    time: f.time(d.getTime()),
    occupant: occupant.get(minute(d)) ?? null,
  }));

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
    runwayDays: scheduleEnd ? Math.max(0, Math.floor((ms(scheduleEnd) - nowMs) / DAY_MS)) : null,
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
  };
}
