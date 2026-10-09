// «Пульс» на главной: что изменилось с прошлого визита (просмотры, подписчики, что вышло,
// собралось или упало) и последние вышедшие Shorts с «×N к обычному». Из истории
// (lib/history.ts) в состояние панели попадает только сжатое — не больше ≈ 3 КБ.
// Чистые функции без сети; проверка — scripts/state-test.ts и push-test.ts.
import type { StatsHistory } from "./history";
import { plural, type Stage } from "./stages";
import type { RowStats, Verdict } from "./stats";

const MIN = 60_000;
const DAY_MS = 86_400_000;
const SERIES_POINTS = 60; // точек «за час» в браузер — не больше
const EVENTS_MAX = 20;

export interface PulseEvent {
  at: string; // ISO
  kind: "published" | "built" | "failed";
  code: string | null;
  text: string; // «вышел 08a», «собран 09a», «упал запуск «Ролик · 10a»»
}

export interface PulseRecent {
  code: string;
  cover: string | null;
  whenLabel: string;
  viewsLabel: string;
  ratioLabel: string | null;
  verdict: Verdict | null;
}

export interface Yesterday {
  views: number; // прирост просмотров за прошлые сутки (≈: снимки в разное время дня)
  subs: number | null;
  typicalViews: number | null; // медиана суточных приростов за 7 дней до этого
  best: { code: string; ratioLabel: string; ratio: number } | null; // лучший свежий ролик
  milestone: number | null; // рубеж подписчиков, перейдённый за эти сутки
}

export interface Pulse {
  series: [number, number, number | null][]; // [минута Unix, сумма просмотров, подписчики] за 7 дней
  events: PulseEvent[];
  recent: PulseRecent[];
  yesterday: Yesterday | null;
  subscribers: number | null; // последнее известное число (для «🎉 500 подписчиков»)
}

interface RowLike {
  code: string;
  stage: Stage;
  when: string | null;
  whenExact: boolean;
  cover: string | null;
  dateLabel: string;
  timeLabel: string;
  release: { createdAt: string } | null;
  stats?: RowStats | null;
}

interface RunLike {
  kind: string;
  label: string;
  codes: string[];
  active: boolean;
  conclusion: string | null;
  createdAt: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// Ряд «за час» — прореженный до 60 точек (последняя — всегда).
function thin<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = (xs.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => xs[Math.round(i * step)]!);
}

const nextDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// Прошлые сутки по дневным строкам истории: разница двух последних соседних дней.
export function yesterdayOf(h: StatsHistory | null): Omit<Yesterday, "best"> | null {
  const ch = h?.ch ?? [];
  if (ch.length < 2) return null;
  const a = ch.at(-2)!;
  const b = ch.at(-1)!;
  if (nextDay(a[0]) !== b[0]) return null;
  const deltas: number[] = [];
  for (let i = Math.max(1, ch.length - 9); i < ch.length - 1; i++) if (nextDay(ch[i - 1]![0]) === ch[i]![0]) deltas.push(ch[i]![2] - ch[i - 1]![2]);
  return { views: Math.max(0, b[2] - a[2]), subs: a[1] !== null && b[1] !== null ? b[1] - a[1] : null, typicalViews: median(deltas.slice(-7)), milestone: crossedMilestone(a[1], b[1]) };
}

export function buildPulse(h: StatsHistory | null, rows: RowLike[], runs: RunLike[], now: Date): Pulse {
  const nowMs = now.getTime();
  const from = nowMs - 7 * DAY_MS;
  const series = thin(
    (h?.t ?? []).filter((p) => p[0] * MIN >= from),
    SERIES_POINTS,
  );
  const events: PulseEvent[] = [];
  for (const r of rows) {
    if (r.stage === "published" && r.when && Date.parse(r.when) >= from && Date.parse(r.when) <= nowMs) events.push({ at: r.when, kind: "published", code: r.code, text: `вышел ${r.code}` });
    if (r.release && Date.parse(r.release.createdAt) >= from) events.push({ at: r.release.createdAt, kind: "built", code: r.code, text: `собран ${r.code}` });
  }
  for (const r of runs) {
    if (!r.active && (r.conclusion === "failure" || r.conclusion === "timed_out") && Date.parse(r.createdAt) >= from) events.push({ at: r.createdAt, kind: "failed", code: r.codes[0] ?? null, text: `упал запуск «${r.label}»` });
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const published = rows.filter((r) => r.stage === "published" && r.when && r.stats).sort((a, b) => Date.parse(b.when!) - Date.parse(a.when!));
  const recent = published.slice(0, 4).map((r) => ({
    code: r.code,
    cover: r.cover,
    whenLabel: `${r.dateLabel} ${r.timeLabel}`,
    viewsLabel: r.stats!.viewsLabel,
    ratioLabel: r.stats!.ratioLabel ?? null,
    verdict: r.stats!.verdict ?? null,
  }));
  // Лучший из вышедших за двое суток — для «лучший 08a ▲ ×3,1» в утреннем уведомлении.
  const fresh = published.filter((r) => nowMs - Date.parse(r.when!) < 2 * DAY_MS && r.stats?.verdict === "up" && r.stats.ratio);
  const top = fresh.sort((a, b) => b.stats!.ratio! - a.stats!.ratio!)[0];
  const y = yesterdayOf(h);
  return {
    series,
    events: events.slice(0, EVENTS_MAX),
    recent,
    yesterday: y ? { ...y, best: top ? { code: top.code, ratioLabel: top.stats!.ratioLabel!, ratio: top.stats!.ratio! } : null } : null,
    subscribers: h?.ch.at(-1)?.[1] ?? null,
  };
}

// Значение ряда на момент t: последняя точка не позже t (≈, если она далеко).
export function seriesAt(series: Pulse["series"], tMs: number): { views: number; subs: number | null; approx: boolean } | null {
  const t = tMs / MIN;
  let p: Pulse["series"][number] | undefined;
  for (const x of series) if (x[0] <= t) p = x;
  if (!p) return null;
  return { views: p[1], subs: p[2], approx: t - p[0] > 90 };
}

export const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000];

// Рубеж подписчиков, перейдённый между двумя значениями (самый большой), или null.
export function crossedMilestone(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return [...MILESTONES].reverse().find((m) => before < m && after >= m) ?? null;
}

const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
export function shortCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${fmt.format(n / 1_000_000)} млн`;
  if (a >= 1000) return `${fmt.format(n / 1000)} тыс.`;
  return String(Math.round(n));
}

// «Вчера: +1,9 тыс. просмотров (обычно 1,6 тыс.) · +12 подписчиков · лучший 08a ▲ ×3,1»
export function yesterdayLine(y: Yesterday): string {
  const parts = [`вчера ≈ +${shortCount(y.views)} просмотров${y.typicalViews !== null ? ` (обычно ${shortCount(y.typicalViews)})` : ""}`];
  if (y.subs) parts.push(`${y.subs > 0 ? "+" : ""}${y.subs} ${plural(Math.abs(y.subs), "подписчик", "подписчика", "подписчиков")}`);
  if (y.best) parts.push(`лучший ${y.best.code} ${y.best.ratioLabel}`);
  return parts.join(" · ");
}

// Есть о чём сказать и без дел: прошлые сутки на ±30 % от обычного, ролик от ×3 или рубеж.
export function notable(y: Yesterday | null, milestone: number | null): boolean {
  if (milestone) return true;
  if (!y) return false;
  if (y.best && y.best.ratio >= 3) return true;
  return y.typicalViews !== null && y.typicalViews > 0 && Math.abs(y.views - y.typicalViews) / y.typicalViews >= 0.3;
}
