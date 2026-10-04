/**
 * Procedural sound effects (Web Audio). No asset files: every sound is
 * synthesised, so it works identically in realtime and OfflineAudioContext
 * (video soundtrack rendering).
 */
export type SfxName =
  | 'jump'
  | 'land'
  | 'step'
  | 'fall'
  | 'hit'
  | 'danger'
  | 'roar'
  | 'stomp'
  | 'door'
  | 'trap'
  | 'checkpoint'
  | 'finish'
  | 'coin'
  | 'crusher'
  | 'laser'
  | 'break'
  | 'boing'
  | 'nearDeath'
  | 'grab'
  | 'alarm'
  | 'collapse'
  | 'whoosh'
  | 'bonk'
  | 'death'
  | 'sting'
  | 'click';

export interface SfxOpts {
  pitch?: number;
  gain?: number;
  pan?: number;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

export class Synth {
  private n = 0;
  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
  ) {}

  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private dest(pan = 0): AudioNode {
    if (!pan || !('createStereoPanner' in this.ctx)) return this.out;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.out);
    return p;
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, attack = 0.005): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(this.env(t, peak, attack, dur, dest));
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, peak: number, dest: AudioNode, filter: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
    const src = this.ctx.createBufferSource();
    src.buffer = noise(this.ctx);
    const bq = this.ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    src.connect(bq);
    bq.connect(this.env(t, peak, 0.004, dur, dest));
    src.start(t, (this.n++ * 0.1373) % 0.5);
    src.stop(t + dur + 0.05);
  }

  play(name: SfxName, t: number, o: SfxOpts = {}): void {
    const p = o.pitch ?? 1;
    const g = o.gain ?? 1;
    const d = this.dest(o.pan);
    switch (name) {
      case 'jump':
        this.tone(t, 'square', 320 * p, 720 * p, 0.12, 0.12 * g, d);
        break;
      case 'land':
        this.noiseBurst(t, 0.12, 0.35 * g, d, 'lowpass', 900, 200);
        this.tone(t, 'sine', 140, 60, 0.12, 0.25 * g, d);
        break;
      case 'step':
        this.noiseBurst(t, 0.045, 0.12 * g, d, 'bandpass', 1800 * p, 900 * p, 1.5);
        break;
      case 'fall':
        this.tone(t, 'sine', 900 * p, 180 * p, 0.9, 0.18 * g, d);
        break;
      case 'hit':
      case 'bonk':
        this.tone(t, 'triangle', 520 * p, 180 * p, 0.18, 0.3 * g, d);
        this.noiseBurst(t, 0.1, 0.25 * g, d, 'bandpass', 2500, 600, 2);
        break;
      case 'boing':
        this.tone(t, 'sine', 180 * p, 520 * p, 0.25, 0.25 * g, d);
        this.tone(t + 0.08, 'sine', 520 * p, 260 * p, 0.25, 0.15 * g, d);
        break;
      case 'danger':
      case 'alarm': {
        for (let i = 0; i < (name === 'alarm' ? 4 : 2); i++) {
          this.tone(t + i * 0.36, 'square', 880, 880, 0.16, 0.09 * g, d);
          this.tone(t + i * 0.36 + 0.18, 'square', 660, 660, 0.16, 0.09 * g, d);
        }
        break;
      }
      case 'roar': {
        const o1 = this.ctx.createOscillator();
        o1.type = 'sawtooth';
        o1.frequency.setValueAtTime(90 * p, t);
        o1.frequency.linearRampToValueAtTime(140 * p, t + 0.25);
        o1.frequency.linearRampToValueAtTime(70 * p, t + 1.0);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 18;
        const lg = this.ctx.createGain();
        lg.gain.value = 25;
        lfo.connect(lg);
        lg.connect(o1.frequency);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        o1.connect(lp);
        lp.connect(this.env(t, 0.35 * g, 0.06, 1.0, d));
        o1.start(t);
        lfo.start(t);
        o1.stop(t + 1.2);
        lfo.stop(t + 1.2);
        this.noiseBurst(t, 0.9, 0.18 * g, d, 'lowpass', 700, 200);
        break;
      }
      case 'stomp':
        this.tone(t, 'sine', 90, 35, 0.22, 0.4 * g, d);
        this.noiseBurst(t, 0.08, 0.15 * g, d, 'lowpass', 400, 120);
        break;
      case 'door':
        this.noiseBurst(t, 0.35, 0.4 * g, d, 'bandpass', 600, 300, 3);
        this.tone(t, 'square', 110, 55, 0.3, 0.22 * g, d);
        this.tone(t + 0.02, 'triangle', 1200, 900, 0.4, 0.06 * g, d);
        break;
      case 'trap':
      case 'click':
        this.noiseBurst(t, 0.03, 0.25 * g, d, 'highpass', 3000, 3000);
        this.tone(t + 0.03, 'triangle', 300, 120, 0.25, 0.12 * g, d);
        break;
      case 'checkpoint': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => this.tone(t + i * 0.08, 'triangle', f, f, 0.3, 0.14 * g, d));
        break;
      }
      case 'finish': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
        notes.forEach((f, i) => this.tone(t + i * 0.11, 'square', f, f, 0.22, 0.09 * g, d));
        this.noiseBurst(t + 0.75, 0.6, 0.12 * g, d, 'highpass', 6000, 3000);
        break;
      }
      case 'coin':
        this.tone(t, 'square', 988 * p, 988 * p, 0.06, 0.07 * g, d);
        this.tone(t + 0.06, 'square', 1318 * p, 1318 * p, 0.12, 0.07 * g, d);
        break;
      case 'crusher':
        this.tone(t, 'sine', 70, 30, 0.35, 0.5 * g, d);
        this.noiseBurst(t, 0.25, 0.35 * g, d, 'lowpass', 1200, 200);
        this.noiseBurst(t + 0.05, 0.4, 0.08 * g, d, 'highpass', 5000, 2000);
        break;
      case 'laser':
        this.tone(t, 'sawtooth', 1400, 600, 0.12, 0.06 * g, d);
        break;
      case 'break':
        this.noiseBurst(t, 0.25, 0.35 * g, d, 'bandpass', 1400, 400, 1.2);
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.04, 'triangle', 400 - i * 80, 150, 0.08, 0.1 * g, d);
        break;
      case 'nearDeath':
        this.noiseBurst(t, 0.45, 0.2 * g, d, 'bandpass', 400, 3000, 2);
        this.tone(t + 0.05, 'sine', 60, 50, 0.15, 0.35 * g, d);
        this.tone(t + 0.3, 'sine', 60, 50, 0.15, 0.3 * g, d);
        break;
      case 'grab':
        this.tone(t, 'sawtooth', 300, 900, 0.18, 0.12 * g, d);
        this.tone(t + 0.15, 'square', 700, 200, 0.4, 0.1 * g, d);
        break;
      case 'death':
        [440, 370, 311, 262].forEach((f, i) => this.tone(t + i * 0.12, 'square', f, f * 0.97, 0.14, 0.08 * g, d));
        break;
      case 'collapse':
        this.noiseBurst(t, 1.2, 0.3 * g, d, 'lowpass', 800, 100);
        this.tone(t, 'sine', 80, 30, 1.0, 0.3 * g, d);
        break;
      case 'whoosh':
        this.noiseBurst(t, 0.35, 0.18 * g, d, 'bandpass', 300, 2500, 1.5);
        break;
      case 'sting':
        [0, 3, 6, 9].forEach((s, i) => this.tone(t + i * 0.07, 'sawtooth', 220 * Math.pow(2, s / 12), 220 * Math.pow(2, s / 12), 0.25, 0.08 * g, d));
        break;
    }
  }
}
