import { describe, expect, it } from 'vitest';
import { Rng, hashData, hashString, mixSeed } from '../../src/engine/core/rng';
import { FixedLoop } from '../../src/engine/core/FixedLoop';
import { Pool } from '../../src/engine/core/Pool';
import { EventBus } from '../../src/engine/events/EventBus';
import { smoothDamp, wrapAngle, aabbOverlap, aabbFromCenter } from '../../src/engine/core/math';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(1001);
    const b = new Rng(1001);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  it('differs between seeds', () => {
    const a = new Rng(1001);
    const b = new Rng(1002);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });
  it('produces values in range with reasonable distribution', () => {
    const r = new Rng('dist');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(850);
    for (let i = 0; i < 500; i++) {
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });
  it('fork produces independent but reproducible streams', () => {
    const a = new Rng(5).fork('bot');
    const b = new Rng(5).fork('bot');
    const c = new Rng(5).fork('level');
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
  });
  it('weighted never picks zero weight', () => {
    const r = new Rng(9);
    for (let i = 0; i < 200; i++) expect(r.weighted(['a', 'b'], (x) => (x === 'a' ? 0 : 1))).toBe('b');
  });
  it('hash helpers are stable', () => {
    expect(hashString('escape')).toBe(hashString('escape'));
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
    expect(hashData({ b: 1, a: [1, 2] })).toBe(hashData({ a: [1, 2], b: 1 }));
  });
});

describe('FixedLoop', () => {
  it('steps in fixed increments and carries remainder', () => {
    const loop = new FixedLoop(1 / 60);
    let n = 0;
    loop.advance(1 / 30, () => n++);
    expect(n).toBe(2);
    loop.advance(1 / 120, () => n++);
    expect(n).toBe(2);
    loop.advance(1 / 120, () => n++);
    expect(n).toBe(3);
  });
  it('respects time scale (slow motion)', () => {
    const loop = new FixedLoop(1 / 60);
    let n = 0;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => n++, 0.5);
    expect(n).toBe(30);
  });
});

describe('Pool', () => {
  it('reuses released objects', () => {
    const pool = new Pool(() => ({ v: 0 }), (o) => (o.v = 0), 2);
    const a = pool.acquire()!;
    a.v = 5;
    pool.release(a);
    const b = pool.acquire()!;
    expect(b).toBe(a);
    expect(b.v).toBe(0);
    expect(pool.totalCreated).toBe(2);
  });
  it('honours max', () => {
    const pool = new Pool(() => ({}), undefined, 0, 1);
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
  });
});

describe('EventBus', () => {
  it('delivers typed events with sim clock and logs them', () => {
    const bus = new EventBus();
    let t = 1.5;
    bus.setClock(() => ({ t, tick: 90 }));
    const got: number[] = [];
    bus.on('PLAYER_JUMP', (e) => got.push(e.t));
    let any = 0;
    bus.onAny(() => any++);
    bus.emit('PLAYER_JUMP', { pos: { x: 0, y: 0, z: 0 }, speed: 8 });
    t = 2;
    bus.emit('DOOR_CLOSE', { pos: { x: 0, y: 0, z: 0 }, id: 1 });
    expect(got).toEqual([1.5]);
    expect(any).toBe(2);
    expect(bus.log.map((e) => e.type)).toEqual(['PLAYER_JUMP', 'DOOR_CLOSE']);
  });
  it('unsubscribes', () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.on('ALARM', () => n++);
    bus.emit('ALARM', { pos: { x: 0, y: 0, z: 0 }, duration: 1 });
    off();
    bus.emit('ALARM', { pos: { x: 0, y: 0, z: 0 }, duration: 1 });
    expect(n).toBe(1);
  });
});

describe('math', () => {
  it('wrapAngle stays in range', () => {
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
  });
  it('smoothDamp converges', () => {
    const s = { v: 0 };
    let x = 0;
    for (let i = 0; i < 300; i++) x = smoothDamp(x, 10, s, 0.3, 1 / 60);
    expect(x).toBeCloseTo(10, 2);
  });
  it('aabb overlap', () => {
    expect(aabbOverlap(aabbFromCenter(0, 0, 0, 1, 1, 1), aabbFromCenter(1.5, 0, 0, 1, 1, 1))).toBe(true);
    expect(aabbOverlap(aabbFromCenter(0, 0, 0, 1, 1, 1), aabbFromCenter(2.5, 0, 0, 1, 1, 1))).toBe(false);
  });
});
