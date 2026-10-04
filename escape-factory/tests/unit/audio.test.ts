import { describe, expect, it } from 'vitest';
import { MusicEngine } from '../../src/engine/audio/music';
import { FACTORY } from '../../src/game/themes/factory';
import { ALL_THEMES } from '../../src/game/themes';

/** Minimal fake Web Audio graph that rejects negative times like browsers do. */
function fakeCtx() {
  let scheduled = 0;
  const param = () => {
    const chk = (t: number) => {
      if (!(t >= 0)) throw new RangeError(`negative time ${t}`);
      scheduled++;
    };
    return { value: 0, setValueAtTime: (_v: number, t: number) => chk(t), linearRampToValueAtTime: (_v: number, t: number) => chk(t), exponentialRampToValueAtTime: (_v: number, t: number) => chk(t) };
  };
  const node = () => ({ connect: () => undefined, disconnect: () => undefined, gain: param(), frequency: param(), detune: param(), Q: param(), type: '', buffer: null, start: (t: number) => { if (!(t >= 0)) throw new RangeError(`negative start ${t}`); }, stop: () => undefined });
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    destination: node(),
    createGain: node,
    createOscillator: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, count: () => scheduled };
}

describe('Music engine', () => {
  it('never schedules before time 0 (offline chunks start the music in the past)', () => {
    for (const start of [-0.0073, -0.63, -3.1, 0]) {
      const { ctx, count } = fakeCtx();
      const m = new MusicEngine(ctx, (ctx as unknown as { destination: AudioNode }).destination, FACTORY.music, 42);
      m.start(start);
      expect(() => m.scheduleRange(4, () => 0.9)).not.toThrow();
      expect(count()).toBeGreaterThan(10);
    }
  });

  it('every theme kit renders a full chase groove', () => {
    for (const t of ALL_THEMES) {
      const { ctx, count } = fakeCtx();
      const m = new MusicEngine(ctx, (ctx as unknown as { destination: AudioNode }).destination, t.music, 7);
      m.start(0);
      m.scheduleRange(8, (x) => (x < 4 ? 0.3 : 1));
      expect(count(), t.id).toBeGreaterThan(50);
    }
  });
});
