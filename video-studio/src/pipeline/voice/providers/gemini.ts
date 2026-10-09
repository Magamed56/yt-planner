// Gemini TTS (Google AI Studio). Бесплатный тариф — около 10 запросов в сутки
// на модель (проверено 07.10.2026: «limit: 10 requests per day»), поэтому сцены
// ролика озвучиваются одним запросом и режутся по паузам (batchMaxChars, split.ts).
// Новые модели gemini-3.8-flash-tts / -lite-tts работают через POST
// /v1beta/interactions (стиль — в speech_metadata.style, ответ — готовый WAV);
// старые (*-preview-tts) — через generateContent и отдают сырой PCM 24 кГц.
// Квоты у моделей раздельные, поэтому при 429/404 пробуем следующую по цепочке.
// Но 429 «в минуту» (RetryInfo «retry in 37s») — повод подождать и повторить
// ту же модель, а не менять голос посреди ролика; на следующую модель идём
// только при суточной квоте, 404/400 или повторном 5xx, и дальше весь ролик
// озвучивает уже она (один голос, а не три).
// Таймингов слов нет — их оценивает общая обвязка по звуку.

import { decodePcm16, decodeWav, isWav } from "../../audio/wav";
import { envInt, httpRequest, sleep, TtsError } from "../http";
import type { RawAudio, RawContext, RawProvider } from "../provider";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_DEFAULT_VOICE = "Charon"; // глубокий спокойный мужской (выбор автора); Puck, Fenrir, Kore, Aoede, Zephyr… — см. README
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
  const baseStyle = process.env.GEMINI_TTS_STYLE?.trim() || GEMINI_DEFAULT_STYLE;
  const timeoutMs = envInt("TTS_TIMEOUT_MS", 120_000);
  const chain = geminiModelChain(model);
  // Шорт ≈ 700–900 символов — один запрос; длинный ролик — по ~2500 символов.
  const batchMaxChars = envInt("GEMINI_TTS_BATCH_CHARS", 2500);
  let start = 0; // с какой модели цепочки начинать (после перехода — с запасной)
  return {
    name: "gemini",
    output: "wav",
    batchMaxChars,
    resolveVoice: (v) => {
      const own = process.env.GEMINI_TTS_VOICE?.trim();
      // Голоса Gemini — одно слово с заглавной (Kore, Puck); edge/piper-имена из TTS_VOICE игнорируем.
      const cand = own || v;
      return cand && /^[A-Z][a-z]+$/.test(cand) ? cand : GEMINI_DEFAULT_VOICE;
    },
    configKey: () => `gemini:${model}:${baseStyle}`,
    async synthesizeRaw(text, ctx) {
      if (!key) throw new TtsError("Gemini TTS: не задан GEMINI_API_KEY (ключ бесплатно: https://aistudio.google.com/apikey).");
      let lastErr: TtsError | null = null;
      for (let idx = start; idx < chain.length; idx++) {
        const m = chain[idx]!;
        for (let attempt = 1; ; attempt++) {
          try {
            const audio = await callModel(m, text, ctx);
            start = idx; // «липкий» запасной вариант: остальные сцены — той же моделью
            return idx > 0 ? { ...audio, fallback: m } : audio;
          } catch (e) {
            if (!(e instanceof TtsError)) throw new TtsError(`Gemini TTS (${m}): ${(e as Error).message}`, { retryable: true, cause: e });
            // Ключ неверный — другие модели не помогут.
            if (e.status === 401 || e.status === 403) throw e;
            const wait = sameModelWait(e, attempt);
            if (wait !== null && !ctx.signal?.aborted) {
              console.warn(`[озвучка] Gemini TTS (${m}): ${e.status === 429 ? "лимит запросов в минуту" : `сбой сервиса (HTTP ${e.status})`} — жду ${Math.ceil(wait / 1000)} с и повторяю…`);
              await sleep(wait, ctx.signal);
              continue;
            }
            const fallThrough = e.status === 429 || e.status === 404 || e.status === 400 || (e.status ?? 0) >= 500;
            if (!fallThrough) throw e;
            lastErr = e;
            if (idx + 1 < chain.length) console.warn(`[озвучка] ${e.message} Пробую следующую модель (${chain[idx + 1]}) — ею будет озвучен и остаток ролика…`);
            break;
          }
        }
      }
      throw lastErr ?? new TtsError("Gemini TTS: ни одна модель не ответила.", { retryable: true });
    },
  };

  async function callModel(m: string, text: string, ctx: RawContext): Promise<RawAudio> {
    // Несколько сцен в одном запросе (абзацы) — просим явную паузу между ними:
    // по ней звук потом режется на сцены.
    const style = text.includes("\n\n") ? `${baseStyle.replace(/[.!?…\s]+$/u, "")}. Между абзацами — пауза около секунды.` : baseStyle;
    const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
    if (!isLegacy(m)) {
      const r = await httpRequest(`Gemini TTS (${m})`, `${BASE}/interactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: m,
          input: [{ type: "text", text, annotations: style ? [{ type: "speech_metadata", style }] : [] }],
          response_format: { type: "audio", mime_type: "audio/wav" },
          // Язык ролика (TTS_LANGUAGE ставит make по сценарию); по умолчанию — русский канал.
          generation_config: { speech_config: [{ voice: ctx.voice, language: process.env.TTS_LANGUAGE?.trim() || "ru" }] },
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
  }
}

// Когда повторить ту же модель вместо перехода на следующую: 429 с квотой «в
// минуту» (или с RetryInfo без id квоты) — ждём сколько сказано (до ~1 мин),
// не больше двух раз; 5xx — один повтор через 3 с. Суточная квота, 404, 400
// и 429 без подробностей — сразу дальше по цепочке.
function sameModelWait(e: TtsError, attempt: number): number | null {
  if (e.status === 429) {
    const perDay = /PerDay/i.test(e.quotaId ?? "");
    const perMinute = /PerMinute/i.test(e.quotaId ?? "") || (!e.quotaId && e.retryAfterMs !== undefined);
    if (perDay || !perMinute || attempt > 2) return null;
    const ms = (e.retryAfterMs ?? 20_000) + 1000;
    return ms <= 66_000 ? ms : null;
  }
  if ((e.status ?? 0) >= 500 && attempt === 1) return 3000;
  return null;
}
