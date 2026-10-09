// Сборка props композиции из результатов модулей: сценарий + голос сцен +
// визуал + музыка + свист. Только здесь конвейер превращает абсолютные пути
// Node в пути относительно publicDir (их ждёт staticFile() в композиции)
// и считает тайминг — строго через layoutScenes()/buildTimelineCaptions()
// из src/types.ts, иначе звук и картинка разъедутся.

import path from "node:path";
import {
  DEFAULT_TRANSITION_FRAMES,
  FPS,
  THEME_NAMES,
  buildTimelineCaptions,
  layoutScenes,
  type Format,
  type RenderScene,
  type SceneVisual,
  type ThemeName,
  type VideoProps,
  type VideoScript,
} from "../types";
import type { MusicChoice, VisualResult, VoiceResult } from "./contracts";

// Громкости подобраны под голос ≈ −18 dBFS RMS (модуль voice) и
// сгенерированный эмбиент ≈ −17 LUFS: под речью музыка уходит на ~25 дБ ниже
// голоса, в паузах слышна. Треки из библиотеки обычно громче на 3–8 дБ —
// для них громкость ниже.
export const MUSIC_VOLUME = 0.22;
export const MUSIC_DUCKED_VOLUME = 0.07;
const LIBRARY_MUSIC_FACTOR = 0.75;
export const SFX_VOLUME = 0.35;

export interface BuildPropsInput {
  script: VideoScript;
  publicDir: string;
  voices: VoiceResult[]; // по порядку script.scenes
  visuals?: (VisualResult | null | undefined)[]; // по порядку script.scenes
  music: MusicChoice | null;
  whooshSrc: string | null; // уже относительно publicDir ("sfx/whoosh.wav")
  format?: Format;
  theme?: ThemeName;
  transitionFrames?: number;
  showCaptions?: boolean;
  showProgressBar?: boolean;
  channelName?: string | null; // undefined → CHANNEL_NAME из окружения
  musicVolume?: number; // undefined → MUSIC_VOLUME из окружения или по умолчанию
}

// Абсолютный путь внутри publicDir → "voice/s1.wav" (всегда с «/», даже на
// Windows: staticFile() строит из него URL). URL и уже относительные пути
// возвращаются как есть.
export function toPublicSrc(publicDir: string, file: string): string {
  if (!file) return "";
  if (/^(https?:|data:|blob:)/.test(file)) return file;
  if (!path.isAbsolute(file)) return file.split(path.sep).join("/").replace(/^\/+/, "");
  const rel = path.relative(publicDir, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Файл ${file} лежит вне папки public запуска (${publicDir}) — композиция его не увидит.`);
  }
  return rel.split(path.sep).join("/");
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function musicVolumes(music: MusicChoice, override?: number): { volume: number; duckedVolume: number } {
  // Сгенерированный эмбиент называется music/ambient-*.wav (модуль audio).
  const generated = /(^|\/)ambient-[^/]*$/.test(music.src);
  const base = override ?? envNumber("MUSIC_VOLUME") ?? MUSIC_VOLUME * (generated ? 1 : LIBRARY_MUSIC_FACTOR);
  const volume = clamp01(base);
  return { volume, duckedVolume: clamp01(volume * (MUSIC_DUCKED_VOLUME / MUSIC_VOLUME)) };
}

function sanitizeVisual(publicDir: string, v: SceneVisual | undefined): SceneVisual {
  if (!v || v.type === "none") return { type: "none" };
  const src = toPublicSrc(publicDir, v.src);
  if (!src) return { type: "none" };
  if (v.type === "video") {
    // Без длительности <Loop> получит 0 кадров — лучше показать как без визуала.
    if (!(v.durationSec > 0)) return { type: "none" };
    return { ...v, src };
  }
  return { ...v, src };
}

// Длина ролика по одной лишь длительности голоса — нужна до сборки props
// (например, чтобы сгенерировать музыку нужной длины).
export function estimateDurationMs(audioDurationsMs: number[], transitionFrames = DEFAULT_TRANSITION_FRAMES): number {
  const { durationInFrames } = layoutScenes(
    audioDurationsMs.map((ms) => ({ audioDurationMs: Math.max(0, Math.round(ms)) })), // как в buildVideoProps
    transitionFrames,
  );
  return Math.round((durationInFrames / FPS) * 1000);
}

export function buildVideoProps(input: BuildPropsInput): VideoProps {
  const { script, publicDir, voices } = input;
  if (voices.length !== script.scenes.length) {
    throw new Error(`Озвучка есть для ${voices.length} сцен из ${script.scenes.length} — props не собрать.`);
  }
  const transitionFrames = Math.max(0, Math.round(input.transitionFrames ?? DEFAULT_TRANSITION_FRAMES));

  const base = script.scenes.map((scene, i) => {
    const voice = voices[i];
    return {
      ...scene,
      audioSrc: toPublicSrc(publicDir, voice.file),
      audioDurationMs: Math.max(0, Math.round(voice.durationMs)),
      words: voice.words,
      visual: sanitizeVisual(publicDir, input.visuals?.[i]?.visual),
    };
  });
  const laid = layoutScenes(base, transitionFrames);
  const scenes: RenderScene[] = laid.scenes;

  const theme: ThemeName = input.theme ?? (script.theme && THEME_NAMES.includes(script.theme) ? script.theme : "midnight");
  const channelEnv = process.env.CHANNEL_NAME?.trim() || null;

  return {
    title: script.title,
    format: input.format ?? script.format,
    theme,
    scenes,
    captions: buildTimelineCaptions(scenes),
    transitionFrames,
    durationInFrames: laid.durationInFrames,
    music: input.music ? { src: toPublicSrc(publicDir, input.music.src), ...musicVolumes(input.music, input.musicVolume) } : null,
    whooshSrc: input.whooshSrc ? toPublicSrc(publicDir, input.whooshSrc) : null,
    sfxVolume: clamp01(envNumber("SFX_VOLUME") ?? SFX_VOLUME),
    showCaptions: input.showCaptions ?? true,
    showProgressBar: input.showProgressBar ?? true,
    channelName: input.channelName === undefined ? channelEnv : input.channelName,
    // Призыв к комментарию в финале: комментарии продвигают ролик сильнее лайков.
    // CTA_COMMENT=off — убрать «облачко».
    ctaComment: ctaCommentFromEnv(),
  };
}

export const propsDurationSec = (p: Pick<VideoProps, "durationInFrames">): number => p.durationInFrames / FPS;

function ctaCommentFromEnv(): string | null {
  const v = process.env.CTA_COMMENT?.trim();
  if (v && /^(off|none|0)$/i.test(v)) return null;
  return v || "Что думаешь? Пиши в комментариях";
}
