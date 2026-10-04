import { describe, expect, it } from 'vitest';
import { generateLevel } from '../../src/engine/level/LevelGenerator';
import { LevelBuilder } from '../../src/engine/level/LevelBuilder';
import { finalizeLevel } from '../../src/engine/level/finalize';
import { resolveDifficulty } from '../../src/engine/level/difficulty';
import { Rng } from '../../src/engine/core/rng';
import { CHECKPOINT, FINISH, STRAIGHT } from '../../src/engine/level/modules/basic';
import type { ModuleContext, ModuleDef } from '../../src/engine/level/ModuleRegistry';
import type { LevelData, ModuleInstance, TriggerPiece } from '../../src/engine/level/types';
import { World } from '../../src/engine/sim/World';
import { musicIntensity } from '../../src/engine/audio/AudioSystem';
import { GRUMBO } from '../../src/game/enemies/grumbo';
import { run, testCharacter } from './helpers';

/** Builds a level by running real module generators in sequence. */
function buildLevel(seq: Array<[ModuleDef, ModuleContext['opts']]>, difficulty = 1): LevelData {
  const b = new LevelBuilder();
  const diff = resolveDifficulty(difficulty);
  const rng = new Rng(5);
  let frame = { x: 0, y: 0, z: 0, dir: 0 as const } as ModuleInstance['entry'];
  const mods: ModuleInstance[] = [];
  b.spinePoint(0, 0, -2, 3);
  b.floor(-3, 3, -4, 0);
  seq.forEach(([def, opts], i) => {
    b.begin(frame, i);
    const r = def.generate({ b, rng, diff, index: i, count: seq.length, opts, decor: [], enemy: 'grumbo' });
    const s1 = b.spine[b.spine.length - 1].s;
    mods.push({ index: i, type: def.type, s0: b.s0, s1, entry: frame, exit: r.exit, footprint: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }, estTime: r.estTime, estStart: 0, beat: !!r.beat, tags: [] });
    frame = r.exit;
  });
  return finalizeLevel(b, { seed: 1, difficulty, theme: 'FACTORY', enemy: 'grumbo', specialEvents: [], modules: mods, spawn: { x: 0, y: 0, z: -1, dir: 0 }, generationMs: 0 });
}

const triggers = (l: LevelData) => l.pieces.filter((p): p is TriggerPiece => p.type === 'trigger').sort((a, b) => a.s - b.s);

describe('Chase system', () => {
  it('every chase in generated levels ends with a door slam at a checkpoint', () => {
    for (let i = 0; i < 60; i++) {
      const l = generateLevel({ seed: 7000 + i, difficulty: 1 + (i % 5) });
      const ts = triggers(l);
      let open = false;
      for (const t of ts) {
        if (t.action.kind === 'chaseStart') {
          expect(open, `seed ${l.seed}: nested chase`).toBe(false);
          open = true;
        }
        if (t.action.kind === 'chaseEnd') {
          expect(open, `seed ${l.seed}: chaseEnd without start`).toBe(true);
          open = false;
          const door = ts.find((d) => d.action.kind === 'event' && d.action.event === 'DOOR_CLOSE' && Math.abs(d.s - t.s) < 0.01);
          expect(door, `seed ${l.seed}: no door slam`).toBeTruthy();
          const slab = l.pieces.find((p) => p.type === 'solid' && p.motion?.kind === 'trigger' && p.motion.triggerId === door!.triggerId);
          expect(slab, `seed ${l.seed}: no door slab`).toBeTruthy();
        }
      }
      expect(open).toBe(false);
      // final escape before the finish
      const fe = ts.find((t) => t.action.kind === 'finalEscape');
      expect(fe, `seed ${l.seed}: no final escape`).toBeTruthy();
      expect(fe!.s).toBeLessThan(l.finish!.s);
      expect(l.finish!.s - fe!.s).toBeGreaterThan(15);
    }
  });

  it('boss levels contain boss start/end triggers around the arena', () => {
    const l = generateLevel({ seed: 1010, difficulty: 2.5, specialEvents: ['boss'] });
    const ts = triggers(l);
    const bs = ts.find((t) => t.action.kind === 'bossStart');
    const be = ts.find((t) => t.action.kind === 'bossEnd');
    expect(bs && be).toBeTruthy();
    expect(be!.s - bs!.s).toBeGreaterThan(30);
    expect(l.pieces.some((p) => p.type === 'hazard' && p.hazard.kind === 'slam')).toBe(true);
  });

  const chaseLevel = () =>
    buildLevel([
      [STRAIGHT, {}],
      [{ ...STRAIGHT, generate: (c) => { c.b.trigger(c.b.sAt(1), { kind: 'chaseStart', intensity: 0.6 }); return STRAIGHT.generate(c); } }, { inChase: true }],
      [STRAIGHT, { inChase: true }],
      [CHECKPOINT, { endsChase: true }],
      [STRAIGHT, {}],
      [FINISH, {}],
    ]);

  it('a full-speed escape ends the chase: door slam, Grumbo bonks, retreats, vanishes', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO });
    let steps = 0;
    w.events.on('ENEMY_STEP', () => steps++);
    let sawVisibleRetreat = false;
    run(w, 14, (wd) => {
      if (wd.enemy!.state === 'retreat' && wd.enemy!.visible > 0.9) sawVisibleRetreat = true;
      return { moveZ: 1 };
    });
    expect(w.events.count('CHASE_START')).toBe(1);
    expect(w.events.count('CHASE_END')).toBe(1);
    expect(w.events.count('DOOR_CLOSE')).toBe(1);
    expect(w.events.count('ENEMY_RETREAT')).toBe(1);
    expect(w.events.count('ENEMY_GRAB')).toBe(0);
    expect(sawVisibleRetreat).toBe(true);
    expect(steps).toBeGreaterThan(5);
    expect(w.enemy!.state).toBe('dormant');
    expect(w.status).toBe('finished');
  });

  it('music intensity rises during the chase and drops at the finish', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO });
    expect(musicIntensity(w)).toBeCloseTo(0.3);
    let peak = 0;
    run(w, 14, (wd) => {
      peak = Math.max(peak, musicIntensity(wd));
      return { moveZ: 1 };
    });
    expect(peak).toBeGreaterThanOrEqual(0.78);
    expect(musicIntensity(w)).toBeCloseTo(0.2);
  });

  it('final escape keeps chasing after a respawn behind it', () => {
    const lvl = buildLevel([
      [CHECKPOINT, {}],
      [{ ...STRAIGHT, generate: (c) => { c.b.trigger(c.b.sAt(1), { kind: 'finalEscape' }); return STRAIGHT.generate(c); } }, { inChase: true }],
      [STRAIGHT, { inChase: true }],
      [FINISH, {}],
    ]);
    const w = new World({ level: lvl, character: testCharacter, enemy: GRUMBO });
    run(w, 2.5, { moveZ: 1 });
    expect(w.events.count('FINAL_ESCAPE')).toBe(1);
    expect(w.enemy!.isFinalEscape).toBe(true);
    run(w, 6, {}); // stop → caught
    expect(w.events.count('ENEMY_GRAB')).toBe(1);
    run(w, 3, {});
    expect(w.events.count('PLAYER_RESPAWN')).toBe(1);
    // the final-escape trigger lies beyond the checkpoint so it re-fires when passed again
    run(w, 3, { moveZ: 1 });
    expect(w.events.count('FINAL_ESCAPE')).toBe(2);
  });
});
