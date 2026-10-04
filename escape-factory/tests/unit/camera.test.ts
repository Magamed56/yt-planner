import { describe, expect, it } from 'vitest';
import { CAMERA_MODES, CameraDirector, type CameraSubject } from '../../src/engine/camera/CameraDirector';
import { GAMEPLAY_STYLE, SHORTS_STYLE, VIDEO_STYLE } from '../../src/engine/camera/styles';
import { EventBus } from '../../src/engine/events/EventBus';
import type { GameEventMap, GameEventType } from '../../src/engine/events/GameEvents';

const subject = (over: Partial<CameraSubject> = {}): CameraSubject => ({
  x: 0,
  y: 0,
  z: 10,
  heading: 0,
  vy: 0,
  grounded: true,
  alive: true,
  groundY: -0.5,
  enemy: { x: 0, y: 0, z: 4, visible: true, chasing: true },
  ...over,
});

function setup(style = VIDEO_STYLE) {
  const bus = new EventBus();
  let t = 0;
  bus.setClock(() => ({ t, tick: 0 }));
  const d = new CameraDirector(style, bus);
  const s = subject();
  d.update(s, 0.016);
  const emit = <K extends GameEventType>(type: K, payload: Partial<GameEventMap[K]> = {}) =>
    bus.emit(type, { pos: { x: 0, y: 0, z: 10 }, ...payload } as GameEventMap[K]);
  const tick = (sec: number) => {
    for (let i = 0; i < Math.round(sec / 0.016); i++) {
      t += 0.016;
      d.update(s, 0.016);
    }
  };
  return { bus, d, s, emit, tick };
}

describe('CameraDirector', () => {
  it('reacts to events with the specified shots', () => {
    const cases: Array<[GameEventType, string, object?]> = [
      ['ENEMY_APPEAR', 'WIDE', { mode: 'peek' }],
      ['ENEMY_NEAR', 'CHASE', { gap: 3 }],
      ['PLAYER_NEAR_DEATH', 'DRAMATIC', { cause: 'crusher', margin: 0.2 }],
      ['FINAL_ESCAPE', 'WIDE'],
      ['OBSTACLE_BREAK', 'IMPACT', { kind: 'crate' }],
      ['PLAYER_FINISH', 'FINISH', { time: 30, deaths: 0, coins: 3 }],
      ['BOSS_START', 'WIDE'],
      ['CHASE_START', 'FRONT', { s: 10 }],
      ['ENEMY_GRAB', 'IMPACT'],
    ];
    for (const [type, mode, payload] of cases) {
      const { d, emit, tick } = setup();
      tick(0.1);
      emit(type, payload as never);
      expect(d.mode, type).toBe(mode);
    }
  });

  it('PLAYER_FALL follows the player', () => {
    const { d, emit, tick } = setup();
    tick(0.1);
    d.request('SIDE', 0, 5, 'test');
    emit('PLAYER_FALL');
    expect(d.mode).toBe('FOLLOW');
  });

  it('respects priorities and hold times', () => {
    const { d, emit, tick } = setup();
    emit('PLAYER_FINISH', { time: 1, deaths: 0, coins: 0 });
    expect(d.mode).toBe('FINISH');
    emit('ENEMY_NEAR', { gap: 3 });
    expect(d.mode).toBe('FINISH');
    tick(4.5);
    emit('ENEMY_NEAR', { gap: 3 });
    expect(d.mode).toBe('CHASE');
  });

  it('applies slow motion and eases back to real time', () => {
    const { d, emit, tick } = setup();
    emit('PLAYER_NEAR_DEATH', { cause: 'laser', margin: 0.1 });
    tick(0.1);
    expect(d.timeScale).toBeLessThan(0.5);
    tick(1.6);
    expect(d.timeScale).toBe(1);
  });

  it('rotates coverage shots when nothing happens (and uses chase coverage while chasing)', () => {
    const { d, tick } = setup();
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      tick(0.5);
      seen.add(d.mode);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const m of seen) expect(VIDEO_STYLE.chaseBase).toContain(m);
  });

  it('every mode yields a finite pose looking near the player, never below the floor', () => {
    for (const portrait of [false, true]) {
      for (const mode of CAMERA_MODES) {
        const { d, s, tick } = setup();
        d.portrait = portrait;
        d.request(mode, 99, 10, 'test', true, { x: 1, y: 0, z: 12 });
        tick(0.5);
        const p = d.pose;
        for (const v of [p.x, p.y, p.z, p.tx, p.ty, p.tz, p.fov]) expect(Number.isFinite(v)).toBe(true);
        expect(p.y).toBeGreaterThanOrEqual(s.groundY + 0.35 - 1e-6);
        const camToSubject = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
        expect(camToSubject, mode).toBeLessThan(45);
        const targetToSubject = Math.hypot(p.tx - s.x, p.tz - s.z);
        expect(targetToSubject, mode).toBeLessThan(12);
        expect(p.fov).toBeGreaterThan(30);
        expect(p.fov).toBeLessThan(80);
      }
    }
  });

  it('cuts snap instantly, blends move smoothly', () => {
    const { d, s, tick } = setup();
    tick(1);
    d.request('TOP', 50, 5, 'test', true);
    tick(0.016);
    const topY = d.pose.y;
    expect(topY).toBeGreaterThan(s.y + 10);
    d.request('LOW', 60, 5, 'test', false);
    tick(0.016);
    expect(d.pose.y).toBeGreaterThan(s.y + 8); // still moving down smoothly
    tick(3);
    expect(d.pose.y).toBeLessThan(s.y + 1);
  });

  it('gameplay style keeps the follow camera during normal play', () => {
    const { d, emit, tick } = setup(GAMEPLAY_STYLE);
    for (const t of ['ENEMY_NEAR', 'PLAYER_NEAR_DEATH', 'OBSTACLE_BREAK', 'PLAYER_JUMP'] as GameEventType[]) {
      emit(t, {} as never);
      tick(0.2);
      expect(d.mode).toBe('FOLLOW');
    }
    expect(d.timeScale).toBe(1);
  });

  it('portrait shorts style frames wider', () => {
    const { d, tick } = setup(SHORTS_STYLE);
    d.portrait = true;
    d.request('FOLLOW', 99, 5, 'test', true);
    tick(0.5);
    expect(d.pose.fov).toBeGreaterThanOrEqual(65);
  });

  it('is deterministic for the same event sequence', () => {
    const runOnce = () => {
      const { d, emit, tick } = setup();
      for (let i = 0; i < 20; i++) {
        tick(0.7);
        if (i % 3 === 0) emit('ENEMY_NEAR', { gap: 2.5 });
        if (i % 5 === 0) emit('PLAYER_JUMP', { speed: 8 });
      }
      return d.log.map((l) => `${l.mode}:${l.cause}`).join('|');
    };
    expect(runOnce()).toBe(runOnce());
  });
});
