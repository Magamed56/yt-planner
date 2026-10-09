// Экран «Статистика» и значки просмотров: цифры роликов и канала (statistics из того же
// videos.list, что у очереди), порог монетизации, рубрики, хэштеги, расходы (минуты Actions,
// content/usage.jsonl). Только чистые функции без сети и без node:* — их проверяет
// scripts/stats-test.ts, а подписи считает сервер (в браузере покажется то же самое).
import type { ChannelStats, ChannelVideo } from "../../src/pipeline/youtube-fill";
import { retentionOverview, videoRetention, type AnalyticsProblem, type Retention, type RetentionOverview, type VideoRetention } from "./analytics";
import { plural } from "./stages";

const DAY_MS = 86_400_000;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

// ---- числа по-русски ----

// Как на YouTube: «999», «1,2 тыс.», «12 тыс.», «1,5 млн» — лишнее отбрасываем, а не округляем
// вверх (999 999 — «999 тыс.», а не «1 млн»).
const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", roundingMode: "trunc" });
const whole = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const tenths = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatCount = (n: number): string => compact.format(n);
export const formatNumber = (n: number): string => whole.format(n);
// Просмотры в сутки: маленькие — с десятыми («0,5»), большие — как счётчик.
export const formatRate = (n: number): string => (n < 10 ? tenths.format(n) : compact.format(n));
export const formatUsd = (n: number): string => (n > 0 && n < 0.01 ? `< ${usd.format(0.01)}` : usd.format(n));
const percentOf = (have: number, need: number) => (need > 0 ? Math.min(100, Math.max(0, (have / need) * 100)) : 0);

// «2026-10-09» в поясе tz — сутки канала, сутки Google и т. п.
const keyFormat = new Map<string, Intl.DateTimeFormat>();
export function dayKey(t: number, tz: string): string {
  let f = keyFormat.get(tz);
  if (!f) keyFormat.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f.format(t);
}

// ---- значок у ролика в ленте и карточке ----

export interface RowStats {
  views: number;
  likes: number | null;
  comments: number | null;
  viewsLabel: string; // «1,2 тыс.»
  likesLabel: string | null;
  commentsLabel: string | null;
}

export function rowStats(v: Pick<ChannelVideo, "viewCount" | "likeCount" | "commentCount">): RowStats | null {
  if (v.viewCount === null || v.viewCount === undefined) return null;
  const label = (n: number | null | undefined) => (n === null || n === undefined ? null : formatCount(n));
  return {
    views: v.viewCount,
    likes: v.likeCount ?? null,
    comments: v.commentCount ?? null,
    viewsLabel: formatCount(v.viewCount),
    likesLabel: label(v.likeCount),
    commentsLabel: label(v.commentCount),
  };
}

// ---- ролики ----

// Ролик плана на канале — как его сопоставила очередь (код в имени файла и т. д.).
export interface Topic {
  videoId: string;
  code: string;
  pillar: string; // id рубрики из content/plan.json
}

export interface Pillar {
  id: string;
  title: string;
}

export interface VideoStat {
  videoId: string;
  code: string | null; // null — видео не из плана
  title: string;
  pillar: string | null;
  pillarTitle: string | null;
  publishedAt: string;
  dateLabel: string;
  days: number; // сутки с выхода (дробные, не меньше 1 — иначе свежий ролик «наберёт» тысячи в сутки)
  fresh: boolean; // вышел меньше суток назад — в сравнения (лучший/худший, рубрики, хэштеги) не берём
  shorts: boolean;
  views: number;
  likes: number | null;
  comments: number | null;
  perDay: number;
  viewsLabel: string;
  likesLabel: string;
  commentsLabel: string;
  perDayLabel: string;
  mark: "best" | "worst" | null; // по просмотрам в сутки
  thumbnailUrl: string | null;
  retention?: VideoRetention | null; // % досмотра и средний просмотр из YouTube Analytics; null — нет данных
}

// Shorts — до 3 минут: для порога монетизации считаются только их просмотры.
const SHORTS_MAX_SEC = 180;

// Вышедшие ролики канала с цифрами; по умолчанию — по просмотрам. retention — строки YouTube Analytics.
export function videoStats(videos: ChannelVideo[], topics: Topic[], pillars: Pillar[], now: Date, tz: string, retention?: Map<string, Retention> | null): VideoStat[] {
  const byVideo = new Map(topics.map((t) => [t.videoId, t]));
  const pillarTitle = new Map(pillars.map((p) => [p.id, p.title]));
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" });
  const nowMs = now.getTime();
  const list: VideoStat[] = [];
  for (const v of videos) {
    const at = ms(v.publishedAt);
    if (v.privacyStatus !== "public" || !Number.isFinite(at)) continue;
    const topic = byVideo.get(v.videoId);
    const views = v.viewCount ?? 0;
    const age = Math.max(0, nowMs - at);
    const days = Math.max(1, age / DAY_MS);
    const perDay = views / days;
    const shorts = v.durationSec === null || v.durationSec <= SHORTS_MAX_SEC;
    list.push({
      videoId: v.videoId,
      code: topic?.code ?? null,
      title: v.title,
      pillar: topic?.pillar ?? null,
      pillarTitle: topic ? (pillarTitle.get(topic.pillar) ?? topic.pillar) : null,
      publishedAt: v.publishedAt!,
      dateLabel: day.format(at),
      days,
      fresh: age < DAY_MS,
      shorts,
      views,
      likes: v.likeCount ?? null,
      comments: v.commentCount ?? null,
      perDay,
      viewsLabel: formatCount(views),
      likesLabel: v.likeCount === null || v.likeCount === undefined ? "—" : formatCount(v.likeCount),
      commentsLabel: v.commentCount === null || v.commentCount === undefined ? "—" : formatCount(v.commentCount),
      perDayLabel: formatRate(perDay),
      mark: null,
      thumbnailUrl: v.thumbnailUrl ?? null,
      retention: videoRetention(retention?.get(v.videoId), shorts),
    });
  }
  // Лучший и худший — по просмотрам в сутки среди роликов старше суток: так старые не
  // выигрывают просто возрастом, а только что вышедший не попадает в худшие.
  const settled = list.filter((v) => !v.fresh);
  if (settled.length >= 2) {
    const best = settled.reduce((a, b) => (b.perDay > a.perDay ? b : a));
    const worst = settled.reduce((a, b) => (b.perDay < a.perDay ? b : a));
    if (best.perDay > worst.perDay) {
      best.mark = "best";
      worst.mark = "worst";
    }
  }
  return list.sort((a, b) => b.views - a.views || ms(b.publishedAt) - ms(a.publishedAt));
}

// ---- монетизация (YouTube Partner Program) ----

export const YPP = {
  full: { subscribers: 1000, shortsViews90: 10_000_000 },
  lower: { subscribers: 500, shortsViews90: 3_000_000, uploads90: 3 },
};

export interface Goal {
  label: string;
  have: number | null; // null — YouTube не показал (подписчики скрыты, YouTube недоступен)
  need: number;
  approx: boolean;
  haveLabel: string;
  needLabel: string;
  percent: number; // 0–100
  done: boolean;
}

export interface Tier {
  id: "full" | "lower";
  title: string;
  perks: string;
  goals: Goal[];
  done: boolean;
}

export interface Monetization {
  tiers: Tier[];
  views90: number; // ≈ просмотры Shorts за 90 дней
  videos90: number; // публичных роликов за 90 дней
  engaged: boolean; // посчитано по засчитанным просмотрам (engagedViews из Analytics)
}

function goal(label: string, have: number | null, need: number, approx = false): Goal {
  return {
    label,
    have,
    need,
    approx,
    haveLabel: have === null ? "нет данных" : `${approx ? "≈ " : ""}${have >= 100_000 ? formatCount(have) : formatNumber(have)}`,
    needLabel: need >= 100_000 ? formatCount(need) : formatNumber(need),
    percent: have === null ? 0 : percentOf(have, need),
    done: have !== null && have >= need,
  };
}

// Data API не отдаёт просмотры за период — берём сумму просмотров Shorts, вышедших за последние
// 90 дней: для молодого канала это почти то же самое. Порог YouTube считает по засчитанным
// просмотрам (у Shorts с 2025 года «просмотр» — любой запуск), поэтому, если Analytics их отдал,
// берём их; у ролика без строки Analytics (свежий) — просмотры Data API.
export function monetization(channel: ChannelStats | null, videos: VideoStat[], now: Date): Monetization {
  const since = now.getTime() - 90 * DAY_MS;
  const recent = videos.filter((v) => ms(v.publishedAt) >= since);
  const shorts = recent.filter((v) => v.shorts);
  const engaged = shorts.some((v) => typeof v.retention?.engagedViews === "number");
  const views90 = shorts.reduce((s, v) => s + (v.retention?.engagedViews ?? v.views), 0);
  const subs = channel?.subscriberCount ?? null;
  const tier = (id: Tier["id"], title: string, perks: string, goals: Goal[]): Tier => ({ id, title, perks, goals, done: goals.every((g) => g.done) });
  return {
    views90,
    videos90: recent.length,
    engaged,
    tiers: [
      tier("full", "Полная монетизация", "доход от рекламы в Shorts", [
        goal("Подписчики", subs, YPP.full.subscribers),
        goal("Просмотры Shorts за 90 дней", views90, YPP.full.shortsViews90, true),
      ]),
      tier("lower", "Начальный уровень", "Спонсорство, Super Thanks, покупки", [
        goal("Подписчики", subs, YPP.lower.subscribers),
        goal("Просмотры Shorts за 90 дней", views90, YPP.lower.shortsViews90, true),
        goal("Публичные ролики за 90 дней", recent.length, YPP.lower.uploads90),
      ]),
    ],
  };
}

// ---- рубрики ----

export interface PillarScore {
  id: string;
  title: string;
  videos: number;
  views: number;
  perDay: number | null; // средние просмотры в сутки; null — роликов рубрики ещё не было
  perDayLabel: string;
  share: number; // доля от лучшей рубрики (0–1) — длина полоски
}

// Рейтинг рубрик: средние просмотры в сутки на ролик, лучшие — первыми; рубрики без вышедших
// роликов — в конце в порядке плана. По этому списку можно будет ставить темы в очередь.
export function pillarRanking(items: { pillar: string | null; perDay: number; views: number }[], pillars: Pillar[]): PillarScore[] {
  const acc = new Map<string, { videos: number; views: number; perDay: number }>();
  for (const it of items) {
    if (!it.pillar) continue;
    const a = acc.get(it.pillar) ?? { videos: 0, views: 0, perDay: 0 };
    a.videos += 1;
    a.views += it.views;
    a.perDay += it.perDay;
    acc.set(it.pillar, a);
  }
  const known = new Set(pillars.map((p) => p.id));
  const all = [...pillars, ...[...acc.keys()].filter((id) => !known.has(id)).map((id) => ({ id, title: id }))];
  const scores = all.map((p) => {
    const a = acc.get(p.id);
    const perDay = a ? a.perDay / a.videos : null;
    return { id: p.id, title: p.title, videos: a?.videos ?? 0, views: a?.views ?? 0, perDay, perDayLabel: perDay === null ? "—" : formatRate(perDay), share: 0 };
  });
  const top = Math.max(0, ...scores.map((s) => s.perDay ?? 0));
  for (const s of scores) s.share = top > 0 && s.perDay !== null ? s.perDay / top : 0;
  const order = new Map(all.map((p, i) => [p.id, i]));
  return scores.sort((a, b) => {
    if (a.perDay === null || b.perDay === null) return a.perDay === b.perDay ? order.get(a.id)! - order.get(b.id)! : a.perDay === null ? 1 : -1;
    return b.perDay - a.perDay || b.videos - a.videos || order.get(a.id)! - order.get(b.id)!;
  });
}

// ---- хэштеги ----

// «#Голос, #почемутак!» → ["#голос", "#почемутак"]. Решётка внутри ссылки («page#part») и
// одни цифры («#1») — не хэштеги. YouTube не различает регистр — приводим к нижнему.
export function hashtagsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]+)/gu)) {
    if (!/^\d+$/.test(m[1]!)) out.add(`#${m[1]!.toLowerCase()}`);
  }
  return [...out];
}

export interface HashtagScore {
  tag: string;
  videos: number;
  avgViews: number;
  avgLabel: string;
}

export interface HashtagRanking {
  best: HashtagScore[];
  worst: HashtagScore[];
  everywhere: string[]; // есть в каждом ролике — сравнивать не с чем
  rare: number; // хэштегов, которые были меньше чем в minVideos роликах
  videos: number;
}

// Средние просмотры роликов с хэштегом. Только хэштеги хотя бы из minVideos роликов: по одному
// ролику выводов не сделать. Лучшие и худшие не пересекаются.
export function hashtagRanking(videos: { description: string; views: number }[], opts: { minVideos?: number; top?: number } = {}): HashtagRanking {
  const minVideos = opts.minVideos ?? 2;
  const top = opts.top ?? 5;
  const acc = new Map<string, { videos: number; views: number }>();
  for (const v of videos) {
    for (const tag of hashtagsOf(v.description)) {
      const a = acc.get(tag) ?? { videos: 0, views: 0 };
      a.videos += 1;
      a.views += v.views;
      acc.set(tag, a);
    }
  }
  const everywhere = videos.length >= 2 ? [...acc].filter(([, a]) => a.videos === videos.length).map(([t]) => t) : [];
  const ranked = [...acc]
    .filter(([t, a]) => a.videos >= minVideos && !everywhere.includes(t))
    .map(([tag, a]) => ({ tag, videos: a.videos, avgViews: a.views / a.videos, avgLabel: formatCount(Math.round(a.views / a.videos)) }))
    .sort((a, b) => b.avgViews - a.avgViews || b.videos - a.videos || a.tag.localeCompare(b.tag));
  const nBest = Math.min(top, Math.ceil(ranked.length / 2));
  const nWorst = Math.min(top, ranked.length - nBest);
  return {
    best: ranked.slice(0, nBest),
    worst: nWorst ? ranked.slice(-nWorst).reverse() : [],
    everywhere: everywhere.sort(),
    rare: [...acc.values()].filter((a) => a.videos < minVideos).length,
    videos: videos.length,
  };
}

// ---- расходы: GitHub Actions ----

export const ACTIONS_FREE_MINUTES = 2000; // приватный репозиторий, бесплатный тариф, в месяц

export interface RunTiming {
  id: number;
  status: string; // queued | in_progress | completed | …
  createdAt: string;
  startedAt: string | null; // run_started_at
  updatedAt: string;
}

export interface ActionsUsage {
  minutes: number;
  runs: number;
  limit: number;
  percent: number;
  minutesLabel: string; // «1 234»
  limitLabel: string; // «2 000»
  monthLabel: string; // «октябрь»
}

// Минуты месяца (по UTC, как считает GitHub): длительность каждого запуска с округлением вверх
// до минуты — так GitHub округляет каждую задачу; у workflow канала задача одна.
export function actionsMinutes(runs: RunTiming[], now: Date): ActionsUsage {
  const nowMs = now.getTime();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let minutes = 0;
  let count = 0;
  for (const r of runs) {
    if (!(ms(r.createdAt) >= monthStart)) continue;
    count += 1;
    const start = ms(r.startedAt ?? r.createdAt);
    const end = r.status === "completed" ? ms(r.updatedAt) : r.status === "in_progress" ? nowMs : start;
    const dur = end - start;
    if (Number.isFinite(dur) && dur > 0) minutes += Math.ceil(dur / 60_000);
  }
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", month: "long" }).format(monthStart);
  return {
    minutes,
    runs: count,
    limit: ACTIONS_FREE_MINUTES,
    percent: percentOf(minutes, ACTIONS_FREE_MINUTES),
    minutesLabel: formatNumber(minutes),
    limitLabel: formatNumber(ACTIONS_FREE_MINUTES),
    monthLabel,
  };
}

// ---- расходы: content/usage.jsonl (пишет конвейер: сценарии — Claude, озвучка — Gemini…) ----

export interface UsageRecord {
  at: string;
  kind: string; // script | tts | …
  code: string | null;
  provider: string; // claude | gemini | edge | piper | …
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  calls: number | null;
  chars: number | null;
  runId: string | null;
}

// Одна запись JSON на строку; битые строки (оборванная запись, ручная правка) пропускаем и считаем.
export function parseUsage(text: string): { records: UsageRecord[]; bad: number } {
  const records: UsageRecord[] = [];
  let bad = 0;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as Record<string, unknown>;
      const at = str(j?.at);
      const kind = str(j?.kind);
      const provider = str(j?.provider);
      if (!at || !Number.isFinite(Date.parse(at)) || !kind || !provider) throw new Error("не та запись");
      records.push({
        at,
        kind,
        code: str(j.code),
        provider: provider.toLowerCase(),
        model: str(j.model),
        inputTokens: num(j.inputTokens),
        outputTokens: num(j.outputTokens),
        costUsd: num(j.costUsd),
        calls: num(j.calls),
        chars: num(j.chars),
        runId: str(j.runId) ?? (typeof j.runId === "number" ? String(j.runId) : null),
      });
    } catch {
      bad += 1;
    }
  }
  return { records, bad };
}

export const GEMINI_FREE_TTS_PER_DAY = 10; // бесплатный Gemini TTS — около 10 озвучек в сутки
// Суточные лимиты Gemini API обнуляются в полночь по тихоокеанскому времени.
const GOOGLE_TZ = "America/Los_Angeles";

export interface UsageSummary {
  claude: { monthUsd: number; todayUsd: number; monthRequests: number; unpriced: number; monthUsdLabel: string; todayUsdLabel: string };
  gemini: { today: number; limit: number; percent: number; resetLabel: string };
  records: number;
  bad: number;
}

// Ближайшая полночь в поясе tz (у тихоокеанского времени сдвиг — целые часы).
function nextMidnight(t: number, tz: string): number {
  const today = dayKey(t, tz);
  let h = Math.ceil(t / 3_600_000) * 3_600_000;
  for (let i = 0; i < 50 && dayKey(h, tz) === today; i++) h += 3_600_000;
  return h;
}

export function usageSummary(records: UsageRecord[], now: Date, tz: string, bad = 0): UsageSummary {
  const nowMs = now.getTime();
  const today = dayKey(nowMs, tz);
  const month = today.slice(0, 7);
  const googleToday = dayKey(nowMs, GOOGLE_TZ);
  let monthUsd = 0;
  let todayUsd = 0;
  let monthRequests = 0;
  let unpriced = 0;
  let gemini = 0;
  for (const r of records) {
    const t = ms(r.at);
    if (r.provider === "claude" || r.provider === "anthropic") {
      const key = dayKey(t, tz);
      if (key.slice(0, 7) !== month) continue;
      monthRequests += 1;
      if (r.costUsd === null) unpriced += 1;
      monthUsd += r.costUsd ?? 0;
      if (key === today) todayUsd += r.costUsd ?? 0;
    } else if (r.provider === "gemini" && r.kind === "tts" && dayKey(t, GOOGLE_TZ) === googleToday) {
      gemini += r.calls ?? 1;
    }
  }
  const reset = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(nextMidnight(nowMs, GOOGLE_TZ));
  return {
    claude: { monthUsd, todayUsd, monthRequests, unpriced, monthUsdLabel: formatUsd(monthUsd), todayUsdLabel: formatUsd(todayUsd) },
    gemini: { today: gemini, limit: GEMINI_FREE_TTS_PER_DAY, percent: percentOf(gemini, GEMINI_FREE_TTS_PER_DAY), resetLabel: reset },
    records: records.length,
    bad,
  };
}

// ---- вовлечённость ----

function engagement(videos: VideoStat[]): Pick<ChannelSummary, "avgViewsLabel" | "engagementLabel" | "likesLabel"> {
  const views = videos.reduce((s, v) => s + v.views, 0);
  const likes = videos.reduce((s, v) => s + (v.likes ?? 0), 0);
  const comments = videos.reduce((s, v) => s + (v.comments ?? 0), 0);
  return {
    avgViewsLabel: videos.length ? formatCount(Math.round(views / videos.length)) : "—",
    engagementLabel: views > 0 ? percentLabel(((likes + comments) / views) * 100) : "—",
    likesLabel: formatCount(likes),
  };
}

// ---- всё вместе ----

export interface ChannelSummary {
  subscribers: number | null;
  subscribersLabel: string;
  views: number | null;
  viewsLabel: string;
  published: number; // вышедших роликов
  publishedLabel: string; // «12 роликов»
  avgViewsLabel: string; // средние просмотры на вышедший ролик
  engagementLabel: string; // (лайки + комментарии) / просмотры
  likesLabel: string; // лайки всех вышедших роликов
}

// Доля в процентах по-русски: «4,1 %»; меньше 10 — с десятыми.
const percentLabel = (p: number) => `${p < 10 ? tenths.format(p) : whole.format(p)} %`;

export interface StatsInput {
  now: Date;
  timezone: string; // пояс канала: «сегодня», «этот месяц», подписи дат
  videos: ChannelVideo[] | null; // null — YouTube недоступен
  channel: ChannelStats | null;
  youtubeError: string | null;
  topics: Topic[];
  pillars: Pillar[];
  runs: RunTiming[] | null; // запуски Actions с начала месяца; null — GitHub не ответил
  runsError: string | null;
  usageText: string | null; // content/usage.jsonl; null — файла ещё нет
  usageError: string | null;
  retention?: Map<string, Retention> | null; // YouTube Analytics по videoId; null — не спрашивали или отказ
  retentionProblem?: AnalyticsProblem | null; // почему удержания нет (нет права, API выключен…)
}

export interface StatsData {
  channel: ChannelSummary | null;
  youtubeError: string | null;
  videos: VideoStat[];
  fresh: number; // вышли меньше суток назад — в сравнения не попали
  monetization: Monetization;
  pillars: PillarScore[];
  hashtags: HashtagRanking;
  actions: ActionsUsage | null;
  actionsError: string | null;
  usage: UsageSummary | null; // null — данных ещё нет
  usageError: string | null;
  retention: RetentionOverview | null; // средний досмотр канала; null — данных Analytics нет
  retentionProblem: AnalyticsProblem | null;
}

export function buildStats(input: StatsInput): StatsData {
  const { now } = input;
  const all = input.videos ?? [];
  const videos = videoStats(all, input.topics, input.pillars, now, input.timezone, input.retention);
  const settled = videos.filter((v) => !v.fresh);
  const description = new Map(all.map((v) => [v.videoId, v.description]));
  const subs = input.channel?.subscriberCount ?? null;
  const views = input.channel?.viewCount ?? null;
  let usage: UsageSummary | null = null;
  if (input.usageText?.trim()) {
    const parsed = parseUsage(input.usageText);
    if (parsed.records.length) usage = usageSummary(parsed.records, now, input.timezone, parsed.bad);
  }
  return {
    channel:
      input.channel || input.videos
        ? {
            subscribers: subs,
            subscribersLabel: subs === null ? "—" : formatNumber(subs),
            views,
            viewsLabel: views === null ? "—" : formatNumber(views),
            published: videos.length,
            publishedLabel: `${videos.length} ${plural(videos.length, "ролик", "ролика", "роликов")}`,
            ...engagement(videos),
          }
        : null,
    youtubeError: input.youtubeError,
    videos,
    fresh: videos.length - settled.length,
    monetization: monetization(input.channel, videos, now),
    pillars: pillarRanking(settled, input.pillars),
    hashtags: hashtagRanking(settled.map((v) => ({ description: description.get(v.videoId) ?? "", views: v.views }))),
    actions: input.runs ? actionsMinutes(input.runs, now) : null,
    actionsError: input.runsError,
    usage,
    usageError: input.usageError,
    retention: retentionOverview(videos.map((v) => v.retention)),
    retentionProblem: input.retentionProblem ?? null,
  };
}
