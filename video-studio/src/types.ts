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
// quiz      — «Правда или миф?»: утверждение голосом → пауза с обратным отсчётом
//             (без голоса) → вердикт с коротким пояснением и вопросом зрителю
export type SceneKind = "hook" | "statement" | "list" | "stat" | "quote" | "media" | "cta" | "quiz";

export const SCENE_KINDS: SceneKind[] = ["hook", "statement", "list", "stat", "quote", "media", "cta", "quiz"];

export interface SceneStat {
  value: number; // число, до которого «докручивается» счётчик
  prefix?: string; // например "≈" или "$"
  suffix?: string; // например "%" или " млн"
  label: string; // подпись под цифрой
}

// Карта: точка на стилизованной карте мира с пульсирующей меткой (сцена про место).
export interface SceneMap {
  lat: number; // широта, −90…90
  lon: number; // долгота, −180…180
  label: string; // подпись метки по-русски: «Гиза», «Санкт-Петербург»
  zoom?: "world" | "region" | "city"; // насколько приблизить (по умолчанию region)
}

// Сравнение 2–4 величин одного типа: анимированные столбики.
export interface SceneCompare {
  items: { label: string; value: number }[];
  suffix?: string; // единицы после числа: " лет", "%"
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
  quiz?: SceneQuiz; // для quiz: ответ и пояснение (narration — само утверждение)
  chapter?: string; // у первой сцены главы длинного ролика: название главы (карточка + таймкод в описании)
  map?: SceneMap; // необязательно: сцена показывает место на карте
  compare?: SceneCompare; // необязательно: сцена показывает сравнение столбиками
}

// ---- Викторина и главы (аддитивно) ----

// Сцена quiz: narration — утверждение с вопросом «Правда или миф?», дальше
// голоса нет — пауза с обратным отсчётом и вердикт; объясняет ответ следующая сцена.
export interface SceneQuiz {
  answer: "truth" | "myth";
  explanation: string; // короткое пояснение на экране после вердикта
  question?: string; // вопрос зрителю для комментариев (на экране)
  pauseSec?: number; // пауза на раздумье, 3–5 с
}

export const QUIZ_PAUSE_SEC = { min: 3, max: 5, default: 3 } as const;
export const QUIZ_REVEAL_FRAMES = 45; // вердикт держится 1.5 с до перехода
export const CHAPTER_CARD_FRAMES = 54; // карточка главы ≈ 1.8 с перед голосом её первой сцены

export function quizPauseFrames(scene: { kind?: string; quiz?: { pauseSec?: number } | null }): number {
  if (scene.kind !== "quiz" || !scene.quiz) return 0;
  const raw = Number(scene.quiz.pauseSec);
  const sec = Number.isFinite(raw) && raw > 0 ? Math.min(QUIZ_PAUSE_SEC.max, Math.max(QUIZ_PAUSE_SEC.min, raw)) : QUIZ_PAUSE_SEC.default;
  return Math.round(sec * FPS);
}

// Карточка главы — у всех глав, кроме самой первой сцены ролика (хук не задерживаем).
export function chapterCardFrames(scene: { chapter?: string | null }, index: number): number {
  return index > 0 && typeof scene.chapter === "string" && scene.chapter.trim() ? CHAPTER_CARD_FRAMES : 0;
}

// Кадры внутри quiz-сцены (от начала сцены): отсчёт стартует, когда голос закончился.
export function quizTiming(scene: { kind?: string; quiz?: { pauseSec?: number } | null; audioStartFrame: number; audioDurationMs: number }) {
  const countdownStart = scene.audioStartFrame + Math.ceil((scene.audioDurationMs / 1000) * FPS);
  const pauseFrames = quizPauseFrames(scene);
  return { countdownStart, pauseFrames, revealAt: countdownStart + pauseFrames, revealFrames: pauseFrames ? QUIZ_REVEAL_FRAMES : 0 };
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
  // fit: "contain" — фото целиком поверх размытой копии (реальное горизонтальное фото в Shorts)
  | { type: "image"; src: string; credit?: string; fit?: "cover" | "contain" }
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

// Звуки монтажа (синтезируются локально, src/pipeline/audio/sfx.ts), пути — от publicDir.
export interface SfxSet {
  whooshes: string[]; // варианты свиста переходов — по кругу
  pop: string | null; // пункт списка, столбик сравнения, метка на карте
  impact: string | null; // удар при раскрытии крупной цифры
  rise: string | null; // нарастание к удару
  sting: string | null; // искра бренд-заставки
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
  sfx?: SfxSet | null; // набор звуков монтажа; нет — только whooshSrc (старые props.json)
  brandIntro?: boolean; // бренд-заставка ≤ 0,5 с поверх начала хука (channel.json → brandIntro, BRAND_INTRO)
  sfxVolume: number;
  showCaptions: boolean;
  showProgressBar: boolean;
  channelName: string | null; // для финальной сцены cta
  ctaComment?: string | null; // подпись к «облачку» комментария в финальной сцене; null — не показывать
  language?: string; // язык ролика (из сценария): подписи композиции и запись чисел; нет — русский
  // Файл канала не по умолчанию (channels/en.json): из него бренд-заставка берёт название
  // (src/remotion/brand/data.ts, ключ BRAND_CHANNEL_PROP). Нет — channel.json из бандла.
  brandChannel?: Record<string, unknown>;
}

export const DEFAULT_TRANSITION_FRAMES = 12; // 0.4 c при 30 fps
// Темп склеек. Было ≈ 0,57 с тишины между репликами соседних сцен (пауза до
// голоса 8 + хвост 14 − переход 12 кадров + края файлов голоса) и лишняя
// секунда в конце — на каждой склейке ролик будто подвисал. Теперь голос новой
// сцены звучит ещё во время перехода, а переход стартует сразу по концу фразы.
export const SCENE_LEAD_FRAMES = 3; // пауза до голоса в начале сцены (внутри перехода)
// Кадров между концом файла голоса и началом следующего; с тишиной по краям
// самих файлов (voice/provider.ts) между фразами ≈ 0,2 с.
export const VOICE_GAP_FRAMES = 2;
export const SCENE_TAIL_FRAMES = sceneTailFrames(DEFAULT_TRANSITION_FRAMES); // 11 кадров при переходе 12
export const FINAL_TAIL_FRAMES = 15; // финал: переход его не съедает — ≈ 0,5 с на точку вместо лишней секунды

// Хвост сцены после голоса: его съедает переход, остаток — VOICE_GAP_FRAMES.
// Через переход, а не константой: при длинном переходе голоса не наложатся.
export function sceneTailFrames(transitionFrames: number): number {
  return Math.max(0, Math.round(transitionFrames) + VOICE_GAP_FRAMES - SCENE_LEAD_FRAMES);
}

// Раскладка сцен на таймлинии. Используется конвейером при сборке props и
// композицией в calculateMetadata — единственное место, где считается тайминг.
// Карточка главы сдвигает голос сцены, пауза викторины и вердикт идут после голоса.
export function layoutScenes<T extends { audioDurationMs: number; kind?: string; quiz?: { pauseSec?: number } | null; chapter?: string | null }>(
  scenes: T[],
  transitionFrames: number = DEFAULT_TRANSITION_FRAMES,
): { scenes: (T & { startFrame: number; durationInFrames: number; audioStartFrame: number })[]; durationInFrames: number } {
  let cursor = 0;
  const tail = sceneTailFrames(transitionFrames);
  const out = scenes.map((scene, i) => {
    const audioFrames = Math.ceil((scene.audioDurationMs / 1000) * FPS);
    const isLast = i === scenes.length - 1;
    const lead = SCENE_LEAD_FRAMES + chapterCardFrames(scene, i);
    const pause = quizPauseFrames(scene);
    const quizTail = pause ? pause + QUIZ_REVEAL_FRAMES : 0;
    const durationInFrames = lead + audioFrames + quizTail + (isLast ? FINAL_TAIL_FRAMES : tail);
    const placed = { ...scene, startFrame: cursor, durationInFrames, audioStartFrame: lead };
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
      // Слово не начинается раньше своего файла голоса: тайминги провайдера
      // после обрезки тишины бывают чуть «в минусе», а пауза на склейке всего
      // ≈ 0,2 с — такое слово попало бы на страницу субтитров прошлой сцены.
      const startMs = Math.max(0, w.startMs);
      const endMs = Math.max(startMs, w.endMs);
      captions.push({
        // Ведущий пробел — так createTikTokStyleCaptions понимает границы слов.
        text: ` ${w.text}`,
        startMs: Math.round(offsetMs + startMs),
        endMs: Math.round(offsetMs + endMs),
        timestampMs: Math.round(offsetMs + (startMs + endMs) / 2),
        confidence: null,
      });
    }
  }
  return captions;
}
