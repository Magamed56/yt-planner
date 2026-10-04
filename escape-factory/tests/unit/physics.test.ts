import { describe, expect, it } from 'vitest';
import { World } from '../../src/engine/sim/World';
import { PhysicsWorld } from '../../src/engine/physics/PhysicsWorld';
import { KinematicBody } from '../../src/engine/physics/KinematicBody';
import { aabb } from '../../src/engine/core/math';
import { REFERENCE_STATS } from '../../src/engine/character/CharacterDef';
import { run, straightLevel, testCharacter } from './helpers';

describe('KinematicBody', () => {
  it('falls under gravity and lands on a floor', () => {
    const w = new PhysicsWorld();
    w.addStatic(aabb(-5, -1, -5, 5, 0, 5));
    const b = new KinematicBody();
    b.setPosition(0, 3, 0);
    for (let i = 0; i < 120; i++) {
      b.vy -= 32 / 60;
      b.move(w, 1 / 60);
    }
    expect(b.grounded).toBe(true);
    expect(b.y).toBeCloseTo(0, 3);
  });

  it('is blocked by walls', () => {
    const w = new PhysicsWorld();
    w.addStatic(aabb(-5, -1, -5, 5, 0, 20));
    w.addStatic(aabb(-5, 0, 5, 5, 3, 6));
    const b = new KinematicBody();
    b.setPosition(0, 0, 0);
    for (let i = 0; i < 120; i++) {
      b.vz = 8;
      b.vy -= 0.5;
      b.move(w, 1 / 60);
    }
    expect(b.z).toBeLessThan(5 - 0.34);
    expect(b.z).toBeGreaterThan(4.5);
    expect(b.hitWall).toBe(true);
  });

  it('steps up small ledges but not tall ones', () => {
    const w = new PhysicsWorld();
    w.addStatic(aabb(-5, -1, -5, 5, 0, 20));
    w.addStatic(aabb(-5, 0, 4, 5, 0.3, 20));
    const b = new KinematicBody();
    b.setPosition(0, 0, 0);
    for (let i = 0; i < 90; i++) {
      b.vz = 6;
      b.vy -= 0.5;
      b.move(w, 1 / 60);
    }
    expect(b.y).toBeCloseTo(0.3, 2);
    expect(b.z).toBeGreaterThan(6);
  });

  it('is carried by kinematic platforms', () => {
    const w = new PhysicsWorld();
    const plat = w.addKinematic(aabb(-1, -1, -1, 1, 0, 1));
    const b = new KinematicBody();
    b.setPosition(0, 0.01, 0);
    for (let i = 0; i < 60; i++) {
      w.moveKinematic(plat, plat.minX + 0.05, plat.minY, plat.minZ);
      b.vy -= 0.5;
      b.move(w, 1 / 60);
    }
    expect(b.x).toBeCloseTo(2.95, 2);
    expect(b.grounded).toBe(true);
  });

  it('detects crushing between kinematic and static solids', () => {
    const w = new PhysicsWorld();
    w.addStatic(aabb(-5, -1, -5, 5, 0, 5));
    w.addStatic(aabb(1, 0, -5, 3, 3, 5)); // wall on the right
    const pusher = w.addKinematic(aabb(-3, 0, -1, -1, 2, 1));
    const b = new KinematicBody();
    b.setPosition(0.5, 0, 0);
    let crushed = false;
    for (let i = 0; i < 60 && !crushed; i++) {
      w.moveKinematic(pusher, pusher.minX + 0.1, pusher.minY, pusher.minZ);
      b.vy -= 0.5;
      b.move(w, 1 / 60);
      crushed = b.crushed;
    }
    expect(crushed).toBe(true);
  });
});

describe('Player controller', () => {
  const flat = () =>
    straightLevel(80, (b) => {
      b.floor(-3, 3, -2, 80);
    });

  it('reaches run speed on flat ground', () => {
    const w = new World({ level: flat(), character: testCharacter });
    run(w, 1, { moveZ: 1 });
    expect(w.player.speed).toBeCloseTo(REFERENCE_STATS.runSpeed, 1);
    expect(w.player.body.grounded).toBe(true);
    expect(w.playerS).toBeGreaterThan(6);
  });

  it('jumps about 2.25 m high and emits jump/land events', () => {
    const w = new World({ level: flat(), character: testCharacter });
    run(w, 0.2, {});
    let maxY = 0;
    let first = true;
    run(w, 1.2, (wd) => {
      maxY = Math.max(maxY, wd.player.body.y);
      const r = { jump: true, jumpPressed: first };
      first = false;
      return r;
    });
    expect(maxY).toBeGreaterThan(2.1);
    expect(maxY).toBeLessThan(2.4);
    expect(w.events.count('PLAYER_JUMP')).toBe(1);
    expect(w.events.count('PLAYER_LAND')).toBeGreaterThanOrEqual(1);
  });

  it('short hop when jump is released early (variable height)', () => {
    const w = new World({ level: flat(), character: testCharacter });
    run(w, 0.2, {});
    let maxY = 0;
    let i = 0;
    run(w, 1, (wd) => {
      maxY = Math.max(maxY, wd.player.body.y);
      i++;
      return { jump: i < 4, jumpPressed: i === 1 };
    });
    expect(maxY).toBeLessThan(1.4);
  });

  const gapLevel = () =>
    straightLevel(60, (b) => {
      b.floor(-3, 3, -2, 20);
      b.spinePoint(0, 0, 20, 3);
      b.spinePoint(0, 0, 23.5, 3, true);
      b.floor(-3, 3, 23.5, 60);
    });

  it('clears a 3.5 m gap with a running jump', () => {
    const w = new World({ level: gapLevel(), character: testCharacter });
    let jumped = false;
    run(w, 4, (wd) => {
      const press = !jumped && wd.player.body.z > 19.2;
      if (press) jumped = true;
      return { moveZ: 1, jump: true, jumpPressed: press };
    });
    expect(w.deaths).toBe(0);
    expect(w.player.body.z).toBeGreaterThan(24);
    expect(w.player.body.grounded).toBe(true);
  });

  it('falls into a gap without jumping, dies and respawns', () => {
    const w = new World({ level: gapLevel(), character: testCharacter });
    run(w, 3.6, { moveZ: 1 });
    expect(w.events.count('PLAYER_FALL')).toBe(1);
    expect(w.deaths).toBe(1);
    expect(w.events.log.some((e) => e.type === 'PLAYER_FAIL' && (e.payload as { reason: string }).reason === 'fell')).toBe(
      true,
    );
    run(w, 1.5, {});
    expect(w.events.count('PLAYER_RESPAWN')).toBe(1);
    expect(w.player.body.z).toBeLessThan(3);
  });

  it('conveyor pushes the player backwards', () => {
    const lvl = straightLevel(40, (b) => {
      b.floor(-3, 3, -2, 5);
      b.floor(-3, 3, 5, 40, 0, { style: 'conveyor', conveyor: { lx: 0, lz: -5 } });
    });
    const w = new World({ level: lvl, character: testCharacter });
    run(w, 0.3, {});
    run(w, 2, { moveZ: 1 });
    const zWithConveyor = w.player.body.z;
    const w2 = new World({ level: flat(), character: testCharacter });
    run(w2, 0.3, {});
    run(w2, 2, { moveZ: 1 });
    expect(zWithConveyor).toBeLessThan(w2.player.body.z - 4);
  });

  it('step platforms collapse after being stood on', () => {
    const lvl = straightLevel(40, (b) => {
      b.floor(-3, 3, -2, 4);
      b.floor(-1, 1, 4, 6, 0, { style: 'trap', vanish: { kind: 'step', delay: 0.4, respawn: 0 } });
    });
    const w = new World({ level: lvl, character: testCharacter });
    run(w, 0.3, {});
    run(w, 0.5, (wd) => ({ moveZ: wd.player.body.z < 5 ? 1 : 0 }));
    run(w, 1.5, {});
    expect(w.events.count('TRAP_TRIGGER')).toBe(1);
    expect(w.events.count('PLATFORM_FALL')).toBe(1);
    expect(w.deaths).toBe(1);
  });

  it('is deterministic for identical inputs', () => {
    const make = () => new World({ level: gapLevel(), character: testCharacter });
    const a = make();
    const b = make();
    const script = (wd: World) => ({ moveZ: 1, moveX: Math.sin(wd.time * 3) * 0.5, jump: true, jumpPressed: wd.tick % 50 === 0 });
    run(a, 5, script);
    run(b, 5, script);
    expect(a.player.body.x).toBe(b.player.body.x);
    expect(a.player.body.z).toBe(b.player.body.z);
    expect(a.events.log.length).toBe(b.events.log.length);
  });
});
