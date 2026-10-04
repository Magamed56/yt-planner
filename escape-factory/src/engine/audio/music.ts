/**
 * Adaptive procedural music. Patterns are generated from the theme's musical
 * parameters + a seed; layers fade in with `intensity` (0 calm … 1 chase).
 * `scheduleRange` works for realtime (incremental) and offline rendering.
 */
import { Rng } from '../core/rng';
import type { MusicScale, ThemeMusic } from '../theme/ThemeDef';

const SCALES: Record<MusicScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  blues: [0, 3, 5, 6, 7, 10],
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class MusicEngine {
  private readonly bass: number[] = [];
  private readonly lead: Array<number | null> = [];
  private readonly chords: number[][] = [];
  private nextStep = 0;
  private readonly stepDur: number;
  private readonly bus: GainNode;
  private startTime = 0;
  private noiseBuf: AudioBuffer | null = null;
  playing = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    private readonly m: ThemeMusic,
    seed: number,
  ) {
    this.stepDur = 60 / m.bpm / 4;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.55;
    this.bus.connect(out);
    const rng = new Rng(seed);
    const sc = SCALES[m.scale];
    const deg = (d: number, oct = 0) => m.root + sc[((d % sc.length) + sc.length) % sc.length] + 12 * (oct + Math.floor(d / sc.length));
    // 4-bar progression (scale degrees)
    const prog = [0, rng.pick([3, 5]), rng.pick([4, 1]), rng.pick([2, 4, 6])];
    for (let bar = 0; bar < 4; bar++) {
      const root = prog[bar];
      this.chords.push([deg(root, 1), deg(root + 2, 1), deg(root + 4, 1)]);
      for (let s = 0; s < 16; s++) {
        const pat = s % 4 === 0 ? 0 : s % 4 === 2 && m.bounce > 0.5 ? 4 : -1;
        this.bass.push(pat < 0 ? (rng.chance(0.25 * m.bounce) ? deg(root + 7, -1) : -1) : deg(root + pat, -1));
      }
    }
    // lead motif: 2-bar phrase repeated with variation
    const motif: Array<number | null> = [];
    let d = rng.int(0, 4);
    for (let s = 0; s < 32; s++) {
      if (s % 2 === 1 && rng.chance(0.6)) {
        motif.push(null);
        continue;
      }
      d += rng.pick([-2, -1, 1, 1, 2, 0]);
      d = Math.max(-2, Math.min(9, d));
      motif.push(rng.chance(0.18) ? null : deg(d, 2));
    }
    for (let i = 0; i < 64; i++) this.lead.push(i >= 32 && rng.chance(0.2) ? null : motif[i % 32]);
  }

  start(at: number): void {
    this.startTime = at;
    this.nextStep = 0;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  /** Realtime: schedule ahead of the audio clock. */
  pump(intensity: number, lookahead = 0.15): void {
    if (!this.playing) return;
    const until = this.ctx.currentTime + lookahead;
    this.scheduleRange(until, () => intensity);
  }

  /** Schedules every step whose start time < `until`. */
  scheduleRange(until: number, intensityAt: (t: number) => number): void {
    while (this.startTime + this.nextStep * this.stepDur < until) {
      const t = this.startTime + this.nextStep * this.stepDur;
      if (t >= this.ctx.currentTime - 0.01) this.step(this.nextStep, t, intensityAt(t));
      this.nextStep++;
    }
  }

  private step(i: number, t: number, k: number): void {
    const s = i % 64;
    const inBar = s % 16;
    const bar = Math.floor(s / 16);
    // pad (chord) on bar start
    if (inBar === 0) for (const n of this.chords[bar]) this.pad(t, midi(n), this.stepDur * 16, 0.035 * (1 - k * 0.5));
    // bass
    const b = this.bass[s];
    if (b >= 0) this.voice(t, this.m.bass, midi(b), this.stepDur * 1.6, 0.11 + 0.06 * k, 600 + 1800 * k);
    // drums
    if (k > 0.15) {
      if (inBar % 4 === 0 || (k > 0.8 && inBar % 8 === 6)) this.kick(t, 0.5);
      const hatEvery = k > 0.75 ? 1 : 2;
      if (inBar % hatEvery === 0) this.hat(t, inBar % 4 === 2 ? 0.06 : 0.035);
    }
    if (k > 0.45 && inBar % 8 === 4) this.snare(t, 0.22);
    // lead
    if (k > 0.45) {
      const n = this.lead[s];
      if (n !== null && n !== undefined) this.voice(t, this.m.lead, midi(n + (k > 0.85 ? 12 : 0)), this.stepDur * 1.8, 0.05 + 0.03 * k, 3000);
    }
  }

  private voice(t: number, type: OscillatorType, f: number, dur: number, peak: number, cutoff: number): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(t: number, f: number, dur: number, peak: number): void {
    for (const det of [-6, 6]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.2);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.bus);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private kick(t: number, peak: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      let s = 99;
      for (let i = 0; i < d.length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[i] = (s / 4294967296) * 2 - 1;
      }
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  }

  private hat(t: number, peak: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.bus);
    src.start(t);
    src.stop(t + 0.06);
  }

  private snare(t: number, peak: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.bus);
    src.start(t);
    src.stop(t + 0.18);
    this.voice(t, 'triangle', 190, 0.08, 0.1, 2000);
  }
}
