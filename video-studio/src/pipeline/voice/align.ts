// Тайминги слов по реальной речи: принудительное выравнивание известного текста
// по звуку через офлайн-распознавание (sherpa-onnx + русская GigaAM CTC).
//
// Зачем: у Gemini/Piper таймингов нет, а оценка по энергии звука (timing.ts)
// местами ошибалась на секунды целыми сценами — подсветка слов шла раньше
// голоса. Распознаватель отдаёт время каждой буквы; слова распознанного
// текста сопоставляются со словами сценария динамическим программированием
// (с заменами, пропусками и склейкой/расклейкой слов — имена и числа он
// пишет по-своему), найденные слова получают время речи, остальные —
// интерполяцию между соседями. Совпало меньше MIN_MATCH слов, нет модели или
// распознавание упало — вызывающий код оставляет прежнюю оценку.
//
// Модель ≈ 170 МБ (архив; распакованная int8 — 240 МБ) скачивается один раз в
// MODELS_DIR, как голоса Piper. Выключить: CAPTION_ALIGN=0. Лицензия — GigaAM v2,
// MIT (файл LICENSE в архиве); выгрузка 2024-10-24 (v1) была некоммерческой.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { WordTiming } from "../../types";
import { envPath } from "../audio/paths";
import { warnOnce } from "./http";
import { downloadTarModel, tarModelReady, type TarModel } from "./model-download";
import { normWord, tokenize, type Token } from "./text";
import { analyzeSpeech, finalize, type SpeechProfile } from "./timing";

export const ASR_MODEL_NAME = "sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19";
const ASR_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ASR_MODEL_NAME}.tar.bz2`;
export const MIN_MATCH = 0.6; // доля слов сценария, найденных в речи, ниже — не верим выравниванию

// Слово, распознанное в речи: нормализованный текст и время (мс от начала звука).
export interface AsrWord {
  text: string;
  startMs: number; // время первой буквы
  endMs: number; // время последней буквы + кадр модели
}

export interface AlignResult {
  words: WordTiming[];
  matched: number; // сколько слов сценария нашлось в речи
  total: number;
  found: boolean[]; // по словам: нашлось в речи (иначе время интерполировано)
  rawEndMs: (number | null)[]; // конец найденного слова по распознаванию, без поправок по звуку
}

// ---- включено ли ----

// Только русская речь (модель русская) и не выключено переменной.
export function alignEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (/^(0|false|no|off|none)$/i.test(env.CAPTION_ALIGN?.trim() ?? "")) return false;
  const lang = (env.TTS_LANGUAGE ?? "").trim().toLowerCase();
  return !lang || lang === "ru";
}

// ---- сопоставление слов (чистая функция, без модели) ----

// Расстояние Левенштейна: сколько букв поправить, чтобы из a получилось b.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

const simOf = (dist: number, a: string, b: string) => (a === b ? 1 : !a.length || !b.length ? 0 : 1 - dist / Math.max(a.length, b.length));

// Похожесть слов 0…1 по расстоянию Левенштейна: «Сатурна» ~ «сатурна» = 1,
// «гелия» ~ «гелея» = 0.8; имена распознаватель пишет «как слышит».
export function wordSimilarity(a: string, b: string): number {
  return simOf(editDistance(a, b), a, b);
}

const FOUND_SIM = 0.5; // слово «нашлось», если похоже хотя бы наполовину
const GAP = 1; // цена пропуска слова с любой стороны
const JOIN = 0.25; // доплата за склейку «во что» ↔ «вочто»

// Распознаватель не различает ё/е и пишет буквы без дефисов — сравниваем так же.
const asrNorm = (w: string) => normWord(w).replace(/ё/g, "е");

// Каждому слову сценария — индексы распознанных слов (или null, если не нашлось).
// Ходы ДП: пропуск слова сценария, пропуск распознанного, 1↔1, 2↔1 и 1↔2.
export function matchWords(script: string[], asr: string[]): ({ from: number; to: number } | null)[] {
  const n = script.length;
  const m = asr.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  const how = new Uint8Array((n + 1) * W);
  D[0] = 0;
  // Правки слово ↔ слово: нужны и для 1↔1, и для проверки склеек.
  const d1 = new Int32Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) d1[i * m + j] = editDistance(script[i]!, asr[j]!);
  const cost = (sim: number) => 2 * (1 - sim);
  // Склейка 2↔1 / 1↔2 — только если она ближе по буквам, чем каждое слово само по себе
  // («в антарктиде» ↔ «вантарктиде»: 0 правок против 1). Иначе пропущенное или лишнее
  // слово у стыка сцен «прилипает» к соседнему: «нет британские» ~ «британские»,
  // «выжили» ~ «там выжили» — и разрез сцен или подсветка уезжают на это слово.
  const joinCost = (a: string, b: string, alone1: number, alone2: number) => {
    const alone = Math.min(alone1, alone2);
    // Разница длин — нижняя граница правок: заведомо не лучше или непохоже — не считаем.
    const dl = Math.abs(a.length - b.length);
    if (dl >= alone || dl > (1 - FOUND_SIM) * Math.max(a.length, b.length)) return Infinity;
    const d = editDistance(a, b);
    const sim = simOf(d, a, b);
    return d < alone && sim >= FOUND_SIM ? cost(sim) + JOIN : Infinity;
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = D[i * W + j]!;
      if (here === Infinity) continue;
      const relax = (ii: number, jj: number, c: number, mv: number) => {
        const k = ii * W + jj;
        if (here + c < D[k]!) {
          D[k] = here + c;
          how[k] = mv;
        }
      };
      if (i < n) relax(i + 1, j, GAP, 1);
      if (j < m) relax(i, j + 1, GAP, 2);
      if (i < n && j < m) relax(i + 1, j + 1, cost(simOf(d1[i * m + j]!, script[i]!, asr[j]!)), 3);
      if (i + 1 < n && j < m) relax(i + 2, j + 1, joinCost(script[i]! + script[i + 1]!, asr[j]!, d1[i * m + j]!, d1[(i + 1) * m + j]!), 4);
      if (i < n && j + 1 < m) relax(i + 1, j + 2, joinCost(script[i]!, asr[j]! + asr[j + 1]!, d1[i * m + j]!, d1[i * m + j + 1]!), 5);
    }
  }
  const out: ({ from: number; to: number } | null)[] = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const mv = how[i * W + j];
    if (mv === 1) i--;
    else if (mv === 2) j--;
    else if (mv === 3) {
      if (simOf(d1[(i - 1) * m + j - 1]!, script[i - 1]!, asr[j - 1]!) >= FOUND_SIM) out[i - 1] = { from: j - 1, to: j - 1 };
      i--;
      j--;
    } else if (mv === 4) {
      // Склейка засчитана в ДП, только если похожа (joinCost), — оба слова нашлись.
      out[i - 2] = { from: j - 1, to: j - 1 };
      out[i - 1] = { from: j - 1, to: j - 1 };
      i -= 2;
      j--;
    } else if (mv === 5) {
      out[i - 1] = { from: j - 2, to: j - 1 };
      i--;
      j -= 2;
    } else break;
  }
  return out;
}

// «Вес» слова для раскладки внутри общего отрезка: гласные ≈ слоги.
const weightOf = (t: Token) => Math.max(1, (t.norm.match(/[аеёиоуыэюяaeiouy]/g)?.length ?? 0) * 2 + t.norm.length * 0.3);

// Поправки по энергии звука: CTC ставит букву с задержкой в кадр-другой, а
// после тишины настоящее начало слова видно по звуку — берём его.
const ONSET_LOOKBACK_MS = 240;
const CTC_LAG_MS = 40; // первая буква «выстреливает» чуть позже начала звука (кадр модели — 40 мс)

// Выравнивание текста сценария по распознанным словам. profile — для уточнения
// краёв слов по паузам; без него — только время букв.
export function alignTextToAsr(text: string, asr: AsrWord[], durationMs: number, profile?: SpeechProfile): AlignResult | null {
  const tokens = tokenize(text);
  if (!tokens.length || !asr.length) return null;
  const pairs = matchWords(
    tokens.map((t) => asrNorm(t.norm)),
    asr.map((w) => asrNorm(w.text)),
  );
  const matched = pairs.filter(Boolean).length;
  if (matched / tokens.length < MIN_MATCH) return null;

  const times: ({ startMs: number; endMs: number } | null)[] = tokens.map(() => null);
  for (let i = 0; i < tokens.length; i++) {
    const p = pairs[i];
    if (!p) continue;
    // Два слова сценария на одно распознанное — делим его время по весам.
    if (i + 1 < tokens.length && pairs[i + 1] && pairs[i + 1]!.from === p.from && pairs[i + 1]!.to === p.to) {
      const a = asr[p.from]!;
      const wa = weightOf(tokens[i]!);
      const mid = a.startMs + ((a.endMs - a.startMs) * wa) / (wa + weightOf(tokens[i + 1]!));
      times[i] = { startMs: a.startMs, endMs: mid };
      times[i + 1] = { startMs: mid, endMs: a.endMs };
      i++;
      continue;
    }
    times[i] = { startMs: asr[p.from]!.startMs, endMs: asr[p.to]!.endMs };
  }

  // Края слов по звуку: начало после паузы — конец паузы (если рядом), иначе
  // время первой буквы минус задержку CTC; конец — не заходит в паузу.
  if (profile?.hasSpeech) {
    const pauses = profile.pauses;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (!t) continue;
      // Пауза — после предыдущего найденного слова, а не перед ним.
      const prevEnd = times.slice(0, i).findLast(Boolean)?.endMs ?? -Infinity;
      const before = pauses.find((p) => p.endMs <= t.startMs + 20 && p.endMs >= t.startMs - ONSET_LOOKBACK_MS && p.startMs >= prevEnd - 40);
      const speechStart = i === 0 && profile.speechStartMs <= t.startMs + 20 && profile.speechStartMs >= t.startMs - ONSET_LOOKBACK_MS ? profile.speechStartMs : null;
      t.startMs = before ? before.endMs : speechStart ?? Math.max(0, t.startMs - CTC_LAG_MS);
      const nextStart = times.slice(i + 1).find(Boolean)?.startMs ?? profile.speechEndMs + 400;
      // Пауза должна тянуться дальше последней распознанной буквы (конец слова − кадр
      // модели): смычка «т/к/п/ц» внутри слова — тоже тишина ≥ 40 мс, но после неё
      // буквы ещё звучат, и подсветка гасла бы посреди слова.
      const pause = pauses.find((p) => p.startMs >= t.startMs && p.endMs > t.endMs - CTC_LAG_MS && p.startMs < nextStart && p.startMs <= t.endMs + 400);
      if (pause) t.endMs = Math.max(t.startMs + 60, Math.min(t.endMs + 80, pause.startMs));
    }
  } else {
    for (const t of times) if (t) t.startMs = Math.max(0, t.startMs - CTC_LAG_MS);
  }

  // Ненайденные слова — между соседями, по весам; по краям — до начала/конца речи.
  const speechStart = profile?.hasSpeech ? profile.speechStartMs : 0;
  const speechEnd = profile?.hasSpeech ? profile.speechEndMs : durationMs;
  for (let i = 0; i < times.length; ) {
    if (times[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < times.length && !times[j]) j++;
    const from = i > 0 ? times[i - 1]!.endMs : Math.min(speechStart, times[j]?.startMs ?? speechStart);
    const to = j < times.length ? times[j]!.startMs : Math.max(speechEnd, from);
    const ws = tokens.slice(i, j).map(weightOf);
    const total = ws.reduce((a, b) => a + b, 0);
    const span = Math.max(to - from, (j - i) * 60);
    let t = from;
    for (let k = i; k < j; k++) {
      const d = (span * ws[k - i]!) / total;
      times[k] = { startMs: t, endMs: t + d };
      t += d;
    }
    i = j;
  }
  // Конец слова — не позже начала следующего (без наложений подсветки).
  for (let i = 0; i + 1 < times.length; i++) times[i]!.endMs = Math.min(times[i]!.endMs, Math.max(times[i]!.startMs + 40, times[i + 1]!.startMs));
  const words = finalize(
    tokens.map((tok, i) => ({ text: tok.text, startMs: times[i]!.startMs, endMs: times[i]!.endMs })),
    durationMs,
  );
  return { words, matched, total: tokens.length, found: pairs.map(Boolean), rawEndMs: pairs.map((p) => (p ? asr[p.to]!.endMs : null)) };
}

// Буквы с временем (результат CTC) → слова; пробел — граница слова.
export function tokensToWords(tokens: string[], timestampsSec: number[], offsetMs = 0, frameMs = 40): AsrWord[] {
  const out: AsrWord[] = [];
  let text = "";
  let start = 0;
  let last = 0;
  const flush = () => {
    if (text) out.push({ text, startMs: offsetMs + start * 1000, endMs: offsetMs + last * 1000 + frameMs });
    text = "";
  };
  tokens.forEach((tok, k) => {
    const ts = timestampsSec[k] ?? last;
    if (!tok.trim()) return flush();
    // Некоторые модели отдают слово-токен с ведущим пробелом («▁слово»).
    if (/^[\s▁]/.test(tok)) flush();
    if (!text) start = ts;
    text += tok.replace(/[\s▁]/g, "");
    last = ts;
  });
  flush();
  return out;
}

// Куски для распознавания: длинный звук режем по паузам на ~8–16 с — модель
// с вниманием на длинных кусках медленнее (и съедает больше памяти).
export function chunkByPauses(profile: SpeechProfile, targetMs = 12_000, minMs = 6_000, maxMs = 18_000): number[] {
  const cuts: number[] = [];
  let cursor = 0;
  const end = profile.durationMs;
  while (end - cursor > maxMs) {
    const window = profile.pauses.filter((p) => {
      const mid = (p.startMs + p.endMs) / 2;
      return mid >= cursor + minMs && mid <= cursor + maxMs;
    });
    let cut: number;
    if (window.length) {
      // Длинная пауза ближе к цели лучше; разрез — в середине паузы (слово не рвём).
      const best = window.reduce((a, b) => (score(b) > score(a) ? b : a));
      cut = (best.startMs + best.endMs) / 2;
    } else cut = cursor + targetMs;
    cuts.push(cut);
    cursor = cut;
  }
  return cuts;
  function score(p: { startMs: number; endMs: number }) {
    return Math.min(600, p.endMs - p.startMs) - 0.05 * Math.abs((p.startMs + p.endMs) / 2 - (cursor + targetMs));
  }
}

// ---- модель и распознавание ----

interface OfflineStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void;
}
interface OfflineRecognizer {
  createStream(): OfflineStream;
  decodeAsync(stream: OfflineStream): Promise<{ text: string; tokens: string[]; timestamps: number[] }>;
}
interface SherpaAsr {
  OfflineRecognizer: { createAsync(config: unknown): Promise<OfflineRecognizer> };
}

export function asrModelDir(): string {
  return path.join(envPath("MODELS_DIR", "models"), ASR_MODEL_NAME);
}

function asrModel(): TarModel {
  return {
    label: "Распознавание речи",
    title: "модель распознавания речи GigaAM для таймингов субтитров (~170 МБ, один раз)",
    url: ASR_MODEL_URL,
    dir: asrModelDir(),
    complete: (d) => existsSync(path.join(d, "model.int8.onnx")) && existsSync(path.join(d, "tokens.txt")),
    idleMs: 60_000,
    totalMs: 15 * 60_000,
  };
}

let engine: Promise<{ rec: OfflineRecognizer; queue: Promise<unknown> }> | null = null;
let disabledReason: string | null = null;

// null — распознавание недоступно (причина уже в логе один раз за процесс).
async function getEngine(): Promise<{ rec: OfflineRecognizer; queue: Promise<unknown> } | null> {
  if (disabledReason) return null;
  engine ??= (async () => {
    const m = asrModel();
    const dir = tarModelReady(m) ? m.dir : await downloadTarModel(m);
    const lib = createRequire(import.meta.url)("sherpa-onnx-node") as SherpaAsr;
    const rec = await lib.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 64 },
      modelConfig: {
        nemoCtc: { model: path.join(dir, "model.int8.onnx") },
        tokens: path.join(dir, "tokens.txt"),
        numThreads: Math.max(1, Math.min(4, os.cpus().length)),
        provider: "cpu",
        debug: 0,
      },
    });
    return { rec, queue: Promise.resolve() as Promise<unknown> };
  })();
  try {
    return await engine;
  } catch (e) {
    disabledReason = (e as Error).message.split("\n")[0]!;
    warnOnce(
      "asr-disabled",
      `[озвучка] Тайминги слов по речи недоступны (${disabledReason}) — субтитры по оценке звука. ` +
        `Модель можно скачать вручную: ${ASR_MODEL_URL} → распаковать в ${path.dirname(asrModelDir())}; выключить попытки: CAPTION_ALIGN=0.`,
    );
    return null;
  }
}

const ASR_RATE = 16000;

// В 16 кГц (частота модели) сами: sherpa-onnx умеет и сам, но печатает об этом
// в лог на каждой сцене. Для распознавания хватает линейной интерполяции со
// сглаживанием окном шириной в шаг (срезает то, что выше 8 кГц).
export function resampleTo16k(x: Float32Array, rate: number): Float32Array {
  if (rate === ASR_RATE) return x;
  const step = rate / ASR_RATE;
  const n = Math.floor(x.length / step);
  const out = new Float32Array(n);
  const half = Math.max(0, Math.floor(step / 2));
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const a = Math.floor(pos);
    const f = pos - a;
    const at = (k: number) => {
      let s = 0;
      let c = 0;
      for (let d = -half; d <= half; d++) {
        const v = x[k + d];
        if (v !== undefined) {
          s += v;
          c++;
        }
      }
      return c ? s / c : 0;
    };
    out[i] = at(a) * (1 - f) + at(a + 1) * f;
  }
  return out;
}

// Распознанные слова звука (время — мс от начала samples) или null.
export async function recognizeWords(input: Float32Array, inputRate: number, profile?: SpeechProfile): Promise<AsrWord[] | null> {
  const eng = await getEngine();
  if (!eng) return null;
  const prof = profile ?? analyzeSpeech(input, inputRate);
  const samples = resampleTo16k(input, inputRate);
  const sampleRate = ASR_RATE;
  const edges = [0, ...chunkByPauses(prof).map((ms) => Math.min(samples.length, Math.round((ms / 1000) * sampleRate))), samples.length];
  try {
    const words: AsrWord[] = [];
    for (let k = 0; k + 1 < edges.length; k++) {
      const part = samples.subarray(edges[k]!, edges[k + 1]!);
      if (part.length < sampleRate * 0.1) continue;
      // Один экземпляр модели — строго по очереди (сцены могут прийти параллельно).
      const run = eng.queue.then(async () => {
        const st = eng.rec.createStream();
        st.acceptWaveform({ samples: part, sampleRate });
        return eng.rec.decodeAsync(st);
      });
      eng.queue = run.catch(() => {});
      const r = await run;
      words.push(...tokensToWords(r.tokens ?? [], r.timestamps ?? [], (edges[k]! / sampleRate) * 1000));
    }
    return words;
  } catch (e) {
    warnOnce("asr-failed", `[озвучка] Распознавание речи для таймингов не удалось (${(e as Error).message.split("\n")[0]}) — субтитры по оценке звука.`);
    return null;
  }
}

// Главный вход: тайминги слов text по звуку. null — распознавание недоступно
// (выключено, нет модели, сбой); "mismatch" — речь не совпала с текстом. В обоих
// случаях вызывающий код оставляет прежнюю оценку.
export async function alignByAsr(text: string, samples: Float32Array, sampleRate: number, durationMs: number, label: string): Promise<AlignResult | "mismatch" | null> {
  if (!alignEnabled()) return null;
  const profile = analyzeSpeech(samples, sampleRate);
  if (!profile.hasSpeech) return null;
  const asr = await recognizeWords(samples, sampleRate, profile);
  if (!asr) return null;
  const r = alignTextToAsr(text, asr, durationMs, profile);
  if (!r) {
    const n = tokenize(text).length;
    console.warn(`[озвучка] ${label}: распознанная речь мало похожа на текст сцены (совпало < ${Math.round(MIN_MATCH * 100)} % из ${n} слов) — тайминги оставлены по оценке звука.`);
    return "mismatch";
  }
  return r;
}

// ---- нарезка общей озвучки на сцены по распознанным словам ----

export interface AlignedSplit {
  cuts: number[]; // мс от начала общего звука, между сценами
  words: WordTiming[][]; // слова каждой сцены, мс от начала её куска
  matched: number;
  total: number;
}

// Gemini озвучивает ролик одним запросом, и звук режется на сцены. Оценка по
// паузам (split.ts) ошибалась на целое предложение («Он бы плавал.» уезжало в
// следующую сцену, и сдвиг тянулся каскадом до конца ролика). Здесь граница —
// в паузе между последним словом сцены и первым словом следующей, найденными в
// речи. null — распознавание недоступно или текст не совпал.
export async function alignedSplitPoints(samples: Float32Array, sampleRate: number, texts: string[]): Promise<AlignedSplit | null> {
  if (!alignEnabled() || texts.length < 2) return null;
  const profile = analyzeSpeech(samples, sampleRate);
  if (!profile.hasSpeech) return null;
  const asr = await recognizeWords(samples, sampleRate, profile);
  if (!asr) return null;
  return splitByAsr(texts, asr, profile);
}

// Пауза между сценами начинается сразу после последнего слова сцены (и кончается
// прямо перед первым словом следующей) — не дальше этого от найденного слова.
const SNAP_MS = 120;

// Чистая часть (для тестов): границы сцен по распознанным словам.
export function splitByAsr(texts: string[], asr: AsrWord[], profile: SpeechProfile): AlignedSplit | null {
  const counts = texts.map((t) => tokenize(t).length);
  const r = alignTextToAsr(texts.join(" "), asr, profile.durationMs, profile);
  if (!r) return null;
  // Каждая сцена должна найтись в речи хотя бы наполовину — иначе граница наугад.
  let at = 0;
  for (const n of counts) {
    if (n && r.found.slice(at, at + n).filter(Boolean).length / n < 0.5) return null;
    at += n;
  }
  // Части пауз внутри [lo, hi] — по времени.
  const within = (lo: number, hi: number) =>
    profile.pauses.map((p) => ({ a: Math.max(p.startMs, lo), b: Math.min(p.endMs, hi) })).filter((p) => p.b > p.a);
  const cuts: number[] = [];
  at = 0;
  for (let k = 0; k + 1 < texts.length; k++) {
    at += counts[k]!;
    if (!counts[k] || at >= r.words.length || at === 0) return null;
    // Не раньше конца последней буквы по распознаванию: пауза по энергии может
    // начаться на затухании слова, а резать его хвост нельзя.
    const lastEnd = Math.max(r.words[at - 1]!.endMs, r.rawEndMs[at - 1] ?? 0);
    const nextStart = r.words[at]!.startMs;
    const prev = cuts.at(-1) ?? 0;
    // Самая длинная пауза в промежутке между сценами — разрез посередине неё.
    const inGap = within(lastEnd, nextStart);
    const best = inGap.length ? inGap.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x)) : null;
    let cut = best ? (best.a + best.b) / 2 : (lastEnd + Math.max(lastEnd, nextStart)) / 2;
    // Слово у стыка не нашлось в речи: интерполяция растянула его на всю паузу между
    // сценами, промежуток пуст, и разрез ложился вплотную к найденному соседу (01b, если
    // не распознано «больше»: хвост «эры» уходил в следующую сцену). Тогда граница — в паузе,
    // примыкающей к найденному слову. Самая длинная тут не годится: тихий хвост
    // слова («-ся», «-ии») по энергии тоже пауза.
    let snap: { a: number; b: number } | undefined;
    if (r.found[at - 1] && !r.found[at]) {
      let ni = at;
      while (ni + 1 < at + counts[k + 1]! && !r.found[ni]) ni++;
      snap = within(lastEnd, r.words[ni]!.startMs).find((p) => p.a <= lastEnd + SNAP_MS);
    } else if (!r.found[at - 1] && r.found[at]) {
      let li = at - 1;
      while (li > at - counts[k]! && !r.found[li]) li--;
      snap = within(Math.max(r.words[li]!.endMs, r.rawEndMs[li] ?? 0), nextStart).findLast((p) => p.b >= nextStart - SNAP_MS);
    }
    if (snap) cut = (snap.a + snap.b) / 2;
    if (cut <= prev + 200) return null;
    cuts.push(cut);
  }
  const edges = [0, ...cuts];
  const words: WordTiming[][] = [];
  at = 0;
  for (let k = 0; k < texts.length; k++) {
    const off = edges[k]!;
    words.push(r.words.slice(at, at + counts[k]!).map((w) => ({ text: w.text, startMs: w.startMs - off, endMs: w.endMs - off })));
    at += counts[k]!;
  }
  return { cuts, words, matched: r.matched, total: r.total };
}
