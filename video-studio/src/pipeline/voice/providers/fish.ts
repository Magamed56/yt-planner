// Fish Speech (локальный сервер tools/api_server.py, POST /v1/tts). Хорошо
// клонирует голос по образцу (reference_id), но веса S2 — под исследовательской
// некоммерческой лицензией.

import { decodeWav, isMp3, isWav } from "../../audio/wav";
import { envInt, httpRequest, TtsError, warnOnce } from "../http";
import type { RawAudio, RawProvider } from "../provider";

export const FISH_DEFAULT_BASE = "http://127.0.0.1:8080";

export function fishProvider(): RawProvider {
  const base = (process.env.FISH_TTS_BASE_URL?.trim() || FISH_DEFAULT_BASE).replace(/\/+$/, "").replace(/\/v1$/, "");
  const timeoutMs = envInt("TTS_TIMEOUT_MS", 180_000);
  return {
    name: "fish",
    output: "wav",
    // У Fish «голос» — это id загруженного образца (reference_id).
    resolveVoice: (v) => process.env.FISH_TTS_REFERENCE_ID?.trim() || (v && !/Neural$|^ru_RU-/.test(v) ? v : ""),
    configKey: () => `fish:${base}`,
    async synthesizeRaw(text, ctx): Promise<RawAudio> {
      warnOnce(
        "fish-license",
        "[озвучка] Fish Speech: веса S2 распространяются по Fish Audio Research License — только некоммерческое использование (для монетизации нужна отдельная лицензия) и атрибуция «Built with Fish Audio».",
      );
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.FISH_TTS_API_KEY) headers.Authorization = `Bearer ${process.env.FISH_TTS_API_KEY}`;
      const r = await httpRequest("Fish Speech", `${base}/v1/tts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          format: "wav",
          chunk_length: 200,
          normalize: false, // нормализация текста у Fish — только для en/zh
          reference_id: ctx.voice || null,
          references: [],
          streaming: false,
          use_memory_cache: "on",
          temperature: 0.8,
          top_p: 0.8,
          repetition_penalty: 1.1,
          max_new_tokens: 1024,
        }),
      }, { timeoutMs, signal: ctx.signal });
      if (isWav(r.body)) return { kind: "pcm", audio: decodeWav(r.body) };
      if (isMp3(r.body)) return { kind: "mp3", bytes: r.body };
      throw new TtsError(`Fish Speech: неизвестный формат ответа (${r.headers.get("content-type") ?? "?"}).`);
    },
  };
}
