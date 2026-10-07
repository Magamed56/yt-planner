// Озвучка сцен. Провайдер выбирается TTS_PROVIDER (по умолчанию edge).
// Все провайдеры возвращают одно и то же: файл (.mp3 или .wav), длительность
// и тайминги слов (родные или оценённые по звуку) — см. VoiceResult.

import type { VoiceProvider } from "../contracts";
import { wrapProvider, type RawProvider } from "./provider";
import { edgeProvider } from "./providers/edge";
import { elevenLabsProvider } from "./providers/elevenlabs";
import { fishProvider } from "./providers/fish";
import { geminiProvider } from "./providers/gemini";
import { openAiProvider } from "./providers/openai";
import { piperProvider } from "./providers/piper";

export type VoiceProviderName = "edge" | "piper" | "gemini" | "elevenlabs" | "openai" | "fish";

interface ProviderInfo {
  make: () => RawProvider;
  requires: string[]; // обязательные переменные окружения
  about: string; // для подсказки в ошибке
}

export const VOICE_PROVIDERS: Record<VoiceProviderName, ProviderInfo> = {
  edge: { make: () => edgeProvider(), requires: [], about: "Microsoft Edge, бесплатно, без ключа, родные тайминги слов (TTS_VOICE, TTS_RATE)" },
  piper: { make: () => piperProvider(), requires: [], about: "локально и офлайн, модель скачается сама в MODELS_DIR (TTS_VOICE=ru_RU-dmitri-medium | irina | denis | ruslan)" },
  gemini: { make: () => geminiProvider(), requires: ["GEMINI_API_KEY"], about: "Google AI Studio, бесплатный лимит ~100 запросов/сутки (GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, GEMINI_TTS_STYLE)" },
  elevenlabs: { make: () => elevenLabsProvider(), requires: ["ELEVENLABS_API_KEY"], about: "лучшее качество, бесплатный план — без коммерческих прав (ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL)" },
  openai: { make: () => openAiProvider(), requires: [], about: "любой OpenAI-совместимый сервер /audio/speech: Qwen3-TTS (vLLM-Omni), Chatterbox (OPENAI_TTS_BASE_URL, OPENAI_TTS_VOICE, OPENAI_TTS_MODEL)" },
  fish: { make: () => fishProvider(), requires: [], about: "локальный Fish Speech, некоммерческая лицензия весов (FISH_TTS_BASE_URL, FISH_TTS_REFERENCE_ID)" },
};

// Синонимы, которые люди пишут чаще всего.
const ALIASES: Record<string, VoiceProviderName> = {
  "edge-tts": "edge",
  microsoft: "edge",
  "openai-compatible": "openai",
  qwen: "openai",
  "qwen3-tts": "openai",
  chatterbox: "openai",
  "fish-speech": "fish",
  eleven: "elevenlabs",
  "google": "gemini",
  sherpa: "piper",
};

function providerHelp(): string {
  return (Object.entries(VOICE_PROVIDERS) as [VoiceProviderName, ProviderInfo][])
    .map(([name, info]) => `  ${name.padEnd(11)} ${info.requires.length ? `[нужно: ${info.requires.join(", ")}] ` : ""}— ${info.about}`)
    .join("\n");
}

export function getVoiceProvider(name?: string): VoiceProvider {
  const raw = (name ?? process.env.TTS_PROVIDER ?? "edge").trim().toLowerCase() || "edge";
  const key = (raw in VOICE_PROVIDERS ? raw : ALIASES[raw]) as VoiceProviderName | undefined;
  if (!key) {
    throw new Error(`Неизвестный TTS_PROVIDER="${raw}". Доступные провайдеры озвучки:\n${providerHelp()}`);
  }
  const info = VOICE_PROVIDERS[key];
  const missing = info.requires.filter((v) => !process.env[v]?.trim() && !(v === "GEMINI_API_KEY" && process.env.GOOGLE_API_KEY?.trim()));
  if (missing.length) {
    throw new Error(
      `Для озвучки через "${key}" не задано: ${missing.join(", ")} (добавьте в .env). Или выберите провайдер без ключа — edge или piper.\nВсе провайдеры:\n${providerHelp()}`,
    );
  }
  return wrapProvider(info.make());
}

export { normalizeText, tokenize } from "./text";
export { analyzeSpeech, estimateWordTimings, estimateWordsUniform, alignToTokens } from "./timing";
export { audioFileDurationMs } from "./duration";
export { ensurePiperModel, resolvePiperVoice } from "./providers/piper";
export { VOICE_TARGET_RMS_DB } from "./provider";
