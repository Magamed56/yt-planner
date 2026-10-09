// Тренды «Статистики» по истории цифр канала (lib/history.ts): подписчики за 7 дней, просмотры
// за 7 дней против прошлых 7, «вчера / обычно», сколько вышло из слотов, темп до порогов
// монетизации и следующий рубеж. Чистые функции без сети — проверка в scripts/stats-test.ts.
import type { StatsHistory } from "./history";
import { plural } from "./stages";

const DAY_MS = 86_400_000;
const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const count = (n: number) => (Math.abs(n) >= 1_000_000 ? `${nf.format(n / 1_000_000)} млн` : Math.abs(n) >= 10_000 ? `${nf.format(n / 1000)} тыс.` : new Intl.NumberFormat("ru-RU").format(Math.round(n)));
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${count(Math.abs(n))}`;
const days = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

export type Dir = "up" | "down" | "flat";
export interface Tile {
  label: string;
  value: string;
  delta: string | null; // «▲ +58 за 7 дн.»
  dir: Dir | null;
  note: string; // окно или «считаю с 10.10 · есть 3 из 7 дней»
  spark: number[] | null; // точки для мини-графика
  sparkLabel: string | null; // «подписчики за 28 дней: с 610 до 742»
}

export interface Trends {
  tiles: Tile[];
  subsPerDay: number | null; // темп за 7 дней (null — истории меньше 3 дней)
  viewsPerDay: number | null;
  milestone: string | null; // «1 000 подписчиков — осталось 258, ≈ 23 дня»
  historyDays: number;
}

const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const PACE_MIN_DAYS = 3;

const dayKeyOf = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const shortDay = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;
const keyMs = (key: string) => Date.parse(`${key}T12:00:00Z`);

// Строка дня не позже key (последняя такая).
function rowAt(ch: StatsHistory["ch"], key: string) {
  let found: StatsHistory["ch"][number] | undefined;
  for (const r of ch) if (r[0] <= key) found = r;
  return found ?? null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const arrow = (n: number): Dir => (n > 0 ? "up" : n < 0 ? "down" : "flat");
const mark = (d: Dir) => (d === "up" ? "▲" : d === "down" ? "▼" : "=");

// ETA до цели при нынешнем темпе: «к 12.11 (34 дня)», дальше 2 лет — «больше 2 лет».
export function etaLabel(have: number, need: number, perDay: number | null, now: Date, tz: string): string | null {
  if (perDay === null) return null;
  if (have >= need) return null;
  if (!(perDay > 0)) return "рост остановился — при нынешнем темпе цель не достигается";
  const d = Math.ceil((need - have) / perDay);
  if (d > 730) return "при нынешнем темпе — больше 2 лет";
  return `≈ ${perDay >= 10 ? Math.round(perDay) : nf.format(perDay)} в день → ${count(need)} к ${shortDay(dayKeyOf(now.getTime() + d * DAY_MS, tz))} (${days(d)})`;
}

export function kpiTrends(h: StatsHistory, published: string[], slotsPerDay: number, subsNow: number | null, now: Date, tz: string): Trends {
  const today = dayKeyOf(now.getTime(), tz);
  const keyBack = (n: number) => dayKeyOf(now.getTime() - n * DAY_MS, tz);
  const ch = h.ch.filter((r) => r[0] <= today);
  const first = ch[0];
  const historyDays = first ? Math.round((keyMs(today) - keyMs(first[0])) / DAY_MS) : 0;
  const since = first ? `считаю с ${shortDay(first[0])} · есть ${Math.min(historyDays, 7)} из 7 дней` : "история копится с сегодняшнего дня";
  const last = ch.at(-1) ?? null;
  const at7 = rowAt(ch, keyBack(7));
  const at14 = rowAt(ch, keyBack(14));

  // Подписчики: прирост за 7 дней (или за сколько есть), мини-график за 28 дней.
  const subs = subsNow ?? last?.[1] ?? null;
  const subsBase = historyDays >= 7 ? at7 : first;
  const subsDelta = subs !== null && subsBase?.[1] != null && subsBase !== last ? subs - subsBase[1] : null;
  const span = historyDays >= 7 ? 7 : historyDays;
  const subsSeries = ch.filter((r) => r[0] >= keyBack(28) && r[1] !== null).map((r) => r[1]!);
  const tiles: Tile[] = [
    {
      label: "Подписчики",
      value: subs === null ? "—" : `${subs >= 1000 ? "≈ " : ""}${count(subs)}`,
      delta: subsDelta !== null && span > 0 ? `${mark(arrow(subsDelta))} ${signed(subsDelta)} за ${span} дн.` : null,
      dir: subsDelta !== null && span > 0 ? arrow(subsDelta) : null,
      note: historyDays >= 7 ? "за 7 дней" : since,
      spark: subsSeries.length >= 3 ? subsSeries : null,
      sparkLabel: subsSeries.length >= 3 ? `подписчики за ${subsSeries.length} дн.: с ${count(subsSeries[0]!)} до ${count(subsSeries.at(-1)!)}` : null,
    },
  ];

  // Просмотры за 7 дней (по сумме просмотров роликов) и к прошлым 7.
  const v7 = last && at7 && historyDays >= 7 ? last[2] - at7[2] : null;
  const prev7 = at7 && at14 && historyDays >= 14 ? at7[2] - at14[2] : null;
  const pct = v7 !== null && prev7 !== null && prev7 > 0 ? Math.round(((v7 - prev7) / prev7) * 100) : null;
  const daily = ch.slice(1).map((r, i) => ({ key: r[0], d: r[2] - ch[i]![2], gap: (keyMs(r[0]) - keyMs(ch[i]![0])) / DAY_MS })).filter((x) => x.gap === 1);
  tiles.push({
    label: "Просмотры за 7 дн.",
    value: v7 === null ? "—" : count(Math.max(0, v7)),
    delta: pct !== null ? `${mark(arrow(pct))} ${pct > 0 ? "+" : ""}${pct} % к прошлым 7` : null,
    dir: pct !== null ? arrow(pct) : null,
    note: historyDays >= 14 ? "сравнение с прошлой неделей" : since,
    spark: daily.length >= 3 ? daily.slice(-28).map((x) => Math.max(0, x.d)) : null,
    sparkLabel: daily.length >= 3 ? `просмотры в день за ${Math.min(28, daily.length)} дн.` : null,
  });

  // Вчера и «обычно» — медиана суточных приростов за 14 дней до вчера.
  const y = daily.at(-1);
  const typical = median(daily.slice(-15, -1).map((x) => x.d));
  tiles.push({
    label: "Вчера",
    value: y ? `≈ ${count(Math.max(0, y.d))}` : "—",
    delta: y && typical !== null ? `обычно ${count(typical)}` : null,
    dir: y && typical !== null ? arrow(y.d - typical) : null,
    note: y ? `просмотры за ${shortDay(y.key)}` : since,
    spark: null,
    sparkLabel: null,
  });

  // Вышло за 7 дней из слотов канала — без истории.
  const from = now.getTime() - 7 * DAY_MS;
  const out = published.filter((iso) => Date.parse(iso) >= from && Date.parse(iso) <= now.getTime()).length;
  const slots = slotsPerDay * 7;
  tiles.push({
    label: "Вышло за 7 дн.",
    value: `${out} из ${slots}`,
    delta: slots ? `${mark(out >= slots ? "up" : out >= slots * 0.7 ? "flat" : "down")} ${Math.round((out / slots) * 100)} % слотов` : null,
    dir: slots ? (out >= slots ? "up" : out >= slots * 0.7 ? "flat" : "down") : null,
    note: "по слотам расписания",
    spark: null,
    sparkLabel: null,
  });

  // Темп — по 7 дням (или по тому, что есть, если хотя бы 3 дня).
  const paceDays = Math.min(7, historyDays);
  const paceBase = paceDays >= 7 ? at7 : first;
  const subsPerDay = paceDays >= PACE_MIN_DAYS && subs !== null && paceBase?.[1] != null ? (subs - paceBase[1]) / paceDays : null;
  const viewsPerDay = paceDays >= PACE_MIN_DAYS && last && paceBase ? (last[2] - paceBase[2]) / paceDays : null;

  // Следующий рубеж подписчиков.
  const next = subs !== null ? MILESTONES.find((m) => m > subs) : undefined;
  const milestone =
    next && subs !== null
      ? `${count(next)} подписчиков — осталось ${count(next - subs)}${subsPerDay && subsPerDay > 0 ? `, ≈ ${days(Math.ceil((next - subs) / subsPerDay))}` : ""}`
      : null;
  return { tiles, subsPerDay, viewsPerDay, milestone, historyDays };
}

// Просмотры Shorts, которые завтра выпадут из окна 90 дней (вышли 89–90 дней назад).
export function dropTomorrow(videos: { publishedAt: string; views: number; shorts: boolean }[], now: Date): number {
  const t = now.getTime();
  return videos.filter((v) => v.shorts && t - Date.parse(v.publishedAt) >= 89 * DAY_MS && t - Date.parse(v.publishedAt) < 90 * DAY_MS).reduce((n, v) => n + v.views, 0);
}
