// Контракты модулей конвейера. Каждый модуль (voice/, audio/, script/,
// visuals/) реализует свою часть, CLI собирает их вместе. Все пути к ассетам,
// которые попадают в props композиции, — ОТНОСИТЕЛЬНО publicDir запуска
// (например "voice/s1.mp3"), абсолютные пути — только внутри Node.
//
// Переменные окружения (единый список, документируется в .env.example):
//   TTS_PROVIDER      auto | gemini | edge | piper | elevenlabs | openai | fish   (auto: gemini при ключе, иначе edge)
//   TTS_VOICE         голос провайдера (edge: ru-RU-DmitryNeural, piper: ru_RU-dmitri-medium, …)
//   TTS_RATE          темп для edge, например "+5%"
//   TTS_LANGUAGE      язык озвучки (en, kk, uz…; ставит make по сценарию): голос по умолчанию, язык Gemini TTS
//   GEMINI_API_KEY    общий ключ AI Studio — и для сценариев, и для Gemini TTS
//   GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, GEMINI_TTS_STYLE
//   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL
//   OPENAI_TTS_BASE_URL, OPENAI_TTS_MODEL, OPENAI_TTS_VOICE, OPENAI_TTS_API_KEY   (локальный Qwen3-TTS/Chatterbox)
//   FISH_TTS_BASE_URL, FISH_TTS_REFERENCE_ID
//   MODELS_DIR        куда скачивать локальные модели (по умолчанию ./models)
//   LLM_PROVIDER      gemini | claude | groq | openrouter | ollama | custom   (по умолчанию gemini)
//   LLM_MODEL, LLM_BASE_URL, LLM_API_KEY
//   ANTHROPIC_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
//   YT_SUGGEST, YT_SUGGEST_TIMEOUT_MS   подсказки поиска YouTube для заголовка/тегов (0 — выключить)
//   USAGE_LOG         журнал расхода content/usage.jsonl (0 — не писать, путь — свой файл)
//   PLAN_WEB_SEARCH, PLAN_CHECK_URLS, PLAN_URL_TIMEOUT_MS   источники фактов для plan-extend / plan-sequel
//   VISUALS           порядок источников через запятую: pexels,pixabay,cloudflare,pollinations,none
//   PEXELS_API_KEY, PIXABAY_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
//   MUSIC             auto | none | generated | <путь к файлу>   (по умолчанию auto)
//   MUSIC_DIR         папка с треками (по умолчанию ./music)
//   CHANNEL_NAME      имя канала для финальной сцены
//   REMOTION_BROWSER_EXECUTABLE, REMOTION_CHROME_MODE   (headless-shell | chrome-for-testing)
//   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN    (загрузка на YouTube из CI)

import type { Format, ScriptScene, SceneVisual, VideoScript, WordTiming } from "../types";

// ---- Озвучка (src/pipeline/voice) ----

export interface VoiceResult {
  file: string; // абсолютный путь к записанному файлу (.mp3 или .wav)
  durationMs: number;
  words: WordTiming[]; // никогда не пустой при непустом тексте
  wordsSource: "provider" | "estimated";
}

export interface VoiceOptions {
  voice?: string;
  signal?: AbortSignal;
}

export interface VoiceProvider {
  readonly name: string;
  // outFileBase — абсолютный путь БЕЗ расширения; провайдер сам добавляет .mp3/.wav.
  synthesize(text: string, outFileBase: string, opts?: VoiceOptions): Promise<VoiceResult>;
  // Есть у провайдеров с квотой «на запросы» (Gemini): все сцены одним-двумя
  // запросами, результат — по сцене на элемент, в том же порядке.
  synthesizeMany?(items: { text: string; outFileBase: string }[], opts?: VoiceOptions): Promise<VoiceResult[]>;
}

// voice/index.ts: export function getVoiceProvider(name?: string): VoiceProvider

// ---- Звук (src/pipeline/audio) ----

export interface MusicChoice {
  src: string; // относительно publicDir
  credit: string | null; // строка атрибуции для описания ролика
}

// audio/index.ts:
//   export async function prepareMusic(publicDir: string, opts: { durationMs: number; mood?: string; seed: string }): Promise<MusicChoice | null>
//   export async function makeWhoosh(publicDir: string): Promise<string>   // → "sfx/whoosh.wav"

// ---- Сценарий (src/pipeline/script) ----

export interface LlmUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // 0 для бесплатных провайдеров
  attempts: number;
}

export interface ScriptRequest {
  topic: string;
  format: Format;
  language?: string; // "ru"
  targetSeconds?: number; // по умолчанию 42 для shorts (SHORTS_DEFAULT_SECONDS), 480 для landscape
  notes?: string; // пожелания автора: стиль, аудитория, факты
}

// script/index.ts:
//   export async function generateScript(req: ScriptRequest): Promise<{ script: VideoScript; usage: LlmUsage[] }>
//   export function validateScript(json: unknown): VideoScript   // бросает Error с понятным списком проблем

// ---- Визуал (src/pipeline/visuals) ----

export interface Credit {
  provider: string; // "Pexels", "Pixabay", "Cloudflare FLUX.2"
  author: string | null;
  url: string | null;
}

export interface VisualResult {
  visual: SceneVisual; // src относительно publicDir
  credit: Credit | null;
}

export interface VisualContext {
  format: Format;
  publicDir: string;
  sceneIndex: number;
  minDurationSec: number; // сколько секунд должна длиться сцена (для видео-клипов)
  usedIds: Set<string>; // чтобы не повторять один и тот же клип в ролике
}

// visuals/index.ts:
//   export async function findVisual(scene: ScriptScene, ctx: VisualContext): Promise<VisualResult>   // при неудаче → { visual: { type: "none" }, credit: null }

export type { Format, ScriptScene, SceneVisual, VideoScript, WordTiming };
