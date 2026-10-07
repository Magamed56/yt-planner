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
import { findSplitPoints, splitAudio } from "./split";
import { normalizeText, rateMultiplier } from "./text";
import { alignToTokens, analyzeSpeech, estimateWordTimings, estimateWordsUniform, finalize } from "./timing";

// fallback — звук дала запасная модель (у Gemini — после 429/404 основной):
// такой результат в кэше не переиспользуем, чтобы при следующей сборке сцены
// переозвучились основной моделью и в ролике остался один голос.
export type RawAudio =
  | { kind: "pcm"; audio: PcmAudio; words?: WordTiming[] | null; fallback?: string }
  | { kind: "mp3"; bytes: Uint8Array; words?: WordTiming[] | null; fallback?: string };

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
  // > 0: несколько сцен (до стольки символов) озвучиваются ОДНИМ запросом и
  // режутся по паузам (split.ts). Для провайдеров, у которых квота считает
  // запросы (Gemini ≈ 10 в сутки на модель), а не символы.
  batchMaxChars?: number;
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
  fallback?: string; // см. RawAudio.fallback
}

export function wrapProvider(raw: RawProvider): VoiceProvider {
  const keyOf = (voice: string, clean: string) => `${raw.name}|${voice}|${raw.configKey()}|${clean}`;

  async function synthesize(text: string, outFileBase: string, opts: VoiceOptions = {}): Promise<VoiceResult> {
    const clean = normalizeText(text);
    const voice = raw.resolveVoice(opts.voice ?? defaultVoiceFromEnv());
    await mkdir(path.dirname(outFileBase), { recursive: true });
    if (!clean) return writeSilence(outFileBase);

    const key = keyOf(voice, clean);
    const cached = await readCache(outFileBase, key);
    if (cached) return cached;

    const ctx: RawContext = { voice, rate: rateMultiplier(process.env.TTS_RATE), signal: opts.signal };
    const result = await withRetry(raw, () => raw.synthesizeRaw(clean, ctx), opts.signal);
    return finish(result, clean, outFileBase, key);
  }

  async function synthesizeMany(items: { text: string; outFileBase: string }[], opts: VoiceOptions = {}): Promise<VoiceResult[]> {
    const voice = raw.resolveVoice(opts.voice ?? defaultVoiceFromEnv());
    const maxChars = raw.batchMaxChars ?? 0;
    const prepared = items.map((it) => ({ ...it, clean: normalizeText(it.text) }));
    const out: (VoiceResult | null)[] = [];
    for (const p of prepared) {
      await mkdir(path.dirname(p.outFileBase), { recursive: true });
      out.push(!p.clean ? await writeSilence(p.outFileBase) : await readCache(p.outFileBase, keyOf(voice, p.clean)));
    }

    // Подряд идущие неозвученные сцены — в группы не длиннее maxChars.
    const groups: number[][] = [];
    for (let i = 0; i < prepared.length; i++) {
      if (out[i]) continue;
      const last = groups.at(-1);
      const len = last ? last.reduce((a, j) => a + prepared[j]!.clean.length + 2, 0) : Infinity;
      if (last && last.at(-1) === i - 1 && len + prepared[i]!.clean.length <= maxChars) last.push(i);
      else groups.push([i]);
    }

    for (const g of groups) {
      if (g.length === 1) {
        out[g[0]!] = await synthesize(items[g[0]!]!.text, items[g[0]!]!.outFileBase, opts);
        continue;
      }
      const texts = g.map((i) => prepared[i]!.clean);
      // Абзацы — подсказка модели сделать паузу между сценами.
      const ctx: RawContext = { voice, rate: rateMultiplier(process.env.TTS_RATE), signal: opts.signal };
      const result = await withRetry(raw, () => raw.synthesizeRaw(texts.join("\n\n"), ctx), opts.signal);
      const cuts = result.kind === "pcm" ? findSplitPoints(result.audio, texts) : null;
      if (result.kind !== "pcm" || !cuts) {
        console.warn(`[озвучка] ${raw.name}: не удалось разрезать общий звук сцен ${g.map((i) => i + 1).join(", ")} по паузам — озвучиваю их по одной.`);
        for (const i of g) out[i] = await synthesize(items[i]!.text, items[i]!.outFileBase, opts);
        continue;
      }
      const parts = splitAudio(result.audio, cuts);
      for (const [k, i] of g.entries()) {
        const p = prepared[i]!;
        out[i] = await finish({ kind: "pcm", audio: parts[k]!, fallback: result.fallback }, p.clean, p.outFileBase, keyOf(voice, p.clean));
      }
    }
    return out as VoiceResult[];
  }

  async function finish(result: RawAudio, clean: string, outFileBase: string, key: string): Promise<VoiceResult> {
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
      await writeCache(outFileBase, key, out, result.fallback);
      return out;
  }

  return raw.batchMaxChars ? { name: raw.name, synthesize, synthesizeMany } : { name: raw.name, synthesize };
}

// Пустая реплика: полсекунды тишины, чтобы сцена всё равно имела звук и длину.
async function writeSilence(outFileBase: string): Promise<VoiceResult> {
  const file = outFileBase + ".wav";
  await writeFile(file, encodeWav16({ sampleRate: 24000, channels: [new Float32Array(12000)] }));
  return { file, durationMs: 500, words: [], wordsSource: "estimated" };
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
    if (c.key !== cacheKey(key) || !existsSync(file) || c.fallback) return null;
    return { file, durationMs: c.durationMs, words: c.words, wordsSource: c.wordsSource };
  } catch {
    return null;
  }
}

async function writeCache(outFileBase: string, key: string, r: VoiceResult, fallback?: string): Promise<void> {
  if (process.env.TTS_CACHE === "0") return;
  const entry: CacheEntry = {
    key: cacheKey(key),
    file: path.basename(r.file),
    durationMs: r.durationMs,
    words: r.words,
    wordsSource: r.wordsSource,
    ...(fallback ? { fallback } : {}),
  };
  await writeFile(cachePath(outFileBase), JSON.stringify(entry, null, 1));
}
