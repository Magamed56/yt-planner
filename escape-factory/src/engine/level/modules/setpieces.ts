/** CHASE and BOSS set pieces. */
import type { ModuleDef } from '../ModuleRegistry';
import { PAD, RUN, breakables, coinArc, coinLine, decorate, gapSpine, runFloor, sideWalls, straightExit } from './common';

export const CHASE: ModuleDef = {
  type: 'CHASE',
  roles: ['special'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: true,
  weight: () => 0,
  estimate: () => 5.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const variant = ctx.opts.variant ?? r.weighted(['corridor', 'gaps', 'collapse'], (v) => (v === 'collapse' ? 0.7 : 1));
    const intensity = Math.min(1, 0.35 + d.level * 0.13);
    runFloor(ctx, 0, PAD + 2, 0, hw);
    // the chase starts with a roar right behind the player
    b.trigger(b.sAt(2), { kind: 'chaseStart', intensity });
    b.decor('alarmLight', -hw - 0.4, 2.5, 3, 0, 1);
    b.decor('alarmLight', hw + 0.4, 2.5, 3, 0, 1);
    let lz = PAD + 2;
    if (variant === 'collapse') {
      const L = r.range(30, 40);
      const tr = b.trigger(b.sAt(lz + 0.5), { kind: 'surprise', surprise: 'floorCollapse' });
      const speed = 6.0 + d.level * 0.2;
      for (let z = 0; z < L; z += 2.5) {
        const z1 = Math.min(L, z + 2.5);
        b.floor(-hw, hw, lz + z, lz + z1, 0, { style: 'tile', vanish: { kind: 'trigger', triggerId: tr.triggerId, delay: 1.0 + z / speed } });
      }
      b.spinePoint(0, 0, lz + L, hw);
      b.hint({ kind: 'nowait', s0: b.sAt(lz), s1: b.sAt(lz + L) });
      breakables(ctx, lz, lz + L, 0, r.int(4, 7), hw);
      coinLine(ctx, lz, lz + L, 0, 0);
      lz += L;
    } else {
      const segments = r.int(3, 4 + Math.round(d.level / 2));
      for (let i = 0; i < segments; i++) {
        const segL = r.range(7, 11);
        runFloor(ctx, lz, lz + segL, 0, hw);
        const kind = variant === 'gaps' && i % 2 === 1 ? 'gap' : r.weighted(['barrier', 'none', 'gap'], (k) => (k === 'gap' ? 0.6 : 1));
        if (kind === 'barrier') {
          const bz = lz + segL * r.range(0.45, 0.7);
          b.solid(-hw, hw, 0, 0.6, bz - 0.25, bz + 0.25, { style: 'barrier', walkable: false, breakable: true });
          b.hint({ kind: 'jump', s: b.sAt(bz - 1.5), landS: b.sAt(bz + 1.5), lateral: 0, targetId: -1, dy: 0 });
        }
        breakables(ctx, lz + 0.5, lz + segL - 0.5, 0, r.int(1, 3), hw);
        coinLine(ctx, lz + 1, lz + segL - 1, 0, r.pick([-1, 0, 1]) * hw * 0.5, 2);
        lz += segL;
        if (kind === 'gap') {
          const g = r.range(d.gapMin, Math.min(d.gapMax, d.gapMin + 1.2));
          gapSpine(ctx, lz, lz + g, 0, 0, hw);
          const p = runFloor(ctx, lz + g, lz + g + 3, 0, hw);
          b.hint({ kind: 'jump', s: b.sAt(lz - 0.35), landS: b.sAt(lz + g + 1.2), lateral: 0, targetId: p.id, dy: 0 });
          coinArc(ctx, lz, lz + g, 0, 0, 0, 2);
          lz += g + 3;
        }
      }
      if (variant === 'corridor') sideWalls(ctx, PAD + 2, lz, 0, hw, 3.4);
      b.hint({ kind: 'nowait', s0: b.sAt(PAD + 2), s1: b.sAt(lz) });
    }
    b.hint({ kind: 'sprint', s0: b.sAt(0), s1: b.sAt(lz) });
    runFloor(ctx, lz, lz + PAD, 0, hw);
    lz += PAD;
    decorate(ctx, 0, lz, 0, 0.8, hw + 0.5);
    return { exit: straightExit(ctx, lz), estTime: lz / RUN, beat: true, tags: [variant] };
  },
};

export const BOSS: ModuleDef = {
  type: 'BOSS',
  roles: ['special'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: true,
  weight: () => 0,
  estimate: () => 8,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const W = hw + 3.2; // arena half width
    const A = 40;
    runFloor(ctx, 0, PAD, 0, hw);
    const a0 = PAD;
    b.floor(-W, W, a0, a0 + A, 0, { style: 'floor' });
    b.spinePoint(0, 0, a0 + A, hw);
    // Grumbo stands on a pedestal beside the arena
    const side = r.sign();
    const bx = side * (W + 4.5);
    const bz = a0 + A * 0.5;
    b.solid(bx - 3, bx + 3, -1, 0.6, bz - 3, bz + 3, { style: 'platform', walkable: false });
    b.decor('bossPedestal', bx, 0.6, bz, 0, 1);
    const laneW = (2 * W) / 3;
    const lanes = [0, 1, 2].map((i) => -W + laneW * (i + 0.5));
    const zA = a0 + 8;
    const zB = a0 + A - 6;
    const laneBoxes = lanes.map((lx) => {
      const box = b.box(lx - laneW / 2 + 0.05, lx + laneW / 2 - 0.05, 0, 0, zA, zB);
      return { minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ };
    });
    const start = b.trigger(b.sAt(a0 + 0.8), { kind: 'fire' });
    const pattern: number[] = [];
    for (let i = 0; i < 8; i++) {
      let lane = r.int(0, 2);
      if (pattern.length && lane === pattern[pattern.length - 1]) lane = (lane + 1 + r.int(0, 1)) % 3;
      pattern.push(lane);
    }
    const slam = b.hazard({
      kind: 'slam',
      lanes: laneBoxes,
      floorY: b.frame.y,
      pattern,
      interval: r.range(1.05, 1.4) / Math.sqrt(d.obstacleSpeed),
      warn: Math.min(1.0, 0.8 * d.timingWindow),
      active: 0.28,
      triggerId: start.triggerId,
    });
    const ids = [slam.id];
    const rollers = d.level >= 2 ? 2 : 1;
    for (let i = 0; i < rollers; i++) {
      const lane = i === 0 ? r.pick([0, 2]) : 1;
      const s0 = b.w(lanes[lane], 0.55, a0 + A - 1);
      const s1 = b.w(lanes[lane], 0.55, a0 + 1);
      const len = Math.hypot(s1.x - s0.x, s1.z - s0.z);
      const sp = r.range(6, 7.5);
      const h = b.hazard({
        kind: 'roller',
        sx: s0.x,
        sy: s0.y,
        sz: s0.z,
        vx: ((s1.x - s0.x) / len) * sp,
        vz: ((s1.z - s0.z) / len) * sp,
        radius: 0.55,
        period: r.range(2.4, 3.2),
        phase: r.next(),
        travel: len,
        triggerId: start.triggerId,
      });
      ids.push(h.id);
    }
    const g = b.w(bx, 0.6, bz);
    b.trigger(b.sAt(a0 + 0.6), { kind: 'bossStart', x: g.x, y: g.y, z: g.z, hazardId: slam.id });
    b.trigger(b.sAt(a0 + A - 3), { kind: 'bossEnd' });
    b.hint({ kind: 'arena', s0: b.sAt(a0), s1: b.sAt(a0 + A), lanes, hazardIds: ids });
    coinLine(ctx, a0 + 2, a0 + A - 2, 0, r.pick(lanes));
    for (const s of [-1, 1]) {
      b.decor('bossBanner', s * (W + 0.5), 0, a0 + 2, 0, 1);
      b.decor('bossBanner', s * (W + 0.5), 0, a0 + A - 2, 0, 1);
    }
    runFloor(ctx, a0 + A, a0 + A + PAD, 0, hw);
    const L = a0 + A + PAD;
    decorate(ctx, 0, L, 0, 0.5, W + 1);
    return { exit: straightExit(ctx, L), estTime: L / RUN + 2.5, beat: true, tags: ['boss'] };
  },
};
