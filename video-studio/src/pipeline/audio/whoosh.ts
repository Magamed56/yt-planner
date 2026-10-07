// Процедурный «вжух» для переходов между сценами: шум через полосовой фильтр,
// частота которого плавно уходит вверх и возвращается, мягкая огибающая и
// лёгкое движение слева направо. Всё детерминированно — один и тот же файл
// при каждом запуске, без лицензий и скачиваний.

import { OnePole, Svf, applyFades, dbToGain, levelStats, makeRng, smoothstep } from "./dsp";
import type { PcmAudio } from "./wav";

export interface WhooshOptions {
  durationMs?: number; // общая длина, по умолчанию 520 мс
  peakAt?: number; // где пик громкости, доля длины (0..1)
  seed?: number;
}

export function synthWhoosh(sampleRate = 44100, opts: WhooshOptions = {}): PcmAudio {
  const durationMs = opts.durationMs ?? 520;
  const peakAt = opts.peakAt ?? 0.45;
  const n = Math.round((durationMs / 1000) * sampleRate);
  const rnd = makeRng(opts.seed ?? 0x5eed);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  // Розовый шум (фильтр Пола Келлета) звучит мягче белого — меньше «шипения».
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const pink = () => {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };

  // Два полосовых фильтра со слегка разными частотами — в каждом канале свой,
  // это даёт объём без фазовых артефактов.
  const bpL = new Svf(sampleRate);
  const bpR = new Svf(sampleRate);
  const body = new Svf(sampleRate); // низкое «тело» воздуха
  const hpL = new OnePole(90, sampleRate);
  const hpR = new OnePole(90, sampleRate);
  const fLow = 260;
  const fHigh = 3600;

  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Свип частоты: вверх до пика, затем мягко вниз (логарифмически — так слышит ухо).
    const sweep = t < peakAt ? smoothstep(t / peakAt) : 1 - 0.55 * smoothstep((t - peakAt) / (1 - peakAt));
    const fc = fLow * Math.pow(fHigh / fLow, sweep);
    if ((i & 15) === 0) {
      bpL.set(fc * 0.94, 1.6);
      bpR.set(fc * 1.06, 1.6);
      body.set(fc * 0.35, 0.8);
    }
    // Огибающая: быстрее нарастает, дольше затухает (как пролёт мимо).
    const env = t < peakAt ? Math.pow(smoothstep(t / peakAt), 1.6) : Math.pow(1 - smoothstep((t - peakAt) / (1 - peakAt)), 2.2);
    const x = pink();
    bpL.process(x);
    bpR.process(x);
    body.process(x);
    const air = body.lp * 0.35;
    // Равномощная панорама: слева → направо.
    const pan = -0.55 + 1.1 * smoothstep(t);
    const angle = ((pan + 1) * Math.PI) / 4;
    left[i] = hpL.hp((bpL.bp + air) * env) * Math.cos(angle);
    right[i] = hpR.hp((bpR.bp + air) * env) * Math.sin(angle);
  }

  applyFades(left, sampleRate, 6, 20);
  applyFades(right, sampleRate, 6, 20);
  // Пик на −6 dBFS: громкость в ролике задаёт sfxVolume, здесь — только запас.
  const { peak } = levelStats([left, right]);
  const g = peak > 0 ? dbToGain(-6) / peak : 1;
  for (let i = 0; i < n; i++) {
    left[i]! *= g;
    right[i]! *= g;
  }
  return { sampleRate, channels: [left, right] };
}
