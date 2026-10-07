import type { RenderScene, WordTiming } from "../../types";

// Синхронизация анимации с речью. scene.words — тайминги слов относительно
// начала голоса сцены; голос стартует через scene.audioStartFrame кадров
// после начала сцены. Всё ниже возвращает кадры ОТНОСИТЕЛЬНО НАЧАЛА СЦЕНЫ.

export function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Нечёткое сравнение с учётом русских окончаний: «неделя» ≈ «неделю»,
// «интервалы» ≈ «интервалами». Короткие служебные слова — только точно.
export function wordsMatch(a: string, b: string): boolean {
  const x = normalizeWord(a);
  const y = normalizeWord(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const minLen = Math.min(x.length, y.length);
  if (minLen < 4) return false;
  const stem = Math.max(4, Math.min(minLen - 1, Math.ceil(minLen * 0.7)));
  return x.slice(0, stem) === y.slice(0, stem);
}

export const msToFrames = (ms: number, fps: number): number => (ms / 1000) * fps;

export function wordFrame(scene: Pick<RenderScene, "audioStartFrame">, w: WordTiming, fps: number): number {
  return scene.audioStartFrame + msToFrames(w.startMs, fps);
}

export function voiceFrames(scene: Pick<RenderScene, "audioDurationMs">, fps: number): number {
  return Math.ceil(msToFrames(scene.audioDurationMs, fps));
}

// Индекс произнесённого слова, совпадающего с text, начиная с from.
export function findSpoken(words: WordTiming[], text: string, from = 0): number {
  for (let i = Math.max(0, from); i < words.length; i++) {
    if (wordsMatch(words[i].text, text)) return i;
  }
  return -1;
}

// Кадры появления слов экранного текста.
// mode "stagger": по очереди от start с шагом step (текст читается сразу);
// mode "speech": слово появляется, когда его произносят (если нашли в речи),
// ненайденные — интерполируются между соседями; порядок не убывает, и всё
// появляется не позже deadline, чтобы текст не «застрял» скрытым.
export function scheduleTokens(
  tokens: { text: string }[],
  scene: Pick<RenderScene, "audioStartFrame" | "words" | "audioDurationMs">,
  fps: number,
  opts: { mode: "stagger" | "speech"; start: number; step: number; lead?: number; deadline?: number },
): number[] {
  const base = tokens.map((_, i) => opts.start + i * opts.step);
  if (opts.mode === "stagger" || scene.words.length === 0) return base;
  const lead = opts.lead ?? 3;
  const hits: (number | null)[] = [];
  let cursor = 0;
  for (const t of tokens) {
    const idx = findSpoken(scene.words, t.text, cursor);
    if (idx >= 0 && idx - cursor <= 6) {
      hits.push(wordFrame(scene, scene.words[idx], fps) - lead);
      cursor = idx + 1;
    } else hits.push(null);
  }
  // Ненайденные — между ближайшими известными соседями.
  const out = hits.map((h, i) => {
    if (h !== null) return h;
    let p = i - 1;
    while (p >= 0 && hits[p] === null) p--;
    let n = i + 1;
    while (n < hits.length && hits[n] === null) n++;
    const pv = p >= 0 ? (hits[p] as number) : opts.start - opts.step;
    const nv = n < hits.length ? (hits[n] as number) : null;
    if (nv === null) return pv + (i - p) * opts.step;
    return pv + ((nv - pv) * (i - p)) / (n - p);
  });
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  let prev = opts.start - opts.step;
  return out.map((f, i) => {
    const v = Math.min(Math.max(f, prev + 1, opts.start), deadline + i);
    prev = v;
    return Math.round(v);
  });
}

// Когда произносится акцентное слово (для подсветки), иначе fallback.
export function accentFrame(
  tokens: { text: string; accent: boolean }[],
  scene: Pick<RenderScene, "audioStartFrame" | "words">,
  fps: number,
  fallback: number,
): number {
  const accentToken = tokens.find((t) => t.accent);
  if (!accentToken) return fallback;
  const idx = findSpoken(scene.words, accentToken.text);
  if (idx < 0) return fallback;
  return Math.round(wordFrame(scene, scene.words[idx], fps));
}

// Кадры появления пунктов списка: когда звучит первое значимое слово пункта.
// Иначе — равномерно по длительности голоса после заголовка.
export function listItemFrames(
  items: string[],
  scene: Pick<RenderScene, "audioStartFrame" | "words" | "audioDurationMs">,
  fps: number,
  earliest: number,
): number[] {
  const total = voiceFrames(scene, fps);
  const fallback = items.map((_, i) =>
    Math.round(Math.max(earliest + i * 8, scene.audioStartFrame + (total * (i + 0.6)) / (items.length + 0.6))),
  );
  if (scene.words.length === 0) return fallback;
  let cursor = 0;
  const found: (number | null)[] = items.map((item) => {
    const words = item.split(/\s+/).filter((w) => normalizeWord(w).length >= 3);
    for (const w of words.slice(0, 2)) {
      const idx = findSpoken(scene.words, w, cursor);
      if (idx >= 0) {
        cursor = idx + 1;
        return Math.round(wordFrame(scene, scene.words[idx], fps)) - 4;
      }
    }
    return null;
  });
  let prev = earliest - 8;
  return found.map((f, i) => {
    const v = Math.max(f ?? fallback[i], prev + 8, earliest);
    prev = v;
    return v;
  });
}
