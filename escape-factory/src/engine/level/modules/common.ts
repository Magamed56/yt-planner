/**
 * Shared authoring helpers for module generators. Everything is in module
 * local coordinates (lx right, ly up, lz forward).
 */
import type { ModuleContext } from '../ModuleRegistry';
import type { Frame, SolidPiece, SurfaceType } from '../types';
import { localToWorld } from '../types';
import type { SolidOpts } from '../LevelBuilder';

/** Standard entry/exit pad length. */
export const PAD = 2.5;
/** Reference run speed used for time estimates. */
export const RUN = 8;

export function straightExit(ctx: ModuleContext, length: number, dy = 0): Frame {
  const f = ctx.b.frame;
  const w = localToWorld(f, 0, dy, length);
  return { x: w.x, y: w.y, z: w.z, dir: f.dir };
}

/** Plain-floor surface (theme may turn some floors to ice / jelly). */
export function floorSurface(ctx: ModuleContext): SurfaceType {
  const fs = ctx.floorSurface;
  if (fs && ctx.rng.chance(fs.chance)) return fs.surface;
  return 'default';
}

/** Adds a floor slab plus spine points at both ends (centre line). */
export function runFloor(
  ctx: ModuleContext,
  lz0: number,
  lz1: number,
  y = 0,
  hw = ctx.diff.trackHalfWidth,
  o: SolidOpts = {},
  spineHw = hw,
): SolidPiece {
  const p = ctx.b.floor(-hw, hw, lz0, lz1, y, o);
  ctx.b.spinePoint(0, y, lz0, spineHw);
  ctx.b.spinePoint(0, y, lz1, spineHw);
  return p;
}

/** Marks a gap on the spine between two floors. */
export function gapSpine(ctx: ModuleContext, lz0: number, lz1: number, y0: number, y1: number, hw = ctx.diff.trackHalfWidth): void {
  ctx.b.spinePoint(0, y0, lz0, hw);
  ctx.b.spinePoint(0, (y0 + y1) / 2, (lz0 + lz1) / 2, hw, true);
  ctx.b.spinePoint(0, y1, lz1, hw);
}

/** Tall side walls (corridor feel; prevents falling off the sides). */
export function sideWalls(ctx: ModuleContext, lz0: number, lz1: number, y = 0, hw = ctx.diff.trackHalfWidth, height = 3.4): void {
  ctx.b.solid(-hw - 0.45, -hw, y - 1, y + height, lz0, lz1, { style: 'wall', walkable: false });
  ctx.b.solid(hw, hw + 0.45, y - 1, y + height, lz0, lz1, { style: 'wall', walkable: false });
}

/** Decorations along both sides, outside the walkable area. */
export function decorate(ctx: ModuleContext, lz0: number, lz1: number, y = 0, density = 1, hw = ctx.diff.trackHalfWidth): void {
  if (!ctx.decor.length) return;
  const len = lz1 - lz0;
  const n = Math.max(0, Math.round((len / 7) * density));
  for (let i = 0; i < n; i++) {
    const d = ctx.rng.weighted(ctx.decor, (x) => x.weight);
    const side = ctx.rng.sign();
    const lz = lz0 + ((i + 0.5) / n) * len + ctx.rng.range(-1, 1);
    const off = hw + ctx.rng.range(1.6, 4.5);
    const ly = y + ctx.rng.range(-2.5, 1.5);
    ctx.b.decor(d.kind, side * off, ly, lz, ctx.rng.range(0, Math.PI * 2), ctx.rng.range(0.8, 1.3), ctx.rng.int(0, 3));
  }
}

export function coinLine(ctx: ModuleContext, lz0: number, lz1: number, y: number, lateral = 0, n?: number): void {
  const count = n ?? Math.max(1, Math.round(((lz1 - lz0) / 3) * ctx.diff.coinRate));
  for (let i = 0; i < count; i++) {
    const lz = lz0 + ((i + 0.5) / count) * (lz1 - lz0);
    ctx.b.coin(lateral, y + 1.0, lz);
  }
}

/** Coins following a jump arc from lz0 to lz1. */
export function coinArc(ctx: ModuleContext, lz0: number, lz1: number, y0: number, y1: number, lateral = 0, n = 3): void {
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const lz = lz0 + (lz1 - lz0) * t;
    const ly = y0 + (y1 - y0) * t + 4 * 1.6 * t * (1 - t) + 0.9;
    ctx.b.coin(lateral, ly, lz);
  }
}

/** Breakable crates near the edges — the enemy smashes them during chases. */
export function breakables(ctx: ModuleContext, lz0: number, lz1: number, y: number, count: number, hw = ctx.diff.trackHalfWidth): void {
  for (let i = 0; i < count; i++) {
    const lz = lz0 + ((i + 0.5) / count) * (lz1 - lz0) + ctx.rng.range(-0.8, 0.8);
    const side = ctx.rng.sign();
    const s = ctx.rng.range(0.7, 0.95);
    const x = side * (hw - s / 2 - 0.1);
    ctx.b.solid(x - s / 2, x + s / 2, y, y + s, lz - s / 2, lz + s / 2, { style: 'crate', breakable: true, walkable: false });
  }
}

/**
 * Emits the surprise planned for this module at local forward offset `lz`.
 * Surprises are scary but fair: anything physical happens off the path or
 * behind the player.
 */
export function plantSurprise(ctx: ModuleContext, lz: number, y: number, hw = ctx.diff.trackHalfWidth): void {
  const kind = ctx.opts.surprise;
  if (!kind) return;
  const b = ctx.b;
  const s = b.sAt(lz);
  switch (kind) {
    case 'enemyPeek': {
      // Grumbo watches from a balcony ahead and to the side
      const side = ctx.rng.sign();
      const ahead = ctx.rng.range(16, 26);
      const lat = side * (hw + ctx.rng.range(6, 9));
      const ly = y + ctx.rng.range(0.5, 2.5);
      // visual-only balcony (the enemy is a set-piece actor, no collision needed)
      b.decor('balcony', lat, ly, lz + ahead, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
      const p = b.w(lat, ly, lz + ahead);
      b.trigger(s, { kind: 'enemyPeek', x: p.x, y: p.y, z: p.z, duration: ctx.rng.range(2.2, 3.4) });
      break;
    }
    case 'debris': {
      // a crate smashes down just beside the track
      const side = ctx.rng.sign();
      const tr = b.trigger(s, { kind: 'surprise', surprise: 'debris' });
      const w = b.w(side * (hw + 0.9), y, lz + 7);
      b.decor('ledge', side * (hw + 0.9), y, lz + 7, 0, 1);
      b.hazard({ kind: 'faller', x: w.x, z: w.z, floorY: y, topY: y + 9, size: 1.1, period: 999, phase: 0, warn: 0.0009, drop: 0.0006, triggerId: tr.triggerId });
      break;
    }
    case 'wallSlam': {
      // a heavy shutter slams down beside the path (pure scare)
      const side = ctx.rng.sign();
      const tr = b.trigger(s, { kind: 'surprise', surprise: 'wallSlam' });
      b.solid(side * (hw + 0.5), side * (hw + 1.0), y + 3.5, y + 7, lz + 5, lz + 10, {
        style: 'pusher',
        walkable: false,
        motion: { kind: 'trigger', lx: 0, ly: -3.5, lz: 0, duration: 0.18, delay: 0.25, triggerId: tr.triggerId },
      });
      break;
    }
    default:
      b.trigger(s, { kind: 'surprise', surprise: kind });
  }
}
