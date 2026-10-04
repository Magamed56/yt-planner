import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { validateVideoConfig, VIDEO_SCENARIOS } from '../../src/engine/video/VideoConfig';
import { resolveVideo, simulateTake } from '../../src/engine/video/VideoSession';
import { TAKES } from '../../src/engine/video/Scenarios';
import { campaignParams } from '../../src/game/campaign';
import { registerContent } from '../../src/game/content';
import { RECIPES } from '../../src/game/recipes';

registerContent();
const opts = { campaign: (n: number) => campaignParams(n) };

describe('VideoConfig', () => {
  it('fills defaults and accepts a full config', () => {
    const v = validateVideoConfig({ id: 'x', level: 5, scenario: 'near_death', take: 3, format: 'short', duration: 32, captions: [{ at: 0, text: 'HI' }] });
    expect(v.errors).toEqual([]);
    expect(v.config.seed).toBe(1005);
    expect(v.config.scenario).toBe('NEAR_DEATH');
    expect(v.config.captions[0].duration).toBe(1.6);
    expect(v.config.fps).toBe(30);
  });

  it('reports invalid fields without throwing', () => {
    const v = validateVideoConfig({ take: 9, format: 'vertical', scenario: 'BORING', duration: 2, fps: 13, difficulty: 'MEDIUM', events: [{ type: 'camera' }] });
    expect(v.errors.length).toBeGreaterThanOrEqual(6);
    expect(validateVideoConfig(null).errors.length).toBeGreaterThan(0);
  });

  it('warns about Shorts length', () => {
    expect(validateVideoConfig({ format: 'short', duration: 70 }).warnings.join()).toMatch(/60/);
    expect(validateVideoConfig({ format: 'long' }).config.duration).toBe(600);
  });

  it('every bundled videos/*.json is valid', () => {
    const dir = new URL('../../videos/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const v = validateVideoConfig(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      expect(v.errors, f).toEqual([]);
    }
  });
});

describe('Video scenarios & takes', () => {
  it('scenario flags shape the level', () => {
    const boss = resolveVideo(validateVideoConfig({ seed: 3001, difficulty: 2, scenario: 'BOSS_ESCAPE' }).config, opts);
    expect(boss.level.modules.some((m) => m.type === 'BOSS')).toBe(true);
    const imp = resolveVideo(validateVideoConfig({ seed: 3001, difficulty: 1, scenario: 'IMPOSSIBLE' }).config, opts);
    expect(imp.level.difficultyName).toBe('IMPOSSIBLE');
    const chaos = resolveVideo(validateVideoConfig({ seed: 3001, scenario: 'CHAOS' }).config, opts);
    expect(chaos.chaos).toBe(1);
  });

  it('a campaign level config reproduces the campaign level geometry', () => {
    const r = resolveVideo(validateVideoConfig({ level: 7 }).config, opts);
    expect(r.level.seed).toBe(1007);
    expect(r.level.theme).toBe('FACTORY');
  });

  it('the same config always produces the same take (deterministic videos)', () => {
    const c = validateVideoConfig({ level: 4, scenario: 'CHASE', take: 3 }).config;
    const a = simulateTake(resolveVideo(c, opts));
    const b = simulateTake(resolveVideo(c, opts));
    expect(a.time).toBe(b.time);
    expect(a.events.map((e) => e.type)).toEqual(b.events.map((e) => e.type));
  });

  it('six takes of one level are genuinely different runs', () => {
    const sigs = new Set<string>();
    for (const t of TAKES) {
      const r = resolveVideo(validateVideoConfig({ level: 15, scenario: 'CHASE', take: t.take }).config, opts);
      const res = simulateTake(r);
      sigs.add(`${res.time.toFixed(2)}|${res.deaths}|${res.events.length}`);
    }
    expect(sigs.size).toBeGreaterThanOrEqual(5);
  });

  it('FAIL scenario contains a scripted failure and still finishes', () => {
    const r = resolveVideo(validateVideoConfig({ level: 12, scenario: 'FAIL', take: 2 }).config, opts);
    expect(r.bot.forced?.length).toBeGreaterThan(0);
    const res = simulateTake(r);
    expect(res.deaths).toBeGreaterThan(0);
    expect(res.finished).toBe(true);
  });

  it('PERFECT_RUN searches for a clean take', () => {
    const r = resolveVideo(validateVideoConfig({ level: 22, scenario: 'PERFECT_RUN', take: 1 }).config, opts);
    const res = simulateTake(r);
    expect(res.finished).toBe(true);
    expect(res.deaths).toBe(0);
  });

  it('ENEMY_ALMOST_CATCHES take gets very close but never grabs', () => {
    const r = resolveVideo(validateVideoConfig({ level: 18, scenario: 'CHASE', take: 6 }).config, opts);
    const res = simulateTake(r);
    expect(res.catches).toBe(0);
    expect(res.events.filter((e) => e.type === 'ENEMY_NEAR').length).toBeGreaterThan(0);
  });

  it('all scenarios resolve for every recipe', () => {
    for (const s of VIDEO_SCENARIOS) expect(resolveVideo(validateVideoConfig({ seed: 1234, scenario: s }).config, { ...opts, searchTakes: false }).level).toBeTruthy();
    for (const rc of RECIPES) {
      const r = resolveVideo(validateVideoConfig({ seed: 2000, scenario: rc.scenario, take: rc.take, specialEvents: rc.specialEvents }).config, { ...opts, searchTakes: false });
      expect(r.level.modules.length, rc.id).toBeGreaterThan(5);
    }
  });
});
