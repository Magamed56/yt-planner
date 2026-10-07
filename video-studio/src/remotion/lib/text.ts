import { measureText } from "@remotion/layout-utils";

// Разбор разметки onScreen: *слово* — акцент. Звёздочки могут стоять внутри
// «слова» вместе с пунктуацией ("*Неделя.*", "*Подпишись*,"), поэтому режем
// посимвольно: пробел завершает слово, '*' переключает акцент, а слово — это
// цепочка кусков с разным стилем без пробелов между ними.
export interface TextRun {
  text: string;
  accent: boolean;
}
export interface TextToken {
  runs: TextRun[];
  text: string; // всё слово без звёздочек
  accent: boolean; // есть ли в слове акцентный кусок
}

export function parseMarkup(input: string): TextToken[] {
  const tokens: TextToken[] = [];
  let accent = false;
  let runs: TextRun[] = [];
  const flush = () => {
    const clean = runs.filter((r) => r.text.length > 0);
    if (clean.length > 0) {
      const text = clean.map((r) => r.text).join("");
      tokens.push({ runs: clean, text, accent: clean.some((r) => r.accent && /[\p{L}\p{N}]/u.test(r.text)) });
    }
    runs = [];
  };
  for (const ch of input) {
    if (ch === "*") {
      accent = !accent;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.accent === accent) last.text += ch;
    else runs.push({ text: ch, accent });
  }
  flush();
  // Висячее тире/знак в начале слова прилепляем к предыдущему — иначе оно
  // уезжает на новую строку одно.
  const merged: TextToken[] = [];
  for (const t of tokens) {
    const prev = merged[merged.length - 1];
    if (prev && /^[—–\-:;,.!?…]+$/.test(t.text)) {
      prev.runs.push({ text: " " + t.text, accent: false });
      prev.text += " " + t.text;
    } else merged.push(t);
  }
  return merged;
}

export const stripMarkup = (s: string): string => s.replace(/\*/g, "");

// ---- Подбор размера шрифта ----

export interface FontSpec {
  fontFamily: string;
  fontWeight: number;
  letterSpacingEm?: number; // например -0.02
  lineHeight: number; // множитель
  uppercase?: boolean;
}

const REF = 100; // меряем на 100px и масштабируем линейно — ширина текста пропорциональна кеглю

function measureAtRef(text: string, font: FontSpec): number {
  return measureText({
    text,
    fontFamily: font.fontFamily,
    fontSize: REF,
    fontWeight: font.fontWeight,
    letterSpacing: font.letterSpacingEm ? `${font.letterSpacingEm * REF}px` : undefined,
    textTransform: font.uppercase ? "uppercase" : undefined,
  }).width;
}

export interface FittedText {
  fontSize: number;
  lines: number[][]; // индексы токенов по строкам
  lineWidths: number[];
}

function wrap(widths: number[], space: number, maxWidth: number): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  let w = 0;
  widths.forEach((ww, i) => {
    const add = cur.length === 0 ? ww : w + space + ww;
    if (cur.length > 0 && add > maxWidth) {
      lines.push(cur);
      cur = [i];
      w = ww;
    } else {
      cur.push(i);
      w = add;
    }
  });
  if (cur.length) lines.push(cur);
  return lines;
}

// Подбирает максимальный кегль, при котором текст влезает в коробку, и
// «балансирует» строки (как text-wrap: balance), чтобы не было сироты
// из одного короткого слова на последней строке.
export function fitTokens(
  tokens: { text: string }[],
  font: FontSpec,
  box: { w: number; h: number },
  opts: { maxFontSize: number; minFontSize?: number; maxLines?: number; balance?: boolean },
): FittedText {
  const minFont = opts.minFontSize ?? Math.min(28, opts.maxFontSize);
  const maxLines = opts.maxLines ?? 6;
  const refWidths = tokens.map((t) => measureAtRef(t.text, font));
  // Пробел меряем как разницу — measureText обрезает одиночный пробел.
  const space = Math.max(1, measureAtRef("a a", font) - measureAtRef("aa", font));

  const tryFit = (size: number): number[][] | null => {
    const k = size / REF;
    const widths = refWidths.map((w) => w * k);
    if (widths.some((w) => w > box.w)) return null;
    const lines = wrap(widths, space * k, box.w);
    if (lines.length > maxLines) return null;
    if (lines.length * size * font.lineHeight > box.h) return null;
    return lines;
  };

  let lo = minFont;
  let hi = opts.maxFontSize;
  let best: number[][] | null = tryFit(hi);
  let bestSize = hi;
  if (!best) {
    best = null;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const r = tryFit(mid);
      if (r) {
        best = r;
        bestSize = mid;
        lo = mid;
      } else hi = mid;
    }
    if (!best) {
      // Даже минимальный кегль не влез (аномально длинный текст) — режем по ширине как есть.
      bestSize = minFont;
      const k = minFont / REF;
      best = wrap(refWidths.map((w) => w * k), space * k, box.w);
    }
  }
  const fontSize = Math.floor(bestSize);
  const k = fontSize / REF;
  const widths = refWidths.map((w) => w * k);
  let lines = wrap(widths, space * k, box.w);

  if (opts.balance !== false && lines.length > 1) {
    // Минимальная ширина, при которой число строк не растёт.
    const n = lines.length;
    let a = Math.max(...widths);
    let b = box.w;
    for (let i = 0; i < 14; i++) {
      const mid = (a + b) / 2;
      if (wrap(widths, space * k, mid).length <= n) b = mid;
      else a = mid;
    }
    lines = wrap(widths, space * k, b + 0.5);
  }
  const lineWidths = lines.map((ln) => ln.reduce((s, i, j) => s + widths[i] + (j > 0 ? space * k : 0), 0));
  return { fontSize, lines, lineWidths };
}
