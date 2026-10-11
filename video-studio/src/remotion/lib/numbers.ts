// Числа в экранном тексте («в 1000 раз», «84%», «≈28 000 км/ч»): найти число
// внутри слова, решить, докручивать ли его, и отформатировать промежуточное
// значение так же, как записано в оригинале (разделитель тысяч, запятая).
// Чистые функции — их берут KineticText, пункты списка и тесты.

import { uiText } from "./ui-text";

const SPACES = /[   ]/g;
const NUM = /(\d{1,3}(?:[   ]\d{3})+|\d+)(?:([.,])(\d+))?/;
// Знаки, которые «прилипают» к числу и подсвечиваются вместе с ним.
const SYMBOL = /[≈~<>+−±$€₽£%°×]/;

export interface NumberInfo {
  raw: string; // число как в тексте: "28 000", "3,5"
  start: number; // где оно в слове
  value: number;
  decimals: number;
  sep: string; // разделитель тысяч оригинала ("" — без групп)
  mark: "," | ".";
  count: boolean; // докручивать от нуля; false — только подсветить
  hlStart: number; // подсветка: число вместе с соседними знаками (≈, %, $)
  hlEnd: number;
}

export function numberInfo(text: string): NumberInfo | null {
  const m = NUM.exec(text);
  if (!m) return null;
  const int = m[1]!;
  const frac = m[3] ?? "";
  const value = Number(int.replace(SPACES, "") + (frac ? `.${frac}` : ""));
  if (!Number.isFinite(value)) return null;
  const start = m.index;
  const end = start + m[0].length;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const sep = /[   ]/.exec(int)?.[0] ?? "";
  // Год («1947.», «в 1878») — не количество: от нуля не считаем.
  const year = !frac && !sep && /^\d{4}$/.test(int) && value >= 1000 && value <= 2100;
  // Дробь, время, диапазон, второе число в слове: «2/3», «12:00», «1–2».
  const compound = /^[/:–—-]\d/.test(after) || /\d[/:–—-]$/.test(before) || /\d/.test(after);
  // Мелкие целые («×3», «3 способа») считать нечего — только подсветка.
  const small = !frac && value < 10;
  let hlStart = start;
  while (hlStart > 0 && SYMBOL.test(text[hlStart - 1]!)) hlStart--;
  let hlEnd = end;
  while (hlEnd < text.length && SYMBOL.test(text[hlEnd]!)) hlEnd++;
  return {
    raw: m[0],
    start,
    value,
    decimals: frac.length,
    sep,
    mark: (m[2] as "," | ".") ?? ",",
    count: !year && !compound && !small && value > 0,
    hlStart,
    hlEnd,
  };
}

// Промежуточное значение счётчика в формате оригинала.
export function formatLike(info: Pick<NumberInfo, "decimals" | "sep" | "mark">, v: number): string {
  const [int, frac] = Math.abs(v).toFixed(info.decimals).split(".");
  const grouped = info.sep ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, info.sep) : int!;
  return `${v < 0 ? "−" : ""}${grouped}${frac ? `${info.mark}${frac}` : ""}`;
}

// Длина счёта в кадрах: большие числа крутятся чуть дольше.
export const countFrames = (value: number): number => (value >= 1000 ? 26 : 20);

// «28» + «000» → одно слово «28 000» (неразрывный пробел): так число не
// разрывается переносом и докручивается целиком, а не двумя кусками.
export function isThousandsTail(prev: string, next: string): boolean {
  return /\d$/.test(prev) && !/\d{4,}$/.test(prev) && /^\d{3}(?!\d)/.test(next) && !/[.,]\d+$/.test(prev);
}

// ---- Крупная цифра stat/compare и плашка обложки ----

// Число с разделителем тысяч и тем же количеством знаков после запятой, что и у
// целевого значения. lang — язык ролика: у английского «1,250.5», у русского
// «1 250,5», а четырёхзначные по-русски не делят («2560»). Четырёхзначный год не
// делят ни в каком языке: «1096 г.», «1096 AD».
export function formatNumber(v: number, decimals: number, lang?: string | null, year = false): string {
  const t = uiText(lang);
  const fixed = Math.abs(v).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const from = Math.max(t.groupFrom ?? 1000, year ? 10_000 : 0);
  const grouped = Number(int) >= from ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, t.group) : int!;
  return `${v < 0 ? "−" : ""}${grouped}${frac ? `${t.decimal}${frac}` : ""}`;
}

// Пометки года у числа. «г» без точки — граммы, поэтому только «г.»/«гг.».
const YEAR_MARK = /(?<!\p{L})(?:гг?\.|(?:до\s+)?н\.\s*э\.|(?:до\s+)?нашей\s+эры|B\.?C\.?(?:E\.?)?|A\.?D\.?|C\.?E\.?)(?!\p{L})/u;
// «год/года/году»: у 332 это срок («332 года»), датой бывает только у 1000–2100.
const YEAR_WORD = /(?<!\p{L})(?:год|года|году|годах)(?!\p{L})/iu;
// В речи год назван порядковым: «шестого года», «в двадцатом году» (а «в год» — нет).
const SPOKEN_YEAR = /(?:\d|\p{L}(?:ого|его|ом|ем|ый|ий|ой))\s+(?:год|года|году|годах)(?!\p{L})/iu;
const calendarYear = (v: number): boolean => Number.isInteger(v) && v >= 1000 && v <= 2100;

// Цифра сцены — год? Тогда счётчик от нуля не крутим («959 г.» по пути к 1096 —
// бессмыслица) и разряды не делим. Голое «1096» без единиц годом делает речь
// («…с тысяча девяносто шестого года»); «2048 слов» остаётся счётчиком.
export function isYearNumber(value: number, prefix = "", suffix = "", narration = ""): boolean {
  const marks = `${prefix} ${suffix}`;
  if (YEAR_MARK.test(marks)) return true;
  if (!calendarYear(value)) return false;
  if (YEAR_WORD.test(marks)) return true;
  return suffix.trim() === "" && /^[≈~]?$/.test(prefix.trim()) && SPOKEN_YEAR.test(narration);
}
