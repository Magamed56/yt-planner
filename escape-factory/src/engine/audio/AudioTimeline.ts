/**
 * Offline soundtrack for recordings. While frames are rendered, the timeline
 * records every sound-producing event (with listener + exact video time),
 * music intensity and heartbeat cues. Afterwards `render()` synthesises the
 * soundtrack with an OfflineAudioContext — in chunks, so 20-minute videos
 * never need one giant buffer. Same procedural synth + music as live play.
 */
import type { GameEvent } from '../events/GameEvents';
import type { World } from '../sim/World';
import type { ThemeMusic } from '../theme/ThemeDef';
import { AudioSystem, EVENT_SFX, musicIntensity, type Listener } from './AudioSystem';
import type { SfxName } from './synth';

export interface TimedSfx {
  e: GameEvent;
  l: Listener;
  t: number;
}

export interface Cue {
  t: number;
  name: SfxName;
  gain?: number;
  pitch?: number;
  pan?: number;
}

export interface MusicSpan {
  /** video time the music (re)starts */
  t: number;
  music: ThemeMusic;
  seed: number;
}

export class AudioTimeline {
  readonly sfx: TimedSfx[] = [];
  readonly cues: Cue[] = [];
  readonly music: MusicSpan[] = [];
  /** smoothed music intensity samples every `step` s of video time */
  readonly intensity: number[] = [];
  readonly step = 0.05;
  private k = 0.3;
  private heartT = 0;
  duration = 0;

  record(e: GameEvent, l: Listener, t: number): void {
    if (!EVENT_SFX[e.type]) return;
    this.sfx.push({ e: { type: e.type, t: e.t, tick: e.tick, payload: e.payload }, l: { ...l }, t });
  }

  cue(c: Cue): void {
    this.cues.push(c);
  }

  startMusic(t: number, music: ThemeMusic, seed: number): void {
    this.music.push({ t, music, seed });
  }

  /** Call once per recorded frame; `t` is the video time at the end of the frame. */
  frame(world: World, dt: number, t: number, intensityOverride?: number): void {
    const gap = world.enemy ? world.enemy.gapTo(world.playerS) : Infinity;
    if (gap < 5 && world.player.isControllable) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.32 + gap * 0.06;
        this.cues.push({ t, name: 'stomp', gain: 0.35, pitch: 1.4 });
      }
    }
    const target = intensityOverride ?? musicIntensity(world);
    this.k += (target - this.k) * Math.min(1, dt * 1.5);
    while (this.intensity.length * this.step <= t) this.intensity.push(this.k);
    this.duration = Math.max(this.duration, t);
  }

  intensityAt(t: number): number {
    const n = this.intensity.length;
    if (!n) return 0.3;
    const f = t / this.step;
    const i = Math.max(0, Math.min(n - 1, Math.floor(f)));
    const j = Math.min(n - 1, i + 1);
    return this.intensity[i] + (this.intensity[j] - this.intensity[i]) * Math.max(0, Math.min(1, f - i));
  }

  /**
   * Renders video time [from, to) to stereo PCM. A pre-roll lets notes that
   * started in the previous chunk ring into this one, so chunks join seamlessly.
   */
  async render(from: number, to: number, sampleRate = 48000, OfflineCtx: typeof OfflineAudioContext = OfflineAudioContext): Promise<[Float32Array, Float32Array]> {
    const pre = Math.min(from, 4);
    const t0 = from - pre;
    const frames = Math.ceil((to - t0) * sampleRate);
    const ctx = new OfflineCtx(2, Math.max(1, frames), sampleRate);
    const audio = new AudioSystem(ctx);
    audio.setVolumes(0.85, 0.75, 1);
    const end = to - t0;
    // music spans (each runs until the next one starts)
    for (let i = 0; i < this.music.length; i++) {
      const m = this.music[i];
      const until = Math.min(end, (this.music[i + 1]?.t ?? Infinity) - t0);
      if (until <= 0) continue;
      audio.startMusic(m.music, m.seed, m.t - t0);
      audio.music!.scheduleRange(until, (t) => this.intensityAt(t + t0));
    }
    for (const s of this.sfx) if (s.t >= t0 - 0.01 && s.t < to) audio.onEvent(s.e, s.l, Math.max(0, s.t - t0));
    for (const c of this.cues) if (c.t >= t0 - 0.01 && c.t < to) audio.synth.play(c.name, Math.max(0, c.t - t0), { gain: c.gain, pitch: c.pitch, pan: c.pan });
    const buf = await ctx.startRendering();
    const skip = Math.round(pre * sampleRate);
    const len = Math.round((to - from) * sampleRate);
    const L = buf.getChannelData(0).slice(skip, skip + len);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice(skip, skip + len) : L;
    return [L, R];
  }
}

/** Interleaved signed 16-bit little-endian PCM. */
export function toPcm16(L: Float32Array, R: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(L.length * 4));
  for (let i = 0; i < L.length; i++) {
    out.setInt16(i * 4, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true);
    out.setInt16(i * 4 + 2, Math.max(-1, Math.min(1, R[i])) * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
