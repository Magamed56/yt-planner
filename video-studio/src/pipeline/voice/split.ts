// Нарезка одного общего звука на сцены. Нужна Gemini TTS: бесплатная квота
// считает ЗАПРОСЫ (≈10 в сутки на модель), поэтому весь ролик озвучиваем
// одним запросом с абзацами-сценами и режем по паузам между ними.
//
// Пауза между сценами не всегда длиннее паузы между предложениями, поэтому
// выравниваем ВСЕ концы предложений: для каждого — ожидаемое время (доля
// «произносимого веса» от длины речи), затем динамическим программированием
// монотонно сопоставляем их с паузами (длинная и близкая — лучше). Концы
// сцен обязаны получить паузу (или самую тихую точку рядом), концы
// предложений внутри сцены — могут остаться без неё. Не вышло — null, и
// вызывающий код озвучит сцены по одной (дороже, но надёжно).

import type { PcmAudio } from "../audio/wav";
import { toMono } from "../audio/wav";
import { analyzeSpeech, type SpeechProfile } from "./timing";

const MIN_GAP_MS = 300; // соседние разрезы не ближе
const DIST_PENALTY = 0.4; // мс длины паузы за мс расстояния от ожидаемого места
const MAX_PAUSE_CREDIT_MS = 1200; // очень длинная пауза не должна «перетягивать» далёкие границы

// «Произносимый вес» текста: гласные (слоги) + цифры, которые читаются длинно.
export function spokenWeight(text: string): number {
  const vowels = text.match(/[аеёиоуыэюяaeiouy]/giu)?.length ?? 0;
  const digits = text.match(/\d/g)?.length ?? 0;
  return Math.max(1, vowels + digits * 2);
}

// Предложения сцены (по . ! ? …); без знаков — вся сцена одним куском.
function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])\s+/u).filter((p) => p.trim());
  return parts.length ? parts : [text];
}

interface Boundary {
  expected: number;
  window: number;
  sceneEnd: boolean;
}

interface Candidate {
  mid: number;
  len: number;
}

export function findSplitPoints(audio: PcmAudio, texts: string[]): number[] | null {
  if (texts.length < 2) return [];
  const prof = analyzeSpeech(toMono(audio), audio.sampleRate);
  if (!prof.hasSpeech) return null;
  const span = prof.speechEndMs - prof.speechStartMs;

  // Концы предложений с ожидаемым временем; последний конец ролика не нужен.
  const units: { w: number; sceneEnd: boolean }[] = [];
  for (const t of texts) {
    const ss = sentences(t);
    ss.forEach((s, i) => units.push({ w: spokenWeight(s), sceneEnd: i === ss.length - 1 }));
  }
  const total = units.reduce((a, u) => a + u.w, 0);
  // Паузы между предложениями тоже занимают время: без этой поправки сцена из
  // нескольких коротких фраз «растягивается» и граница уезжает на предложение.
  // Длительность пауз берём по K самым длинным паузам звука (K — число границ).
  const K = units.length - 1;
  const pauseTotal = prof.pauses.map((p) => p.endMs - p.startMs).sort((a, b) => b - a).slice(0, K).reduce((a, b) => a + b, 0);
  const speechOnly = Math.max(span * 0.5, span - pauseTotal);
  const pauseEach = K ? (span - speechOnly) / K : 0;
  const bounds: Boundary[] = [];
  let acc = 0;
  for (let i = 0; i < K; i++) {
    acc += units[i]!.w;
    const near = (Math.min(units[i]!.w, units[i + 1]!.w) / total) * speechOnly;
    bounds.push({
      expected: prof.speechStartMs + (speechOnly * acc) / total + (i + 0.5) * pauseEach,
      // Ошибка оценки копится к середине ролика — окно шире для длинных ролей.
      window: Math.max(1000, 0.6 * near, 0.06 * span),
      sceneEnd: units[i]!.sceneEnd,
    });
  }

  const cands: Candidate[] = prof.pauses.map((p) => ({ mid: (p.startMs + p.endMs) / 2, len: p.endMs - p.startMs }));
  // Для обязательных границ — запасной кандидат: самая тихая точка рядом.
  for (const b of bounds) if (b.sceneEnd) {
    const q = quietestPoint(prof, b.expected, Math.min(b.window, 700));
    if (q !== null) cands.push({ mid: q, len: 0 });
  }
  cands.sort((a, b) => a.mid - b.mid);

  const assigned = align(bounds, cands);
  if (!assigned) return null;
  const cuts = bounds.flatMap((b, k) => (b.sceneEnd ? [cands[assigned[k]!]!.mid] : []));

  // Проверка здравого смысла: длина каждой части сопоставима с ожидаемой.
  const edges = [prof.speechStartMs, ...cuts, prof.speechEndMs];
  const sceneW = texts.map(spokenWeight);
  const sceneTotal = sceneW.reduce((a, b) => a + b, 0);
  for (let i = 0; i < texts.length; i++) {
    const got = edges[i + 1]! - edges[i]!;
    const exp = (span * sceneW[i]!) / sceneTotal;
    if (got < Math.max(250, exp * 0.4) || got > exp * 2.5 + 600) return null;
  }
  return cuts;
}

// Монотонное сопоставление границ с кандидатами: максимум суммы
// (длина паузы − штраф за расстояние). Возвращает индекс кандидата для
// каждой границы (-1 — внутри сцены паузы нет) или null.
function align(bounds: Boundary[], cands: Candidate[]): number[] | null {
  const K = bounds.length;
  const P = cands.length;
  const NEG = -Infinity;
  // f[j] — лучший счёт после текущей границы, если последний занятый кандидат — j (P — «ещё никого»).
  let f = new Float64Array(P + 1).fill(NEG);
  f[P] = 0;
  const choice: Int32Array[] = []; // для границы k и последнего j: откуда пришли (-2 — пропуск)
  const prevOf: Int32Array[] = [];
  for (let k = 0; k < K; k++) {
    const b = bounds[k]!;
    const g = new Float64Array(P + 1).fill(NEG);
    const ch = new Int32Array(P + 1).fill(-3);
    const pv = new Int32Array(P + 1).fill(-1);
    if (!b.sceneEnd) {
      for (let j = 0; j <= P; j++) if (f[j]! > g[j]!) { g[j] = f[j]!; ch[j] = -2; pv[j] = j; }
    }
    // Префиксный максимум f по кандидатам левее (с зазором MIN_GAP_MS).
    let bestPrev = f[P]!;
    let bestPrevIdx = P;
    let i = 0;
    for (let j = 0; j < P; j++) {
      const c = cands[j]!;
      while (i < j && cands[i]!.mid <= c.mid - MIN_GAP_MS) {
        if (f[i]! > bestPrev) { bestPrev = f[i]!; bestPrevIdx = i; }
        i++;
      }
      const dist = Math.abs(c.mid - b.expected);
      if (dist > b.window || bestPrev === NEG) continue;
      const score = bestPrev + Math.min(c.len, MAX_PAUSE_CREDIT_MS) - DIST_PENALTY * dist;
      if (score > g[j]!) { g[j] = score; ch[j] = j; pv[j] = bestPrevIdx; }
    }
    choice.push(ch);
    prevOf.push(pv);
    f = g;
  }
  let j = -1;
  let best = NEG;
  for (let t = 0; t <= P; t++) if (f[t]! > best) { best = f[t]!; j = t; }
  if (best === NEG) return null;
  const out = new Array<number>(K).fill(-1);
  for (let k = K - 1; k >= 0; k--) {
    const c = choice[k]![j]!;
    if (c === -3) return null;
    if (c >= 0) out[k] = c;
    j = prevOf[k]![j]!;
  }
  return out;
}

function quietestPoint(prof: SpeechProfile, expected: number, window: number): number | null {
  const from = Math.max(0, Math.floor((expected - window) / prof.hopMs));
  const to = Math.min(prof.db.length - 1, Math.ceil((expected + window) / prof.hopMs));
  let best = -1;
  for (let f = from; f <= to; f++) if (best < 0 || prof.db[f]! < prof.db[best]!) best = f;
  return best < 0 ? null : best * prof.hopMs;
}

// Разрезает звук в точках (мс). Края частей — в середине пауз, поэтому
// дальнейшая обрезка тишины (postprocessVoice) срезает лишнее чисто.
export function splitAudio(audio: PcmAudio, cutsMs: number[]): PcmAudio[] {
  const sr = audio.sampleRate;
  const mono = toMono(audio);
  const idx = [0, ...cutsMs.map((ms) => Math.round((ms / 1000) * sr)), mono.length];
  const parts: PcmAudio[] = [];
  for (let i = 0; i < idx.length - 1; i++) {
    parts.push({ sampleRate: sr, channels: [mono.slice(idx[i]!, idx[i + 1]!)] });
  }
  return parts;
}
