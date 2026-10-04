import { describe, expect, it } from 'vitest';
import { World } from '../../src/engine/sim/World';
import { crusherState, fallerState, hazardHit, laserState, rollerForEach, slamLaneState } from '../../src/engine/obstacle/hazardEval';
import type { CrusherSpec, LaserSpec, SpinnerSpec } from '../../src/engine/obstacle/hazardTypes';
import { aabb } from '../../src/engine/core/math';
import { evalMotion, cycleVanish } from '../../src/engine/obstacle/motion';
import { run, straightLevel, testCharacter } from './helpers';

const crusher: CrusherSpec = { kind: 'crusher', minX: -1.5, maxX: 1.5, minZ: 9, maxZ: 11, floorY: 0, topY: 3.5, period: 2.5, phase: 0 };

describe('hazard evaluators', () => {
  it('crusher cycle: up → warn → slam → hold → rise', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 2.5; t += 0.01) seen.add(crusherState(crusher, t).phase);
    expect([...seen]).toEqual(['up', 'warn', 'slam', 'hold', 'rise']);
    const atHold = crusherState(crusher, 2.5 * 0.65);
    expect(atHold.bottom).toBeCloseTo(0);
  });

  it('crusher only kills when the head is low', () => {
    const player = aabb(-0.35, 0, 9.65, 0.35, 1.4, 10.35);
    expect(hazardHit(crusher, 0.1, player)).toBeNull();
    expect(hazardHit(crusher, 2.5 * 0.65, player)?.cause).toBe('crushed');
  });

  it('laser blinks on/off with a warning before turning on', () => {
    const l: LaserSpec = { kind: 'laser', ax: -3, ay: 0.8, az: 5, bx: 3, by: 0.8, bz: 5, radius: 0.1, period: 2, on: 0.5, phase: 0 };
    expect(laserState(l, 0.2).on).toBe(true);
    expect(laserState(l, 1.2).on).toBe(false);
    expect(laserState(l, 1.9).warn).toBeGreaterThan(0);
    const p = aabb(-0.35, 0, 4.65, 0.35, 1.4, 5.35);
    expect(hazardHit(l, 0.2, p)?.cause).toBe('zapped');
    expect(hazardHit(l, 1.2, p)).toBeNull();
    // jumping over a low beam is safe
    const high = aabb(-0.35, 1.2, 4.65, 0.35, 2.6, 5.35);
    expect(hazardHit(l, 0.2, high)).toBeNull();
  });

  it('spinner arm hits produce a knockback direction', () => {
    const s: SpinnerSpec = { kind: 'spinner', x: 0, y: 0.5, z: 0, radius: 3, thick: 0.18, omega: 2, phase: 0, arms: 2, lethal: false };
    const p = aabb(-0.35, 0, 1.65, 0.35, 1.4, 2.35);
    const hit = hazardHit(s, 0, p);
    expect(hit).not.toBeNull();
    expect(hit!.lethal).toBe(false);
    expect(Math.hypot(hit!.pushX, hit!.pushZ)).toBeGreaterThan(0.5);
    const above = aabb(-0.35, 0.9, 1.65, 0.35, 2.3, 2.35);
    expect(hazardHit(s, 0, above)).toBeNull();
  });

  it('faller telegraphs then drops', () => {
    const f = { kind: 'faller' as const, x: 0, z: 0, floorY: 0, topY: 8, size: 1.2, period: 3, phase: 0, warn: 0.3, drop: 0.1 };
    expect(fallerState(f, 0.5).phase).toBe('warn');
    expect(fallerState(f, 0.95).phase).toBe('drop');
    expect(fallerState(f, 2.5).phase).toBe('idle');
  });

  it('boss slam lanes follow the pattern with a warning', () => {
    const lanes = [0, 1, 2].map((i) => ({ minX: i * 2, maxX: i * 2 + 2, minZ: 0, maxZ: 10 }));
    const s = { kind: 'slam' as const, lanes, floorY: 0, pattern: [0, 2, 1], interval: 1.2, warn: 0.8, active: 0.3 };
    expect(slamLaneState(s, 0, 0.4).phase).toBe('warn');
    expect(slamLaneState(s, 0, 0.9).phase).toBe('active');
    expect(slamLaneState(s, 2, 1.6).phase).toBe('warn');
    expect(slamLaneState(s, 1, 0.5).phase).toBe('idle');
  });

  it('rollers spawn periodically and travel', () => {
    const r = { kind: 'roller' as const, sx: 0, sy: 0.6, sz: 30, vx: 0, vz: -6, radius: 0.6, period: 2, phase: 0, travel: 30 };
    let n = 0;
    rollerForEach(r, 6.2, () => n++);
    expect(n).toBe(3);
  });

  it('motion and vanish evaluators', () => {
    const o = { x: 0, y: 0, z: 0 };
    evalMotion({ kind: 'sine', ax: 2, ay: 0, az: 0, period: 4, phase: 0 }, 1, null, o);
    expect(o.x).toBeCloseTo(2);
    evalMotion({ kind: 'trigger', ax: 0, ay: -3, az: 0, duration: 0.5, delay: 0, triggerId: 1 }, 5, null, o);
    expect(o.y).toBeCloseTo(0);
    evalMotion({ kind: 'trigger', ax: 0, ay: -3, az: 0, duration: 0.5, delay: 0, triggerId: 1 }, 5, 4, o);
    expect(o.y).toBeCloseTo(-3);
    expect(cycleVanish({ kind: 'cycle', period: 2, on: 0.6, phase: 0 }, 0.5).solid).toBe(true);
    expect(cycleVanish({ kind: 'cycle', period: 2, on: 0.6, phase: 0 }, 1.5).solid).toBe(false);
  });
});

describe('HazardSystem in the world', () => {
  const crusherLevel = () =>
    straightLevel(40, (b) => {
      b.floor(-3, 3, -2, 40);
      b.hazard({ ...crusher, minZ: 9, maxZ: 11 });
    });

  it('kills a player standing under a crusher', () => {
    const w = new World({ level: crusherLevel(), character: testCharacter });
    run(w, 1.2, (wd) => ({ moveZ: wd.player.body.z < 10 ? 1 : 0 }));
    run(w, 3, {});
    expect(w.events.log.some((e) => e.type === 'PLAYER_DEATH' && (e.payload as { cause: string }).cause === 'crushed')).toBe(true);
    expect(w.events.count('CRUSHER_SLAM')).toBeGreaterThan(0);
  });

  it('predicted danger matches actual hits', () => {
    const w = new World({ level: crusherLevel(), character: testCharacter });
    const id = w.hazards.list[0].id;
    const box = aabb(-0.35, 0, 9.65, 0.35, 1.4, 10.35);
    for (let t = 0; t < 5; t += 0.05) {
      const predicted = w.hazards.dangerAt(id, t, box, 0);
      const actual = hazardHit(crusher, t, box) !== null;
      expect(predicted).toBe(actual);
    }
  });

  it('a well-timed run under a crusher survives and may count as a near miss', () => {
    const w = new World({ level: crusherLevel(), character: testCharacter });
    // wait until the head has just risen past the player then sprint
    run(w, 0.05, {});
    const id = w.hazards.list[0].id;
    let go = false;
    run(w, 4, (wd) => {
      if (!go) {
        // safe if the next 0.6 s of crossing is clear
        let safe = true;
        for (let k = 0; k < 12; k++) {
          const t = wd.time + k * 0.05;
          const z = wd.player.body.z + 8 * k * 0.05;
          if (wd.hazards.dangerAt(id, t, aabb(-0.35, 0, z - 0.35, 0.35, 1.4, z + 0.35), 0.15)) safe = false;
        }
        if (safe && wd.player.body.z < 7) go = true;
      }
      return { moveZ: go ? 1 : 0 };
    });
    expect(w.deaths).toBe(0);
    expect(w.player.body.z).toBeGreaterThan(15);
  });

  it('spinner knocks the player back without killing', () => {
    const lvl = straightLevel(30, (b) => {
      b.floor(-6, 6, -2, 30);
      b.hazard({ kind: 'spinner', x: 0, y: 0.6, z: 8, radius: 3.5, thick: 0.2, omega: 2.4, phase: 0, arms: 2, lethal: false });
    });
    const w = new World({ level: lvl, character: testCharacter });
    run(w, 3, { moveZ: 1 });
    expect(w.events.count('SPINNER_HIT')).toBeGreaterThan(0);
    expect(w.events.count('PLAYER_DEATH')).toBe(0);
  });

  it('triggered floor collapse drops tiles in sequence', () => {
    const lvl = straightLevel(60, (b) => {
      b.floor(-3, 3, -2, 10);
      const tr = b.trigger(8, { kind: 'surprise', surprise: 'floorCollapse' });
      for (let i = 0; i < 6; i++)
        b.floor(-3, 3, 10 + i * 3, 13 + i * 3, 0, { style: 'tile', vanish: { kind: 'trigger', triggerId: tr.triggerId, delay: 1.2 + i * 0.45 } });
      b.floor(-3, 3, 28, 60);
    });
    const w = new World({ level: lvl, character: testCharacter });
    run(w, 5, { moveZ: 1 });
    expect(w.events.count('FLOOR_COLLAPSE')).toBe(1);
    expect(w.events.count('SURPRISE')).toBe(1);
    expect(w.deaths).toBe(0);
    const w2 = new World({ level: lvl, character: testCharacter });
    run(w2, 1.3, { moveZ: 1 });
    run(w2, 3, {});
    expect(w2.deaths).toBe(1);
  });

  it('door closes on trigger and blocks the path', () => {
    const lvl = straightLevel(40, (b) => {
      b.floor(-3, 3, -2, 40);
      const tr = b.trigger(5, { kind: 'event', event: 'DOOR_CLOSE' });
      b.solid(-3, 3, 3.2, 6.2, 14, 14.5, { style: 'door', motion: { kind: 'trigger', lx: 0, ly: -3.2, lz: 0, duration: 0.3, delay: 0, triggerId: tr.triggerId } });
    });
    const w = new World({ level: lvl, character: testCharacter });
    run(w, 4, { moveZ: 1 });
    expect(w.events.count('DOOR_CLOSE')).toBe(1);
    expect(w.player.body.z).toBeLessThan(14);
  });
});
