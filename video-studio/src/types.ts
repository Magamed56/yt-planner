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

// ---- Кинорежим (аддитивно) ----
// VideoScript.mode = "cinematic": сцена — один голос и одни субтитры, а картинка
// меняется по планам (shots). Каждый план — свой AI-кадр в общем стиле ролика
// (VideoScript.style) со своим движением камеры; заголовков и плашек поверх нет.

// Крупность или ракурс плана — попадает в промпт кадра.
export type ShotFraming = "establishing" | "wide" | "medium" | "close-up" | "detail" | "reaction" | "pov" | "low-angle" | "high-angle" | "overhead";
export const SHOT_FRAMINGS: ShotFraming[] = ["establishing", "wide", "medium", "close-up", "detail", "reaction", "pov", "low-angle", "high-angle", "overhead"];

// Движение камеры по кадру (src/remotion/lib/camera.ts). pan — по горизонтали,
// tilt — по вертикали; handheld — лёгкое «дыхание» с рук.
export type CameraMove = "push-in" | "pull-out" | "pan-left" | "pan-right" | "tilt-up" | "tilt-down" | "handheld";
export const CAMERA_MOVES: CameraMove[] = ["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "tilt-down", "handheld"];

export interface SceneShot {
  // АНГЛИЙСКИЙ промпт кадра. При VideoScript.shotPrompts = "complete" — полный
  // (герой с приметами, действие, одно место, свет, объектив, композиция) и
  // уходит в генератор как есть; иначе — только содержание, стиль добавит код.
  prompt: string;
  seconds?: number; // желаемая длина плана; реальная — доля длины сцены, которую задаёт голос
  framing?: ShotFraming;
  camera?: CameraMove; // нет — подберётся по крупности (defaultCamera)
  subject?: string; // кто/что в кадре: один и тот же герой или предмет называется одинаково во всех планах
  beat?: string; // первые слова narration, на которых начинается план (склейка под фразу)
  reuse?: string; // "s2-k1": кадр того плана ещё раз, с другим движением камеры — без новой генерации
  callouts?: ShotCallout[]; // подписи со стрелкой к предметам в кадре (моушен поверх картинки)
  sticker?: ShotSticker; // крупная цифра или дата поверх кадра
  // Настоящая съёмка вместо рисунка (ENGLISH, 2–6 слов): видео со стоков или фото из
  // архивов (Wikimedia Commons, Openverse). Не нашлось по теме — кадр по prompt.
  footage?: string;
  photo?: string;
}

// Подпись к предмету в кадре: где он — скажет проверка кадра (visuals/review.ts).
export interface ShotCallout {
  label: string; // по-русски, 1–3 слова: «пулемёт Льюиса»
  target: string; // ENGLISH: что в кадре подписываем — "the machine gun"
  beat?: string; // слова narration, на которых подпись появляется
}

export interface ShotSticker {
  text: string; // «1932», «×10», «986»
  beat?: string;
}

export type VideoMode = "infographic" | "cinematic";

// Общий вид кадров ролика (по-английски). Старые сценарии: поля direction…
// environment дописываются в промпт каждого кадра. Новые (shotPrompts =
// "complete"): world, look и characters — «библия» ролика, по которой
// сценарист пишет полные промпты; код к ним ничего не дописывает.
export interface VisualStyle {
  direction?: string; // художественное направление: "dark fantasy film still"
  lighting?: string; // "low-key candle light, volumetric haze"
  palette?: string; // "deep teal and amber"
  realism?: string; // "photorealistic" | "painterly" …
  mood?: string; // "mysterious, tense"
  environment?: string; // "misty northern village, wooden houses"
  world?: string; // один мир ролика: место, эпоха, время года, погода
  look?: string; // съёмка: камера, объектив, плёнка, свет, цвет
  characters?: StyleCharacter[]; // сквозные герои с неизменными приметами
}

export interface StyleCharacter {
  name: string; // "Major Meredith"
  look: string; // ENGLISH приметы — слово в слово в каждом промпте с этим героем
}

// newFrames — сколько НОВЫХ картинок просим у сценариста на ролик (остальные
// планы повторяют кадры через reuse): бесплатной квоты Cloudflare хватает на
// ≈ 60 кадров в сутки, а одна картинка с движением камеры держит 3–5 с.
export const SHOT_LIMITS = { perScene: 6, minSec: 1, maxSec: 10, newFrames: 12, callouts: 2 } as const;
// План короче секунды мелькает: такие точки склейки сдвигаются.
export const MIN_SHOT_FRAMES = 30;
// Склейка на фразу — чуть раньше первого слова: картинка «ведёт» голос.
export const BEAT_LEAD_FRAMES = 2;

export const isCinematic = (script: { mode?: VideoMode }): boolean => script.mode === "cinematic";

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
  shots?: SceneShot[]; // кинорежим: планы сцены по порядку (без mode "cinematic" не используются)
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
  mode?: VideoMode; // нет — обычный режим (инфографика)
  style?: VisualStyle; // общий стиль AI-кадров ролика
  shotPrompts?: "complete"; // промпты планов полные — стиль к ним не дописывается (кинорежим, сценарий от 10.2026)
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
  shots?: RenderShot[]; // кинорежим: планы с кадром и местом внутри сцены (layoutShots)
}

export interface RenderShot extends SceneShot {
  camera: CameraMove; // всегда задано (своё или defaultCamera)
  visual: SceneVisual;
  from: number; // кадр начала плана относительно начала сцены
  durationInFrames: number;
  marks?: ShotMarks; // моушен поверх кадра: подписи и цифра (кадры — от начала плана)
}

// Прямоугольник на картинке в долях её ширины и высоты (левый верхний угол + размер).
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Что знает проверка о кадре (visuals/review.ts): где главный предмет и
// предметы для подписей. Нет — подписи плана не рисуются.
export interface ShotMeta {
  subject?: Box;
  boxes?: Record<string, Box>; // target подписи → где он на картинке
}

export interface ShotMarks {
  callouts: { label: string; box: Box; at: number }[];
  sticker: { text: string; at: number; place: "top" | "middle" } | null;
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

// ---- Планы кинорежима ----

// Камера по крупности, если сценарий её не задал: общий план «осматривается»
// панорамой, деталь — наездом, реакция — с рук. Подряд одно и то же движение
// не повторяем — соседние планы иначе сливаются.
const CAMERA_PAIR: Record<CameraMove, CameraMove> = {
  "push-in": "pull-out",
  "pull-out": "push-in",
  "pan-left": "pan-right",
  "pan-right": "pan-left",
  "tilt-up": "tilt-down",
  "tilt-down": "tilt-up",
  handheld: "push-in",
};

export function defaultCamera(framing: ShotFraming | undefined, index: number, prev?: CameraMove): CameraMove {
  let move: CameraMove;
  switch (framing) {
    case "establishing":
    case "wide":
    case "overhead":
      move = index % 2 === 0 ? "pan-right" : "pan-left";
      break;
    case "low-angle":
      move = "tilt-up";
      break;
    case "high-angle":
      move = "tilt-down";
      break;
    case "reaction":
    case "pov":
      move = "handheld";
      break;
    case "close-up":
    case "detail":
      move = "push-in";
      break;
    default:
      move = index % 2 === 0 ? "push-in" : "pull-out";
  }
  return move === prev ? CAMERA_PAIR[move] : move;
}

const normWord = (w: string) => w.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

// Где в словах сцены начинается фраза beat (по первым трём её словам), начиная
// со слова fromIndex: склейка не может уйти назад, к уже показанному плану.
export function findBeat(beat: string, words: WordTiming[], fromIndex = 0): { index: number; startMs: number } | null {
  const target = beat.split(/\s+/).map(normWord).filter(Boolean).slice(0, 3);
  if (!target.length) return null;
  const ws = words.map((w) => normWord(w.text));
  for (let i = Math.max(0, fromIndex); i + target.length <= ws.length; i++) {
    if (target.every((t, k) => ws[i + k] === t)) return { index: i, startMs: words[i]!.startMs };
  }
  return null;
}

// Раскладка планов внутри сцены: длину сцены задаёт голос (layoutScenes), планы
// её только делят — тайминг сцен, звука и субтитров от них не меняется, а сумма
// длин планов всегда ровно durationInFrames сцены. Точка склейки — по beat
// (слово найдено), иначе по доле seconds. Края сцены (edgeFrames — переход к
// соседней сцене) и минимум MIN_SHOT_FRAMES на план соблюдаются; не влезающие
// планы с конца отбрасываются.
export function layoutShots<S extends SceneShot & { visual: SceneVisual }>(
  shots: S[],
  scene: { durationInFrames: number; audioStartFrame: number; words: WordTiming[] },
  edgeFrames = 0,
): (S & { camera: CameraMove; from: number; durationInFrames: number })[] {
  const total = Math.max(1, Math.round(scene.durationInFrames));
  const edge = Math.max(0, Math.round(edgeFrames));
  const fit = Math.max(1, Math.floor((total - 2 * edge) / MIN_SHOT_FRAMES));
  const list = shots.slice(0, Math.min(shots.length, fit));
  const n = list.length;
  if (n === 0) return [];

  const given = list.map((s) => (typeof s.seconds === "number" && s.seconds > 0 ? s.seconds : null));
  const known = given.filter((v): v is number => v !== null);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const weights = given.map((v) => v ?? fallback);
  const sum = weights.reduce((a, b) => a + b, 0);

  const cuts: number[] = [0];
  let acc = 0;
  let wordFrom = 0;
  for (let k = 1; k < n; k++) {
    acc += weights[k - 1]!;
    let at = Math.round((total * acc) / sum);
    const beat = list[k]!.beat;
    const hit = beat ? findBeat(beat, scene.words, wordFrom) : null;
    if (hit) {
      at = scene.audioStartFrame + Math.floor((Math.max(0, hit.startMs) / 1000) * FPS) - BEAT_LEAD_FRAMES;
      wordFrom = hit.index + 1;
    }
    const lo = k === 1 ? edge + MIN_SHOT_FRAMES : cuts[k - 1]! + MIN_SHOT_FRAMES;
    const hi = total - edge - MIN_SHOT_FRAMES * (n - k);
    cuts.push(Math.min(hi, Math.max(lo, at)));
  }
  cuts.push(total);

  let prev: CameraMove | undefined;
  return list.map((s, k) => {
    const camera = s.camera ?? defaultCamera(s.framing, k, prev);
    prev = camera;
    return { ...s, camera, from: cuts[k]!, durationInFrames: cuts[k + 1]! - cuts[k]! };
  });
}

// Планы сценария + их кадры → планы рендера (props и фикстуры собирают их
// одинаково). План без кадра выпадает — соседние делят его время. Ни одного
// кадра — один план из визуала сцены, если он есть; иначе undefined, и сцена
// рисуется обычной раскладкой.
export function renderShots(
  scene: { durationInFrames: number; audioStartFrame: number; words: WordTiming[]; visual: SceneVisual },
  shots: SceneShot[] | undefined,
  visuals: (SceneVisual | null | undefined)[],
  edgeFrames: number,
  metas: (ShotMeta | null | undefined)[] = [],
): RenderShot[] | undefined {
  if (!shots?.length) return undefined;
  const ready = shots
    .map((s, k) => ({ ...s, visual: visuals[k] ?? ({ type: "none" } as SceneVisual), meta: metas[k] ?? null }))
    .filter((s) => s.visual.type !== "none");
  if (!ready.length) {
    if (scene.visual.type === "none") return undefined;
    ready.push({ ...shots[0]!, visual: scene.visual, meta: null });
  }
  const out = layoutShots(ready, scene, edgeFrames).map(({ meta, ...shot }) => {
    const marks = shotMarks(shot, meta, scene);
    return marks ? { ...shot, marks } : shot;
  });
  return out.length ? out : undefined;
}

// Подпись появляется на своих словах (beat) и держится не меньше MARK_TAIL
// кадров; план короче MARK_MIN_SHOT — без подписей (не успеть прочитать).
const MARK_FIRST = 6;
const MARK_TAIL = 20;
const MARK_MIN_SHOT = 36;

export function shotMarks(
  shot: SceneShot & { from: number; durationInFrames: number },
  meta: ShotMeta | null | undefined,
  scene: { audioStartFrame: number; words: WordTiming[] },
): ShotMarks | undefined {
  const dur = shot.durationInFrames;
  if (dur < MARK_MIN_SHOT) return undefined;
  // Кадр слов beat относительно начала плана; не нашлось — запасной момент.
  const at = (beat: string | undefined, fallback: number): number => {
    const hit = beat ? findBeat(beat, scene.words) : null;
    const f = hit ? scene.audioStartFrame + Math.floor((Math.max(0, hit.startMs) / 1000) * FPS) - shot.from : fallback;
    return Math.max(MARK_FIRST, Math.min(dur - MARK_TAIL, f));
  };
  const callouts: ShotMarks["callouts"] = [];
  (shot.callouts ?? []).slice(0, SHOT_LIMITS.callouts).forEach((c, k) => {
    const box = meta?.boxes?.[c.target];
    if (!box) return; // проверка не нашла предмет — подпись в пустоту не рисуем
    callouts.push({ label: c.label, box, at: at(c.beat, MARK_FIRST + 4 + k * 14) });
  });
  const sticker = shot.sticker?.text.trim()
    ? { text: shot.sticker.text.trim(), at: at(shot.sticker.beat, MARK_FIRST), place: meta?.subject && meta.subject.y < 0.3 ? ("middle" as const) : ("top" as const) }
    : null;
  return callouts.length || sticker ? { callouts, sticker } : undefined;
}
