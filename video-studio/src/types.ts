// Общий контракт между конвейером (src/pipeline, Node) и видео-композицией
// (src/remotion, браузер внутри Remotion). Только типы и чистые константы —
// никаких импортов Node или React, чтобы файл безопасно собирался и там, и там.

export type Format = "shorts" | "landscape";

export const FORMAT_SIZE: Record<Format, { width: number; height: number }> = {
  shorts: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

export const FPS = 30;

// Тип сцены определяет её раскладку и анимацию в композиции.
// hook      — первые 1–3 секунды: крупная цепляющая фраза
// statement — основная мысль: кинетическая типографика + иконка
// list      — 2–4 пункта, появляются по очереди
// stat      — крупная цифра со счётчиком и подписью
// quote     — цитата / «сильная фраза»
// media     — полноэкранный визуал (сток/AI-картинка) с подписью
// cta       — призыв подписаться в конце
export type SceneKind = "hook" | "statement" | "list" | "stat" | "quote" | "media" | "cta";

export const SCENE_KINDS: SceneKind[] = ["hook", "statement", "list", "stat", "quote", "media", "cta"];

export interface SceneStat {
  value: number; // число, до которого «докручивается» счётчик
  prefix?: string; // например "≈" или "$"
  suffix?: string; // например "%" или " млн"
  label: string; // подпись под цифрой
}

// Сцена сценария — то, что пишет LLM (или человек руками в JSON).
export interface ScriptScene {
  id: string; // "s1", "s2", …
  kind: SceneKind;
  narration: string; // что говорит диктор (полными предложениями)
  onScreen: string; // короткий текст на экране; *слово* = акцентное слово
  items?: string[]; // для list: 2–4 коротких пункта
  stat?: SceneStat; // для stat
  icon?: string; // имя иконки lucide в kebab-case: "brain", "rocket", "clock"
  visualQuery?: string; // АНГЛИЙСКИЙ запрос для стоков (Pexels/Pixabay): "person studying at night"
  imagePrompt?: string; // АНГЛИЙСКИЙ промпт для AI-картинки
}

export interface VideoScript {
  title: string; // заголовок ролика для YouTube
  description: string; // описание для YouTube
  tags: string[];
  language: string; // "ru"
  format: Format;
  theme?: ThemeName;
  scenes: ScriptScene[];
}

// ---- Рендер ----

export type ThemeName = "midnight" | "sunset" | "emerald" | "mono";
export const THEME_NAMES: ThemeName[] = ["midnight", "sunset", "emerald", "mono"];

export interface WordTiming {
  text: string;
  startMs: number; // относительно начала аудио СЦЕНЫ
  endMs: number;
}

export type SceneVisual =
  | { type: "none" }
  | { type: "image"; src: string; credit?: string }
  | { type: "video"; src: string; durationSec: number; credit?: string };

// Пути к ассетам (audioSrc, visual.src, music.src, sfx) — относительно
// publicDir бандла Remotion; в композиции оборачиваются в staticFile().
export interface RenderScene extends ScriptScene {
  audioSrc: string;
  audioDurationMs: number;
  startFrame: number; // кадр начала сцены на общей таймлинии (с учётом наложения переходов)
  durationInFrames: number; // длина Sequence сцены, включая хвост под переход
  audioStartFrame: number; // через сколько кадров после начала сцены стартует голос
  words: WordTiming[]; // тайминги слов относительно начала аудио сцены
  visual: SceneVisual;
}

// Слово субтитров на ОБЩЕЙ таймлинии (совместимо с Caption из @remotion/captions).
export interface TimelineCaption {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
}

export interface VideoProps {
  title: string;
  format: Format;
  theme: ThemeName;
  scenes: RenderScene[];
  captions: TimelineCaption[];
  transitionFrames: number;
  durationInFrames: number; // итоговая длина ролика
  music: { src: string; volume: number; duckedVolume: number } | null;
  whooshSrc: string | null; // звук перехода (генерируется локально)
  sfxVolume: number;
  showCaptions: boolean;
  showProgressBar: boolean;
  channelName: string | null; // для финальной сцены cta
  ctaComment?: string | null; // подпись к «облачку» комментария в финальной сцене; null — не показывать
}

export const DEFAULT_TRANSITION_FRAMES = 12; // 0.4 c при 30 fps
export const SCENE_LEAD_FRAMES = 8; // пауза до голоса в начале сцены
export const SCENE_TAIL_FRAMES = 14; // пауза после голоса (часть съедает переход)

// Раскладка сцен на таймлинии. Используется конвейером при сборке props и
// композицией в calculateMetadata — единственное место, где считается тайминг.
export function layoutScenes<T extends { audioDurationMs: number }>(
  scenes: T[],
  transitionFrames: number = DEFAULT_TRANSITION_FRAMES,
): { scenes: (T & { startFrame: number; durationInFrames: number; audioStartFrame: number })[]; durationInFrames: number } {
  let cursor = 0;
  const out = scenes.map((scene, i) => {
    const audioFrames = Math.ceil((scene.audioDurationMs / 1000) * FPS);
    const isLast = i === scenes.length - 1;
    // Последней сцене нужен хвост подлиннее — переход после неё не съедает кадры.
    const durationInFrames = SCENE_LEAD_FRAMES + audioFrames + SCENE_TAIL_FRAMES + (isLast ? FPS : 0);
    const placed = { ...scene, startFrame: cursor, durationInFrames, audioStartFrame: SCENE_LEAD_FRAMES };
    cursor += durationInFrames - (isLast ? 0 : transitionFrames);
    return placed;
  });
  return { scenes: out, durationInFrames: Math.max(cursor, 1) };
}

// Слова всех сцен → субтитры на общей таймлинии.
export function buildTimelineCaptions(
  scenes: { startFrame: number; audioStartFrame: number; words: WordTiming[] }[],
): TimelineCaption[] {
  const captions: TimelineCaption[] = [];
  for (const scene of scenes) {
    const offsetMs = ((scene.startFrame + scene.audioStartFrame) / FPS) * 1000;
    for (const w of scene.words) {
      captions.push({
        // Ведущий пробел — так createTikTokStyleCaptions понимает границы слов.
        text: ` ${w.text}`,
        startMs: Math.round(offsetMs + w.startMs),
        endMs: Math.round(offsetMs + w.endMs),
        timestampMs: Math.round(offsetMs + (w.startMs + w.endMs) / 2),
        confidence: null,
      });
    }
  }
  return captions;
}
