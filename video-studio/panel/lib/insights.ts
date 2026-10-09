// Подсказки экрана «Статистика»: слабый старт (ролик 1–3 суток набирает заметно меньше
// обычного — повод сменить название) и лучшее время выхода (слоты канала и дни недели).
// Только чистые функции без сети — их проверяет scripts/insights-test.ts.
import { formatRate, type VideoStat } from "./stats";
import { plural } from "./stages";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Медиана, а не среднее: один вирусный ролик не должен задирать «обычный уровень».
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Доля пар (a из A, b из B), где a больше b (ничья — пополам): «в 7 из 10 сравнений».
// Устойчивее разницы средних на маленьких выборках и понятна без статистики.
export function superiority(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0.5;
  let wins = 0;
  for (const x of a) for (const y of b) wins += x > y ? 1 : x === y ? 0.5 : 0;
  return wins / (a.length * b.length);
}

// ---- слабый старт ----

export const WEAK_START = {
  minHours: 24, // младше суток — цифры ещё скачут
  maxHours: 72, // старше 3 суток — менять название поздно
  ratio: 0.5, // меньше половины обычного
  minSample: 5, // столько роликов для сравнения нужно хотя бы
  windowDays: 30, // сравниваем со свежими роликами канала
};

export interface WeakVideo {
  videoId: string;
  code: string | null;
  title: string;
  pillarTitle: string | null;
  thumbnailUrl: string | null;
  hours: number;
  ageLabel: string; // «31 ч»
  perDay: number;
  perDayLabel: string;
  baseline: number; // медиана остальных роликов
  baselineLabel: string;
  percent: number; // perDay от обычного, целые проценты
}

export interface WeakStartReport {
  flagged: WeakVideo[]; // слабее всех — первыми
  candidates: number; // роликов от 1 до 3 суток
  sample: number; // роликов Shorts от суток до 30 дней — с ними и сравниваем
  baseline: number | null; // медиана просмотров в сутки по ним
  baselineLabel: string;
  enough: boolean; // хватает ли роликов для сравнения
}

// Ролик 24–72 ч, у которого просмотров в сутки меньше половины медианы остальных Shorts
// канала за 30 дней (не меньше 5 роликов для сравнения). Старые ролики уже «остыли» — их
// просмотры в сутки ниже стартовых, так что правило скорее промолчит, чем зря поднимет тревогу.
export function weakStarts(videos: VideoStat[], now: Date, rule = WEAK_START): WeakStartReport {
  const t = now.getTime();
  const hours = (v: VideoStat) => (t - Date.parse(v.publishedAt)) / HOUR_MS;
  const pool = videos.filter((v) => v.shorts && hours(v) >= rule.minHours && hours(v) <= rule.windowDays * 24);
  const candidates = pool.filter((v) => hours(v) <= rule.maxHours);
  const flagged: WeakVideo[] = [];
  for (const v of candidates) {
    const others = pool.filter((o) => o !== v).map((o) => o.perDay);
    if (others.length < rule.minSample) continue;
    const base = median(others)!;
    if (!(base > 0) || v.perDay >= base * rule.ratio) continue;
    const h = hours(v);
    flagged.push({
      videoId: v.videoId,
      code: v.code,
      title: v.title,
      pillarTitle: v.pillarTitle,
      thumbnailUrl: v.thumbnailUrl,
      hours: h,
      ageLabel: `${Math.floor(h)} ч`,
      perDay: v.perDay,
      perDayLabel: formatRate(v.perDay),
      baseline: base,
      baselineLabel: formatRate(base),
      percent: Math.floor((v.perDay / base) * 100),
    });
  }
  const baseline = median(pool.map((v) => v.perDay));
  return {
    flagged: flagged.sort((a, b) => a.percent - b.percent || a.hours - b.hours),
    candidates: candidates.length,
    sample: pool.length,
    baseline,
    baselineLabel: baseline === null ? "—" : formatRate(baseline),
    enough: (candidates.length ? pool.length - 1 : pool.length) >= rule.minSample,
  };
}

// ---- лучшее время выхода ----

export const TIMING = {
  minAgeDays: 2, // младше 2 суток ролик ещё набирает — сравнивать рано
  minGroup: 4, // меньше 4 роликов в слоте (дне недели) — «мало данных»
  toleranceMin: 60, // вышел ±1 ч от слота — считаем этим слотом (ручная публикация)
};

export type Confidence = "none" | "low" | "medium" | "high";
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  none: "мало данных",
  low: "уверенность низкая",
  medium: "уверенность средняя",
  high: "уверенность высокая",
};

export interface TimingGroup {
  key: string; // «12:00» или «mon»
  label: string; // «12:00» или «Пн»
  videos: number;
  median: number | null;
  medianLabel: string;
  share: number; // от лучшей группы (0–1) — длина полоски
}

export interface TimingAdvice {
  text: string;
  confidence: Confidence;
  confidenceLabel: string;
}

export interface ReleaseTiming {
  eligible: number; // роликов старше 2 суток
  offSlot: number; // из них вышли не в слот канала
  slots: TimingGroup[];
  weekdays: TimingGroup[];
  slotAdvice: TimingAdvice;
  weekdayAdvice: TimingAdvice;
}

const WEEKDAYS = [
  { key: "mon", label: "Пн", on: "в понедельник" },
  { key: "tue", label: "Вт", on: "во вторник" },
  { key: "wed", label: "Ср", on: "в среду" },
  { key: "thu", label: "Чт", on: "в четверг" },
  { key: "fri", label: "Пт", on: "в пятницу" },
  { key: "sat", label: "Сб", on: "в субботу" },
  { key: "sun", label: "Вс", on: "в воскресенье" },
];

const partsFormat = new Map<string, Intl.DateTimeFormat>();
// Минуты от полуночи и день недели в поясе канала.
function localParts(t: number, tz: string): { minutes: number; weekday: string } {
  let f = partsFormat.get(tz);
  if (!f) partsFormat.set(tz, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })));
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]));
  return { minutes: Number(p.hour) * 60 + Number(p.minute), weekday: String(p.weekday).toLowerCase().slice(0, 3) };
}

const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
};

interface Bucket {
  key: string;
  label: string;
  on: string; // «в 12:00», «в субботу» — для текста совета
  values: number[];
}

function groupsOf(buckets: Bucket[]): TimingGroup[] {
  const meds = buckets.map((b) => median(b.values));
  const top = Math.max(0, ...meds.map((m) => m ?? 0));
  return buckets.map((b, i) => ({
    key: b.key,
    label: b.label,
    videos: b.values.length,
    median: meds[i]!,
    medianLabel: meds[i] === null ? "—" : formatRate(meds[i]!),
    share: top > 0 && meds[i] !== null ? meds[i]! / top : 0,
  }));
}

const advice = (text: string, confidence: Confidence): TimingAdvice => ({ text, confidence, confidenceLabel: CONFIDENCE_LABEL[confidence] });
const videosWord = (n: number) => `${n} ${plural(n, "ролик", "ролика", "роликов")}`;
// «по 1 ролику», «по 4 ролика», «по 5 роликов»
const perGroup = (n: number) => `по ${n} ${plural(n, "ролику", "ролика", "роликов")}`;

// Лучшую группу сравниваем с соперником (у слотов — со следующей, у дней недели — с худшим днём).
// Совет — только когда в каждой группе хотя бы minGroup роликов; уверенность — по размеру
// выборки и доле выигранных пар.
function compare(buckets: Bucket[], minGroup: number, what: { many: string; against: "next" | "last" }): TimingAdvice {
  if (buckets.length < 2) return advice("Сравнивать не с чем: у канала один слот.", "none");
  const thin = buckets.filter((b) => b.values.length < minGroup);
  if (thin.length) {
    const have = buckets.map((b) => `${b.label} — ${b.values.length}`).join(", ");
    return advice(`Мало данных: нужно хотя бы ${perGroup(minGroup)} старше 2 суток на ${what.many} (сейчас: ${have}). Пока оставьте как есть.`, "none");
  }
  const ranked = [...buckets].sort((a, b) => median(b.values)! - median(a.values)!);
  const best = ranked[0]!;
  const rival = what.against === "next" ? ranked[1]! : ranked[ranked.length - 1]!;
  const mb = median(best.values)!;
  const mr = median(rival.values)!;
  const p = superiority(best.values, rival.values);
  const n = Math.min(best.values.length, rival.values.length);
  const pairs = `в ${Math.round(p * 100)} % пар ролик ${best.on} обогнал ролик ${rival.on}`;
  const numbers = `медиана ${formatRate(mb)} в сутки ${best.on} против ${formatRate(mr)} ${rival.on}`;
  if (p < 0.6 || mb < mr * 1.15) {
    return advice(`Разницы почти нет: ${numbers}. Менять ничего не нужно.`, n >= 10 ? "medium" : "low");
  }
  const confidence: Confidence = n >= 10 && p >= 0.7 ? "high" : n >= 6 && p >= 0.65 ? "medium" : "low";
  const lead = what.against === "next" ? `Лучше заходят ролики ${best.on}` : `Лучше всего заходят ролики, вышедшие ${best.on}, слабее — ${rival.on}`;
  const tail =
    confidence === "low"
      ? " Но роликов пока мало — проверьте ещё через неделю-две."
      : what.against === "next"
        ? ` Можно попробовать сдвинуть слабый слот ближе к ${best.label} (channel.json → schedule.publishTimesLocal) и сравнить через пару недель.`
        : " Сильные темы можно ставить на сильные дни.";
  return advice(`${lead}: ${numbers}; ${pairs}.${tail}`, confidence);
}

export function releaseTiming(videos: VideoStat[], slotTimes: string[], tz: string, now: Date, rule = TIMING): ReleaseTiming {
  const t = now.getTime();
  const eligible = videos.filter((v) => v.shorts && t - Date.parse(v.publishedAt) >= rule.minAgeDays * DAY_MS);
  const slots = slotTimes.map((s) => ({ s, m: toMinutes(s) })).filter((x) => Number.isFinite(x.m));
  const slotBuckets: Bucket[] = slots.map((x) => ({ key: x.s, label: x.s, on: `в ${x.s}`, values: [] }));
  const dayBuckets: Bucket[] = WEEKDAYS.map((d) => ({ key: d.key, label: d.label, on: d.on, values: [] }));
  let offSlot = 0;
  for (const v of eligible) {
    const local = localParts(Date.parse(v.publishedAt), tz);
    dayBuckets.find((b) => b.key === local.weekday)?.values.push(v.perDay);
    // Ближайший слот по кругу суток (23:30 и 00:10 — рядом).
    let best = -1;
    let bestDiff = Infinity;
    slots.forEach((x, i) => {
      const d = Math.abs(local.minutes - x.m);
      const diff = Math.min(d, 1440 - d);
      if (diff < bestDiff) [best, bestDiff] = [i, diff];
    });
    if (best >= 0 && bestDiff <= rule.toleranceMin) slotBuckets[best]!.values.push(v.perDay);
    else offSlot += 1;
  }
  const slotAdvice = eligible.length
    ? compare(slotBuckets, rule.minGroup, { many: "каждый слот", against: "next" })
    : advice("Мало данных: ещё нет роликов старше 2 суток.", "none");
  const weekdayAdvice = eligible.length
    ? compare(dayBuckets, rule.minGroup, { many: "каждый день недели", against: "last" })
    : advice("Мало данных: ещё нет роликов старше 2 суток.", "none");
  // У дней недели в тексте «мало данных» — коротко: семь чисел подряд читать тяжело.
  if (weekdayAdvice.confidence === "none" && eligible.length) {
    const fewest = Math.min(...dayBuckets.map((b) => b.values.length));
    weekdayAdvice.text = `Мало данных: нужно хотя бы ${perGroup(rule.minGroup)} старше 2 суток на каждый день недели (сейчас у самого редкого дня — ${videosWord(fewest)}).`;
  }
  return { eligible: eligible.length, offSlot, slots: groupsOf(slotBuckets), weekdays: groupsOf(dayBuckets), slotAdvice, weekdayAdvice };
}
