// Короткие звуки монтажа — синтез на месте, как и «вжух» (whoosh.ts): без
// скачиваний и лицензий, детерминированно (один и тот же файл при каждом запуске).
//   pop    — мягкий «пузырёк»: появился пункт списка, столбик сравнения, метка на карте;
//   impact — глухой удар на раскрытие крупной цифры: энергия в низах (≈ 40–120 Гц)
//            и коротком хлопке, поэтому он не спорит с голосом (300–3000 Гц);
//   rise   — тихое нарастание к удару, пока докручивается счётчик;
//   sting  — «искра» бренд-заставки: четыре колокольчика вразбивку, ≤ 0,5 с.
// Пики нормируются к −6 dBFS — громкость в ролике задают sfxVolume и
// множители в AudioLayer (звуки под голосом заметно тише свиста переходов).

import { OnePole, Svf, applyFades, dbToGain, levelStats, makeRng } from "./dsp";
import type { PcmAudio } from "./wav";

function normalizePeak(channels: Float32Array[], db = -6): void {
  const { peak } = levelStats(channels);
  if (!(peak > 0)) return;
  const g = dbToGain(db) / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= g;
}

const seconds = (sec: number, sampleRate: number) => Math.max(1, Math.round(sec * sampleRate));

export function synthPop(sampleRate = 44100, opts: { seed?: number; pitch?: number } = {}): PcmAudio {
  const n = seconds(0.12, sampleRate);
  const rnd = makeRng(opts.seed ?? 0x9091);
  const k = opts.pitch ?? 1;
  const out = new Float32Array(n);
  const lp = new OnePole(5000, sampleRate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Частота «пузырька» взлетает 480 → 1150 Гц за первые ~15 мс.
    const f = (480 + 670 * (1 - Math.exp(-t / 0.005))) * k;
    phase += (2 * Math.PI * f) / sampleRate;
    const env = Math.min(1, t / 0.0015) * Math.exp(-t / 0.026);
    const tone = Math.sin(phase) + 0.16 * Math.sin(2 * phase);
    // Щелчок — 3 мс приглушённого шума в самом начале: «касание» пальцем.
    const click = t < 0.003 ? lp.lp(rnd() * 2 - 1) * (1 - t / 0.003) * 0.5 : 0;
    out[i] = tone * env + click;
  }
  applyFades(out, sampleRate, 0.3, 20);
  const channels = [out, Float32Array.from(out)];
  normalizePeak(channels);
  return { sampleRate, channels };
}

export function synthImpact(sampleRate = 44100, opts: { seed?: number } = {}): PcmAudio {
  const n = seconds(0.9, sampleRate);
  const rnd = makeRng(opts.seed ?? 0x1a7c);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const body = new Svf(sampleRate);
  const airL = new Svf(sampleRate);
  const airR = new Svf(sampleRate);
  airL.set(2600, 0.7);
  airR.set(3100, 0.7);
  const dc = [new OnePole(25, sampleRate), new OnePole(25, sampleRate)];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // «Тело» удара: синус, падающий 120 → 42 Гц.
    const f = 42 + 78 * Math.exp(-t / 0.05);
    phase += (2 * Math.PI * f) / sampleRate;
    const thump = Math.sin(phase) * Math.min(1, t / 0.002) * Math.exp(-t / 0.2);
    // Хлопок: шум через ФНЧ, срез падает 1500 → 150 Гц.
    if ((i & 15) === 0) body.set(150 + 1350 * Math.exp(-t / 0.04), 0.9);
    body.process(rnd() * 2 - 1);
    const crack = body.lp * Math.exp(-t / 0.05) * 0.8;
    // Хвост «воздуха»: тихий шум, разный в каналах, — ощущение пространства.
    airL.process(rnd() * 2 - 1);
    airR.process(rnd() * 2 - 1);
    const tail = Math.exp(-t / 0.22) * 0.06;
    left[i] = dc[0]!.hp(thump + crack + airL.bp * tail);
    right[i] = dc[1]!.hp(thump + crack + airR.bp * tail);
  }
  applyFades(left, sampleRate, 0.3, 80);
  applyFades(right, sampleRate, 0.3, 80);
  const channels = [left, right];
  normalizePeak(channels);
  return { sampleRate, channels };
}

export function synthRise(sampleRate = 44100, opts: { durationMs?: number; seed?: number } = {}): PcmAudio {
  const n = seconds((opts.durationMs ?? 1200) / 1000, sampleRate);
  const rnd = makeRng(opts.seed ?? 0x415e);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const bpL = new Svf(sampleRate);
  const bpR = new Svf(sampleRate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n; // 0..1
    // Полоса шума ускоряясь уходит вверх 400 → 4500 Гц, под ней — тон 180 → 720 Гц.
    const fc = 400 * Math.pow(4500 / 400, x * x);
    if ((i & 15) === 0) {
      bpL.set(fc * 0.95, 2.2);
      bpR.set(fc * 1.05, 2.2);
    }
    bpL.process(rnd() * 2 - 1);
    bpR.process(rnd() * 2 - 1);
    phase += (2 * Math.PI * 180 * Math.pow(4, x)) / sampleRate;
    const env = Math.pow(x, 2.2);
    const tone = Math.sin(phase) * 0.1;
    left[i] = (bpL.bp + tone) * env;
    right[i] = (bpR.bp + tone) * env;
  }
  // Конец обрывается коротким фейдом — дальше вступает удар.
  applyFades(left, sampleRate, 5, 12);
  applyFades(right, sampleRate, 5, 12);
  const channels = [left, right];
  normalizePeak(channels);
  return { sampleRate, channels };
}

export function synthSting(sampleRate = 44100): PcmAudio {
  const n = seconds(0.62, sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  // Соль-до-ми-соль (G5 C6 E6 G6) вразбивку слева направо.
  const notes = [
    { f: 783.99, at: 0, pan: -0.5 },
    { f: 1046.5, at: 0.045, pan: -0.15 },
    { f: 1318.51, at: 0.09, pan: 0.2 },
    { f: 1567.98, at: 0.135, pan: 0.5 },
  ];
  for (const note of notes) {
    const start = Math.round(note.at * sampleRate);
    const angle = ((note.pan + 1) * Math.PI) / 4;
    const gl = Math.cos(angle);
    const gr = Math.sin(angle);
    for (let i = start; i < n; i++) {
      const t = (i - start) / sampleRate;
      const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.15);
      // Колокольчик: основной тон + быстро гаснущий негармоничный обертон ×2,76.
      const v = (Math.sin(2 * Math.PI * note.f * t) + 0.3 * Math.sin(2 * Math.PI * note.f * 2.76 * t) * Math.exp(-t / 0.05)) * env;
      left[i]! += v * gl;
      right[i]! += v * gr;
    }
  }
  applyFades(left, sampleRate, 0.3, 120);
  applyFades(right, sampleRate, 0.3, 120);
  const channels = [left, right];
  normalizePeak(channels);
  return { sampleRate, channels };
}
