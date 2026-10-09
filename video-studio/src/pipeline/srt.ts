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

// ---- Готовый .srt: разбор и запись (перевод субтитров, npm run captions-translate) ----

export interface SrtCue {
  index: number; // номер реплики, как в файле
  timing: string; // «00:00:01,000 --> 00:00:02,500» — переносится в перевод байт в байт
  startMs: number;
  endMs: number;
  text: string; // строки реплики через \n
}

const TIMING_LINE = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})(?:\s.*)?$/;

const toMs = (h: string, m: string, s: string, ms: string) => ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, "0"));

// Разбор с понятной ошибкой: битый файл молча «переводить» нельзя — тайминги разъедутся.
export function parseSrt(text: string, name = "captions.srt"): SrtCue[] {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    while (lines.length && !lines[0]!.trim()) lines.shift();
    if (!lines.length) continue;
    const n = cues.length + 1;
    let index = n;
    if (/^\d+$/.test(lines[0]!.trim())) index = Number(lines.shift()!.trim());
    const timing = (lines.shift() ?? "").trim();
    const m = TIMING_LINE.exec(timing);
    if (!m) throw new Error(`${name}: реплика ${n} — нет строки времени вида «00:00:01,000 --> 00:00:02,500» (вместо неё «${timing.slice(0, 60)}»).`);
    const startMs = toMs(m[1]!, m[2]!, m[3]!, m[4]!);
    const endMs = toMs(m[5]!, m[6]!, m[7]!, m[8]!);
    const body = lines.join("\n").trim();
    if (!body) throw new Error(`${name}: реплика ${n} (${timing}) без текста.`);
    cues.push({ index, timing, startMs, endMs, text: body });
  }
  if (!cues.length) throw new Error(`${name}: пустой файл — нет ни одной реплики.`);
  return cues;
}

export function serializeSrt(cues: Pick<SrtCue, "index" | "timing" | "text">[]): string {
  return cues.map((c) => `${c.index}\n${c.timing}\n${c.text.trim()}`).join("\n\n") + "\n";
}

// Перевод совпадает с оригиналом по числу реплик, номерам и строкам времени.
export function sameTimings(a: Pick<SrtCue, "index" | "timing">[], b: Pick<SrtCue, "index" | "timing">[]): boolean {
  return a.length === b.length && a.every((c, i) => c.index === b[i]!.index && c.timing === b[i]!.timing);
}

// Ширина строки субтитров как в оригинале: у Shorts 32 символа (с «хвостом» фразы строка
// доходит до ~39), у длинного ролика 42.
export function srtLineWidth(cues: Pick<SrtCue, "text">[]): number {
  const widest = Math.max(0, ...cues.flatMap((c) => c.text.split("\n").map((l) => l.length)));
  return widest > 40 ? 42 : 32;
}

// Новые тексты в те же реплики: время и номера — из оригинала, строки — заново по ширине.
export function withCueTexts(cues: SrtCue[], texts: string[], maxLineChars = srtLineWidth(cues)): SrtCue[] {
  if (texts.length !== cues.length) throw new Error(`Перевод: ${texts.length} реплик вместо ${cues.length}.`);
  return cues.map((c, i) => ({ ...c, text: wrap(texts[i]!.replace(/\s+/g, " ").trim(), maxLineChars) }));
}
