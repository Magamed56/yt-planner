// Небольшой набор DSP-примитивов на чистом JS: генератор случайных чисел
// с зерном (чтобы звук был воспроизводимым от запуска к запуску), фильтры,
// фейды, анализ уровней и офлайн-лимитер для выравнивания громкости.

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-12));

// FNV-1a: строка-зерно → 32-битное число.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — маленький, быстрый и детерминированный PRNG.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// State-variable filter в топологии TPT (Zavalishin): устойчив при быстрой
// модуляции частоты среза — нужен для «свиста» перехода и дыхания пэдов.
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  lp = 0;
  bp = 0;
  hp = 0;
  constructor(private readonly sampleRate: number) {}
  set(cutoffHz: number, q: number): void {
    const fc = Math.min(Math.max(cutoffHz, 10), this.sampleRate * 0.49);
    this.g = Math.tan((Math.PI * fc) / this.sampleRate);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  process(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
  }
}

// Однополюсный ФНЧ/ФВЧ — для сглаживания огибающих и удаления DC.
export class OnePole {
  private z = 0;
  private a: number;
  constructor(cutoffHz: number, sampleRate: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  }
  lp(x: number): number {
    this.z += this.a * (x - this.z);
    return this.z;
  }
  hp(x: number): number {
    return x - this.lp(x);
  }
}

// Плавная S-кривая 0→1 (без излома на концах — фейды без щелчков).
export const smoothstep = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

export function applyFades(ch: Float32Array, sampleRate: number, fadeInMs: number, fadeOutMs: number): void {
  const fi = Math.min(ch.length, Math.round((fadeInMs / 1000) * sampleRate));
  const fo = Math.min(ch.length, Math.round((fadeOutMs / 1000) * sampleRate));
  for (let i = 0; i < fi; i++) ch[i]! *= smoothstep(i / fi);
  for (let i = 0; i < fo; i++) ch[ch.length - 1 - i]! *= smoothstep(i / fo);
}

export interface LevelStats {
  peak: number; // линейный пик
  rms: number; // линейный RMS по всему сигналу
  dc: number; // среднее значение (постоянная составляющая)
  nonFinite: number; // количество NaN/Infinity
}

export function levelStats(channels: Float32Array[]): LevelStats {
  let peak = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let nonFinite = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]!;
      if (!Number.isFinite(x)) {
        nonFinite++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      sum += x;
      sumSq += x * x;
      n++;
    }
  }
  return { peak, rms: n ? Math.sqrt(sumSq / n) : 0, dc: n ? sum / n : 0, nonFinite };
}

// RMS только по «звучащим» кадрам (50 мс), тише порога относительно самого
// громкого кадра — пропускаем. Так паузы в речи не занижают уровень, и разные
// провайдеры с разной длиной тишины выравниваются одинаково.
export function gatedRms(channels: Float32Array[], sampleRate: number, gateDb = -40): number {
  const frame = Math.max(1, Math.round(sampleRate * 0.05));
  const len = channels[0]?.length ?? 0;
  const energies: number[] = [];
  for (let start = 0; start < len; start += frame) {
    const end = Math.min(len, start + frame);
    let s = 0;
    for (const ch of channels) for (let i = start; i < end; i++) s += ch[i]! * ch[i]!;
    energies.push(s / ((end - start) * channels.length));
  }
  let max = 0;
  for (const e of energies) if (e > max) max = e;
  if (max <= 0) return 0;
  const gate = max * dbToGain(gateDb) ** 2;
  let sum = 0;
  let n = 0;
  for (const e of energies) {
    if (e >= gate) {
      sum += e;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

// Офлайн-лимитер «с заглядыванием вперёд». Т.к. весь сигнал известен заранее,
// огибающая усиления строится двумя проходами: обратным (плавная атака ДО пика)
// и прямым (плавное отпускание после). Усиление нигде не превышает нужного,
// поэтому потолок соблюдается точно, а скачков усиления (щелчков) нет.
export function limitPeaks(channels: Float32Array[], sampleRate: number, ceiling: number, attackMs = 4, releaseMs = 80): void {
  const len = channels[0]?.length ?? 0;
  if (!len) return;
  const gain = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let a = 0;
    for (const ch of channels) a = Math.max(a, Math.abs(ch[i]!));
    gain[i] = a > ceiling ? ceiling / a : 1;
  }
  const att = 1 - Math.exp(-1 / ((attackMs / 1000) * sampleRate));
  const rel = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  for (let i = len - 2; i >= 0; i--) {
    const next = gain[i + 1]!;
    const ramp = next + (1 - next) * att;
    if (ramp < gain[i]!) gain[i] = ramp;
  }
  for (let i = 1; i < len; i++) {
    const prev = gain[i - 1]!;
    const ramp = prev + (1 - prev) * rel;
    if (ramp < gain[i]!) gain[i] = ramp;
  }
  for (const ch of channels) for (let i = 0; i < len; i++) ch[i]! *= gain[i]!;
}

// Выравнивание громкости: цель по «гейтированному» RMS, пики — не выше потолка.
export function normalizeLoudness(
  channels: Float32Array[],
  sampleRate: number,
  opts: { targetRmsDb: number; ceilingDb: number; maxGainDb?: number },
): { gainDb: number } {
  const rms = gatedRms(channels, sampleRate);
  if (rms <= 1e-6) return { gainDb: 0 };
  let gainDb = opts.targetRmsDb - gainToDb(rms);
  // Не раздуваем почти пустой сигнал до шума.
  if (opts.maxGainDb !== undefined) gainDb = Math.min(gainDb, opts.maxGainDb);
  const g = dbToGain(gainDb);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= g;
  // Чуть ниже потолка: 16-битное округление и дизеринг не должны его пробить.
  limitPeaks(channels, sampleRate, dbToGain(opts.ceilingDb) * 0.995);
  return { gainDb };
}

// Удаление постоянной составляющей ФВЧ ~20 Гц (некоторые TTS дают смещение).
export function removeDc(ch: Float32Array, sampleRate: number, cutoffHz = 20): void {
  const f = new OnePole(cutoffHz, sampleRate);
  for (let i = 0; i < ch.length; i++) ch[i] = f.hp(ch[i]!);
}
