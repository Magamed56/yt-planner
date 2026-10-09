// Числа в экранном тексте («в 1000 раз», «84%», «≈28 000 км/ч»): найти число
// внутри слова, решить, докручивать ли его, и отформатировать промежуточное
// значение так же, как записано в оригинале (разделитель тысяч, запятая).
// Чистые функции — их берут KineticText, пункты списка и тесты.

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
