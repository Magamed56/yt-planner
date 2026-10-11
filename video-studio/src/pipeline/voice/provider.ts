// Общая обвязка над «сырыми» провайдерами: нормализация текста, кэш,
// повтор при сбое, запись файла, постобработка WAV (обрезка тишины,
// выравнивание громкости), длительность и тайминги слов. Провайдеру остаётся
// только получить звук — поэтому все шесть ведут себя одинаково.
// Тайминги без провайдера (Piper, Gemini…) — по распознанной речи (align.ts),
// а если распознавание недоступно — оценка по звуку (timing.ts).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordTiming } from "../../types";
import type { VoiceOptions, VoiceProvider, VoiceResult } from "../contracts";
import { applyFades, normalizeLoudness, removeDc } from "../audio/dsp";
import { decodeWav, encodeWav16, toMono, type PcmAudio } from "../audio/wav";
import { alignByAsr, alignedSplitPoints, alignEnabled } from "./align";
import { audioFileDurationMs } from "./duration";
import { TtsError, sleep } from "./http";
import { pruneSharedOnce, readShared, sharedCacheDir, writeShared } from "./shared-cache";
import { findSplitPoints, splitAudio } from "./split";
import { normalizeText, rateMultiplier } from "./text";
import { alignToTokens, analyzeSpeech, estimateWordTimings, estimateWordsUniform, finalize } from "./timing";

// fallback — звук дала запасная модель (у Gemini — после 429/404 основной):
// такой результат в кэше не переиспользуем, чтобы при следующей сборке сцены
// переозвучились основной моделью и в ролике остался один голос.
// aligned — слова, уже выровненные по распознанной речи (мс от начала audio):
// нарезка общего звука или общий кэш; тогда распознавать сцену заново не нужно.
// keyIndex — каким по счёту ключом озвучено (Gemini с GEMINI_API_KEY_2): только номер,
// в кэш не пишется — голос у ключей один.
export type RawAudio =
  | { kind: "pcm"; audio: PcmAudio; words?: WordTiming[] | null; fallback?: string; aligned?: WordTiming[] | null; keyIndex?: number }
  | { kind: "mp3"; bytes: Uint8Array; words?: WordTiming[] | null; fallback?: string; keyIndex?: number };

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

// Тишина, которую оставляем по краям речи. Хвост — затухание последнего звука
// (порог речи и так на 30 дБ ниже громкой); всё сверх него — пауза на каждой
// склейке (её добавляет layoutScenes). Кэш не сбрасываем: старые файлы с
// хвостом 180 мс лишь чуть длиннее, а переозвучка тратит квоту.
export const KEEP_LEAD_MS = 60;
export const KEEP_TAIL_MS = 120;

interface CacheEntry {
  key: string;
  file: string; // имя файла рядом с json
  durationMs: number;
  words: WordTiming[];
  wordsSource: VoiceResult["wordsSource"];
  fallback?: string; // см. RawAudio.fallback
  alignTried?: boolean; // выравнивание по речи пробовали и не вышло — при чтении не повторяем
}

export function wrapProvider(raw: RawProvider): VoiceProvider {
  const keyOf = (voice: string, clean: string) => `${raw.name}|${voice}|${raw.configKey()}|${clean}`;

  async function synthesize(text: string, outFileBase: string, opts: VoiceOptions = {}): Promise<VoiceResult> {
    const clean = normalizeText(text);
    const voice = raw.resolveVoice(opts.voice ?? defaultVoiceFromEnv());
    await mkdir(path.dirname(outFileBase), { recursive: true });
    if (!clean) return writeSilence(outFileBase);

    const key = keyOf(voice, clean);
    const cached = await fromCaches(clean, outFileBase, key, voice);
    if (cached) return cached;

    const ctx: RawContext = { voice, rate: rateMultiplier(process.env.TTS_RATE), signal: opts.signal };
    const result = await withRetry(raw, () => raw.synthesizeRaw(clean, ctx), opts.signal);
    return finish(result, clean, outFileBase, key, voice);
  }

  // Сначала кэш в папке ролика (готовый файл), затем общий (shared-cache.ts): из сырого
  // звука сцена собирается заново той же постобработкой, без запроса к сервису.
  async function fromCaches(clean: string, outFileBase: string, key: string, voice: string): Promise<VoiceResult | null> {
    const local = await readCache(outFileBase, key, clean);
    if (local) return { ...local, voice, cached: true };
    // TTS_CACHE=0 — нужен новый дубль: общий кэш не читаем (запишет его finish).
    const dir = process.env.TTS_CACHE === "0" ? null : sharedCacheDir();
    if (!dir) return null;
    await pruneSharedOnce(dir);
    const hit = await readShared(dir, key);
    if (!hit) return null;
    try {
      return { ...(await finish(hit, clean, outFileBase, key, voice, false)), cached: true };
    } catch {
      return null; // запись не разобралась — озвучим заново
    }
  }

  async function synthesizeMany(items: { text: string; outFileBase: string }[], opts: VoiceOptions = {}): Promise<VoiceResult[]> {
    const voice = raw.resolveVoice(opts.voice ?? defaultVoiceFromEnv());
    const maxChars = raw.batchMaxChars ?? 0;
    const prepared = items.map((it) => ({ ...it, clean: normalizeText(it.text) }));
    const out: (VoiceResult | null)[] = [];
    for (const p of prepared) {
      await mkdir(path.dirname(p.outFileBase), { recursive: true });
      out.push(!p.clean ? await writeSilence(p.outFileBase) : await fromCaches(p.clean, p.outFileBase, keyOf(voice, p.clean), voice));
    }

    // Неозвученные сцены по порядку — в группы не длиннее maxChars, соседство не нужно:
    // правка нескольких сцен вразбивку (остальные — из кэша) — один запрос, а не по
    // запросу на сцену (квота Gemini — ≈ 10 в сутки, без кэша весь ролик и так один запрос).
    const groups: number[][] = [];
    for (let i = 0; i < prepared.length; i++) {
      if (out[i]) continue;
      const last = groups.at(-1);
      const len = last ? last.reduce((a, j) => a + prepared[j]!.clean.length + 2, 0) : Infinity;
      if (last && len + prepared[i]!.clean.length <= maxChars) last.push(i);
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
      const sceneNames = g.map((i) => i + 1);
      const cuts = result.kind === "pcm" ? await splitPoints(result.audio, texts, sceneNames) : null;
      if (result.kind !== "pcm" || !cuts) {
        console.warn(`[озвучка] ${raw.name}: не удалось разрезать общий звук сцен ${g.map((i) => i + 1).join(", ")} по паузам — озвучиваю их по одной.`);
        for (const i of g) out[i] = await synthesize(items[i]!.text, items[i]!.outFileBase, opts);
        continue;
      }
      const parts = splitAudio(result.audio, cuts.cuts);
      for (const [k, i] of g.entries()) {
        const p = prepared[i]!;
        out[i] = await finish({ kind: "pcm", audio: parts[k]!, fallback: result.fallback, aligned: cuts.words?.[k] ?? null, keyIndex: result.keyIndex }, p.clean, p.outFileBase, keyOf(voice, p.clean), voice);
      }
    }
    return out as VoiceResult[];
  }

  // Границы сцен в общем звуке: по распознанным словам (точно), иначе по паузам
  // (split.ts). words — слова сцен от начала их кусков, если выравнивание удалось.
  async function splitPoints(audio: PcmAudio, texts: string[], scenes: number[]): Promise<{ cuts: number[]; words?: WordTiming[][] } | null> {
    const byPauses = findSplitPoints(audio, texts);
    const byAsr = await alignedSplitPoints(toMono(audio), audio.sampleRate, texts);
    if (!byAsr) return byPauses ? { cuts: byPauses } : null;
    const moved = byAsr.cuts
      .map((c, k) => ({ k, d: byPauses ? (c - byPauses[k]!) / 1000 : NaN }))
      .filter((x) => !byPauses || Math.abs(x.d) >= 0.3);
    if (byPauses && moved.length) {
      console.log(`[озвучка] ${raw.name}: границы сцен поправлены по распознанной речи — ${moved.map((x) => `${scenes[x.k]}|${scenes[x.k + 1]} на ${x.d > 0 ? "+" : ""}${x.d.toFixed(1)} с`).join(", ")}.`);
    }
    return { cuts: byAsr.cuts, words: byAsr.words };
  }

  // store = false — звук уже из общего кэша, класть его туда снова незачем (кроме
  // случая, когда запись старая и тайминги по речи посчитаны только сейчас).
  async function finish(result: RawAudio, clean: string, outFileBase: string, key: string, voice: string, store = true): Promise<VoiceResult> {
      let file: string;
      let durationMs: number;
      let words: WordTiming[] | null = null;
      let wordsSource: VoiceResult["wordsSource"] = "provider";
      let alignTried = false;
      let alignedRaw: WordTiming[] | null = null; // для общего кэша: мс от начала сырого звука
      if (result.kind === "pcm") {
        const { audio, shiftMs } = postprocessVoice(result.audio);
        file = outFileBase + ".wav";
        await writeFile(file, encodeWav16(audio));
        durationMs = (audio.channels[0]!.length / audio.sampleRate) * 1000;
        if (result.words?.length) {
          const shifted = result.words.map((w) => ({ text: w.text, startMs: w.startMs - shiftMs, endMs: w.endMs - shiftMs }));
          words = alignToTokens(shifted, clean) ?? shifted;
        } else if (result.aligned?.length) {
          words = result.aligned.map((w) => ({ text: w.text, startMs: w.startMs - shiftMs, endMs: w.endMs - shiftMs }));
          wordsSource = "aligned";
          alignedRaw = result.aligned;
        } else {
          const aligned = await alignByAsr(clean, audio.channels[0]!, audio.sampleRate, durationMs, path.basename(outFileBase));
          alignTried = aligned === "mismatch";
          if (aligned && aligned !== "mismatch") {
            words = aligned.words;
            wordsSource = "aligned";
            alignedRaw = words.map((w) => ({ text: w.text, startMs: w.startMs + shiftMs, endMs: w.endMs + shiftMs }));
          } else {
            words = estimateWordTimings(clean, analyzeSpeech(audio.channels[0]!, audio.sampleRate));
            wordsSource = "estimated";
          }
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
      await writeCache(outFileBase, key, out, result.fallback, alignTried);
      // Старая запись общего кэша без таймингов по речи — дописываем их, чтобы
      // следующая сборка не распознавала сцену заново.
      const refresh = !store && alignedRaw && !(result.kind === "pcm" && result.aligned?.length);
      const shared = (store || refresh) && !result.fallback ? sharedCacheDir() : null;
      if (shared) await writeShared(shared, key, result.kind === "pcm" ? { ...result, aligned: alignedRaw } : result, { provider: raw.name, voice, chars: clean.length });
      return { ...out, voice, ...(result.fallback ? { fallbackModel: result.fallback } : {}), ...(result.keyIndex ? { keyIndex: result.keyIndex } : {}) };
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
      // Суточная квота до завтра не вернётся — повтор только шумит в логе.
      const retryable = e instanceof TtsError ? e.retryable && !/PerDay/i.test(e.quotaId ?? "") : false;
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

async function readCache(outFileBase: string, key: string, clean: string): Promise<VoiceResult | null> {
  if (process.env.TTS_CACHE === "0") return null;
  const p = cachePath(outFileBase);
  if (!existsSync(p)) return null;
  let c: CacheEntry;
  let file: string;
  try {
    c = JSON.parse(await readFile(p, "utf8")) as CacheEntry;
    file = path.join(path.dirname(outFileBase), c.file);
    if (c.key !== cacheKey(key) || !existsSync(file) || c.fallback) return null;
  } catch {
    return null;
  }
  const r: VoiceResult = { file, durationMs: c.durationMs, words: c.words, wordsSource: c.wordsSource };
  // Запись до выравнивания по речи (оценка по звуку) — доуточняем один раз: звук
  // уже на диске, распознать сцену — доли секунды, а квоту озвучки это не тратит.
  if (c.wordsSource !== "estimated" || c.alignTried || !file.endsWith(".wav") || !alignEnabled()) return r;
  try {
    const audio = decodeWav(await readFile(file));
    const aligned = await alignByAsr(clean, toMono(audio), audio.sampleRate, c.durationMs, path.basename(outFileBase));
    // Модель недоступна — запись не трогаем: попробуем при следующей сборке.
    if (!aligned) return r;
    const next: VoiceResult = aligned === "mismatch" ? r : { ...r, words: finalize(aligned.words, c.durationMs), wordsSource: "aligned" };
    await writeCache(outFileBase, key, next, undefined, aligned === "mismatch");
    return next;
  } catch {
    return r; // не вышло — прежние тайминги, сборка идёт дальше
  }
}

async function writeCache(outFileBase: string, key: string, r: VoiceResult, fallback?: string, alignTried = false): Promise<void> {
  if (process.env.TTS_CACHE === "0") return;
  const entry: CacheEntry = {
    key: cacheKey(key),
    file: path.basename(r.file),
    durationMs: r.durationMs,
    words: r.words,
    wordsSource: r.wordsSource,
    ...(fallback ? { fallback } : {}),
    ...(alignTried ? { alignTried } : {}),
  };
  await writeFile(cachePath(outFileBase), JSON.stringify(entry, null, 1));
}
