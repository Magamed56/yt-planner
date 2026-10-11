// Числа в экранном тексте («в 1000 раз», «84%», «≈28 000 км/ч»): найти число
// внутри слова, решить, докручивать ли его, и отформатировать промежуточное
// значение так же, как записано в оригинале (разделитель тысяч, запятая).
// Здесь же числительные речи («двести сорок три»). Чистые функции — их берут
// KineticText, пункты списка, крупная цифра, звуки (lib/cues.ts) и тесты.

import { normalizeWord } from "./timing";
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
// «1250,5» и «12 500,5» — четырёхзначные по-русски не делят. Четырёхзначный год
// не делят ни в каком языке: «1096 г.», «1096 AD».
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
// «1096 году»: слово сразу за числом. «₽ в год», «раз в год» — частота, не дата;
// у 332 «года» — срок, датой бывает только 1000–2100.
const YEAR_WORD = /^\s*(?:год|года|году|годах)(?!\p{L})/iu;
const calendarYear = (v: number): boolean => Number.isInteger(v) && v >= 1000 && v <= 2100;

// Цифра сцены — год? Тогда счётчик от нуля не крутим («959 г.» по пути к 1096 —
// бессмыслица) и разряды не делим. Голое «1096» без единиц годом делает речь,
// если именно это число в ней названо годом (spokenYear): «2048 слов» и «2000
// участников» рядом с «в двадцать первом году» остаются счётчиками.
export function isYearNumber(value: number, prefix = "", suffix = "", narration = ""): boolean {
  if (YEAR_MARK.test(`${prefix} ${suffix}`)) return true;
  if (!calendarYear(value)) return false;
  if (YEAR_WORD.test(suffix)) return true;
  return suffix.trim() === "" && /^(?:[≈~]|в|с)?$/iu.test(prefix.trim()) && spokenYear(value, narration);
}

// ---- Числительные в речи ----

// Русские числительные (как их пишет narration: «двести сорок три»). Короткие
// формы — только целиком: «сто» не должно ловить «стоит», «семь» — «семья».
const NUMERAL =
  /^(ноль|нуль|один|одна|одно|одного|одной|одну|два|две|двух|двум|двумя|три|трех|трем|тремя|четыре|четырех|четырем|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти|\p{L}+надцать|\p{L}+надцати|двадцать|двадцати|тридцать|тридцати|сорок|сорока|пятьдесят|пятидесяти|шестьдесят|шестидесяти|семьдесят|семидесяти|восемьдесят|восьмидесяти|девяносто|девяноста|сто|ста|двести|двухсот|триста|трехсот|четыреста|четырехсот|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|\p{L}+сот(ни|ен)?|тысяч\p{L}*|миллион\p{L}*|миллиард\p{L}*|триллион\p{L}*|полтор\p{L}*|процент\p{L}*|\d+([.,]\d+)?)$/u;
const BAD_SOT = /^(высот|красот|частот|пустот|работ|забот)/u;

export function isNumeralWord(w: string): boolean {
  const n = normalizeWord(w);
  return n.length > 0 && NUMERAL.test(n) && !BAD_SOT.test(n);
}

// Порядковое — так в речи называют год: «шестого», «двадцатом», «двухтысячном»,
// «2016-м» (после normalizeWord — «2016м»).
const ORDINAL =
  /^(?:(?:перв|втор|треть?|четверт|пят|шест|седьм|восьм|девят|десят|\p{L}+надцат|двадцат|тридцат|сороков|\p{L}+десят|девяност|\p{L}*сот|\p{L}*тысячн|миллионн)(?:ый|ий|ой|ого|его|ому|ему|ом|ем|ая|яя|ую|юю|ое|ее|ые|ие|ых|их|ым|им|ыми|ими)|\d+\p{L}{1,3})$/u;
const isOrdinal = (n: string): boolean => ORDINAL.test(n) && !BAD_SOT.test(n);
const isYearWord = (n: string): boolean => /^год(?:а|у|ом|ах|ы|ов)?$/u.test(n);

// Значение слова по основе; длинные основы проверяем раньше коротких
// («двадцат» раньше «дв», «пятисот» раньше «пят»).
const STEMS = Object.entries({
  ноль: 0, нуль: 0, од: 1, перв: 1, дв: 2, втор: 2, тр: 3, четыр: 4, четверт: 4, пят: 5, шест: 6, сем: 7, седьм: 7,
  восем: 8, восьм: 8, девят: 9, десят: 10, одиннадцат: 11, двенадцат: 12, тринадцат: 13, четырнадцат: 14,
  пятнадцат: 15, шестнадцат: 16, семнадцат: 17, восемнадцат: 18, девятнадцат: 19, двадцат: 20, тридцат: 30,
  сорок: 40, пятьдесят: 50, пятидесят: 50, шестьдесят: 60, шестидесят: 60, семьдесят: 70, семидесят: 70,
  восемьдесят: 80, восьмидесят: 80, девяност: 90, сто: 100, ста: 100, сот: 100, двест: 200, двухсот: 200,
  трист: 300, трехсот: 300, четырест: 400, четырехсот: 400, пятьсот: 500, пятисот: 500, шестьсот: 600,
  шестисот: 600, семьсот: 700, семисот: 700, восемьсот: 800, восьмисот: 800, девятьсот: 900, девятисот: 900,
  полтор: 1.5,
}).sort((a, b) => b[0].length - a[0].length);
const stemValue = (n: string): number => STEMS.find(([s]) => n.startsWith(s))?.[1] ?? 0;
const SCALE: Record<string, number> = { тысяч: 1e3, миллион: 1e6, миллиард: 1e9 };

// «тысяча девяносто шестого» → 1096, «двух тысячах» → 2000, «двадцатом» → 20.
function runValue(ws: string[]): number {
  let total = 0;
  let cur = 0;
  for (const n of ws) {
    const digits = /^\d+/.exec(n);
    const scale = /тысяч|миллиард|миллион/.exec(n);
    if (digits) cur += Number(digits[0]);
    else if (scale) {
      // «двухтысячном» — множитель вместе с основой перед ним.
      total += (cur + stemValue(n.slice(0, scale.index)) || 1) * SCALE[scale[0]]!;
      cur = 0;
    } else cur += stemValue(n);
  }
  return total + cur;
}

// Числа, названные в речи: подряд идущие числительные, последним может быть
// порядковое. Год — порядковое (или цифры), за которым сразу «год…», в том числе
// через «и»: «в две тысячи шестнадцатом и семнадцатом годах». «Двадцать один год»
// (количественное) — срок, «в год», «каждый год», «в этом году» — не числа вовсе.
function spokenNumbers(narration: string): { value: number; year: boolean }[] {
  const ws = narration.split(/\s+/).map(normalizeWord);
  const runs: { from: number; to: number; value: number; year: boolean; ordinal: boolean }[] = [];
  for (let i = 0; i < ws.length; i++) {
    let j = i - 1;
    while (j + 1 < ws.length && isNumeralWord(ws[j + 1]!)) j++;
    if (j + 1 < ws.length && isOrdinal(ws[j + 1]!)) j++;
    if (j < i) continue;
    const ordinal = isOrdinal(ws[j]!) || /^\d+$/.test(ws[j]!);
    runs.push({ from: i, to: j, value: runValue(ws.slice(i, j + 1)), year: ordinal && isYearWord(ws[j + 1] ?? ""), ordinal });
    i = j;
  }
  for (let k = runs.length - 2; k >= 0; k--) {
    const r = runs[k]!;
    const next = runs[k + 1]!;
    if (r.ordinal && next.year && next.from === r.to + 2 && /^(?:и|или|)$/u.test(ws[r.to + 1]!)) r.year = true;
  }
  return runs.map(({ value, year }) => ({ value, year }));
}

// Названо ли в речи именно это число годом. Своё число — то, что совпало целиком
// («тысяча девяносто шестого» = 1096); если такого нет — краткая форма года
// («в двадцатом году» = 2020). «Двадцать первом году» при цифре 2000 — чужое число.
function spokenYear(value: number, narration: string): boolean {
  const runs = spokenNumbers(narration);
  const own = runs.filter((r) => r.value === value);
  if (own.length > 0) return own.some((r) => r.year);
  return runs.some((r) => r.year && r.value < 100 && value % 100 === r.value);
}
