// Общая обвязка над «сырыми» провайдерами: нормализация текста, кэш,
// повтор при сбое, запись файла, постобработка WAV (обрезка тишины,
// выравнивание громкости), длительность и тайминги слов. Провайдеру остаётся
// только получить звук — поэтому все шесть ведут себя одинаково.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordTiming } from "../../types";
import type { VoiceOptions, VoiceProvider, VoiceResult } from "../contracts";
import { applyFades, normalizeLoudness, removeDc } from "../audio/dsp";
import { encodeWav16, toMono, type PcmAudio } from "../audio/wav";
import { audioFileDurationMs } from "./duration";
import { TtsError, sleep } from "./http";
import { normalizeText, rateMultiplier } from "./text";
import { alignToTokens, analyzeSpeech, estimateWordTimings, estimateWordsUniform, finalize } from "./timing";

export type RawAudio =
  | { kind: "pcm"; audio: PcmAudio; words?: WordTiming[] | null }
  | { kind: "mp3"; bytes: Uint8Array; words?: WordTiming[] | null };

export interface RawContext {
  voice: string;
  rate: number; // множитель скорости из TTS_RATE (1 = как есть)
  signal?: AbortSignal;
}

export interface RawProvider {
  readonly name: string;
  readonly output: "mp3" | "wav"; // обычный формат ответа (фактический определяется по байтам)
  resolveVoice(requested: string | undefined): string;
  configKey(): string; // всё, что влияет на звук, кроме текста и голоса (модель, стиль, темп)
  synthesizeRaw(text: string, ctx: RawContext): Promise<RawAudio>;
  maxAttempts?: number; // по умолчанию 2 (один повтор)
}

// Громкость голоса после обработки — одинаковая для всех провайдеров с WAV.
export const VOICE_TARGET_RMS_DB = -18;
export const VOICE_CEILING_DB = -1.5; // по сэмплам; с запасом на межсэмпловые пики (true peak ≤ −1 dBFS)

const KEEP_LEAD_MS = 60;
const KEEP_TAIL_MS = 180;

interface CacheEntry {
  key: string;
  file: string; // имя файла рядом с json
  durationMs: number;
  words: WordTiming[];
  wordsSource: "provider" | "estimated";
}

export function wrapProvider(raw: RawProvider): VoiceProvider {
  return {
    name: raw.name,
    async synthesize(text: string, outFileBase: string, opts: VoiceOptions = {}): Promise<VoiceResult> {
      const clean = normalizeText(text);
      const voice = raw.resolveVoice(opts.voice ?? defaultVoiceFromEnv());
      await mkdir(path.dirname(outFileBase), { recursive: true });

      if (!clean) {
        // Пустая реплика: полсекунды тишины, чтобы сцена всё равно имела звук и длину.
        const file = outFileBase + ".wav";
        await writeFile(file, encodeWav16({ sampleRate: 24000, channels: [new Float32Array(12000)] }));
        return { file, durationMs: 500, words: [], wordsSource: "estimated" };
      }

      const key = `${raw.name}|${voice}|${raw.configKey()}|${clean}`;
      const cached = await readCache(outFileBase, key);
      if (cached) return cached;

      const ctx: RawContext = { voice, rate: rateMultiplier(process.env.TTS_RATE), signal: opts.signal };
      const result = await withRetry(raw, () => raw.synthesizeRaw(clean, ctx), opts.signal);

      let file: string;
      let durationMs: number;
      let words: WordTiming[] | null = null;
      let wordsSource: VoiceResult["wordsSource"] = "provider";
      if (result.kind === "pcm") {
        const { audio, shiftMs } = postprocessVoice(result.audio);
        file = outFileBase + ".wav";
        await writeFile(file, encodeWav16(audio));
        durationMs = (audio.channels[0]!.length / audio.sampleRate) * 1000;
        if (result.words?.length) {
          const shifted = result.words.map((w) => ({ text: w.text, startMs: w.startMs - shiftMs, endMs: w.endMs - shiftMs }));
          words = alignToTokens(shifted, clean) ?? shifted;
        } else {
          words = estimateWordTimings(clean, analyzeSpeech(audio.channels[0]!, audio.sampleRate));
          wordsSource = "estimated";
        }
      } else {
        // Расширение — по фактическому формату: OpenAI-совместимый сервер мог вернуть MP3 вместо WAV.
        file = outFileBase + ".mp3";
        await writeFile(file, result.bytes);
        durationMs = await audioFileDurationMs(file);
        if (result.words?.length) words = alignToTokens(result.words, clean) ?? result.words;
        else {
          // MP3 без таймингов не декодируем (нет ffmpeg) — ровная оценка по тексту.
          words = estimateWordsUniform(clean, durationMs);
          wordsSource = "estimated";
        }
      }
      words = finalize(words, durationMs);
      if (!words.length) {
        words = estimateWordsUniform(clean, durationMs);
        wordsSource = "estimated";
      }
      durationMs = Math.round(Math.max(durationMs, words.at(-1)?.endMs ?? 0));
      const out: VoiceResult = { file, durationMs, words, wordsSource };
      await writeCache(outFileBase, key, out);
      return out;
    },
  };
}

function defaultVoiceFromEnv(): string | undefined {
  return process.env.TTS_VOICE?.trim() || undefined;
}

async function withRetry(raw: RawProvider, fn: () => Promise<RawAudio>, signal?: AbortSignal): Promise<RawAudio> {
  const attempts = raw.maxAttempts ?? 2;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e instanceof TtsError ? e.retryable : false;
      if (!retryable || i === attempts || signal?.aborted) break;
      console.warn(`[озвучка] ${raw.name}: ${(e as Error).message} Повторяю (попытка ${i + 1} из ${attempts})…`);
      await sleep(1500 * i, signal);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// Обрезка лишней тишины по краям, удаление DC и выравнивание громкости.
// Возвращает сдвиг начала (мс), чтобы поправить тайминги провайдера.
export function postprocessVoice(input: PcmAudio): { audio: PcmAudio; shiftMs: number } {
  const sr = input.sampleRate;
  const mono = Float32Array.from(toMono(input));
  removeDc(mono, sr);
  const prof = analyzeSpeech(mono, sr);
  let from = 0;
  let to = mono.length;
  if (prof.hasSpeech) {
    from = Math.max(0, Math.floor(((prof.speechStartMs - KEEP_LEAD_MS) / 1000) * sr));
    to = Math.min(mono.length, Math.ceil(((prof.speechEndMs + KEEP_TAIL_MS) / 1000) * sr));
    if (to - from < sr * 0.1) {
      from = 0;
      to = mono.length;
    }
  }
  const ch = mono.slice(from, to);
  normalizeLoudness([ch], sr, { targetRmsDb: VOICE_TARGET_RMS_DB, ceilingDb: VOICE_CEILING_DB, maxGainDb: 30 });
  // Короткие фейды на срезах — без щелчков.
  applyFades(ch, sr, 8, 25);
  return { audio: { sampleRate: sr, channels: [ch] }, shiftMs: (from / sr) * 1000 };
}

const cacheKey = (key: string) => createHash("sha256").update(key).digest("hex");

function cachePath(outFileBase: string) {
  return outFileBase + ".voice.json";
}

async function readCache(outFileBase: string, key: string): Promise<VoiceResult | null> {
  if (process.env.TTS_CACHE === "0") return null;
  const p = cachePath(outFileBase);
  if (!existsSync(p)) return null;
  try {
    const c = JSON.parse(await readFile(p, "utf8")) as CacheEntry;
    const file = path.join(path.dirname(outFileBase), c.file);
    if (c.key !== cacheKey(key) || !existsSync(file)) return null;
    return { file, durationMs: c.durationMs, words: c.words, wordsSource: c.wordsSource };
  } catch {
    return null;
  }
}

async function writeCache(outFileBase: string, key: string, r: VoiceResult): Promise<void> {
  if (process.env.TTS_CACHE === "0") return;
  const entry: CacheEntry = {
    key: cacheKey(key),
    file: path.basename(r.file),
    durationMs: r.durationMs,
    words: r.words,
    wordsSource: r.wordsSource,
  };
  await writeFile(cachePath(outFileBase), JSON.stringify(entry, null, 1));
}
