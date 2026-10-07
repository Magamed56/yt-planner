// Тайминги слов для субтитров.
//
// 1) Провайдер дал тайминги (Edge, ElevenLabs, vLLM-Omni) — привязываем их к
//    словам нашего текста: так в субтитрах будет пунктуация и одинаковое
//    деление на слова у всех провайдеров.
// 2) Таймингов нет (Piper, Gemini, Fish, OpenAI-совместимые) — оцениваем по
//    самому звуку:
//    а) энергия кадров по 10 мс → речь/тишина → паузы;
//    б) знаки препинания сопоставляются с паузами динамическим
//       программированием (паузы короче ~90 мс — обычно смычки согласных);
//    в) внутри фразы буквы получают «вес» (гласная длиннее согласной), а
//       шкала подгоняется под реальные слоги: в русском каждая гласная буква —
//       это слог, и пики энергии в полосе гласных (300–3000 Гц) показывают,
//       где они на самом деле. Так оценка не «уплывает» к концу длинной фразы.

import type { WordTiming } from "../../types";
import { Svf } from "../audio/dsp";
import { normWord, tokenize, type Token } from "./text";

export interface Pause {
  startMs: number;
  endMs: number;
}

export interface SpeechProfile {
  hopMs: number;
  db: Float32Array; // энергия кадров (дБ), сглаженная по 30 мс
  vdb: Float32Array; // энергия в полосе гласных (дБ), сглаженная по 50 мс — для поиска слогов
  thresholdDb: number;
  speechStartMs: number;
  speechEndMs: number;
  pauses: Pause[]; // тишина внутри речи, ≥ 40 мс
  durationMs: number;
  hasSpeech: boolean;
}

const HOP_MS = 10;
const toDb = (p: number) => Math.max(-120, 10 * Math.log10(p + 1e-12));

export function analyzeSpeech(samples: Float32Array, sampleRate: number): SpeechProfile {
  const hop = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  const frames = Math.max(1, Math.ceil(samples.length / hop));
  const power = new Float64Array(frames);
  const vpower = new Float64Array(frames);
  // Широкая полоса вокруг 1 кГц: форманты гласных, без шипящих и низкого гула.
  const bp = new Svf(sampleRate);
  bp.set(1000, 0.45);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    let v = 0;
    const a = f * hop;
    const b = Math.min(samples.length, a + hop);
    for (let i = a; i < b; i++) {
      const x = samples[i]!;
      s += x * x;
      bp.process(x);
      v += bp.bp * bp.bp;
    }
    power[f] = s / Math.max(1, b - a);
    vpower[f] = v / Math.max(1, b - a);
  }
  const raw = new Float32Array(frames);
  const db = new Float32Array(frames);
  const vdb = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    raw[f] = toDb(power[f]!);
    // Сглаживаем мощность (не децибелы): 30 мс для провалов, 50 мс для слогов.
    const p = (power[Math.max(0, f - 1)]! + power[f]! + power[Math.min(frames - 1, f + 1)]!) / 3;
    db[f] = toDb(p);
    let vp = 0;
    for (let k = -2; k <= 2; k++) vp += vpower[Math.min(frames - 1, Math.max(0, f + k))]!;
    vdb[f] = toDb(vp / 5);
  }
  const sorted = Array.from(raw).sort((x, y) => x - y);
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? -120;
  const speech = pct(0.95);
  const floor = pct(0.1);
  // Порог тишины: на 30 дБ ниже громкой речи, но не ниже «пола» шума + 10 дБ
  // (для записей с шумом) и не выше речи −18 дБ.
  const thresholdDb = Math.max(speech - 30, Math.min(floor + 10, speech - 18));
  const durationMs = (samples.length / sampleRate) * 1000;

  let first = -1;
  let last = -1;
  for (let f = 0; f < frames; f++) {
    if (raw[f]! > thresholdDb) {
      if (first < 0) first = f;
      last = f;
    }
  }
  if (first < 0 || speech < -70) {
    return { hopMs: HOP_MS, db, vdb, thresholdDb, speechStartMs: 0, speechEndMs: durationMs, pauses: [], durationMs, hasSpeech: false };
  }
  const pauses: Pause[] = [];
  let runStart = -1;
  for (let f = first; f <= last + 1; f++) {
    const silent = f <= last && raw[f]! <= thresholdDb;
    if (silent && runStart < 0) runStart = f;
    if (!silent && runStart >= 0) {
      if (f - runStart >= 4) pauses.push({ startMs: runStart * HOP_MS, endMs: f * HOP_MS });
      runStart = -1;
    }
  }
  return {
    hopMs: HOP_MS,
    db,
    vdb,
    thresholdDb,
    speechStartMs: first * HOP_MS,
    speechEndMs: Math.min(durationMs, (last + 1) * HOP_MS),
    pauses,
    durationMs,
    hasSpeech: true,
  };
}

// Ожидаемая длина паузы (мс) по силе знака препинания.
const EXPECTED_PAUSE: Record<number, number> = { 0: 0, 1.5: 120, 2: 180, 3: 280 };
const expectedPause = (s: number) => EXPECTED_PAUSE[s] ?? 0;
// Насколько пауза похожа на настоящую. Замеры на Piper (сверка с ASR): паузы
// короче ~90 мс совпадают с границей слова не чаще случайного (это смычки
// согласных «т», «к», «п»), от 160 мс — почти всегда граница.
const pauseConfidence = (durMs: number) => Math.min(1, Math.max(0, (durMs - 75) / 125));

// «Вес» буквы ≈ её длительность: гласная — слог, согласная — около половины,
// ь/ъ не звучат, цифры (если остались) читаются длинно.
const VOWEL = /[аеёиоуыэюяaeiouy]/;
const letterWeight = (ch: string) => (VOWEL.test(ch) ? 1 : /[ьъ]/.test(ch) ? 0 : /\p{N}/u.test(ch) ? 2.5 : 0.55);
const tokenWeight = (t: Token) => {
  let w = 0;
  for (const ch of t.norm) w += letterWeight(ch);
  return Math.max(0.3, w);
};

export interface EstimateOptions {
  align?: boolean; // сопоставлять знаки препинания с паузами (по умолчанию да)
  nuclei?: boolean; // подгонять шкалу под найденные слоги (по умолчанию да)
}

export function estimateWordTimings(text: string, profile: SpeechProfile, opts: EstimateOptions = {}): WordTiming[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  if (!profile.hasSpeech) return estimateWordsUniform(text, profile.durationMs);
  const { speechStartMs: s0, speechEndMs: s1 } = profile;
  const available = Math.max(1, s1 - s0);
  const n = tokens.length;
  if (n === 1) return finalize([{ text: tokens[0]!.text, startMs: s0, endMs: s1 }], profile.durationMs);

  const anchors = opts.align === false ? new Map<number, Pause>() : matchPauses(tokens, profile, s0, available, opts);

  // Отрезки речи между опорными паузами; внутри — по буквам и слогам.
  const out: WordTiming[] = [];
  let segStart = 0;
  let tStart = s0;
  for (let k = 0; k < n; k++) {
    const anchor = k < n - 1 ? anchors.get(k) : undefined;
    if (k === n - 1 || anchor) {
      const tEnd = Math.max(tStart + (k + 1 - segStart) * 40, anchor ? anchor.startMs : s1);
      const seg = tokens.slice(segStart, k + 1);
      const times = placeInSegment(seg, tStart, tEnd, profile, opts.nuclei !== false);
      seg.forEach((t, i) => out.push({ text: t.text, startMs: times[i]!.startMs, endMs: times[i]!.endMs }));
      segStart = k + 1;
      tStart = anchor ? anchor.endMs : tEnd;
    }
  }
  return finalize(out, profile.durationMs);
}

// Динамическое программирование: монотонно сопоставляем границы слов (B) и паузы (P).
// Граница со знаком препинания «хочет» паузу; граница без знака берёт паузу,
// только если та длинная и стоит там, где её ожидает пропорциональная модель.
function matchPauses(tokens: Token[], profile: SpeechProfile, s0: number, available: number, opts: EstimateOptions): Map<number, Pause> {
  const n = tokens.length;
  const weights = tokens.map(tokenWeight);
  const totalW = weights.reduce((a, b) => a + b, 0);
  let pauseTotal = 0;
  for (let k = 0; k < n - 1; k++) pauseTotal += expectedPause(tokens[k]!.pause);
  const pauseScale = pauseTotal > 0.35 * available ? (0.35 * available) / pauseTotal : 1;
  const rate = (available - pauseTotal * pauseScale) / totalW;
  // Линейная шкала с запасом на паузы у знаков препинания…
  const scale = letterScale(tokens);
  const pauseBefore: number[] = [0]; // накопленные паузы перед словом i
  for (let k = 0; k < n - 1; k++) pauseBefore.push(pauseBefore[k]! + expectedPause(tokens[k]!.pause) * pauseScale);
  const at = (w: number, word: number) => s0 + w * rate * (totalW / scale.total) + pauseBefore[word]!;
  const vowelsT: number[] = [];
  for (let i = 0, vi = 0; i < n; i++) {
    while (vi < scale.nuclei.length && scale.nuclei[vi]! < scale.wordEnd[i]!) vowelsT.push(at(scale.nuclei[vi++]!, i));
  }
  // …уточнённая по слогам всей реплики: ожидаемые позиции пауз становятся точнее,
  // и допуск можно держать узким (иначе пауза «уезжает» к соседней фразе).
  const warp = opts.nuclei !== false ? nucleiWarp(vowelsT, profile, s0, s0 + available, Math.max(150, NUCLEI_TUNING.globalSigmaFrac * available), NUCLEI_TUNING.globalBlend) : (t: number) => t;
  const expected: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const endK = at(scale.wordEnd[k]!, k);
    const ep = expectedPause(tokens[k]!.pause) * pauseScale;
    expected.push(warp(endK + ep / 2));
  }
  const P = profile.pauses;
  const B = n - 1;
  const tol = opts.nuclei !== false ? Math.max(NUCLEI_TUNING.tolMin, NUCLEI_TUNING.tolFrac * available) : Math.max(300, 0.15 * available);
  const skipB = (k: number) => (tokens[k]!.pause > 0 ? 0.4 * tokens[k]!.pause : 0);
  const skipP = (j: number) => 1.5 * pauseConfidence(P[j]!.endMs - P[j]!.startMs);
  const match = (k: number, j: number) => {
    const p = P[j]!;
    const dev = (expected[k]! - (p.startMs + p.endMs) / 2) / tol;
    const conf = pauseConfidence(p.endMs - p.startMs);
    const s = tokens[k]!.pause;
    const reward = s > 0 ? (1 + s) * conf : (conf - 0.5) * 2.5;
    return 2 * dev * dev - reward;
  };
  const W = P.length + 1;
  const D = new Float64Array((B + 1) * W);
  const how = new Uint8Array((B + 1) * W); // 1 — пропуск границы, 2 — пропуск паузы, 3 — совпадение
  for (let k = 0; k <= B; k++) {
    for (let j = 0; j <= P.length; j++) {
      if (k === 0 && j === 0) continue;
      let best = Infinity;
      let mv = 0;
      if (k > 0) {
        const c = D[(k - 1) * W + j]! + skipB(k - 1);
        if (c < best) [best, mv] = [c, 1];
      }
      if (j > 0) {
        const c = D[k * W + j - 1]! + skipP(j - 1);
        if (c < best) [best, mv] = [c, 2];
      }
      if (k > 0 && j > 0) {
        const c = D[(k - 1) * W + j - 1]! + match(k - 1, j - 1);
        if (c < best) [best, mv] = [c, 3];
      }
      D[k * W + j] = best;
      how[k * W + j] = mv;
    }
  }
  const anchors = new Map<number, Pause>();
  for (let k = B, j = P.length; k > 0 || j > 0; ) {
    const mv = how[k * W + j];
    if (mv === 3) {
      // Пауза без знака препинания, но слабая — не опора (скорее смычка).
      if (tokens[k - 1]!.pause > 0 || pauseConfidence(P[j - 1]!.endMs - P[j - 1]!.startMs) > 0.5) anchors.set(k - 1, P[j - 1]!);
      k--;
      j--;
    } else if (mv === 1) k--;
    else j--;
  }
  return anchors;
}

// Параметры подгонки по слогам (подобраны сверкой с ASR на голосах Piper).
export const NUCLEI_TUNING = { sigmaMin: 110, sigmaFrac: 0.12, skipV: 0.9, skipN: 0.7, mergeDb: 2.5, minGapMs: 60, blend: 0.5, globalSigmaFrac: 0.12, globalBlend: 0.5, tolMin: 250, tolFrac: 0.08 };

// Пики энергии в полосе гласных внутри [t0, t1] — кандидаты в центры слогов.
function findNuclei(profile: SpeechProfile, t0: number, t1: number): number[] {
  const { vdb, hopMs } = profile;
  const f0 = Math.max(1, Math.ceil(t0 / hopMs));
  const f1 = Math.min(vdb.length - 2, Math.floor(t1 / hopMs));
  if (f1 - f0 < 3) return [];
  let peaks: number[] = [];
  let top = -Infinity;
  for (let f = f0; f <= f1; f++) {
    if (vdb[f]! > vdb[f - 1]! && vdb[f]! >= vdb[f + 1]!) peaks.push(f);
    if (vdb[f]! > top) top = vdb[f]!;
  }
  peaks = peaks.filter((f) => vdb[f]! > top - 24);
  // Сливаем пики, между которыми нет заметного провала (< 2.5 дБ) или они ближе 60 мс.
  for (let changed = true; changed && peaks.length > 1; ) {
    changed = false;
    let worst = -1;
    let worstScore = Infinity;
    for (let i = 0; i < peaks.length - 1; i++) {
      const a = peaks[i]!;
      const b = peaks[i + 1]!;
      let valley = Infinity;
      for (let f = a; f <= b; f++) valley = Math.min(valley, vdb[f]!);
      const depth = Math.min(vdb[a]!, vdb[b]!) - valley;
      const close = (b - a) * hopMs < NUCLEI_TUNING.minGapMs;
      const score = close ? -1 : depth;
      if ((close || depth < NUCLEI_TUNING.mergeDb) && score < worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    if (worst >= 0) {
      const a = peaks[worst]!;
      const b = peaks[worst + 1]!;
      peaks.splice(vdb[a]! >= vdb[b]! ? worst + 1 : worst, 1);
      changed = true;
    }
  }
  return peaks.map((f) => f * hopMs + hopMs / 2);
}

// Кусочно-линейная «подгонка времени»: ожидаемые центры гласных → найденные
// пики слогов (монотонное выравнивание ДП с пропусками с обеих сторон).
function nucleiWarp(expected: number[], profile: SpeechProfile, t0: number, t1: number, sigma: number, blend: number): (t: number) => number {
  const knots: [number, number][] = [[t0, t0]];
  const peaks = expected.length ? findNuclei(profile, t0, t1) : [];
  if (peaks.length) {
    const V = expected.length;
    const N = peaks.length;
    const W = N + 1;
    const D = new Float64Array((V + 1) * W);
    const how = new Uint8Array((V + 1) * W);
    const skipV = NUCLEI_TUNING.skipV; // гласная без пика: две гласные подряд, редуцированный слог
    const skipN = NUCLEI_TUNING.skipN; // лишний пик: сонорный согласный, шум
    for (let i = 0; i <= V; i++) {
      for (let j = 0; j <= N; j++) {
        if (i === 0 && j === 0) continue;
        let best = Infinity;
        let mv = 0;
        if (i > 0 && D[(i - 1) * W + j]! + skipV < best) [best, mv] = [D[(i - 1) * W + j]! + skipV, 1];
        if (j > 0 && D[i * W + j - 1]! + skipN < best) [best, mv] = [D[i * W + j - 1]! + skipN, 2];
        if (i > 0 && j > 0) {
          const d = (expected[i - 1]! - peaks[j - 1]!) / sigma;
          const c = D[(i - 1) * W + j - 1]! + d * d;
          if (c < best) [best, mv] = [c, 3];
        }
        D[i * W + j] = best;
        how[i * W + j] = mv;
      }
    }
    const pairs: [number, number][] = [];
    for (let i = V, j = N; i > 0 || j > 0; ) {
      const mv = how[i * W + j];
      if (mv === 3) {
        pairs.push([expected[i - 1]!, peaks[j - 1]!]);
        i--;
        j--;
      } else if (mv === 1) i--;
      else j--;
    }
    pairs.reverse();
    for (const [e, p] of pairs) {
      const last = knots.at(-1)!;
      const q = e + (p - e) * blend;
      if (e > last[0] + 1 && e < t1 - 1 && q > last[1] + 1 && q < t1 - 1) knots.push([e, q]);
    }
  }
  knots.push([t1, t1]);
  return (t: number) => {
    for (let i = 1; i < knots.length; i++) {
      const [ea, pa] = knots[i - 1]!;
      const [eb, pb] = knots[i]!;
      if (t <= eb) return pa + ((t - ea) / Math.max(1e-6, eb - ea)) * (pb - pa);
    }
    return t1;
  };
}

// Шкала «веса» слов: начало каждого слова и центры гласных (в единицах веса).
function letterScale(tokens: Token[]): { wordStart: number[]; wordEnd: number[]; nuclei: number[]; total: number } {
  const wordStart: number[] = [];
  const wordEnd: number[] = [];
  const nuclei: number[] = [];
  let acc = 0;
  for (const t of tokens) {
    wordStart.push(acc);
    for (const ch of t.norm) {
      const w = letterWeight(ch);
      if (VOWEL.test(ch)) nuclei.push(acc + w / 2);
      acc += w;
    }
    if (acc === wordStart.at(-1)) acc += 0.3; // слово без «звучащих» букв — минимальная длина
    wordEnd.push(acc);
  }
  return { wordStart, wordEnd, nuclei, total: acc || 1 };
}

// Раскладка слов внутри отрезка речи [t0, t1].
function placeInSegment(tokens: Token[], t0: number, t1: number, profile: SpeechProfile, useNuclei: boolean): { startMs: number; endMs: number }[] {
  const { wordStart, nuclei, total } = letterScale(tokens);
  const span = t1 - t0;
  const lin = (w: number) => t0 + (w / total) * span;
  const warp =
    useNuclei && span > 200
      ? nucleiWarp(nuclei.map(lin), profile, t0, t1, Math.max(NUCLEI_TUNING.sigmaMin, NUCLEI_TUNING.sigmaFrac * span), NUCLEI_TUNING.blend)
      : (t: number) => t;
  const bounds = wordStart.map((w) => warp(lin(w)));
  bounds.push(t1);
  return tokens.map((_, i) => ({ startMs: bounds[i]!, endMs: bounds[i + 1]! }));
}

// Пропорциональная раскладка слов в отрезке [from, to] по весам.
function spread(tokens: Token[], from: number, to: number): { startMs: number; endMs: number }[] {
  const weights = tokens.map(tokenWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = from;
  return weights.map((w) => {
    const d = ((to - from) * w) / total;
    const r = { startMs: t, endMs: t + d };
    t += d;
    return r;
  });
}

// Без звука (например, MP3 без таймингов): ровная раскладка с паузами на знаках.
export function estimateWordsUniform(text: string, durationMs: number, leadMs = 60, tailMs = 140): WordTiming[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const lead = Math.min(leadMs, durationMs * 0.1);
  const tail = Math.min(tailMs, durationMs * 0.15);
  const span = Math.max(1, durationMs - lead - tail);
  const weights = tokens.map((t, i) => tokenWeight(t) + (i < tokens.length - 1 ? expectedPause(t.pause) / 90 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = lead;
  const out = tokens.map((tok, i) => {
    const d = (span * weights[i]!) / total;
    const pause = i < tokens.length - 1 ? ((expectedPause(tok.pause) / 90) / weights[i]!) * d : 0;
    const w = { text: tok.text, startMs: t, endMs: t + d - pause };
    t += d;
    return w;
  });
  return finalize(out, durationMs);
}

// ElevenLabs: посимвольное выравнивание → слова (пробел разделяет слова).
export function charsToWords(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): WordTiming[] {
  const words: WordTiming[] = [];
  let text = "";
  let start = -1;
  let end = 0;
  const flush = () => {
    if (text.trim()) words.push({ text, startMs: start * 1000, endMs: end * 1000 });
    text = "";
    start = -1;
  };
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) return flush();
    if (start < 0) start = a.character_start_times_seconds[i] ?? end;
    end = a.character_end_times_seconds[i] ?? end;
    text += ch;
  });
  flush();
  return words;
}

// Привязка таймингов провайдера к словам нашего текста. Слова провайдера ищутся
// в «сплошной» строке нормализованных букв — так переживаем расхождения в
// пунктуации, дефисах и регистре. Если совпало меньше 60% — возвращаем null.
export function alignToTokens(words: WordTiming[], text: string): WordTiming[] | null {
  const tokens = tokenize(text);
  if (!tokens.length || !words.length) return null;
  let S = "";
  const owner: number[] = [];
  tokens.forEach((t, i) => {
    S += t.norm;
    for (let c = 0; c < t.norm.length; c++) owner.push(i);
  });
  const spans: { startMs: number; endMs: number }[][] = tokens.map(() => []);
  let cursor = 0;
  let matched = 0;
  let considered = 0;
  for (const w of words) {
    const nw = normWord(w.text);
    if (!nw) continue;
    considered++;
    const idx = S.indexOf(nw, cursor);
    if (idx < 0 || idx - cursor > Math.max(24, nw.length * 3)) continue;
    matched++;
    const a = owner[idx]!;
    const b = owner[idx + nw.length - 1]!;
    if (a === b) spans[a]!.push({ startMs: w.startMs, endMs: w.endMs });
    else {
      // Слово провайдера накрыло несколько наших — делим его время по весам.
      const part = spread(tokens.slice(a, b + 1), w.startMs, w.endMs);
      part.forEach((p, i) => spans[a + i]!.push(p));
    }
    cursor = idx + nw.length;
  }
  if (!considered || matched / considered < 0.6) return null;

  const out: (WordTiming | null)[] = tokens.map((t, i) => {
    const s = spans[i]!;
    if (!s.length) return null;
    return { text: t.text, startMs: Math.min(...s.map((x) => x.startMs)), endMs: Math.max(...s.map((x) => x.endMs)) };
  });
  // Слова без таймингов (провайдер их «проглотил») — в промежуток между соседями.
  for (let i = 0; i < out.length; ) {
    if (out[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !out[j]) j++;
    const from = i > 0 ? out[i - 1]!.endMs : Math.max(0, (out[j]?.startMs ?? 0) - 300);
    const to = j < out.length ? out[j]!.startMs : from + 300 * (j - i);
    const part = spread(tokens.slice(i, j), from, Math.max(from + (j - i) * 60, to));
    for (let k = i; k < j; k++) out[k] = { text: tokens[k]!.text, ...part[k - i]! };
    i = j;
  }
  return out as WordTiming[];
}

const MIN_WORD_MS = 40;

// Гарантии для композиции: целые мс, монотонно, без наложений, внутри длительности.
export function finalize(words: WordTiming[], durationMs: number): WordTiming[] {
  const out: WordTiming[] = [];
  let prevEnd = 0;
  for (const w of words) {
    const startMs = Math.max(prevEnd, Number.isFinite(w.startMs) ? w.startMs : prevEnd);
    const endMs = Math.max(startMs + MIN_WORD_MS, Number.isFinite(w.endMs) ? w.endMs : startMs);
    out.push({ text: w.text, startMs, endMs });
    prevEnd = endMs;
  }
  const last = out.at(-1)?.endMs ?? 0;
  const limit = Math.max(1, durationMs);
  const k = last > limit ? limit / last : 1;
  let prev = 0;
  return out.map((w) => {
    const startMs = Math.max(prev, Math.round(w.startMs * k));
    const endMs = Math.max(startMs + 1, Math.round(w.endMs * k));
    prev = endMs;
    return { text: w.text, startMs, endMs };
  });
}
