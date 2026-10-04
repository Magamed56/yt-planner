/** JUMP, MOVING_PLATFORM, DISAPPEARING_PLATFORM, NARROW_BRIDGE, CONVEYOR. */
import type { ModuleDef } from '../ModuleRegistry';
import { PAD, RUN, coinArc, coinLine, decorate, gapSpine, plantSurprise, runFloor, straightExit } from './common';

export const JUMP: ModuleDef = {
  type: 'JUMP',
  roles: ['obstacle', 'flow'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 1.4,
  estimate: (d) => (PAD * 2 + 2 * (d.gapMax + d.platformMax)) / RUN,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const n = Math.min(4, 1 + r.int(0, Math.round(d.level)));
    let lz = PAD;
    let y = 0;
    runFloor(ctx, 0, PAD, 0, hw);
    const chaseK = ctx.opts.inChase ? 0.85 : 1;
    for (let i = 0; i < n; i++) {
      let dy = 0;
      const roll = r.next();
      const chase = !!ctx.opts.inChase;
      if (roll < 0.18 && y < 6) dy = r.pick([0.8, 1.1]);
      else if (!chase && roll < 0.34 && y > -4) dy = -r.pick([0.8, 1.2]);
      let gap = r.range(d.gapMin, d.gapMax) * chaseK;
      if (dy > 0) gap = Math.min(gap, 3.5);
      const last = i === n - 1;
      let plat = last ? PAD + 0.5 : r.range(d.platformMin, d.platformMax);
      if (dy < 0) plat = Math.max(plat, 3.0);
      // during chases keep platforms long enough to land at full speed
      // (floaty themes fly further, so their chase platforms are longer too)
      if (chase && !last) plat = Math.max(plat, 4.6 * Math.max(1, ctx.rangeScale ?? 1));
      const hwP = last ? hw : hw * r.range(0.45, 0.9);
      const lat = last ? 0 : r.range(-(hw - hwP), hw - hwP);
      gapSpine(ctx, lz, lz + gap, y, y + dy, hw);
      const p = b.floor(lat - hwP, lat + hwP, lz + gap, lz + gap + plat, y + dy, { style: last ? 'floor' : 'platform' });
      b.hint({ kind: 'jump', s: b.sAt(lz - 0.35), landS: b.sAt(lz + gap + Math.min(1.2, plat / 2)), lateral: lat, targetId: p.id, dy });
      if (!last) b.hint({ kind: 'lane', s0: b.sAt(lz + gap), s1: b.sAt(lz + gap + plat), lateral: lat });
      coinArc(ctx, lz, lz + gap, y, y + dy, lat * 0.5, 2);
      lz += gap;
      y += dy;
      b.spinePoint(0, y, lz + plat, hw);
      lz += plat;
    }
    decorate(ctx, 0, lz, Math.min(0, y), 0.7, hw);
    plantSurprise(ctx, 1, 0, hw);
    return { exit: straightExit(ctx, lz, y), estTime: lz / RUN + 0.15 * n, tags: [`gaps:${n}`] };
  },
};

export const MOVING_PLATFORM: ModuleDef = {
  type: 'MOVING_PLATFORM',
  roles: ['obstacle'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: false,
  weight: () => 1.1,
  estimate: () => 5.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const variant = ctx.opts.variant ?? r.weighted(['sway', 'shuttle', 'elevator'], (v) => (v === 'elevator' ? (d.level >= 2 ? 0.8 : 0) : 1));
    runFloor(ctx, 0, PAD, 0, hw);
    const pw = 1.4; // platform half width
    let lz = PAD;
    let exitY = 0;
    let wait = 0;
    if (variant === 'sway') {
      const count = d.level >= 3 && r.chance(0.5) ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const g = r.range(1.4, 2.1);
        const pl = 2.8;
        const amp = r.range(1.6, 2.5) * (r.chance(0.5) ? 1 : -1);
        const period = r.range(2.6, 3.8) / d.obstacleSpeed;
        const p = b.floor(-pw, pw, lz + g, lz + g + pl, 0, {
          style: 'moving',
          motion: { kind: 'sine', lx: amp, ly: 0, lz: 0, period, phase: r.next() },
        });
        gapSpine(ctx, lz, lz + g + pl / 2, 0, 0, hw);
        b.hint({ kind: 'jump', s: b.sAt(lz - 0.3), landS: b.sAt(lz + g + pl / 2), lateral: 0, targetId: p.id, dy: 0 });
        b.hint({ kind: 'ride', pieceId: p.id, s0: b.sAt(lz + g), s1: b.sAt(lz + g + pl) });
        lz += g + pl;
        wait += period * 0.4;
      }
      const g2 = r.range(1.4, 2.1);
      gapSpine(ctx, lz - 1.4, lz + g2, 0, 0, hw);
      const exitPad = runFloor(ctx, lz + g2, lz + g2 + PAD + 0.5, 0, hw);
      b.hint({ kind: 'jump', s: b.sAt(lz - 0.3), landS: b.sAt(lz + g2 + 1), lateral: 0, targetId: exitPad.id, dy: 0 });
      lz += g2 + PAD + 0.5;
    } else if (variant === 'shuttle') {
      const pl = 2.8;
      const amp = r.range(2.2, 3.4);
      const gapNear = 1.0;
      const G = gapNear * 2 + pl + amp * 2;
      const period = r.range(3.4, 4.6) / Math.sqrt(d.obstacleSpeed);
      const centre = lz + G / 2;
      const p = b.floor(-pw, pw, centre - pl / 2, centre + pl / 2, 0, {
        style: 'moving',
        motion: { kind: 'pingpong', lx: 0, ly: 0, lz: amp, period, phase: r.next(), hold: 0.12 },
      });
      gapSpine(ctx, lz, lz + G, 0, 0, hw);
      b.hint({ kind: 'jump', s: b.sAt(lz - 0.3), landS: b.sAt(lz + gapNear + pl / 2), lateral: 0, targetId: p.id, dy: 0 });
      b.hint({ kind: 'ride', pieceId: p.id, s0: b.sAt(lz), s1: b.sAt(lz + G) });
      const exitPad = runFloor(ctx, lz + G, lz + G + PAD + 0.5, 0, hw);
      b.hint({ kind: 'jump', s: b.sAt(lz + G - gapNear - 0.4), landS: b.sAt(lz + G + 1), lateral: 0, targetId: exitPad.id, dy: 0 });
      lz += G + PAD + 0.5;
      wait += period * 0.7;
    } else {
      // elevator up to a higher exit
      const H = r.range(2.2, 3.0);
      const pl = 2.8;
      const g = 1.0;
      const period = r.range(3.6, 4.8) / Math.sqrt(d.obstacleSpeed);
      const p = b.solid(-pw, pw, H / 2 - 1, H / 2, lz + g, lz + g + pl, {
        style: 'moving',
        walkable: true,
        motion: { kind: 'pingpong', lx: 0, ly: H / 2, lz: 0, period, phase: r.next(), hold: 0.18 },
      });
      gapSpine(ctx, lz, lz + g + pl + g, 0, H, hw);
      b.hint({ kind: 'jump', s: b.sAt(lz - 0.3), landS: b.sAt(lz + g + pl / 2), lateral: 0, targetId: p.id, dy: 0 });
      b.hint({ kind: 'ride', pieceId: p.id, s0: b.sAt(lz + g), s1: b.sAt(lz + g + pl) });
      const exitPad = b.floor(-hw, hw, lz + g + pl + g, lz + g + pl + g + PAD + 0.5, H);
      b.spinePoint(0, H, lz + g + pl + g + PAD + 0.5, hw);
      b.hint({ kind: 'jump', s: b.sAt(lz + g + pl - 0.4), landS: b.sAt(lz + g + pl + g + 1), lateral: 0, targetId: exitPad.id, dy: H });
      // decorative shaft
      b.decor('elevatorFrame', 0, 0, lz + g + pl / 2, 0, 1);
      lz += g + pl + g + PAD + 0.5;
      exitY = H;
      wait += period * 0.8;
    }
    decorate(ctx, 0, lz, 0, 0.6, hw);
    coinLine(ctx, 0.5, PAD, 0, 0, 1);
    plantSurprise(ctx, 1, 0, hw);
    return { exit: straightExit(ctx, lz, exitY), estTime: lz / RUN + wait, tags: [variant] };
  },
};

export const DISAPPEARING_PLATFORM: ModuleDef = {
  type: 'DISAPPEARING_PLATFORM',
  roles: ['obstacle'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: false,
  weight: () => 1,
  estimate: () => 4.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const variant = ctx.opts.variant ?? (d.level >= 1.5 && r.chance(0.5) ? 'cycle' : 'step');
    const n = r.int(3, 4 + Math.round(d.level / 2));
    runFloor(ctx, 0, PAD, 0, hw);
    let lz = PAD;
    // cycle variant: A/B rhythm — even platforms solid in the first part of the
    // period, odd ones in the second, with an overlap window to hop across.
    const period = r.range(2.6, 3.4) / Math.sqrt(d.obstacleSpeed);
    const on = Math.min(0.66, 0.56 + 0.06 * d.timingWindow);
    const startLz = lz;
    for (let i = 0; i < n; i++) {
      const g = r.range(1.0, 1.9);
      const pl = r.range(2.0, 2.6);
      const half = 1.2;
      const lat = r.range(-(hw - half), hw - half) * 0.7;
      gapSpine(ctx, lz, lz + g, 0, 0, hw);
      const vanish =
        variant === 'cycle'
          ? { kind: 'cycle' as const, period, on, phase: i % 2 === 0 ? 0 : -0.5 }
          : { kind: 'step' as const, delay: r.range(0.45, 0.7) / Math.sqrt(d.obstacleSpeed), respawn: 2.6 };
      const p = b.floor(lat - half, lat + half, lz + g, lz + g + pl, 0, { style: variant === 'cycle' ? (i % 2 === 0 ? 'vanish' : 'vanishB') : 'vanish', vanish });
      b.hint({ kind: 'jump', s: b.sAt(lz - 0.3), landS: b.sAt(lz + g + pl / 2), lateral: lat, targetId: p.id, dy: 0 });
      b.hint({ kind: 'lane', s0: b.sAt(lz + g), s1: b.sAt(lz + g + pl), lateral: lat });
      coinArc(ctx, lz, lz + g, 0, 0, lat, 1);
      lz += g + pl;
      b.spinePoint(0, 0, lz, hw);
    }
    const g = r.range(1.0, 1.8);
    gapSpine(ctx, lz, lz + g, 0, 0, hw);
    const exitPad = runFloor(ctx, lz + g, lz + g + PAD + 0.5, 0, hw);
    b.hint({ kind: 'jump', s: b.sAt(lz - 0.3), landS: b.sAt(lz + g + 1), lateral: 0, targetId: exitPad.id, dy: 0 });
    if (variant === 'step') b.hint({ kind: 'nowait', s0: b.sAt(startLz), s1: b.sAt(lz + g) });
    lz += g + PAD + 0.5;
    decorate(ctx, 0, lz, 0, 0.6, hw);
    plantSurprise(ctx, 1, 0, hw);
    return { exit: straightExit(ctx, lz), estTime: lz / RUN + (variant === 'cycle' ? period * 0.5 * n : 0.3), tags: [variant] };
  },
};

export const NARROW_BRIDGE: ModuleDef = {
  type: 'NARROW_BRIDGE',
  roles: ['obstacle'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 0.9,
  estimate: () => 2.8,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const L = r.range(10, 17);
    const w = d.bridgeWidth;
    runFloor(ctx, 0, PAD, 0, hw);
    const zig = d.level >= 2.5 && r.chance(0.5);
    let lz = PAD;
    if (zig) {
      // three offset segments joined by small squares
      const seg = L / 3;
      const offs = [0, r.pick([-1, 1]) * 1.1, 0];
      for (let i = 0; i < 3; i++) {
        const o = offs[i];
        b.floor(o - w / 2, o + w / 2, lz, lz + seg, 0, { style: 'bridge' });
        // the spine runs straight down each segment and jogs diagonally across
        // the joining squares, so "lateral 0" (bot, camera) is always on the planks
        const a = i === 0 ? lz : lz + w / 2;
        const e = i === 2 ? lz + seg : lz + seg - w / 2;
        b.spinePoint(o, 0, a, w / 2);
        b.spinePoint(o, 0, e, w / 2);
        b.hint({ kind: 'lane', s0: b.sAt(a), s1: b.sAt(e), lateral: 0 });
        if (i < 2) {
          const o2 = offs[i + 1];
          b.floor(Math.min(o, o2) - w / 2, Math.max(o, o2) + w / 2, lz + seg - w / 2, lz + seg + w / 2, 0, { style: 'bridge' });
        }
        lz += seg;
      }
    } else {
      b.floor(-w / 2, w / 2, lz, lz + L, 0, { style: 'bridge' });
      b.spinePoint(0, 0, lz + L / 2, w / 2);
      b.hint({ kind: 'lane', s0: b.sAt(lz), s1: b.sAt(lz + L), lateral: 0 });
      lz += L;
    }
    b.spinePoint(0, 0, lz, w / 2);
    runFloor(ctx, lz, lz + PAD + 0.5, 0, hw);
    coinLine(ctx, PAD + 1, lz - 1, 0, 0);
    b.decor('chain', -w / 2 - 0.3, 3, PAD + L * 0.3, 0, 1);
    b.decor('chain', w / 2 + 0.3, 3, PAD + L * 0.7, 0, 1);
    lz += PAD + 0.5;
    decorate(ctx, 0, lz, -1, 0.8, hw);
    plantSurprise(ctx, PAD, 0, w / 2);
    return { exit: straightExit(ctx, lz), estTime: lz / (RUN * 0.85), tags: [zig ? 'zigzag' : 'straight'] };
  },
};

export const CONVEYOR: ModuleDef = {
  type: 'CONVEYOR',
  roles: ['obstacle', 'flow'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 0.8,
  estimate: () => 3.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const variant = ctx.opts.inChase ? 'boost' : ctx.opts.variant ?? r.weighted(['against', 'side', 'boost'], (v) => (v === 'boost' ? 0.5 : 1));
    runFloor(ctx, 0, PAD, 0, hw);
    const segs = r.int(2, 3);
    let lz = PAD;
    let slow = 0;
    for (let i = 0; i < segs; i++) {
      const L = r.range(6, 9);
      let conveyor = { lx: 0, lz: 0 };
      if (variant === 'against') conveyor = { lx: 0, lz: -r.range(2.8, 4.2) * d.obstacleSpeed };
      else if (variant === 'side') conveyor = { lx: (i % 2 === 0 ? 1 : -1) * r.range(1.6, 2.6) * d.obstacleSpeed, lz: 0 };
      else conveyor = { lx: 0, lz: r.range(3, 4.5) };
      runFloor(ctx, lz, lz + L, 0, hw, { style: 'conveyor', conveyor });
      if (variant === 'against') slow += L / (RUN + conveyor.lz) - L / RUN;
      lz += L;
    }
    if (variant !== 'boost') b.hint({ kind: 'sprint', s0: b.sAt(PAD), s1: b.sAt(lz) });
    runFloor(ctx, lz, lz + PAD, 0, hw);
    lz += PAD;
    coinLine(ctx, PAD, lz - PAD, 0, 0);
    decorate(ctx, 0, lz, 0, 1, hw);
    plantSurprise(ctx, PAD, 0, hw);
    return { exit: straightExit(ctx, lz), estTime: lz / RUN + slow, tags: [variant] };
  },
};
