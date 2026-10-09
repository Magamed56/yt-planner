import {
  DEFAULT_TRANSITION_FRAMES,
  buildTimelineCaptions,
  layoutScenes,
  type Format,
  type RenderScene,
  type SceneVisual,
  type ThemeName,
  type VideoProps,
  type VideoScript,
  type WordTiming,
} from "../../types";

// Фикстура для Studio и dev-рендеров: реальный сценарий + ПРИДУМАННЫЕ
// тайминги слов (≈ темп русского TTS), без аудио. Чистая функция без
// Node/React — её импортируют и Root.tsx (браузер), и src/dev/*.ts (Node).

export function estimateWords(narration: string): { words: WordTiming[]; durationMs: number } {
  const words: WordTiming[] = [];
  let t = 120;
  for (const raw of narration.split(/\s+/).filter(Boolean)) {
    const letters = raw.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (letters === 0) continue;
    const dur = 90 + letters * 58;
    words.push({ text: raw.replace(/[.,!?:;«»"()…]+/g, ""), startMs: t, endMs: t + dur });
    t += dur + 40;
    if (/[.!?…]$/.test(raw)) t += 320;
    else if (/[,;:—]$/.test(raw)) t += 160;
  }
  return { words, durationMs: t + 120 };
}

export interface FixtureOptions {
  format?: Format;
  theme?: ThemeName;
  // Пути к голосу по id сцены ("" = без звука). Dev-скрипты подкладывают WAV.
  audioSrc?: (sceneId: string) => string;
  visual?: (sceneId: string, index: number) => SceneVisual;
  music?: VideoProps["music"];
  whooshSrc?: string | null;
  channelName?: string | null;
  showCaptions?: boolean;
  transitionFrames?: number;
  brandIntro?: boolean;
}

export function buildFixtureProps(script: VideoScript, opts: FixtureOptions = {}): VideoProps {
  const transitionFrames = opts.transitionFrames ?? DEFAULT_TRANSITION_FRAMES;
  const base = script.scenes.map((s, i) => {
    const { words, durationMs } = estimateWords(s.narration);
    return {
      ...s,
      audioSrc: opts.audioSrc ? opts.audioSrc(s.id) : "",
      audioDurationMs: durationMs,
      words,
      visual: opts.visual ? opts.visual(s.id, i) : ({ type: "none" } as SceneVisual),
    };
  });
  const laid = layoutScenes(base, transitionFrames);
  const scenes: RenderScene[] = laid.scenes;
  return {
    title: script.title,
    format: opts.format ?? script.format,
    theme: opts.theme ?? script.theme ?? "midnight",
    scenes,
    captions: buildTimelineCaptions(scenes),
    transitionFrames,
    durationInFrames: laid.durationInFrames,
    music: opts.music ?? null,
    whooshSrc: opts.whooshSrc ?? null,
    brandIntro: opts.brandIntro ?? false,
    sfxVolume: 0.5,
    showCaptions: opts.showCaptions ?? true,
    showProgressBar: true,
    channelName: opts.channelName === undefined ? "Суть за минуту" : opts.channelName,
    ctaComment: "Что думаешь? Пиши в комментариях",
  };
}
