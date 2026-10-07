// Gemini TTS (Google AI Studio, бесплатный тариф ≈ 100 запросов/сутки на модель).
// Новые модели gemini-3.8-flash-tts / -lite-tts работают через POST
// /v1beta/interactions (стиль — в speech_metadata.style, ответ — готовый WAV);
// старые (*-preview-tts) — через generateContent и отдают сырой PCM 24 кГц.
// Квоты у моделей раздельные, поэтому при 429/404 пробуем следующую по цепочке.
// Таймингов слов нет — их оценивает общая обвязка по звуку.

import { decodePcm16, decodeWav, isWav } from "../../audio/wav";
import { envInt, httpRequest, TtsError } from "../http";
import type { RawAudio, RawProvider } from "../provider";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_DEFAULT_VOICE = "Puck"; // «бодрый» мужской; Kore, Charon, Aoede, Fenrir… — см. README
export const GEMINI_DEFAULT_STYLE = "Энергично и тепло, как ведущий научпоп-канала. Чёткая дикция, живые интонации, без пауз в начале.";

const isLegacy = (model: string) => /preview|^gemini-2\.|^gemini-3\.[01]-/.test(model);

// Цепочка моделей: заданная → «лёгкая» 3.8 → старая preview.
export function geminiModelChain(model: string): string[] {
  const chain = [model];
  if (model === "gemini-3.8-flash-tts") chain.push("gemini-3.8-flash-lite-tts");
  if (!isLegacy(model)) chain.push("gemini-3.1-flash-tts-preview");
  return [...new Set(chain)];
}

interface InteractionsResponse {
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string; sample_rate?: number }[] }[];
}
interface GenerateContentResponse {
  candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
}

// Ответ Gemini → PCM: WAV с заголовком или сырой L16 (rate=… в mime-типе).
export function geminiAudioToPcm(b64: string, mime: string, sampleRateHint?: number): RawAudio {
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) throw new TtsError("Gemini TTS: пустое аудио в ответе.", { retryable: true });
  if (isWav(bytes)) return { kind: "pcm", audio: decodeWav(bytes) };
  if (/mpeg|mp3/i.test(mime)) return { kind: "mp3", bytes };
  const rate = Number(/rate=(\d+)/i.exec(mime)?.[1] ?? sampleRateHint ?? 24000);
  return { kind: "pcm", audio: decodePcm16(bytes, rate) };
}

export function geminiProvider(): RawProvider {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
  const model = process.env.GEMINI_TTS_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const style = process.env.GEMINI_TTS_STYLE?.trim() || GEMINI_DEFAULT_STYLE;
  const timeoutMs = envInt("TTS_TIMEOUT_MS", 120_000);
  return {
    name: "gemini",
    output: "wav",
    resolveVoice: (v) => {
      const own = process.env.GEMINI_TTS_VOICE?.trim();
      // Голоса Gemini — одно слово с заглавной (Kore, Puck); edge/piper-имена из TTS_VOICE игнорируем.
      const cand = own || v;
      return cand && /^[A-Z][a-z]+$/.test(cand) ? cand : GEMINI_DEFAULT_VOICE;
    },
    configKey: () => `gemini:${model}:${style}`,
    async synthesizeRaw(text, ctx) {
      if (!key) throw new TtsError("Gemini TTS: не задан GEMINI_API_KEY (ключ бесплатно: https://aistudio.google.com/apikey).");
      const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
      let lastErr: TtsError | null = null;
      for (const m of geminiModelChain(model)) {
        try {
          if (!isLegacy(m)) {
            const r = await httpRequest(`Gemini TTS (${m})`, `${BASE}/interactions`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: m,
                input: [{ type: "text", text, annotations: style ? [{ type: "speech_metadata", style }] : [] }],
                response_format: { type: "audio", mime_type: "audio/wav" },
                generation_config: { speech_config: [{ voice: ctx.voice, language: "ru" }] },
              }),
            }, { timeoutMs, signal: ctx.signal });
            const j = JSON.parse(r.body.toString("utf8")) as InteractionsResponse;
            const audio = (j.steps ?? [])
              .filter((s) => s.type === "model_output")
              .flatMap((s) => s.content ?? [])
              .reverse()
              .find((c) => c.type === "audio" && c.data);
            if (!audio?.data) throw new TtsError(`Gemini TTS (${m}): в ответе нет аудио.`, { retryable: true });
            return geminiAudioToPcm(audio.data, audio.mime_type ?? "audio/wav", audio.sample_rate);
          }
          // Старый путь: режиссура — фразой перед текстом в форме «Как читать: текст»,
          // как в примерах Google (модель выполняет указание, а не озвучивает его).
          const r = await httpRequest(`Gemini TTS (${m})`, `${BASE}/models/${m}:generateContent`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              contents: [{ parts: [{ text: style ? `${style.replace(/[.!?…\s]+$/u, "")}:\n${text}` : text }] }],
              generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ctx.voice } } } },
            }),
          }, { timeoutMs, signal: ctx.signal });
          const j = JSON.parse(r.body.toString("utf8")) as GenerateContentResponse;
          const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
          if (!part?.data) throw new TtsError(`Gemini TTS (${m}): в ответе нет аудио.`, { retryable: true });
          return geminiAudioToPcm(part.data, part.mimeType ?? "audio/L16;codec=pcm;rate=24000");
        } catch (e) {
          if (!(e instanceof TtsError)) throw new TtsError(`Gemini TTS (${m}): ${(e as Error).message}`, { retryable: true, cause: e });
          // Ключ неверный — другие модели не помогут.
          if (e.status === 401 || e.status === 403) throw e;
          const fallThrough = e.status === 429 || e.status === 404 || e.status === 400 || (e.status ?? 0) >= 500;
          if (!fallThrough) throw e;
          lastErr = e;
          console.warn(`[озвучка] ${e.message} Пробую следующую модель…`);
        }
      }
      throw lastErr ?? new TtsError("Gemini TTS: ни одна модель не ответила.", { retryable: true });
    },
  };
}
