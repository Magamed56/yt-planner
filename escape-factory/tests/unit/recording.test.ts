import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameEvent } from '../../src/engine/events/GameEvents';
import { AudioTimeline, toPcm16 } from '../../src/engine/audio/AudioTimeline';
import { EditRunner, measureEdit, type EditPlan } from '../../src/engine/video/Edit';
import { bestWindow, coldOpenCamera, interestCurve, peaks } from '../../src/engine/video/Highlights';
import { planLong } from '../../src/engine/video/LongPlanner';
import { planShortEdit, SHORT_MAX, SHORT_MIN } from '../../src/engine/video/plans';
import { planShort } from '../../src/engine/video/ShortsPlanner';
import { validateVideoConfig } from '../../src/engine/video/VideoConfig';
import { resolveVideo, simulateTake } from '../../src/engine/video/VideoSession';
import { campaignLevel, campaignParams } from '../../src/game/campaign';
import { registerContent } from '../../src/game/content';

registerContent();
const resolver = (c: Parameters<typeof resolveVideo>[0]) => resolveVideo(c, { campaign: (n) => campaignParams(n, c.enemy) });
const ev = (type: GameEvent['type'], t: number, payload: Record<string, unknown> = {}): GameEvent => ({ type, t, tick: Math.round(t * 60), payload: { pos: { x: 0, y: 0, z: 0 }, ...payload } as never });

describe('Highlights', () => {
  const events = [ev('LEVEL_START', 0), ev('PLAYER_JUMP', 3), ev('CHASE_START', 20), ev('ENEMY_NEAR', 24, { gap: 2 }), ev('PLAYER_NEAR_DEATH', 27), ev('CHASE_END', 31, { escaped: true }), ev('PLAYER_FINISH', 40)];

  it('interest peaks where the action is', () => {
    const c = interestCurve(events, 45);
    const top = peaks(c, 2, 3);
    expect(top.some((t) => t > 23 && t < 29)).toBe(true);
    expect(c.values[Math.round(10 / c.step)]).toBeLessThan(0.05);
  });

  it('best window contains the climax and ends on a resolution', () => {
    const w = bestWindow(interestCurve(events, 45), events, 20);
    expect(w.start).toBeLessThan(24);
    expect(w.end).toBeGreaterThan(31);
    expect(w.resolution?.type).toMatch(/CHASE_END|PLAYER_FINISH/);
  });

  it('cold open uses the chase camera when the monster is involved', () => {
    expect(coldOpenCamera(events, 24)).toBe('CHASE');
    expect(coldOpenCamera([ev('PLAYER_NEAR_DEATH', 5)], 5)).toBe('DRAMATIC');
  });

  it('shorts plan: hook in the first second, no intro, ≤ target length', () => {
    const p = planShort(events, 45, { duration: 30, hook: 'CAN I ESCAPE?!', climaxCaption: 'RUN!', outro: 'ESCAPED!' });
    const first = p.segments[0];
    expect(first.captions[0]?.text).toBe('CAN I ESCAPE?!');
    expect(first.captions[0].at).toBe(0);
    expect(p.duration).toBeLessThanOrEqual(30.5);
    expect(['finish', 'escape', 'fail', 'loop']).toContain(p.ending);
  });
});

describe('Edit runner', () => {
  const cfg = validateVideoConfig(JSON.parse(readFileSync(new URL('../../videos/video_001.json', import.meta.url), 'utf8'))).config;

  it('plans a 25–40 s Short for video_001 with hook first', () => {
    const plan = planShortEdit(cfg, resolver, { hook: 'CAN I ESCAPE?!', climax: 'RUN!!!', outro: 'I ESCAPED!', focus: 'chase' });
    expect(plan.duration).toBeGreaterThanOrEqual(SHORT_MIN);
    expect(plan.duration).toBeLessThanOrEqual(SHORT_MAX);
    const m = measureEdit(plan, resolver);
    expect(m.captions[0].start).toBe(0);
    expect(m.captions[0].text).toBe('CAN I ESCAPE?!');
    expect(Math.abs(m.duration - plan.duration)).toBeLessThan(1e-6);
  });

  it('is frame-exact and deterministic', () => {
    const plan: EditPlan = {
      id: 't', title: 't', kind: 'short', format: 'short', width: 1080, height: 1920, fps: 30, sources: [cfg], duration: 0, chapters: [], music: 'auto', meta: {},
      segments: [
        { from: 6, to: 8, kind: 'coldOpen', camera: 'DRAMATIC', slowmo: 0.5, captions: [{ at: 0, duration: 1, text: 'HOOK', style: 'hook' }] },
        { from: 0, to: 6, kind: 'main', captions: [] },
      ],
    };
    const tlA = new AudioTimeline();
    const a = measureEdit(plan, resolver, tlA);
    const b = measureEdit(plan, resolver);
    expect(a.frames).toBe(b.frames);
    expect(a.events.map((e) => `${e.type}@${e.t.toFixed(4)}`)).toEqual(b.events.map((e) => `${e.type}@${e.t.toFixed(4)}`));
    // slow motion stretches the cold open beyond its 2 simulated seconds
    expect(a.segStart[1]).toBeGreaterThan(2.5);
    expect(a.duration).toBeCloseTo(a.frames / 30, 6);
    expect(tlA.sfx.length).toBeGreaterThan(5);
    expect(tlA.cues.some((c) => c.name === 'whoosh')).toBe(true);
    expect(tlA.music.length).toBe(1);
  });

  it('events in the edit are mapped to segment time (fast-forward is silent)', () => {
    const plan: EditPlan = {
      id: 't', title: 't', kind: 'short', format: 'short', width: 1080, height: 1920, fps: 30, sources: [cfg], duration: 0, chapters: [], music: 'auto', meta: {},
      segments: [{ from: 5, to: 7, kind: 'main', captions: [] }],
    };
    const r = new EditRunner(plan, resolver);
    while (!r.step(false).done);
    expect(r.t).toBeGreaterThan(1.9);
    expect(r.t).toBeLessThan(2.2);
    expect(r.events.every((e) => e.t >= 0 && e.t <= r.t + 1e-6)).toBe(true);
    expect(r.events.some((e) => e.type === 'LEVEL_START')).toBe(false);
  });
});

describe('Audio timeline', () => {
  it('interpolates music intensity and encodes PCM', () => {
    const tl = new AudioTimeline();
    tl.intensity.push(0, 1);
    expect(tl.intensityAt(0.025)).toBeCloseTo(0.5, 5);
    const pcm = toPcm16(new Float32Array([0, 1, -1]), new Float32Array([0.5, 2, -2]));
    const v = new DataView(pcm.buffer);
    expect(pcm.length).toBe(12);
    expect(v.getInt16(4, true)).toBe(32767);
    expect(v.getInt16(10, true)).toBe(-32767);
  });
});

describe('Long videos', () => {
  it('assembles a ~5 minute compilation with chapters, varied scenarios and a cold open', () => {
    const base = validateVideoConfig({ id: 'long_test', format: 'long', title: 'Escape Factory' }).config;
    const plan = planLong(
      {
        minutes: 5,
        base,
        startLevel: 1,
        levelConfig: (n) => {
          const L = campaignLevel(n);
          return { level: n, seed: L.seed, difficulty: L.difficulty, theme: L.theme };
        },
        levelTitle: (n) => `Level ${n}`,
        isBossLevel: (n) => campaignLevel(n).boss,
      },
      resolver,
    );
    expect(plan.duration).toBeGreaterThan(300 * 0.9);
    expect(plan.duration).toBeLessThan(300 * 1.1);
    expect(plan.segments[0].kind).toBe('coldOpen');
    const chapters = plan.segments.filter((s) => s.chapter);
    expect(chapters.length).toBeGreaterThanOrEqual(6);
    expect(new Set(plan.sources.map((s) => s.scenario)).size).toBeGreaterThanOrEqual(4);
    expect(plan.width).toBe(1920);
  }, 300000);

  it('the take used for a segment matches the take that was analysed', () => {
    const r = resolver(validateVideoConfig({ level: 4, scenario: 'FAIL', take: 2, format: 'long' }).config);
    const a = simulateTake(r);
    const b = simulateTake(r);
    expect(a.deaths).toBeGreaterThanOrEqual(1);
    expect(a.finishTime).toBe(b.finishTime);
  });
});

describe('Video series (one game → many videos)', () => {
  it('every recipe yields a distinct config that delivers its title', async () => {
    const { planSeries } = await import('../../src/game/video/series');
    const { RECIPES } = await import('../../src/game/recipes');
    const items = planSeries(RECIPES.length, resolver, { startIndex: 100 });
    expect(items.length).toBe(RECIPES.length);
    expect(new Set(items.map((i) => i.recipe.id)).size).toBe(RECIPES.length);
    expect(new Set(items.map((i) => `${i.config.seed}:${i.config.character}`)).size).toBe(items.length);
    for (const it of items) {
      expect(it.check?.ok, it.recipe.id).toBe(true);
      expect(it.check!.duration).toBeGreaterThanOrEqual(25);
      expect(it.check!.duration).toBeLessThanOrEqual(40);
    }
    expect(items.find((i) => i.recipe.id === 'CAUGHT')!.check!.ending).toBe('fail');
    expect(items.find((i) => i.recipe.id === 'PERFECT_RUN')!.check!.deaths).toBe(0);
  }, 300000);
});
