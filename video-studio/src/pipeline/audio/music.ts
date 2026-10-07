// Генеративная фоновая музыка: спокойный эмбиент-пэд, который не спорит с
// голосом. Аккорды с плавным голосоведением, пилы с расстройкой через мягкий
// ФНЧ, хорус, FDN-реверберация, тихий бас; для бодрых настроений — лёгкая
// «пульсация» и арпеджио. Без барабанов и мелодий: фон должен быть незаметным.
// Всё детерминировано зерном (seed) — повторный запуск даёт тот же трек.

import { OnePole, Svf, applyFades, hashString, limitPeaks, makeRng, normalizeLoudness, smoothstep } from "./dsp";
import type { PcmAudio } from "./wav";

export type MusicMood = "calm" | "inspiring" | "upbeat" | "tech" | "dark";
export const MUSIC_MOODS: MusicMood[] = ["calm", "inspiring", "upbeat", "tech", "dark"];

// Синонимы — LLM/автор может написать настроение как угодно, по-русски или по-английски.
const MOOD_WORDS: Record<MusicMood, string[]> = {
  calm: ["calm", "chill", "relax", "ambient", "lofi", "soft", "peace", "спокой", "расслаб", "мягк", "тих", "уют", "нейтрал"],
  inspiring: ["inspir", "motiv", "hope", "uplift", "warm", "вдохнов", "мотив", "надежд", "тепл", "светл"],
  upbeat: ["upbeat", "energ", "happy", "fun", "positive", "drive", "бодр", "энерг", "весел", "позитив", "драйв", "радост"],
  tech: ["tech", "science", "future", "space", "digital", "innov", "научн", "наук", "технол", "будущ", "космос", "цифр"],
  dark: ["dark", "drama", "myster", "tense", "epic", "sad", "suspense", "мрач", "драм", "тайн", "загад", "тревож", "грус", "эпич"],
};

export function resolveMood(mood: string | undefined, seed: string): MusicMood {
  const m = (mood ?? "").toLowerCase();
  if (m) {
    for (const key of MUSIC_MOODS) if (MOOD_WORDS[key].some((w) => m.includes(w))) return key;
  }
  // Настроение не задано — выбираем из «безопасных» по зерну, чтобы ролики канала не звучали одинаково.
  const safe: MusicMood[] = ["calm", "inspiring", "tech"];
  return safe[hashString(`mood:${seed}`) % safe.length]!;
}

export function moodMatches(mood: MusicMood, tags: string[]): boolean {
  return tags.some((t) => {
    const s = t.toLowerCase();
    return s === mood || MOOD_WORDS[mood].some((w) => s.includes(w));
  });
}

interface Chord {
  root: number; // ступень от тоники, полутоны
  tones: number[]; // звуки аккорда относительно тоники (pitch class)
}

interface Preset {
  bpm: number;
  beatsPerChord: number;
  progA: Chord[];
  progB: Chord[];
  cutoff: number; // базовая частота ФНЧ пэда
  bellsEvery: number; // средний интервал «колокольчиков», с (0 — нет)
  arp: boolean; // тихое арпеджио восьмыми
  pulse: number; // глубина «дыхания» пэда в долю (0 — нет)
  subPulse: boolean; // мягкий саб на каждую долю
  minor: boolean;
}

// Аккорды мажора/минора от тоники. Терции и септимы — основа «современного» звучания.
const c = (root: number, ...tones: number[]): Chord => ({ root, tones: tones.map((t) => ((t % 12) + 12) % 12) });
const MAJ = {
  Imaj9: c(0, 0, 4, 7, 11, 2),
  Iadd9: c(0, 0, 4, 7, 2),
  ii9: c(2, 2, 5, 9, 0, 4),
  iii7: c(4, 4, 7, 11, 2),
  IVmaj7: c(5, 5, 9, 0, 4),
  IVadd9: c(5, 5, 9, 0, 7),
  Vsus: c(7, 7, 0, 2, 5),
  Vadd9: c(7, 7, 11, 2, 9),
  vi9: c(9, 9, 0, 4, 7, 11),
};
const MIN = {
  i9: c(0, 0, 3, 7, 10, 2),
  iadd9: c(0, 0, 3, 7, 2),
  iv9: c(5, 5, 8, 0, 3, 7),
  VImaj7: c(8, 8, 0, 3, 7),
  IIImaj7: c(3, 3, 7, 10, 2),
  VIIadd9: c(10, 10, 2, 5, 0),
  Vsus: c(7, 7, 0, 2),
};

const PRESETS: Record<MusicMood, Preset> = {
  calm: {
    bpm: 64, beatsPerChord: 8, cutoff: 1350, bellsEvery: 5.5, arp: false, pulse: 0, subPulse: false, minor: false,
    progA: [MAJ.Imaj9, MAJ.vi9, MAJ.IVmaj7, MAJ.Vsus],
    progB: [MAJ.ii9, MAJ.IVmaj7, MAJ.vi9, MAJ.Vsus],
  },
  inspiring: {
    bpm: 84, beatsPerChord: 8, cutoff: 1800, bellsEvery: 4, arp: false, pulse: 0.14, subPulse: false, minor: false,
    progA: [MAJ.IVadd9, MAJ.Iadd9, MAJ.Vadd9, MAJ.vi9],
    progB: [MAJ.vi9, MAJ.IVmaj7, MAJ.Iadd9, MAJ.Vsus],
  },
  upbeat: {
    bpm: 104, beatsPerChord: 8, cutoff: 2100, bellsEvery: 0, arp: true, pulse: 0.3, subPulse: true, minor: false,
    progA: [MAJ.Iadd9, MAJ.Vadd9, MAJ.vi9, MAJ.IVmaj7],
    progB: [MAJ.IVmaj7, MAJ.Vadd9, MAJ.iii7, MAJ.vi9],
  },
  tech: {
    bpm: 92, beatsPerChord: 8, cutoff: 1600, bellsEvery: 0, arp: true, pulse: 0, subPulse: false, minor: true,
    progA: [MIN.i9, MIN.VImaj7, MIN.IIImaj7, MIN.VIIadd9],
    progB: [MIN.iv9, MIN.VImaj7, MIN.i9, MIN.VIIadd9],
  },
  dark: {
    bpm: 60, beatsPerChord: 8, cutoff: 950, bellsEvery: 9, arp: false, pulse: 0, subPulse: false, minor: true,
    progA: [MIN.iadd9, MIN.VImaj7, MIN.iv9, MIN.Vsus],
    progB: [MIN.iadd9, MIN.IIImaj7, MIN.VImaj7, MIN.Vsus],
  },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Голосоведение: из всех вариантов 4 звуков аккорда в диапазоне пэда берём
// ближайший к предыдущему, избегая малых секунд (дают «грязь»).
function voiceChord(tonic: number, chord: Chord, prev: number[] | null): number[] {
  const low = 52;
  const high = 76;
  const cands: number[] = [];
  for (let m = low; m <= high; m++) if (chord.tones.includes((((m - tonic) % 12) + 12) % 12)) cands.push(m);
  const third = chord.tones[1]!;
  const target = prev ?? [57, 62, 66, 69];
  let best: number[] = cands.slice(0, 4);
  let bestCost = Infinity;
  const n = cands.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let d = b + 1; d < n; d++)
        for (let e = d + 1; e < n; e++) {
          const v = [cands[a]!, cands[b]!, cands[d]!, cands[e]!];
          const pcs = new Set(v.map((m) => (((m - tonic) % 12) + 12) % 12));
          if (!pcs.has(third)) continue; // без терции аккорд звучит пусто
          if (pcs.size < 3) continue;
          let cost = 0;
          for (let i = 0; i < 4; i++) cost += Math.abs(v[i]! - target[i]!);
          for (let i = 1; i < 4; i++) {
            const iv = v[i]! - v[i - 1]!;
            if (iv === 1) cost += 12;
            if (iv > 9) cost += 3; // слишком широкие дыры
          }
          if (cost < bestCost) {
            bestCost = cost;
            best = v;
          }
        }
  return best;
}

const polyBlep = (t: number, dt: number): number => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

// Огибающая ноты пэда: медленная атака, удержание, медленное затухание.
function padEnv(t: number, len: number, attack: number, release: number): number {
  if (t < 0) return 0;
  if (t < attack) return smoothstep(t / attack);
  if (t < len) return 1;
  const r = t - len;
  return r < release ? 1 - smoothstep(r / release) : 0;
}

export interface AmbientOptions {
  durationMs: number;
  mood?: string;
  seed: string;
  sampleRate?: number;
}

export function synthAmbient(opts: AmbientOptions): { audio: PcmAudio; mood: MusicMood } {
  const sr = opts.sampleRate ?? 44100;
  const mood = resolveMood(opts.mood, opts.seed);
  const p = PRESETS[mood];
  const rnd = makeRng(hashString(`music:${opts.seed}:${mood}`));
  const n = Math.max(1, Math.round((opts.durationMs / 1000) * sr));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const aux = [new Float32Array(n), new Float32Array(n)] as const; // колокольчики/арпеджио → через дилэй
  const bass = new Float32Array(n);

  // Тональность — по зерну; диапазон тоник подобран так, чтобы пэд не уходил в «бубнёж».
  const tonics = p.minor ? [57, 52, 55, 50, 53] : [50, 52, 53, 55, 57, 48];
  const tonic = tonics[Math.floor(rnd() * tonics.length)]!;
  const beat = 60 / p.bpm;
  const chordSec = beat * p.beatsPerChord;
  const totalSec = n / sr;

  // ---- Пэд и бас: аккорд за аккордом, ноты пишутся сразу в буферы ----
  const order = ["A", "A", "B", "A"];
  let prev: number[] | null = null;
  const attack = Math.min(2.2, chordSec * 0.35);
  const release = Math.min(3.2, chordSec * 0.5);
  const chordsTimeline: { start: number; voicing: number[]; chord: Chord }[] = [];
  for (let k = 0, t0 = 0; t0 < totalSec; k++, t0 += chordSec) {
    const prog = order[Math.floor(k / 4) % order.length] === "A" ? p.progA : p.progB;
    const chord = prog[k % 4]!;
    const voicing: number[] = voiceChord(tonic, chord, prev);
    prev = voicing;
    chordsTimeline.push({ start: t0, voicing, chord });
    // Первый аккорд звучит сразу (фейд-ин всё равно сделает мастер).
    const att = k === 0 ? 0.05 : attack;
    voicing.forEach((midi, vi) => {
      const pan = vi % 2 === 0 ? -0.35 : 0.35;
      addPadNote(L, R, sr, t0, chordSec, att, release, midi, pan, 0.16, rnd);
    });
    // Бас — тоника аккорда во второй октаве.
    let bassMidi = tonic - 12 + chord.root;
    while (bassMidi > 47) bassMidi -= 12;
    while (bassMidi < 36) bassMidi += 12;
    addBassNote(bass, sr, t0, chordSec, att, release, bassMidi, p.subPulse ? beat : 0);
  }

  // ---- Фильтр пэда с медленным «дыханием» яркости ----
  const lfoRate = 1 / (14 + rnd() * 8);
  const lfoPhase = rnd() * Math.PI * 2;
  for (const [ch, offset] of [[L, 0], [R, 0.7]] as const) {
    const f1 = new Svf(sr);
    const f2 = new Svf(sr);
    for (let i = 0; i < n; i++) {
      if ((i & 31) === 0) {
        const t = i / sr;
        const fc = p.cutoff * (1 + 0.32 * Math.sin(2 * Math.PI * lfoRate * t + lfoPhase + offset));
        f1.set(fc, 0.54); // 4-й порядок Баттерворта: два звена с Q 0.54 и 1.31
        f2.set(fc, 1.31);
      }
      f1.process(ch[i]!);
      f2.process(f1.lp);
      ch[i] = f2.lp;
    }
  }

  // ---- «Дыхание» под долю (sidechain без бочки) ----
  if (p.pulse > 0) {
    for (let i = 0; i < n; i++) {
      const ph = ((i / sr) / beat) % 1;
      const a = 0.03;
      const shape = ph < a ? smoothstep(ph / a) : ph < 0.55 ? 1 - smoothstep((ph - a) / (0.55 - a)) : 0;
      const g = 1 - p.pulse * shape;
      L[i]! *= g;
      R[i]! *= g;
    }
  }

  // ---- Хорус: две модулируемые задержки — ширина стерео без фазовой каши ----
  chorus(L, sr, 0.012, 0.0025, 0.21, 0.32);
  chorus(R, sr, 0.0145, 0.0025, 0.29, 0.32);

  // ---- Колокольчики и арпеджио ----
  if (p.bellsEvery > 0) {
    let t = 1.5 + rnd() * p.bellsEvery;
    while (t < totalSec - 2) {
      const ch = chordsTimeline[Math.min(chordsTimeline.length - 1, Math.floor(t / chordSec))]!;
      const tone = ch.chord.tones[Math.floor(rnd() * ch.chord.tones.length)]!;
      let midi = tonic + tone + 24;
      while (midi > 88) midi -= 12;
      addPluck(aux, sr, t, midi, -0.6 + rnd() * 1.2, 0.05, 1.1);
      t += p.bellsEvery * (0.6 + rnd() * 0.8);
    }
  }
  if (p.arp) {
    const step = beat / 2;
    const pattern = [0, 1, 2, 3, 2, 1, 3, 2];
    let k = 0;
    for (let t = chordSec * 0.5; t < totalSec - 1.5; t += step, k++) {
      const ch = chordsTimeline[Math.min(chordsTimeline.length - 1, Math.floor(t / chordSec))]!;
      const v = [...ch.voicing].sort((a, b) => a - b);
      const midi = v[pattern[k % pattern.length]! % v.length]! + 12;
      // Лёгкая «человечность»: акценты на сильных долях, случайная громкость.
      const vel = (k % 4 === 0 ? 0.03 : 0.02) * (0.8 + rnd() * 0.4);
      addPluck(aux, sr, t, midi, k % 2 === 0 ? -0.3 : 0.3, vel, 0.32);
    }
  }
  // Пинг-понг дилэй на пунктирную восьмую — колокольчики «растекаются» по стерео.
  pingPong(aux[0], aux[1], sr, beat * 0.75, 0.38);

  // ---- Сведение и реверберация ----
  const verb = new Fdn(sr, 3.8 + (mood === "dark" ? 1.2 : 0), 5200);
  const hpL = new OnePole(38, sr);
  const hpR = new OnePole(38, sr);
  const wet = mood === "dark" ? 0.42 : 0.34;
  const out: [number, number] = [0, 0];
  for (let i = 0; i < n; i++) {
    const padL = L[i]!;
    const padR = R[i]!;
    const b = bass[i]!;
    const xL = padL + aux[0][i]! + b * 0.9;
    const xR = padR + aux[1][i]! + b * 0.9;
    verb.process((padL + padR) * 0.5 + (aux[0][i]! + aux[1][i]!) * 0.6 + b * 0.05, out);
    L[i] = hpL.hp(xL * (1 - wet * 0.5) + out[0] * wet);
    R[i] = hpR.hp(xR * (1 - wet * 0.5) + out[1] * wet);
  }

  // ---- Мастеринг: тихо и без клиппинга ----
  // RMS ≈ −19 dBFS (≈ −17 LUFS), пик ≤ −2 dBFS: тише коммерческих треков
  // (обычно −9…−14 LUFS), громкость в ролике всё равно задаёт music.volume.
  normalizeLoudness([L, R], sr, { targetRmsDb: -19, ceilingDb: -2 });
  applyFades(L, sr, 2000, 2500);
  applyFades(R, sr, 2000, 2500);
  limitPeaks([L, R], sr, Math.pow(10, -2 / 20) * 0.995);
  return { audio: { sampleRate: sr, channels: [L, R] }, mood };
}

function addPadNote(
  L: Float32Array, R: Float32Array, sr: number, startSec: number, lenSec: number,
  attack: number, release: number, midi: number, pan: number, amp: number, rnd: () => number,
): void {
  const start = Math.round(startSec * sr);
  const end = Math.min(L.length, Math.round((startSec + lenSec + release) * sr));
  const f = mtof(midi);
  // Две пилы с расстройкой ±6 центов + синус на основном тоне — тёплая «плёнка».
  const det = Math.pow(2, 6 / 1200);
  const incA = f / det / sr;
  const incB = (f * det) / sr;
  const incS = f / sr;
  let pa = rnd();
  let pb = rnd();
  let ps = rnd();
  // Медленный дрейф высоты ±2 цента — «аналоговость», чтобы пэд не звучал стерильно.
  const driftRate = 0.1 + rnd() * 0.15;
  const driftPhase = rnd() * Math.PI * 2;
  const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
  let drift = 1;
  for (let i = Math.max(0, start); i < end; i++) {
    const t = (i - start) / sr;
    if ((i & 63) === 0) drift = Math.pow(2, (2 * Math.sin(2 * Math.PI * driftRate * t + driftPhase)) / 1200);
    const env = padEnv(t, lenSec, attack, release);
    if (env <= 0 && t > lenSec) break;
    const ia = incA * drift;
    const ib = incB * drift;
    pa += ia;
    if (pa >= 1) pa -= 1;
    pb += ib;
    if (pb >= 1) pb -= 1;
    ps += incS;
    if (ps >= 1) ps -= 1;
    const sawA = 2 * pa - 1 - polyBlep(pa, ia);
    const sawB = 2 * pb - 1 - polyBlep(pb, ib);
    const sine = Math.sin(2 * Math.PI * ps);
    // Левому каналу чуть больше одной пилы, правому — другой: естественная ширина.
    const vL = sawA * 0.42 + sawB * 0.28 + sine * 0.5;
    const vR = sawA * 0.28 + sawB * 0.42 + sine * 0.5;
    L[i]! += vL * env * gl;
    R[i]! += vR * env * gr;
  }
}

function addBassNote(
  out: Float32Array, sr: number, startSec: number, lenSec: number,
  attack: number, release: number, midi: number, pulseBeat: number,
): void {
  const start = Math.round(startSec * sr);
  const end = Math.min(out.length, Math.round((startSec + lenSec + release) * sr));
  const inc = mtof(midi) / sr;
  let ph = 0;
  for (let i = Math.max(0, start); i < end; i++) {
    const t = (i - start) / sr;
    let env = padEnv(t, lenSec, attack, release);
    if (pulseBeat > 0) {
      // Мягкий саб-пульс на каждую долю: атака 15 мс, спад ~0.3 с, без щелчков.
      const bt = (t % pulseBeat) / pulseBeat;
      const sec = bt * pulseBeat;
      const pulse = sec < 0.015 ? smoothstep(sec / 0.015) : Math.exp(-(sec - 0.015) / 0.28);
      env *= 0.35 + 0.65 * pulse;
    }
    ph += inc;
    if (ph >= 1) ph -= 1;
    const s = Math.sin(2 * Math.PI * ph) + 0.18 * Math.sin(4 * Math.PI * ph);
    out[i]! += s * env * 0.085;
  }
}

// Короткая «колокольная» нота: синус + обертоны с быстрым затуханием.
function addPluck(out: readonly [Float32Array, Float32Array], sr: number, startSec: number, midi: number, pan: number, amp: number, decaySec: number): void {
  const start = Math.round(startSec * sr);
  const len = Math.round((decaySec * 6 + 0.05) * sr);
  const f = mtof(midi);
  const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
  const [L, R] = out;
  for (let k = 0; k < len; k++) {
    const i = start + k;
    if (i >= L.length) break;
    const t = k / sr;
    const env = (t < 0.008 ? smoothstep(t / 0.008) : 1) * Math.exp(-t / decaySec);
    const w = 2 * Math.PI * f * t;
    const s = Math.sin(w) + 0.22 * Math.sin(2 * w) * Math.exp(-t / (decaySec * 0.4)) + 0.06 * Math.sin(3 * w) * Math.exp(-t / (decaySec * 0.2));
    L[i]! += s * env * gl;
    R[i]! += s * env * gr;
  }
}

function chorus(ch: Float32Array, sr: number, baseSec: number, depthSec: number, rate: number, mix: number): void {
  const maxD = Math.ceil((baseSec + depthSec) * sr) + 2;
  const buf = new Float32Array(maxD + 1);
  let w = 0;
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i]!;
    buf[w] = x;
    const d = (baseSec + depthSec * Math.sin((2 * Math.PI * rate * i) / sr)) * sr;
    let r = w - d;
    if (r < 0) r += buf.length;
    const i0 = Math.floor(r);
    const frac = r - i0;
    const a = buf[i0 % buf.length]!;
    const b = buf[(i0 + 1) % buf.length]!;
    ch[i] = x * (1 - mix * 0.5) + (a + (b - a) * frac) * mix;
    w = (w + 1) % buf.length;
  }
}

function pingPong(L: Float32Array, R: Float32Array, sr: number, delaySec: number, feedback: number): void {
  const d = Math.max(1, Math.round(delaySec * sr));
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const dampL = new OnePole(3500, sr);
  const dampR = new OnePole(3500, sr);
  let w = 0;
  for (let i = 0; i < L.length; i++) {
    const outL = bl[w]!;
    const outR = br[w]!;
    // Перекрёстная обратная связь: эхо прыгает L → R → L.
    bl[w] = dampL.lp((L[i]! + R[i]!) * 0.5 + outR * feedback);
    br[w] = dampR.lp(outL * feedback);
    L[i]! += outL * 0.5;
    R[i]! += outR * 0.5;
    w = (w + 1) % d;
  }
}

// Реверберация FDN: 8 линий задержки, ортогональное смешивание Адамара
// (без потерь энергии → устойчиво), затухание по T60 и демпфирование ВЧ.
class Fdn {
  private lines: Float32Array[];
  private idx: number[];
  private gains: number[];
  private damp: OnePole[];
  private pre: Float32Array;
  private preIdx = 0;
  private v = new Float64Array(8);
  constructor(sr: number, t60: number, dampHz: number) {
    const base = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2797];
    const scale = sr / 44100;
    this.lines = base.map((l) => new Float32Array(Math.round(l * scale * 1.3)));
    this.idx = base.map(() => 0);
    this.gains = this.lines.map((l) => Math.pow(10, (-3 * l.length) / (t60 * sr)));
    this.damp = base.map(() => new OnePole(dampHz, sr));
    this.pre = new Float32Array(Math.round(0.022 * sr)); // пре-дилэй 22 мс
  }
  process(x: number, out: [number, number]): void {
    const pre = this.pre[this.preIdx]!;
    this.pre[this.preIdx] = x;
    this.preIdx = (this.preIdx + 1) % this.pre.length;
    const v = this.v;
    for (let k = 0; k < 8; k++) v[k] = this.lines[k]![this.idx[k]!]!;
    out[0] = (v[0]! - v[2]! + v[4]! - v[6]!) * 0.35;
    out[1] = (v[1]! - v[3]! + v[5]! - v[7]!) * 0.35;
    // Быстрое преобразование Адамара 8×8 (три ступени «бабочек»).
    for (let h = 1; h < 8; h <<= 1) {
      for (let i = 0; i < 8; i += h << 1) {
        for (let j = i; j < i + h; j++) {
          const a = v[j]!;
          const b = v[j + h]!;
          v[j] = a + b;
          v[j + h] = a - b;
        }
      }
    }
    const norm = 1 / Math.sqrt(8);
    for (let k = 0; k < 8; k++) {
      const line = this.lines[k]!;
      const fb = this.damp[k]!.lp(v[k]! * norm * this.gains[k]!);
      line[this.idx[k]!] = fb + pre * 0.25;
      this.idx[k] = (this.idx[k]! + 1) % line.length;
    }
  }
}
