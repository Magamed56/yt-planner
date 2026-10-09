// Главы «Разбора»: разделы плана = главы YouTube. У первой сцены каждого
// раздела — chapter (карточка в ролике и таймкод в описании). Модель просим
// отметить их сама; не отметила или сбилась с порядка — расставляем по доле
// слов: раздел на 80 с из 400 — это ~20% текста.

import type { ScriptScene } from "../../types";
import { cleanChapter, countWords } from "./validate";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function proportionalStarts(scenes: ScriptScene[], sections: { seconds: number }[]): number[] {
  const words = scenes.map((s) => countWords(s.narration));
  const total = words.reduce((a, w) => a + w, 0) || 1;
  const secs = sections.map((s) => (s.seconds > 0 ? s.seconds : 0));
  const secTotal = secs.reduce((a, s) => a + s, 0);
  const share = (j: number) => (secTotal > 0 ? secs[j]! / secTotal : 1 / sections.length);
  const starts = [0];
  let cum = 0;
  for (let j = 1; j < sections.length; j++) {
    cum += share(j - 1);
    const target = total * cum;
    let acc = 0;
    let idx = scenes.length;
    for (let i = 0; i < scenes.length; i++) {
      if (acc >= target) {
        idx = i;
        break;
      }
      acc += words[i]!;
    }
    idx = Math.max(idx, starts[starts.length - 1]! + 1);
    if (idx >= scenes.length) break; // сцен меньше, чем разделов, — лишние главы не ставим
    starts.push(idx);
  }
  return starts;
}

export function assignChapters(scenes: ScriptScene[], sections: { heading: string; seconds: number }[]): ScriptScene[] {
  if (!scenes.length || !sections.length) return scenes;
  const headings = sections.map((s) => cleanChapter(s.heading) || s.heading.trim());
  const marked: number[] = [];
  let k = 0;
  scenes.forEach((s, i) => {
    if (k < headings.length && s.chapter && norm(s.chapter) === norm(headings[k]!)) {
      marked.push(i);
      k++;
    }
  });
  const starts = marked.length === headings.length && marked[0] === 0 ? marked : proportionalStarts(scenes, sections);
  return scenes.map((s, i) => {
    const { chapter: _old, ...rest } = s;
    const j = starts.indexOf(i);
    return j >= 0 ? { ...rest, chapter: headings[j]! } : rest;
  });
}

export const countChapters = (scenes: Pick<ScriptScene, "chapter">[]): number => scenes.filter((s) => s.chapter?.trim()).length;
