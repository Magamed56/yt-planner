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

// Русская типографика: предлоги, союзы, частицы и числа не оставляем в конце
// строки («в / памяти», «не / ленится», «3 / способа»), а «же/ли/бы» — в
// начале. glue[i] = true — между словами i и i+1 переносить нельзя.
const GLUE_FORWARD = new Set([
  "без", "для", "изо", "над", "обо", "под", "при", "про", "через", "перед", "что", "как", "или", "чтобы", "если", "когда",
]);
const GLUE_BACK = new Set(["же", "ж", "ли", "ль", "бы", "б"]);

export function glueMap(tokens: { text: string }[]): boolean[] {
  const words = tokens.map((t) => t.text.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, ""));
  return tokens.map((t, i) => {
    if (i >= tokens.length - 1) return false;
    // Конец предложения/фразы — граница, клеить через неё нельзя.
    if (/[.!?…:;,—–]["»”)]?$/.test(t.text)) return false;
    const w = words[i];
    const next = words[i + 1];
    if (!w || !next) return false;
    if (GLUE_BACK.has(next)) return true;
    if (/^\p{N}+$/u.test(w)) return true; // «24 часа», «3 способа»
    return w.length <= 2 || GLUE_FORWARD.has(w);
  });
}

interface Wrapped {
  lines: number[][];
  violations: number; // сколько «склеек» пришлось разорвать
}

function wrap(widths: number[], space: number, maxWidth: number, breaks?: Set<number>, glue?: boolean[]): Wrapped {
  const lines: number[][] = [];
  let violations = 0;
  let cur: number[] = [];
  let w = 0;
  const widthOf = (ids: number[]) => ids.reduce((s, id, j) => s + widths[id] + (j > 0 ? space : 0), 0);
  widths.forEach((ww, i) => {
    const add = cur.length === 0 ? ww : w + space + ww;
    if (cur.length > 0 && add > maxWidth) {
      // Переносим перед словом i. Если оно «приклеено» к предыдущему —
      // уносим на новую строку всю склейку; не влезает целиком — рвём её в
      // самом раннем месте, где хвост ещё помещается («чтобы / не забыть»).
      let cut = cur.length;
      if (glue?.[i - 1]) {
        let j0 = cur.length - 1;
        while (j0 > 0 && glue[cur[j0] - 1]) j0--;
        if (j0 > 0 && widthOf([...cur.slice(j0), i]) <= maxWidth) cut = j0;
        else {
          violations++;
          for (let k = Math.max(1, j0 + 1); k < cur.length; k++) {
            if (widthOf([...cur.slice(k), i]) <= maxWidth) {
              cut = k;
              break;
            }
          }
        }
      }
      lines.push(cur.slice(0, cut));
      cur = [...cur.slice(cut), i];
      w = widthOf(cur);
    } else {
      cur.push(i);
      w = add;
    }
    if (breaks?.has(i) && i < widths.length - 1) {
      lines.push(cur);
      cur = [];
      w = 0;
    }
  });
  if (cur.length) lines.push(cur);
  return { lines, violations };
}

// Индексы слов, после которых заканчивается предложение («День. Три дня.»):
// по возможности начинаем новое предложение с новой строки.
function sentenceBreaks(tokens: { text: string }[]): Set<number> {
  const out = new Set<number>();
  tokens.forEach((t, i) => {
    if (i < tokens.length - 1 && /[.!?…]["»”)]?$/.test(t.text)) out.add(i);
  });
  return out;
}

interface FitOptions {
  maxFontSize: number;
  minFontSize?: number;
  maxLines?: number;
  balance?: boolean;
  sentenceBreaks?: boolean;
  extraEm?: number; // добавка к ширине каждого слова (поля, «поп»-масштаб)
  glue?: boolean; // false — без правил переноса коротких слов
  // false — просто максимальный влезающий кегль (субтитры: размер от страницы
  // к странице не должен прыгать). По умолчанию кегль выбирается с учётом
  // качества переносов (см. scoreLayout).
  scoring?: boolean;
}

interface Candidate extends FittedText {
  violations: number;
  score: number;
}

// Подбирает кегль и переносы: начинает с максимального влезающего кегля и
// пробует чуть меньшие, если они дают заметно более чистый набор — без
// разорванных склеек («ты / забудешь»), без строки из одного короткого слова
// («Он») и без «сироты» в последней строке. Строки «балансируются» (как
// text-wrap: balance).
export function fitTokens(tokens: { text: string }[], font: FontSpec, box: { w: number; h: number }, opts: FitOptions): FittedText {
  if (tokens.length === 0) return { fontSize: opts.maxFontSize, lines: [], lineWidths: [] };
  const refWidths = tokens.map((t) => measureAtRef(t.text, font) + (opts.extraEm ?? 0) * REF);
  // Пробел меряем как разницу — measureText обрезает одиночный пробел.
  const space = Math.max(1, measureAtRef("a a", font) - measureAtRef("aa", font));
  const glue = opts.glue === false ? undefined : glueMap(tokens);
  const letters = tokens.map((t) => t.text.replace(/[^\p{L}\p{N}]+/gu, "").length);
  const plain = fitWith(refWidths, space, font, box, opts, undefined, glue, letters);
  if (opts.sentenceBreaks === false) return strip(plain);
  const br = sentenceBreaks(tokens);
  if (br.size === 0) return strip(plain);
  const broken = fitWith(refWidths, space, font, box, opts, br, glue, letters);
  // Разбивка по предложениям красивее, но не ценой заметно меньшего кегля
  // и не ценой худших переносов.
  const preferBroken = broken.fontSize >= plain.fontSize * 0.86 && broken.score + 0.1 >= plain.score;
  return strip(preferBroken ? broken : plain);
}

const strip = (c: Candidate): FittedText => ({ fontSize: c.fontSize, lines: c.lines, lineWidths: c.lineWidths });

// Штрафы за типографские огрехи (в долях кегля: 0.12 ≈ «лучше на 12% мельче»).
function scoreLayout(c: { fontSize: number; lines: number[][]; violations: number }, refSize: number, letters: number[]): number {
  let score = c.fontSize / refSize - 0.12 * c.violations;
  const n = c.lines.length;
  const words = letters.length;
  c.lines.forEach((ln, i) => {
    if (n > 1 && ln.length === 1 && letters[ln[0]] <= 3) score -= 0.2; // строка «Он» / «ТЫ»
    // «Лесенка» из одиночных слов в длинном тексте читается рвано.
    else if (words >= 6 && ln.length === 1 && i < n - 1) score -= 0.03;
  });
  if (n > 4) score -= 0.04 * (n - 4); // много строк — текст читается дольше
  const last = c.lines[n - 1];
  if (n > 1 && last.length === 1 && letters[last[0]] <= 5 && c.lines[n - 2].length > 1) score -= 0.22; // сирота
  return score;
}

function fitWith(
  refWidths: number[],
  space: number,
  font: FontSpec,
  box: { w: number; h: number },
  opts: FitOptions,
  breaks: Set<number> | undefined,
  glue: boolean[] | undefined,
  letters: number[],
): Candidate {
  const minFont = opts.minFontSize ?? Math.min(28, opts.maxFontSize);
  const maxLines = opts.maxLines ?? 6;

  const tryFit = (size: number): boolean => {
    const k = size / REF;
    const widths = refWidths.map((w) => w * k);
    if (widths.some((w) => w > box.w)) return false;
    const lines = wrap(widths, space * k, box.w, breaks, glue).lines;
    if (lines.length > maxLines) return false;
    return lines.length * size * font.lineHeight <= box.h;
  };

  let bestSize = opts.maxFontSize;
  if (!tryFit(bestSize)) {
    let lo = minFont;
    let hi = opts.maxFontSize;
    let found = false;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (tryFit(mid)) {
        found = true;
        bestSize = mid;
        lo = mid;
      } else hi = mid;
    }
    // Даже минимальный кегль не влез (аномально длинный текст) — берём минимум.
    if (!found) bestSize = minFont;
  }

  const layoutAt = (size: number): Candidate => {
    const fontSize = Math.floor(size);
    const k = fontSize / REF;
    const widths = refWidths.map((w) => w * k);
    let { lines, violations } = wrap(widths, space * k, box.w, breaks, glue);
    if (opts.balance !== false && lines.length > 1) {
      // Минимальная ширина, при которой число строк не растёт и не
      // прибавляется разорванных склеек.
      const n = lines.length;
      const v0 = violations;
      const ok = (mw: number) => {
        const r = wrap(widths, space * k, mw, breaks, glue);
        return r.lines.length <= n && r.violations <= v0;
      };
      let a = Math.max(...widths);
      let b = box.w;
      for (let i = 0; i < 14; i++) {
        const mid = (a + b) / 2;
        if (ok(mid)) b = mid;
        else a = mid;
      }
      const r = wrap(widths, space * k, b + 0.5, breaks, glue);
      if (r.lines.length <= n && r.violations <= v0) ({ lines, violations } = r);
    }
    const lineWidths = lines.map((ln) => ln.reduce((s, i, j) => s + widths[i] + (j > 0 ? space * k : 0), 0));
    return { fontSize, lines, lineWidths, violations, score: 0 };
  };

  const first = layoutAt(bestSize);
  first.score = scoreLayout(first, bestSize, letters);
  if (opts.scoring === false || bestSize <= minFont) return first;
  let best = first;
  // Пробуем кегли до −24%: каждый должен влезать в коробку.
  for (let f = 0.97; f >= 0.755; f -= 0.03) {
    const size = bestSize * f;
    if (size < minFont) break;
    if (!tryFit(size)) continue;
    const c = layoutAt(size);
    c.score = scoreLayout(c, bestSize, letters);
    if (c.score > best.score + 1e-6) best = c;
  }
  return best;
}
