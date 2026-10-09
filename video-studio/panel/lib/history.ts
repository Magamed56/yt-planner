// История цифр канала — основа для трендов («+58 подписчиков за неделю», «вчера +1,9 тыс.
// просмотров»): YouTube отдаёт только итоги на сейчас. Базы нет — хранится компактным JSON в
// переменной репозитория PANEL_STATS_HISTORY (лимит GitHub — 48 КБ, держим ≤ 40 000 знаков).
// Чистые функции без сети; запись — lib/history-store.ts, проверка — scripts/history-test.ts.
import type { ChannelStats, ChannelVideo } from "../../src/pipeline/youtube-fill";

export const HISTORY_VAR = "PANEL_STATS_HISTORY";
export const HISTORY_MAX_CHARS = 40_000;

const MIN = 60_000;
const HOUR = 60;
const DAY = 24 * HOUR;
const CH_DAYS = 120; // по дню на строку
const CH_KEEP_TRIM_DAYS = 90; // если места мало — дневные строки старше этого уходят
const T_DAYS = 7; // точки «за час» по каналу
const T_GAP_MIN = 55; // не чаще раза в 55 минут
const VID_DAYS = 14; // кривая ролика — первые две недели
const VID_HOURLY_H = 48; // первые 48 ч — по точке в час, дальше — раз в сутки

// ch: [день по Москве, подписчики, сумма просмотров, публичных роликов]
// t: [минута Unix, сумма просмотров, подписчики] — за последние 7 дней
// vid: { id: { p: минута выхода, s: [[часов после выхода, просмотры]] } }
export interface StatsHistory {
  v: 1;
  ch: [string, number | null, number, number][];
  t: [number, number, number | null][];
  vid: Record<string, { p: number; s: [number, number][] }>;
}

export const emptyHistory = (): StatsHistory => ({ v: 1, ch: [], t: [], vid: {} });

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const numOrNull = (x: unknown): x is number | null => x === null || num(x);

// Терпимо к мусору: битое — пусто, кривые строки — пропускаем.
export function parseHistory(raw: string | null): StatsHistory {
  let j: unknown;
  try {
    j = JSON.parse(raw ?? "");
  } catch {
    return emptyHistory();
  }
  const o = (j ?? {}) as Partial<Record<keyof StatsHistory, unknown>>;
  if (o.v !== 1) return emptyHistory();
  const ch = (Array.isArray(o.ch) ? o.ch : []).filter((r): r is StatsHistory["ch"][number] => Array.isArray(r) && typeof r[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && numOrNull(r[1]) && num(r[2]) && num(r[3]));
  const t = (Array.isArray(o.t) ? o.t : []).filter((r): r is StatsHistory["t"][number] => Array.isArray(r) && num(r[0]) && num(r[1]) && numOrNull(r[2]));
  const vid: StatsHistory["vid"] = {};
  if (o.vid && typeof o.vid === "object") {
    for (const [id, e] of Object.entries(o.vid as Record<string, unknown>)) {
      const x = e as { p?: unknown; s?: unknown };
      if (!num(x?.p) || !Array.isArray(x.s)) continue;
      vid[id] = { p: x.p, s: x.s.filter((p): p is [number, number] => Array.isArray(p) && num(p[0]) && num(p[1])) };
    }
  }
  return { v: 1, ch, t, vid };
}

function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

// Последняя точка «за час» старше 55 минут (или её нет) — пора записать новую.
export function snapshotDue(h: StatsHistory, now: Date): boolean {
  const last = h.t.at(-1)?.[0];
  return last === undefined || Math.floor(now.getTime() / MIN) - last >= T_GAP_MIN;
}

// Добавить снимок. Повтор того же снимка JSON не меняет. Ролики, которых больше нет на канале,
// выпадают; кривая ролика — по точке в час первые 48 ч, дальше раз в сутки, до 14 дней.
export function recordSnapshot(h: StatsHistory, videos: ChannelVideo[], channel: ChannelStats | null, now: Date, timeZone: string): StatsHistory {
  const nowMs = now.getTime();
  const nowMin = Math.floor(nowMs / MIN);
  const pub = videos.filter((v) => v.privacyStatus === "public" && v.publishedAt && Number.isFinite(Date.parse(v.publishedAt)));
  const views = pub.reduce((s, v) => s + (v.viewCount ?? 0), 0);
  const subs = channel?.subscriberCount ?? null;

  const today = dayKey(nowMs, timeZone);
  const oldestDay = dayKey(nowMs - (CH_DAYS - 1) * DAY * MIN, timeZone);
  const ch = h.ch.filter((r) => r[0] !== today && r[0] >= oldestDay);
  ch.push([today, subs, views, pub.length]);
  ch.sort((a, b) => a[0].localeCompare(b[0]));

  const t = h.t.filter((p) => p[0] > nowMin - T_DAYS * DAY);
  const lastT = t.at(-1);
  if (!lastT || nowMin - lastT[0] >= T_GAP_MIN) t.push([nowMin, views, subs]);

  const vid: StatsHistory["vid"] = {};
  for (const v of pub) {
    const p = Math.floor(Date.parse(v.publishedAt!) / MIN);
    const ageH = Math.floor((nowMin - p) / HOUR);
    if (ageH < 0 || ageH > VID_DAYS * 24) continue;
    const prev = h.vid[v.videoId];
    const s = prev && prev.p === p ? [...prev.s] : [];
    const bucket = (hours: number) => (hours < VID_HOURLY_H ? `h${hours}` : `d${Math.floor(hours / 24)}`);
    const last = s.at(-1);
    if (!last || bucket(last[0]) !== bucket(ageH)) s.push([ageH, v.viewCount ?? 0]);
    vid[v.videoId] = { p, s };
  }
  return { v: 1, ch, t, vid };
}

// Просмотры ролика через hours часов после выхода. Между точками — по прямой (approx);
// null, если ближайшая точка дальше четверти возраста — по такой не судим.
export function viewsAt(entry: { s: [number, number][] }, hours: number): { views: number; approx: boolean } | null {
  const s = entry.s;
  if (!s.length || hours < 0) return null;
  const exact = s.find((p) => p[0] === hours);
  if (exact) return { views: exact[1], approx: false };
  const before = [...s].reverse().find((p) => p[0] < hours);
  const after = s.find((p) => p[0] > hours);
  const near = Math.min(before ? hours - before[0] : Infinity, after ? after[0] - hours : Infinity);
  if (near > Math.max(1, hours * 0.25)) return null;
  if (before && after) {
    const k = (hours - before[0]) / (after[0] - before[0]);
    return { views: Math.round(before[1] + k * (after[1] - before[1])), approx: true };
  }
  const only = (before ?? after)!;
  return { views: only[1], approx: true };
}

// Точки «за час» начиная с момента since.
export function seriesSince(h: StatsHistory, since: Date): StatsHistory["t"] {
  const from = Math.floor(since.getTime() / MIN);
  return h.t.filter((p) => p[0] >= from);
}

// Уложиться в лимит переменной: сначала уходят самые старые ролики, потом дневные строки
// старше 90 дней, в крайнем случае — старые точки «за час».
export function trimHistory(h: StatsHistory, maxChars = HISTORY_MAX_CHARS, now = new Date()): StatsHistory {
  const out: StatsHistory = { v: 1, ch: [...h.ch], t: [...h.t], vid: { ...h.vid } };
  const size = () => JSON.stringify(out).length;
  const byAge = Object.entries(out.vid).sort((a, b) => a[1].p - b[1].p);
  while (size() > maxChars && byAge.length) delete out.vid[byAge.shift()![0]];
  if (size() > maxChars) {
    const cut = new Date(now.getTime() - CH_KEEP_TRIM_DAYS * DAY * MIN).toISOString().slice(0, 10);
    out.ch = out.ch.filter((r) => r[0] >= cut);
  }
  while (size() > maxChars && out.t.length) out.t.shift();
  return out;
}

export const serializeHistory = (h: StatsHistory) => JSON.stringify(h);
