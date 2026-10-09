import type { RenderScene, WordTiming } from "../../types";
import { parseMarkup } from "./text";
import { listItemFrames, msToFrames, normalizeWord, voiceFrames } from "./timing";

// Моменты внутри сцены, к которым привязаны и анимация, и звуки монтажа
// (AudioLayer). Единственное место расчёта: сцена и звук берут кадры отсюда,
// поэтому «пузырёк» звучит ровно тогда, когда пункт появляется на экране.
// Все кадры — ОТНОСИТЕЛЬНО НАЧАЛА СЦЕНЫ.

type CueScene = Pick<RenderScene, "kind" | "onScreen" | "narration" | "items" | "stat" | "audioStartFrame" | "audioDurationMs" | "words" | "durationInFrames">;

// Пункты списка: когда диктор произносит пункт (после заголовка).
export function listRevealFrames(scene: CueScene, fps: number): number[] {
  const items = (scene.items && scene.items.length > 0 ? scene.items : [scene.narration]).slice(0, 5);
  const titleDone = 6 + parseMarkup(scene.onScreen).length * 3 + 6;
  return listItemFrames(items, scene, fps, titleDone);
}

// ---- Счётчик крупной цифры ----

// Русские числительные (как их пишет narration: «двести сорок три»). Короткие
// формы — только целиком: «сто» не должно ловить «стоит», «семь» — «семья».
const NUMERAL =
  /^(ноль|нуль|один|одна|одно|одного|одной|одну|два|две|двух|двум|двумя|три|трех|трем|тремя|четыре|четырех|четырем|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти|\p{L}+надцать|\p{L}+надцати|двадцать|двадцати|тридцать|тридцати|сорок|сорока|пятьдесят|пятидесяти|шестьдесят|шестидесяти|семьдесят|семидесяти|восемьдесят|восьмидесяти|девяносто|девяноста|сто|ста|двести|двухсот|триста|трехсот|четыреста|четырехсот|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|\p{L}+сот(ни|ен)?|тысяч\p{L}*|миллион\p{L}*|миллиард\p{L}*|триллион\p{L}*|полтор\p{L}*|процент\p{L}*|\d+([.,]\d+)?)$/u;
const BAD_SOT = /^(высот|красот|частот|пустот|работ|забот)/u;

export function isNumeralWord(w: string): boolean {
  const n = normalizeWord(w);
  return n.length > 0 && NUMERAL.test(n) && !BAD_SOT.test(n);
}

// Самая «числовая» фраза речи: подряд идущие числительные; длиннее — вероятнее
// та самая цифра сцены («двести сорок три» важнее «один оборот»), при «%» —
// фраза со словом «процент». null — числа в речи нет (или нет таймингов).
export function spokenNumberRun(words: WordTiming[], suffix?: string): { from: number; to: number } | null {
  let best: { from: number; to: number; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    if (!isNumeralWord(words[i]!.text)) continue;
    let j = i;
    while (j + 1 < words.length && (isNumeralWord(words[j + 1]!.text) || (normalizeWord(words[j + 1]!.text) === "и" && j + 2 < words.length && isNumeralWord(words[j + 2]!.text)))) j++;
    const percent = (suffix ?? "").includes("%") && words.slice(i, j + 1).some((w) => normalizeWord(w.text).startsWith("процент"));
    const score = j - i + 1 + (percent ? 2 : 0);
    if (!best || score > best.score) best = { from: i, to: j, score };
    i = j;
  }
  return best ? { from: best.from, to: best.to } : null;
}

export const STAT_FALLBACK = { start: 10, end: 48 };

// Окно счётчика: цифра «докручивается» и встаёт на место, когда диктор её
// договорил (+2 кадра). Счёт начинается рано (не позже ~0,5 с), но длится не
// дольше 2,2 с и не меньше 0,8 с. Без числа в речи — прежний тайминг.
export function statCountWindow(scene: CueScene, fps: number): { start: number; end: number } {
  if (!scene.stat || scene.words.length === 0) return STAT_FALLBACK;
  const run = spokenNumberRun(scene.words, scene.stat.suffix);
  if (!run) return STAT_FALLBACK;
  const runTo = scene.audioStartFrame + msToFrames(scene.words[run.to]!.endMs, fps);
  const voiceEnd = scene.audioStartFrame + voiceFrames(scene, fps);
  const minLen = Math.round(0.8 * fps);
  const maxLen = Math.round(2.2 * fps);
  const end = Math.max(Math.round(Math.min(runTo + 2, voiceEnd)), 6 + minLen);
  const start = Math.max(6, end - maxLen, Math.min(Math.round(0.47 * fps), end - minLen));
  return { start, end };
}

// ---- Звуки сцены ----

export interface SceneCues {
  pops: number[]; // «пузырьки»
  impacts: number[]; // удары
  rises: number[]; // кадр, к которому нарастание должно ПРИЙТИ (совпадает с ударом)
}

export function sceneCues(scene: CueScene, fps: number): SceneCues {
  const cues: SceneCues = { pops: [], impacts: [], rises: [] };
  if (scene.kind === "list" && scene.items && scene.items.length > 0) cues.pops.push(...listRevealFrames(scene, fps));
  if (scene.kind === "stat" && scene.stat) {
    const w = statCountWindow(scene, fps);
    cues.impacts.push(w.end);
    cues.rises.push(w.end);
  }
  // Только то, что попадает внутрь сцены (хвост съедает переход).
  const inside = (f: number) => f >= 0 && f < scene.durationInFrames - 4;
  return { pops: cues.pops.filter(inside), impacts: cues.impacts.filter(inside), rises: cues.rises.filter(inside) };
}
