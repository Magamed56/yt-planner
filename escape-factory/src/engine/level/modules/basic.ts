/** START, STRAIGHT, TURN, CHECKPOINT, FINISH. */
import type { ModuleDef } from '../ModuleRegistry';
import { localToWorld, turnLeft, turnRight } from '../types';
import {
  PAD,
  RUN,
  breakables,
  coinLine,
  decorate,
  floorSurface,
  plantSurprise,
  runFloor,
  sideWalls,
  straightExit,
} from './common';

export const START: ModuleDef = {
  type: 'START',
  roles: ['special'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: true,
  weight: () => 0,
  estimate: () => 2.5,
  generate(ctx) {
    const b = ctx.b;
    const hw = ctx.diff.trackHalfWidth;
    const L = 16;
    b.spinePoint(0, 0, 0, hw);
    b.floor(-hw - 1.5, hw + 1.5, -6, L, 0, { style: 'floor' });
    b.spinePoint(0, 0, L, hw);
    // the gate behind the player slams shut: no way back
    b.solid(-hw - 1.5, hw + 1.5, 0, 4.5, -6.6, -6, { style: 'wall', walkable: false });
    b.decor('gate', 0, 0, -5.8, 0, 1);
    b.decor('sign', -hw - 1.0, 0, 3, 0, 1, 0);
    b.decor('lamp', hw + 1.0, 0, 6, 0, 1);
    b.decor('lamp', -hw - 1.0, 0, 12, 0, 1);
    decorate(ctx, 0, L, 0, 0.8, hw + 1.5);
    coinLine(ctx, 5, L - 1, 0, 0, 3);
    if (ctx.enemy !== 'none') {
      // HOOK: Grumbo watches the player from a balcony far ahead
      const side = ctx.rng.sign();
      const lat = side * (hw + 8);
      const ahead = 34;
      const ly = 2.5;
      b.decor('balcony', lat, ly, ahead, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
      const p = b.w(lat, ly, ahead);
      b.trigger(b.sAt(1.2), { kind: 'enemyPeek', x: p.x, y: p.y, z: p.z, duration: 3.2 });
    }
    return { exit: straightExit(ctx, L), estTime: L / RUN + 1, beat: true, tags: ['spawn'] };
  },
};

export const STRAIGHT: ModuleDef = {
  type: 'STRAIGHT',
  roles: ['explore', 'flow'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 1,
  estimate: () => 2.4,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const hw = ctx.diff.trackHalfWidth;
    const L = r.range(14, 22);
    const corridor = r.chance(0.45);
    let barrierAt = -1;
    if (ctx.opts.surprise === 'floorCollapse') {
      // floor collapses BEHIND the runner: "the floor disappeared!"
      runFloor(ctx, 0, 3.5, 0, hw);
      const tr = b.trigger(b.sAt(4), { kind: 'surprise', surprise: 'floorCollapse' });
      const tile = 2.5;
      let lz = 3.5;
      while (lz < L - 2.5) {
        const lz1 = Math.min(L - 2.5, lz + tile);
        b.floor(-hw, hw, lz, lz1, 0, { style: 'tile', vanish: { kind: 'trigger', triggerId: tr.triggerId, delay: 0.55 + (lz - 4) / 6.4 } });
        lz = lz1;
      }
      b.spinePoint(0, 0, L - 2.5, hw);
      runFloor(ctx, L - 2.5, L, 0, hw);
      b.hint({ kind: 'nowait', s0: b.sAt(3.5), s1: b.sAt(L - 2.5) });
      b.hint({ kind: 'sprint', s0: b.sAt(3.5), s1: b.sAt(L) });
    } else {
      runFloor(ctx, 0, L, 0, hw, { surface: floorSurface(ctx) });
      if (ctx.diff.level >= 1.8 && r.chance(ctx.diff.trapDensity * 0.6)) {
        barrierAt = r.range(L * 0.4, L * 0.7);
        b.solid(-hw, hw, 0, 0.65, barrierAt - 0.25, barrierAt + 0.25, { style: 'barrier', walkable: false, breakable: ctx.opts.inChase });
        b.hint({ kind: 'jump', s: b.sAt(barrierAt - 1.5), landS: b.sAt(barrierAt + 1.5), lateral: 0, targetId: -1, dy: 0 });
      }
    }
    if (corridor) sideWalls(ctx, 0, L, 0, hw);
    decorate(ctx, 0, L, 0, corridor ? 0.6 : 1.1, hw + (corridor ? 0.5 : 0));
    breakables(ctx, 1.5, L - 1.5, 0, ctx.opts.inChase ? r.int(3, 5) : r.int(0, 2), hw);
    coinLine(ctx, 2, L - 2, 0, r.pick([-hw * 0.5, 0, hw * 0.5]));
    if (ctx.opts.surprise !== 'floorCollapse') plantSurprise(ctx, L * 0.3, 0, hw);
    return {
      exit: straightExit(ctx, L),
      estTime: L / RUN + (barrierAt > 0 ? 0.2 : 0),
      tags: [corridor ? 'corridor' : 'catwalk', ...(ctx.opts.surprise ? ['surprise'] : [])],
    };
  },
};

export const TURN: ModuleDef = {
  type: 'TURN',
  roles: ['explore', 'flow'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 1,
  estimate: (d) => (2 * d.trackHalfWidth + 1.5) / RUN + 0.4,
  generate(ctx) {
    const b = ctx.b;
    const hw = ctx.diff.trackHalfWidth;
    const S = 2 * hw + 1.5;
    const left = ctx.opts.turn !== 'right';
    const sg = left ? -1 : 1;
    b.floor(-S / 2, S / 2, 0, S, 0, { style: 'floor', surface: floorSurface(ctx) });
    // quarter-circle spine around the inner corner
    const cx = sg * (S / 2);
    for (let i = 1; i <= 6; i++) {
      const th = (i / 6) * (Math.PI / 2);
      const lx = cx - sg * (S / 2) * Math.cos(th);
      const lz = (S / 2) * Math.sin(th);
      b.spinePoint(lx, 0, lz, hw);
    }
    // outer walls make the corner read clearly
    if (ctx.rng.chance(0.6)) {
      b.solid(-sg * (S / 2) - sg * 0.45 - 0.0, -sg * (S / 2), -1, 3.4, 0, S, { style: 'wall', walkable: false });
      b.solid(-S / 2 - 0.45, S / 2 + 0.45, -1, 3.4, S, S + 0.45, { style: 'wall', walkable: false });
      b.decor('arrowSign', -sg * (S / 2 - 0.3), 1.6, S * 0.5, left ? -Math.PI / 2 : Math.PI / 2, 1, left ? 0 : 1);
    }
    b.decor('beacon', sg * (S / 2) - sg * 0.4, 0, S - 0.4, 0, 1);
    coinLine(ctx, 1, S / 2, 0, 0, 2);
    plantSurprise(ctx, S / 2, 0, hw);
    const w = localToWorld(b.frame, sg * (S / 2), 0, S / 2);
    const dir = left ? turnLeft(b.frame.dir) : turnRight(b.frame.dir);
    return { exit: { x: w.x, y: w.y, z: w.z, dir }, estTime: S / RUN + 0.4, tags: [left ? 'left' : 'right'] };
  },
};

export const CHECKPOINT: ModuleDef = {
  type: 'CHECKPOINT',
  roles: ['special'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 0,
  estimate: () => 1.3,
  generate(ctx) {
    const b = ctx.b;
    const hw = ctx.diff.trackHalfWidth + 0.8;
    const L = 10;
    runFloor(ctx, 0, L, 0, hw, { style: 'floor' }, hw);
    const ends = !!ctx.opts.endsChase;
    if (ends) {
      // ESCAPE: a blast door slams shut right behind the player — Grumbo bonks into it
      const s = b.sAt(2.4);
      const tr = b.trigger(s, { kind: 'event', event: 'DOOR_CLOSE' });
      b.trigger(s, { kind: 'chaseEnd' });
      b.solid(-hw - 0.5, hw + 0.5, 3.6, 7.4, 0.2, 0.9, {
        style: 'door',
        walkable: false,
        motion: { kind: 'trigger', lx: 0, ly: -3.6, lz: 0, duration: 0.22, delay: 0.05, triggerId: tr.triggerId },
      });
      b.solid(-hw - 1.3, -hw - 0.5, -1, 7.4, 0, 1.1, { style: 'wall', walkable: false });
      b.solid(hw + 0.5, hw + 1.3, -1, 7.4, 0, 1.1, { style: 'wall', walkable: false });
      b.solid(-hw - 1.3, hw + 1.3, 7.4, 8.2, 0, 1.1, { style: 'wall', walkable: false });
    }
    b.checkpoint(5.2);
    b.decor('checkpointBeacon', hw - 0.6, 0, 5.2, 0, 1);
    b.decor('checkpointBeacon', -hw + 0.6, 0, 5.2, 0, 1);
    decorate(ctx, 0, L, 0, 0.6, hw);
    coinLine(ctx, 6.5, L - 0.5, 0, 0, 2);
    return { exit: straightExit(ctx, L), estTime: L / RUN, beat: ends, tags: ends ? ['escape'] : [] };
  },
};

export const FINISH: ModuleDef = {
  type: 'FINISH',
  roles: ['special'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: true,
  weight: () => 0,
  estimate: () => 2,
  generate(ctx) {
    const b = ctx.b;
    const hw = ctx.diff.trackHalfWidth + 0.6;
    const L = 20;
    runFloor(ctx, 0, 13, 0, hw);
    b.floor(-hw - 3, hw + 3, 13, L, 0, { style: 'finish' });
    b.spinePoint(0, 0, L, hw);
    b.setFinish(-hw, hw, 12.2, 14);
    b.decor('exitGate', 0, 0, 12.6, 0, 1);
    b.decor('confettiCannon', -hw - 1.5, 0, 14, 0, 1);
    b.decor('confettiCannon', hw + 1.5, 0, 14, 0, 1);
    coinLine(ctx, 2, 11, 0, 0, 4);
    if (ctx.opts.finalEscape) b.trigger(b.sAt(0.5), { kind: 'finalEscape' });
    return { exit: straightExit(ctx, L), estTime: 13 / RUN, beat: true, tags: ['finish'] };
  },
};

export { PAD };
