/** SPINNER, CRUSHER, LASER, FALLING_OBJECT, WALL, DOOR, TRAP. */
import type { ModuleDef } from '../ModuleRegistry';
import { PAD, RUN, breakables, coinLine, decorate, plantSurprise, runFloor, sideWalls, straightExit } from './common';

export const SPINNER: ModuleDef = {
  type: 'SPINNER',
  roles: ['danger'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: false,
  weight: () => 1,
  estimate: () => 3.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    runFloor(ctx, 0, PAD, 0, hw);
    const count = d.level >= 3 && r.chance(0.45) ? 2 : 1;
    let lz = PAD;
    const R = hw + 0.4;
    let wait = 0;
    for (let i = 0; i < count; i++) {
      const L = 2 * R + 1.2;
      runFloor(ctx, lz, lz + L, 0, R + 0.6);
      const c = b.w(0, 0.55, lz + L / 2);
      const arms = Math.min(3, 1 + r.int(0, Math.round(d.level / 2)));
      const omega = r.range(1.5, 2.3) * d.obstacleSpeed * r.sign();
      const h = b.hazard({ kind: 'spinner', x: c.x, y: c.y, z: c.z, radius: R, thick: 0.17, omega, phase: r.range(0, Math.PI * 2), arms, lethal: false });
      b.hint({ kind: 'gate', s0: b.sAt(lz - 0.4), s1: b.sAt(lz + L + 0.2), lateral: 0, hazardIds: [h.id], blockerIds: [], supportIds: [], jumps: [] });
      b.decor('warningSign', R + 0.9, 0, lz + 0.5, 0, 1);
      lz += L;
      wait += (Math.PI / Math.abs(omega) / arms) * 0.5;
      if (i < count - 1) {
        // safe pad between spinners so the runner can wait for the next one
        runFloor(ctx, lz, lz + 2.6, 0, hw);
        lz += 2.6;
      }
    }
    runFloor(ctx, lz, lz + PAD, 0, hw);
    lz += PAD;
    coinLine(ctx, PAD, lz - PAD, 0, 0, 2);
    decorate(ctx, 0, lz, 0, 0.7, hw + 1);
    plantSurprise(ctx, 1, 0, hw);
    return { exit: straightExit(ctx, lz), estTime: lz / RUN + wait + 0.4, tags: [`spinners:${count}`] };
  },
};

export const CRUSHER: ModuleDef = {
  type: 'CRUSHER',
  roles: ['danger'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: false,
  weight: () => 1.1,
  estimate: (d) => 4 + d.level * 0.4,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const k = Math.min(3, 1 + r.int(0, Math.ceil(d.level / 2)));
    const spacing = 3.2;
    const depth = 2.0;
    const L = PAD + k * (depth + spacing) + PAD - spacing + 1;
    runFloor(ctx, 0, L, 0, hw);
    sideWalls(ctx, PAD - 0.5, L - PAD + 0.5, 0, hw, 4.2);
    let wait = 0;
    const basePhase = r.next();
    for (let i = 0; i < k; i++) {
      const cz0 = PAD + i * (depth + spacing);
      const box = b.box(-hw, hw, 0, 0, cz0, cz0 + depth);
      const period = r.range(2.2, 3.0) / d.obstacleSpeed;
      const h = b.hazard({
        kind: 'crusher',
        minX: box.minX,
        maxX: box.maxX,
        minZ: box.minZ,
        maxZ: box.maxZ,
        floorY: b.frame.y,
        topY: b.frame.y + 3.2,
        period,
        phase: basePhase + i * r.range(0.18, 0.4),
      });
      b.hint({ kind: 'gate', s0: b.sAt(cz0 - 1.1), s1: b.sAt(cz0 + depth + 0.5), lateral: 0, hazardIds: [h.id], blockerIds: [], supportIds: [], jumps: [] });
      wait += period * 0.5;
    }
    coinLine(ctx, PAD, L - PAD, 0, 0, k + 1);
    decorate(ctx, 0, L, 0, 0.5, hw + 0.5);
    plantSurprise(ctx, 0.5, 0, hw);
    return { exit: straightExit(ctx, L), estTime: L / RUN + wait, tags: [`crushers:${k}`] };
  },
};

export const LASER: ModuleDef = {
  type: 'LASER',
  roles: ['danger'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: false,
  weight: () => 1.1,
  estimate: () => 4,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const variant = ctx.opts.variant ?? r.weighted(['blink', 'low', 'sweep'], (v) => (v === 'sweep' ? (d.level >= 2 ? 0.8 : 0) : 1));
    const k = Math.min(4, 2 + r.int(0, Math.round(d.level / 2)));
    const spacing = variant === 'low' ? 3.6 : 3.2;
    const L = PAD * 2 + k * spacing;
    runFloor(ctx, 0, L, 0, hw);
    sideWalls(ctx, PAD - 0.4, L - PAD + 0.4, 0, hw, 3.2);
    const ids: number[] = [];
    let wait = 0;
    if (variant === 'sweep') {
      // vertical beams sweeping across the corridor: dodge sideways
      for (let i = 0; i < Math.min(2, k - 1); i++) {
        const lz = PAD + 2 + i * 5;
        const a = b.w(0, 0.05, lz);
        const top = b.w(0, 2.8, lz);
        const sweepDir = b.w(1, 0, lz);
        const period = r.range(2.4, 3.4) / d.obstacleSpeed;
        const amp = hw - 0.3;
        const h = b.hazard({
          kind: 'laser',
          ax: a.x,
          ay: a.y,
          az: a.z,
          bx: top.x,
          by: top.y,
          bz: top.z,
          radius: 0.1,
          period: 10,
          on: 1,
          phase: 0,
          sweep: { dx: (sweepDir.x - a.x) * amp, dy: 0, dz: (sweepDir.z - a.z) * amp, period, phase: r.next() },
        });
        ids.push(h.id);
        b.hint({ kind: 'gate', s0: b.sAt(lz - 1.3), s1: b.sAt(lz + 0.6), lateral: 0, hazardIds: [h.id], blockerIds: [], supportIds: [], jumps: [] });
        wait += period * 0.3;
      }
    } else {
      for (let i = 0; i < k; i++) {
        const lz = PAD + spacing * (i + 0.5);
        const low = variant === 'low' || r.chance(0.35);
        const hgt = low ? 0.45 : r.pick([0.9, 1.1]);
        const a = b.w(-hw + 0.05, hgt, lz);
        const c = b.w(hw - 0.05, hgt, lz);
        const period = r.range(1.8, 2.6) / d.obstacleSpeed;
        const on = variant === 'low' ? 1 : Math.min(0.62, 0.42 / d.timingWindow);
        const h = b.hazard({ kind: 'laser', ax: a.x, ay: a.y, az: a.z, bx: c.x, by: c.y, bz: c.z, radius: 0.08, period, on, phase: r.next() });
        ids.push(h.id);
        if (on >= 1) {
          // always-on low beam = a barrier you jump over
          b.hint({ kind: 'jump', s: b.sAt(lz - 1.35), landS: b.sAt(lz + 2.2), lateral: 0, targetId: -1, dy: 0 });
          wait += 0.1;
        } else {
          b.hint({ kind: 'gate', s0: b.sAt(lz - 1.6), s1: b.sAt(lz + 0.7), lateral: 0, hazardIds: [h.id], blockerIds: [], supportIds: [], jumps: [] });
          wait += period * on * 0.5;
        }
      }
    }
    coinLine(ctx, PAD, L - PAD, 0, 0, k);
    decorate(ctx, 0, L, 0, 0.5, hw + 0.5);
    plantSurprise(ctx, 0.5, 0, hw);
    return { exit: straightExit(ctx, L), estTime: L / RUN + wait, tags: [variant, `lasers:${ids.length}`] };
  },
};

export const FALLING_OBJECT: ModuleDef = {
  type: 'FALLING_OBJECT',
  roles: ['danger', 'flow'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 1,
  estimate: () => 3.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const L = r.range(18, 26);
    runFloor(ctx, 0, L, 0, hw);
    const lanes = [-hw * 0.62, 0, hw * 0.62];
    const m = Math.min(7, 3 + Math.round(d.level * (ctx.opts.inChase ? 0.5 : 0.8)));
    const ids: number[] = [];
    for (let i = 0; i < m; i++) {
      const lz = PAD + 1 + ((i + 0.5) / m) * (L - PAD * 2 - 2);
      const lat = r.pick(lanes);
      const w = b.w(lat, 0, lz);
      const period = r.range(1.9, 2.8) / Math.sqrt(d.obstacleSpeed);
      const h = b.hazard({
        kind: 'faller',
        x: w.x,
        z: w.z,
        floorY: b.frame.y,
        topY: b.frame.y + 9,
        size: 1.15,
        period,
        phase: r.next(),
        warn: Math.min(0.5, (0.75 * d.timingWindow) / period),
        drop: 0.14 / period,
      });
      ids.push(h.id);
    }
    b.hint({ kind: 'arena', s0: b.sAt(1), s1: b.sAt(L - 1), lanes, hazardIds: ids });
    if (r.chance(0.5)) sideWalls(ctx, 0, L, 0, hw, 3.6);
    coinLine(ctx, 2, L - 2, 0, r.pick(lanes));
    decorate(ctx, 0, L, 0, 0.8, hw + 0.5);
    plantSurprise(ctx, 1, 0, hw);
    return { exit: straightExit(ctx, L), estTime: L / RUN + 0.8, tags: [`fallers:${m}`] };
  },
};

export const WALL: ModuleDef = {
  type: 'WALL',
  roles: ['danger'],
  chaseSafe: false,
  minDifficulty: 1.5,
  beat: false,
  weight: () => 0.9,
  estimate: () => 3.5,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const k = Math.min(4, 2 + r.int(0, Math.round(d.level / 2)));
    const spacing = 4;
    const L = PAD * 2 + k * spacing;
    runFloor(ctx, 0, L, 0, hw);
    let side = r.sign();
    const reach = 1.5 * hw; // 75 % of the track width when extended
    for (let i = 0; i < k; i++) {
      const lz = PAD + spacing * i + 1.2;
      const depth = 1.6;
      const period = r.range(2.2, 3.2) / d.obstacleSpeed;
      const centre = side * hw;
      b.solid(centre - reach / 2, centre + reach / 2, 0, 2.6, lz, lz + depth, {
        style: 'pusher',
        walkable: false,
        motion: { kind: 'pingpong', lx: side * (reach / 2), ly: 0, lz: 0, period, phase: r.next(), hold: 0.2 },
      });
      b.solid(side * (hw + reach) - 0.3, side * (hw + reach) + 0.3, -1, 3.2, lz - 0.3, lz + depth + 0.3, { style: 'wall', walkable: false });
      // safe lane is on the opposite side of the pusher
      b.hint({ kind: 'lane', s0: b.sAt(lz - 1.8), s1: b.sAt(lz + depth + 0.4), lateral: -side * hw * 0.72 });
      side = -side as 1 | -1;
    }
    coinLine(ctx, PAD, L - PAD, 0, 0, k);
    decorate(ctx, 0, L, 0, 0.6, hw + 2);
    plantSurprise(ctx, 1, 0, hw);
    return { exit: straightExit(ctx, L), estTime: L / RUN + 0.6, tags: [`walls:${k}`] };
  },
};

export const DOOR: ModuleDef = {
  type: 'DOOR',
  roles: ['danger'],
  chaseSafe: false,
  minDifficulty: 1,
  beat: true,
  weight: () => 0.9,
  estimate: () => 3,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = Math.max(2.6, d.trackHalfWidth);
    const doorZ = PAD + 11;
    const L = doorZ + 1 + PAD + 2;
    runFloor(ctx, 0, L, 0, hw);
    sideWalls(ctx, doorZ - 4, doorZ + 1, 0, hw, 3.4);
    const lanes = [-hw * 0.64, 0, hw * 0.64];
    const dw = Math.min(1.6, hw * 0.48);
    // wall with three doorways
    const edges = [-hw, lanes[0] - dw / 2, lanes[0] + dw / 2, lanes[1] - dw / 2, lanes[1] + dw / 2, lanes[2] - dw / 2, lanes[2] + dw / 2, hw];
    for (let i = 0; i < edges.length; i += 2) b.solid(edges[i], edges[i + 1], 0, 3.4, doorZ, doorZ + 1, { style: 'wall', walkable: false });
    b.solid(-hw, hw, 3.0, 3.6, doorZ, doorZ + 1, { style: 'wall', walkable: false });
    const trigS = b.sAt(doorZ - 8);
    const tr = b.trigger(trigS, { kind: 'event', event: 'DOOR_CLOSE' });
    const order = r.shuffle([0, 1, 2]);
    const closing = d.level >= 2.5 && r.chance(0.5) ? 2 : 1;
    const doorIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const willClose = order.indexOf(i) < closing;
      const p = b.solid(lanes[i] - dw / 2, lanes[i] + dw / 2, 3.0, 6.0, doorZ + 0.25, doorZ + 0.75, {
        style: 'door',
        walkable: false,
        motion: willClose ? { kind: 'trigger', lx: 0, ly: -3.0, lz: 0, duration: 0.22, delay: r.range(0.1, 0.45), triggerId: tr.triggerId } : undefined,
      });
      doorIds.push(p.id);
    }
    b.hint({ kind: 'choice', s0: trigS, s1: b.sAt(doorZ + 3.2), options: lanes, blockerIds: doorIds });
    // with two doors left open, Grumbo may burst out of one of them
    const open = [0, 1, 2].filter((i) => order.indexOf(i) >= closing);
    if (ctx.enemy !== 'none' && open.length >= 2 && !ctx.opts.inChase && r.chance(0.55)) {
      const blockLane = r.pick(open);
      const p = b.w(lanes[blockLane], 0, doorZ + 1.3);
      b.trigger(b.sAt(doorZ - 9), { kind: 'enemyBlock', x: p.x, y: p.y, z: p.z, lateral: lanes[blockLane] });
    }
    b.decor('alarmLight', -hw + 0.3, 3.4, doorZ - 0.1, 0, 1);
    b.decor('alarmLight', hw - 0.3, 3.4, doorZ - 0.1, 0, 1);
    coinLine(ctx, 2, doorZ - 1, 0, 0, 3);
    decorate(ctx, 0, L, 0, 0.5, hw + 0.5);
    return { exit: straightExit(ctx, L), estTime: L / RUN + 0.6, beat: true, tags: [`closing:${closing}`] };
  },
};

export const TRAP: ModuleDef = {
  type: 'TRAP',
  roles: ['danger', 'flow'],
  chaseSafe: true,
  minDifficulty: 1,
  beat: false,
  weight: () => 1,
  estimate: () => 3,
  generate(ctx) {
    const b = ctx.b;
    const r = ctx.rng;
    const d = ctx.diff;
    const hw = d.trackHalfWidth;
    const variant = ctx.opts.variant ?? (ctx.opts.inChase || r.chance(0.45) ? 'collapse' : 'trapdoors');
    runFloor(ctx, 0, PAD, 0, hw);
    let lz = PAD;
    let beat = false;
    if (variant === 'collapse') {
      // the whole floor falls away behind the runner
      const L = r.range(18, 26);
      const tr = b.trigger(b.sAt(PAD + 0.5), { kind: 'surprise', surprise: 'floorCollapse' });
      const speed = 6.2 + d.level * 0.25;
      const tile = 2.4;
      for (let z = 0; z < L; z += tile) {
        const z1 = Math.min(L, z + tile);
        b.floor(-hw, hw, lz + z, lz + z1, 0, { style: 'tile', vanish: { kind: 'trigger', triggerId: tr.triggerId, delay: 0.6 + z / speed } });
      }
      b.spinePoint(0, 0, lz + L, hw);
      b.hint({ kind: 'nowait', s0: b.sAt(lz), s1: b.sAt(lz + L) });
      b.hint({ kind: 'sprint', s0: b.sAt(lz), s1: b.sAt(lz + L) });
      breakables(ctx, lz, lz + L, 0, 2, hw);
      lz += L;
      beat = true;
    } else {
      // checkerboard of trapdoors with one guaranteed safe path
      const cols = 3;
      const cw = (2 * hw) / cols;
      const rows = r.int(4, 6 + Math.round(d.level / 2));
      const rowL = 2.4;
      let safeCol = r.int(0, cols - 1);
      for (let row = 0; row < rows; row++) {
        if (row > 0 && r.chance(0.5)) safeCol = Math.max(0, Math.min(cols - 1, safeCol + r.sign()));
        for (let c = 0; c < cols; c++) {
          const x0 = -hw + c * cw;
          const trap = c !== safeCol && r.chance(0.55 + d.trapDensity * 0.35);
          b.floor(x0 + 0.03, x0 + cw - 0.03, lz, lz + rowL, 0, {
            style: trap ? 'trap' : 'tile',
            vanish: trap ? { kind: 'step', delay: 0.32, respawn: 3 } : undefined,
          });
        }
        b.hint({ kind: 'lane', s0: b.sAt(lz), s1: b.sAt(lz + rowL), lateral: -hw + (safeCol + 0.5) * cw });
        lz += rowL;
      }
      b.spinePoint(0, 0, lz, hw);
      b.hint({ kind: 'nowait', s0: b.sAt(PAD), s1: b.sAt(lz) });
    }
    runFloor(ctx, lz, lz + PAD, 0, hw);
    lz += PAD;
    b.decor('warningSign', hw + 0.8, 0, 1, 0, 1, 1);
    coinLine(ctx, PAD, lz - PAD, 0, 0);
    decorate(ctx, 0, lz, 0, 0.6, hw);
    plantSurprise(ctx, 0.5, 0, hw);
    return { exit: straightExit(ctx, lz), estTime: lz / RUN + 0.2, beat, tags: [variant] };
  },
};
