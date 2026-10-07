// ElevenLabs (лучшее качество, точные посимвольные тайминги). Бесплатный план —
// 10 000 кредитов в месяц, но БЕЗ коммерческих прав и с обязательной
// атрибуцией: для монетизируемого канала нужен платный Starter.

import { decodePcm16 } from "../../audio/wav";
import { envInt, httpRequest, TtsError, warnOnce } from "../http";
import type { RawAudio, RawProvider } from "../provider";
import { charsToWords } from "../timing";

const BASE = "https://api.elevenlabs.io";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_v4";
// Премиум-голос из библиотеки по умолчанию (George). Для русского лучше выбрать
// носителя: Voice Library → фильтр Russian → ELEVENLABS_VOICE_ID.
export const ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export function elevenLabsProvider(): RawProvider {
  const key = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  const model = process.env.ELEVENLABS_MODEL?.trim() || ELEVENLABS_DEFAULT_MODEL;
  const format = process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128";
  const timeoutMs = envInt("TTS_TIMEOUT_MS", 120_000);
  return {
    name: "elevenlabs",
    output: format.startsWith("pcm_") ? "wav" : "mp3",
    resolveVoice: () => process.env.ELEVENLABS_VOICE_ID?.trim() || ELEVENLABS_DEFAULT_VOICE,
    configKey: () => `elevenlabs:${model}:${format}:${process.env.TTS_RATE ?? ""}`,
    async synthesizeRaw(text, ctx): Promise<RawAudio> {
      if (!key) throw new TtsError("ElevenLabs: не задан ELEVENLABS_API_KEY.");
      warnOnce(
        "elevenlabs-license",
        "[озвучка] ElevenLabs: на бесплатном плане озвучку нельзя использовать в монетизируемых роликах (нет коммерческих прав, нужна атрибуция). Для канала с монетизацией — платный план от Starter.",
      );
      if (!process.env.ELEVENLABS_VOICE_ID) {
        warnOnce("elevenlabs-voice", "[озвучка] ElevenLabs: ELEVENLABS_VOICE_ID не задан — голос по умолчанию (George) говорит по-русски с акцентом; выберите русский голос в Voice Library.");
      }
      const body: Record<string, unknown> = {
        text,
        model_id: model,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true,
          speed: Math.min(1.2, Math.max(0.7, ctx.rate)),
        },
      };
      // У multilingual_v2 параметра language_code нет — API отвечает ошибкой.
      if (!/multilingual_v2/.test(model)) body.language_code = "ru";
      const url = `${BASE}/v1/text-to-speech/${encodeURIComponent(ctx.voice)}/with-timestamps?output_format=${encodeURIComponent(format)}`;
      const r = await httpRequest("ElevenLabs", url, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }, { timeoutMs, signal: ctx.signal });
      const j = JSON.parse(r.body.toString("utf8")) as { audio_base64?: string; alignment?: Alignment | null; normalized_alignment?: Alignment | null };
      if (!j.audio_base64) throw new TtsError("ElevenLabs: в ответе нет аудио.", { retryable: true });
      const bytes = Buffer.from(j.audio_base64, "base64");
      // alignment — по исходному тексту (normalized_alignment — после раскрытия чисел).
      const al = j.alignment ?? j.normalized_alignment ?? null;
      const words = al?.characters?.length ? charsToWords(al) : null;
      if (format.startsWith("pcm_")) {
        const rate = Number(format.split("_")[1]) || 24000;
        return { kind: "pcm", audio: decodePcm16(bytes, rate), words };
      }
      return { kind: "mp3", bytes, words };
    },
  };
}
