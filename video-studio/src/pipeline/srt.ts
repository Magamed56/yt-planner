// Субтитры .srt из слов общей таймлинии. Субтитры уже «вшиты» в картинку,
// а .srt — для YouTube (поиск, автоперевод, доступность). Поэтому группируем
// по-человечески: реплика заканчивается на конце предложения или паузе, не
// длиннее двух строк и ~6 секунд — так их удобно читать в плеере.

import type { TimelineCaption } from "../types";

export interface SrtOptions {
  maxLineChars?: number; // символов в строке
  maxLines?: number;
  maxCueMs?: number;
  pauseBreakMs?: number; // пауза между словами, после которой — новая реплика
}

interface Cue {
  startMs: number;
  endMs: number;
  words: string[];
}

const SENTENCE_END = /[.!?…]["»”)]*$/;
const SOFT_END = /[,;:—–]["»”)]*$/;

function ts(ms: number): string {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3_600_000);
  const m = Math.floor((v % 3_600_000) / 60_000);
  const s = Math.floor((v % 60_000) / 1000);
  const r = v % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

// Две строки примерно равной длины, разрыв — по пробелу.
function wrap(text: string, maxLineChars: number): string {
  if (text.length <= maxLineChars) return text;
  const words = text.split(" ");
  let best = text;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const score = Math.max(a.length, b.length) + (/[,;:]$/.test(a) ? -4 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = `${a}\n${b}`;
    }
  }
  return best;
}

// Сколько символов осталось до конца предложения, начиная со слова i.
function sentenceTail(words: { text: string; endMs: number }[], i: number): { chars: number; endMs: number } {
  let chars = -1;
  for (let j = i; j < words.length; j++) {
    chars += words[j].text.length + 1;
    if (SENTENCE_END.test(words[j].text)) return { chars, endMs: words[j].endMs };
    if (j - i >= 2) break;
  }
  return { chars: Infinity, endMs: Infinity };
}

export function groupCaptions(captions: TimelineCaption[], opts: SrtOptions = {}): Cue[] {
  const maxLineChars = opts.maxLineChars ?? 42;
  const maxChars = maxLineChars * (opts.maxLines ?? 2);
  const maxCueMs = opts.maxCueMs ?? 6000;
  const pauseBreakMs = opts.pauseBreakMs ?? 600;

  const cues: Cue[] = [];
  let cur: Cue | null = null;
  const words = captions.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur) {
      const len = cur.words.join(" ").length + 1 + w.text.length;
      const gap = w.startMs - cur.endMs;
      // Хвост предложения из 1–2 коротких слов не отрываем в отдельную реплику
      // («пятом году.»), если с ним реплика превышает лимит совсем чуть-чуть.
      const tail = sentenceTail(words, i);
      const tailFits = tail.chars <= 14 && cur.words.join(" ").length + 1 + tail.chars <= maxChars + 14 && tail.endMs - cur.startMs <= maxCueMs + 1500;
      if ((len > maxChars && !tailFits) || gap > pauseBreakMs || (w.endMs - cur.startMs > maxCueMs && !tailFits)) {
        cues.push(cur);
        cur = null;
      }
    }
    if (!cur) cur = { startMs: w.startMs, endMs: w.endMs, words: [] };
    cur.words.push(w.text);
    cur.endMs = Math.max(cur.endMs, w.endMs);
    const textLen = cur.words.join(" ").length;
    // Конец предложения закрывает реплику; запятая — если реплика уже длинная.
    if (SENTENCE_END.test(w.text) || (SOFT_END.test(w.text) && textLen > maxLineChars * 0.8)) {
      cues.push(cur);
      cur = null;
    }
  }
  if (cur) cues.push(cur);

  // Реплика держится чуть дольше последнего слова (но не наезжает на следующую)
  // и не короче 0,7 с — иначе её не успеть прочитать.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const limit = next ? next.startMs - 40 : Infinity;
    const wanted = Math.max(cues[i].endMs + 250, cues[i].startMs + 700);
    cues[i].endMs = Math.max(cues[i].endMs, Math.min(wanted, limit));
  }
  return cues;
}

export function captionsToSrt(captions: TimelineCaption[], opts: SrtOptions = {}): string {
  const maxLineChars = opts.maxLineChars ?? 42;
  return (
    groupCaptions(captions, opts)
      .map((c, i) => `${i + 1}\n${ts(c.startMs)} --> ${ts(c.endMs)}\n${wrap(c.words.join(" "), maxLineChars)}`)
      .join("\n\n") + "\n"
  );
}
