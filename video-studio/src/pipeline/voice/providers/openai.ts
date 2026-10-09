// Любой OpenAI-совместимый сервер речи: POST {base}/audio/speech.
// Локально бесплатно: vLLM-Omni + Qwen3-TTS (порт 8091, умеет русский и
// клонирование голоса), Chatterbox Multilingual (devnen :8004, travisvn :4123).
// Через этот же путь позже подключается клон голоса пользователя.

import { decodeWav, isMp3, isWav } from "../../audio/wav";
import type { WordTiming } from "../../../types";
import { envInt, httpRequest, TtsError } from "../http";
import type { RawAudio, RawProvider } from "../provider";

export const OPENAI_TTS_DEFAULT_BASE = "http://localhost:8091/v1";

// "http://host:8091" → "http://host:8091/v1"; путь уже указан — не трогаем.
export function openAiBase(raw: string | undefined): string {
  const s = (raw?.trim() || OPENAI_TTS_DEFAULT_BASE).replace(/\/+$/, "");
  try {
    const u = new URL(s);
    if (u.pathname === "" || u.pathname === "/") return `${s}/v1`;
  } catch {
    throw new TtsError(`OpenAI-совместимый TTS: OPENAI_TTS_BASE_URL="${raw}" — не URL (пример: ${OPENAI_TTS_DEFAULT_BASE}).`);
  }
  return s;
}

// vLLM-Omni c --forced-aligner: заголовок X-Word-Timestamps = JSON [{word,start_ms,end_ms}].
export function parseWordTimestampsHeader(h: string | null): WordTiming[] | null {
  if (!h) return null;
  try {
    const arr = JSON.parse(h) as { word?: string; text?: string; start_ms?: number; end_ms?: number; start?: number; end?: number }[];
    if (!Array.isArray(arr)) return null;
    const out: WordTiming[] = [];
    for (const w of arr) {
      const text = w.word ?? w.text;
      const start = w.start_ms ?? (typeof w.start === "number" ? w.start * 1000 : undefined);
      const end = w.end_ms ?? (typeof w.end === "number" ? w.end * 1000 : undefined);
      if (text && typeof start === "number" && typeof end === "number") out.push({ text, startMs: start, endMs: end });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function openAiProvider(): RawProvider {
  const base = openAiBase(process.env.OPENAI_TTS_BASE_URL);
  const model = process.env.OPENAI_TTS_MODEL?.trim();
  const apiKey = process.env.OPENAI_TTS_API_KEY?.trim();
  const language = process.env.OPENAI_TTS_LANGUAGE?.trim(); // vLLM-Omni/Qwen3: "Russian"
  const instructions = process.env.OPENAI_TTS_INSTRUCTIONS?.trim();
  const wantTimestamps = process.env.OPENAI_TTS_WORD_TIMESTAMPS === "1";
  const timeoutMs = envInt("TTS_TIMEOUT_MS", 180_000); // локальная GPU/CPU-модель может думать долго
  return {
    name: "openai",
    output: "wav",
    // Имена голосов Edge/Piper из общего TTS_VOICE этому серверу не подходят.
    resolveVoice: (v) => process.env.OPENAI_TTS_VOICE?.trim() || (v && !/Neural$|^ru_RU-/.test(v) ? v : "vivian"),
    configKey: () => `openai:${base}:${model ?? ""}:${language ?? ""}:${instructions ?? ""}:${process.env.TTS_RATE ?? ""}`,
    async synthesizeRaw(text, ctx): Promise<RawAudio> {
      // Лишних полей не шлём: настоящий api.openai.com отвечает 400 на незнакомые параметры.
      const body: Record<string, unknown> = { input: text, voice: ctx.voice, response_format: "wav" };
      if (model) body.model = model;
      if (ctx.rate !== 1) body.speed = ctx.rate;
      if (language) body.language = language;
      if (instructions) body.instructions = instructions;
      if (wantTimestamps) body.word_timestamps = true;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const r = await httpRequest("OpenAI-совместимый TTS", `${base}/audio/speech`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, { timeoutMs, signal: ctx.signal });
      const words = parseWordTimestampsHeader(r.headers.get("x-word-timestamps"));
      if (wantTimestamps && !words && r.headers.get("x-word-timestamps-omitted")) {
        console.warn("[озвучка] Сервер не прислал тайминги слов (слишком длинная сцена) — оцениваю по звуку.");
      }
      // Часть серверов игнорирует response_format и всё равно отдаёт MP3.
      if (isWav(r.body)) return { kind: "pcm", audio: decodeWav(r.body), words };
      if (isMp3(r.body)) return { kind: "mp3", bytes: r.body, words };
      throw new TtsError(`OpenAI-совместимый TTS: неизвестный формат ответа (${r.headers.get("content-type") ?? "?"}, ${r.body.length} байт). Нужен WAV или MP3.`);
    },
  };
}
