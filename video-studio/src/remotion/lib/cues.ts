import type { RenderScene, WordTiming } from "../../types";
import { isNumeralWord } from "./numbers";
import { parseMarkup } from "./text";
import { listItemFrames, msToFrames, normalizeWord, voiceFrames } from "./timing";

// Моменты внутри сцены, к которым привязаны и анимация, и звуки монтажа
// (AudioLayer). Единственное место расчёта: сцена и звук берут кадры отсюда,
// поэтому «пузырёк» звучит ровно тогда, когда пункт появляется на экране.
// Все кадры — ОТНОСИТЕЛЬНО НАЧАЛА СЦЕНЫ.

type CueScene = Pick<
  RenderScene,
  "kind" | "onScreen" | "narration" | "items" | "stat" | "map" | "compare" | "audioStartFrame" | "audioDurationMs" | "words" | "durationInFrames"
>;

// Пункты списка: когда диктор произносит пункт (после заголовка).
export function listRevealFrames(scene: CueScene, fps: number): number[] {
  const items = (scene.items && scene.items.length > 0 ? scene.items : [scene.narration]).slice(0, 5);
  const titleDone = 6 + parseMarkup(scene.onScreen).length * 3 + 6;
  return listItemFrames(items, scene, fps, titleDone);
}

// ---- Счётчик крупной цифры ----

// Самая «числовая» фраза речи: подряд идущие числительные; длиннее — вероятнее
// та самая цифра сцены («двести сорок три» важнее «один оборот»), при «%» —
// фраза со словом «процент». null — числа в речи нет (или нет таймингов).
// Числительные распознаёт isNumeralWord (lib/numbers.ts) — тот же разбор решает, год ли цифра.
export function spokenNumberRun(words: WordTiming[], suffix?: string): { from: number; to: number } | null {
  let best: { from: number; to: number; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    if (!isNumeralWord(words[i]!.text)) continue;
    let j = i;
    while (j + 1 < words.length && isNumeralWord(words[j + 1]!.text)) j++;
    // «…восемьдесят пятом году» — это год, а не цифра сцены.
    if (words.slice(j + 1, j + 3).some((w) => normalizeWord(w.text).startsWith("год"))) {
      i = j;
      continue;
    }
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

// ---- Карта и сравнение ----

// Карта: камера летит от вида на весь мир к месту, метка «приземляется» в конце.
export const MAP_FLY = { start: 6, length: 42 };
export function mapLandFrame(scene: Pick<CueScene, "map">): number {
  return (scene.map?.zoom ?? "region") === "world" ? 14 : MAP_FLY.start + MAP_FLY.length - 2;
}

// Столбики сравнения: когда диктор называет пункт (как пункты списка).
export function compareRevealFrames(scene: CueScene, fps: number): number[] {
  const labels = (scene.compare?.items ?? []).slice(0, 4).map((it) => it.label.split(/\s+/));
  if (labels.length === 0) return [];
  // Ищем в речи только «свои» слова пункта: общее «Через» в «Через час» и
  // «Через сутки» нашлось бы где угодно и сдвинуло бы все столбики.
  const count = new Map<string, number>();
  for (const ws of labels) for (const w of new Set(ws.map(normalizeWord))) count.set(w, (count.get(w) ?? 0) + 1);
  const items = labels.map((ws) => ws.filter((w) => count.get(normalizeWord(w)) === 1).join(" "));
  const titleDone = 6 + parseMarkup(scene.onScreen).length * 3 + 4;
  return listItemFrames(items, scene, fps, titleDone);
}

// Какую сцену рисует композиция: карта/сравнение заменяют обычную раскладку
// (кроме хука и призыва) — так же решают Video.tsx и звуки.
export function specialLayout(scene: Pick<RenderScene, "kind" | "map" | "compare">): "map" | "compare" | null {
  if (scene.kind === "hook" || scene.kind === "cta") return null;
  if (scene.map && Number.isFinite(scene.map.lat) && Number.isFinite(scene.map.lon)) return "map";
  if (scene.compare && scene.compare.items.length >= 2) return "compare";
  return null;
}

// ---- Звуки сцены ----

export interface SceneCues {
  pops: number[]; // «пузырьки»
  impacts: number[]; // удары
  rises: number[]; // кадр, к которому нарастание должно ПРИЙТИ (совпадает с ударом)
}

export function sceneCues(scene: CueScene, fps: number): SceneCues {
  const cues: SceneCues = { pops: [], impacts: [], rises: [] };
  const special = specialLayout(scene);
  if (special === "map") cues.pops.push(mapLandFrame(scene));
  else if (special === "compare") cues.pops.push(...compareRevealFrames(scene, fps));
  else if (scene.kind === "list" && scene.items && scene.items.length > 0) cues.pops.push(...listRevealFrames(scene, fps));
  else if (scene.kind === "stat" && scene.stat) {
    const w = statCountWindow(scene, fps);
    cues.impacts.push(w.end);
    cues.rises.push(w.end);
  }
  // Только то, что попадает внутрь сцены (хвост съедает переход).
  const inside = (f: number) => f >= 0 && f < scene.durationInFrames - 4;
  return { pops: cues.pops.filter(inside), impacts: cues.impacts.filter(inside), rises: cues.rises.filter(inside) };
}

// Свист перехода (0,44–0,62 с) длиннее паузы между фразами (≈ 0,2 с, types.ts):
// без приглушения его затухание ложится на первое слово новой сцены почти
// в полную силу. С началом её голоса свист уходит на −10 дБ за 2 кадра —
// пик остаётся в паузе. frame и voiceAt — от начала свиста.
export const WHOOSH_LEAD_FRAMES = 4; // свист начинается чуть раньше склейки — пик звука приходится на переход
export const WHOOSH_UNDER_VOICE = 0.3;
const WHOOSH_DUCK_FRAMES = 2;
export function whooshDuck(frame: number, voiceAt: number): number {
  if (frame <= voiceAt) return 1;
  return WHOOSH_UNDER_VOICE + (1 - WHOOSH_UNDER_VOICE) * Math.max(0, 1 - (frame - voiceAt) / WHOOSH_DUCK_FRAMES);
}
