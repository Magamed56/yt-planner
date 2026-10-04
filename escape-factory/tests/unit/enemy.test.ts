import { describe, expect, it } from 'vitest';
import { World } from '../../src/engine/sim/World';
import { GRUMBO } from '../../src/game/enemies/grumbo';
import { run, straightLevel, testCharacter } from './helpers';

const chaseLevel = (difficulty = 1) => {
  const lvl = straightLevel(400, (b) => {
    b.floor(-3, 3, -2, 400);
    b.trigger(10, { kind: 'chaseStart', intensity: 0.6 });
    b.checkpoint(5);
  });
  return { ...lvl, difficulty };
};

describe('Enemy (Grumbo)', () => {
  it('spawns dormant and emits ENEMY_SPAWN', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO });
    expect(w.enemy!.state).toBe('dormant');
    expect(w.events.count('ENEMY_SPAWN')).toBe(1);
  });

  it('starts chasing when the chase trigger fires', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO });
    run(w, 2, { moveZ: 1 });
    expect(w.enemy!.state).toBe('chase');
    expect(w.events.count('CHASE_START')).toBe(1);
    expect(w.events.count('ENEMY_CHASE')).toBe(1);
    expect(w.events.count('ENEMY_APPEAR')).toBe(1);
  });

  it('catches a player who stops running', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO });
    run(w, 2, { moveZ: 1 });
    run(w, 6, {});
    expect(w.events.count('ENEMY_GRAB')).toBe(1);
    expect(w.events.log.some((e) => e.type === 'PLAYER_FAIL' && (e.payload as { reason: string }).reason === 'caught')).toBe(true);
  });

  it('never catches a player running at full speed, but gets scarily close', () => {
    for (const d of [1, 3, 5]) {
      const w = new World({ level: chaseLevel(d), character: testCharacter, enemy: GRUMBO });
      run(w, 40, { moveZ: 1 });
      expect(w.events.count('ENEMY_GRAB')).toBe(0);
      expect(w.events.count('ENEMY_NEAR')).toBeGreaterThan(0);
      expect(w.events.count('ENEMY_ROAR')).toBeGreaterThan(1);
    }
  });

  it('peeks then disappears', () => {
    const lvl = straightLevel(200, (b) => {
      b.floor(-3, 3, -2, 200);
      const p = b.w(8, 0, 40);
      b.trigger(2, { kind: 'enemyPeek', x: p.x, y: p.y, z: p.z, duration: 2 });
    });
    const w = new World({ level: lvl, character: testCharacter, enemy: GRUMBO });
    run(w, 1.5, { moveZ: 0.3 });
    expect(w.enemy!.state).toBe('peek');
    run(w, 4, { moveZ: 0.3 });
    expect(w.events.count('ENEMY_APPEAR')).toBe(1);
    expect(w.events.count('ENEMY_DISAPPEAR')).toBe(1);
  });

  it('resets to dormant after the player respawns', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO });
    run(w, 2, { moveZ: 1 });
    run(w, 6, {});
    run(w, 3, {});
    expect(w.events.count('PLAYER_RESPAWN')).toBe(1);
    expect(w.enemy!.state === 'dormant' || w.enemy!.state === 'chase').toBe(true);
    // chase trigger beyond the checkpoint re-arms
    run(w, 2, { moveZ: 1 });
    expect(w.events.count('CHASE_START')).toBe(2);
  });

  it('smashes breakable crates during a chase (OBSTACLE_BREAK)', () => {
    const lvl = straightLevel(300, (b) => {
      b.floor(-3, 3, -2, 300);
      b.trigger(5, { kind: 'chaseStart', intensity: 0.5 });
      for (let i = 0; i < 6; i++) b.solid(2, 2.8, 0, 0.8, 20 + i * 10, 20.8 + i * 10, { style: 'crate', breakable: true });
    });
    const w = new World({ level: lvl, character: testCharacter, enemy: GRUMBO });
    run(w, 15, { moveZ: 1 });
    expect(w.events.log.filter((e) => e.type === 'OBSTACLE_BREAK').length).toBeGreaterThan(3);
  });

  it('mercy tuning prevents catching (cinematic takes)', () => {
    const w = new World({ level: chaseLevel(), character: testCharacter, enemy: GRUMBO, enemyTuning: { mercy: true } });
    run(w, 2, { moveZ: 1 });
    run(w, 6, {});
    expect(w.events.count('ENEMY_GRAB')).toBe(0);
  });

  it('is deterministic', () => {
    const a = new World({ level: chaseLevel(3), character: testCharacter, enemy: GRUMBO });
    const b = new World({ level: chaseLevel(3), character: testCharacter, enemy: GRUMBO });
    const script = (w: World) => ({ moveZ: w.time % 5 < 4 ? 1 : 0.2 });
    run(a, 30, script);
    run(b, 30, script);
    expect(a.enemy!.s).toBe(b.enemy!.s);
    expect(a.events.log.map((e) => e.type)).toEqual(b.events.log.map((e) => e.type));
  });
});
