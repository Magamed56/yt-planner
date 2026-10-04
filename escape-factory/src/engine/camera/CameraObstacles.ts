/**
 * What the camera must never pass through: every physics collider (floors,
 * walls, doors, platforms, crates), large decorations (pipes, gears, trees,
 * gates — visual only, so physics doesn't know them), crusher housings/heads
 * and the enemy's body. Pure data + math (no Three.js), so the same checks run
 * in the browser and headless (video planning, tests, quality audits).
 */
import type { AABB } from '../core/math';
import { crusherState } from '../obstacle/hazardEval';
import { decorWorldBoxes } from '../level/decorBounds';
import type { LevelData } from '../level/types';
import type { World } from '../sim/World';

export type ObstacleKind = 'walkable' | 'solid' | 'moving' | 'decor' | 'hazard' | 'enemy';

export interface CamBox extends AABB {
  kind: ObstacleKind;
}

export { decorWorldBoxes, hasDecorBounds, prop, registerDecorBounds, type DecorBoxes } from '../level/decorBounds';

const CELL = 8;
const cellKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

export class CameraObstacles {
  /** static visual blockers (decor, crusher housings) */
  readonly statics: CamBox[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly walkable = new Set<number>();
  private readonly tmp: import('../physics/PhysicsWorld').Collider[] = [];
  private readonly dyn: CamBox[] = [];
  private stamp = 0;
  private readonly stamps: number[] = [];

  constructor(
    readonly world: World,
    level: LevelData = world.level,
  ) {
    for (const p of level.pieces) {
      if (p.type === 'decor') decorWorldBoxes(p, this.statics);
      else if (p.type === 'solid' && p.walkable) this.walkable.add(p.id);
      else if (p.type === 'hazard' && p.hazard.kind === 'crusher') {
        const h = p.hazard;
        this.statics.push({ kind: 'hazard', minX: h.minX - 0.2, maxX: h.maxX + 0.2, minY: h.topY + 1.9, maxY: h.topY + 2.9, minZ: h.minZ - 0.2, maxZ: h.maxZ + 0.2 });
      }
    }
    this.statics.forEach((b, i) => {
      for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++)
        for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
          const k = cellKey(ix, iz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(i);
        }
    });
    this.stamps = new Array(this.statics.length).fill(0);
  }

  /**
   * All blockers overlapping `region` at the world's current time.
   * `conservative`: moving hazards occupy their whole travel range (used when
   * choosing a shot that has to stay free for a while).
   */
  query(region: AABB, out: CamBox[], conservative = false): CamBox[] {
    out.length = 0;
    const w = this.world;
    for (const c of w.physics.query(region, this.tmp)) {
      const b = c as unknown as CamBox;
      (b as { kind: ObstacleKind }).kind = this.walkable.has(c.owner) ? 'walkable' : c.kinematic ? 'moving' : 'solid';
      out.push(b);
    }
    const s = ++this.stamp;
    for (let ix = Math.floor(region.minX / CELL); ix <= Math.floor(region.maxX / CELL); ix++)
      for (let iz = Math.floor(region.minZ / CELL); iz <= Math.floor(region.maxZ / CELL); iz++) {
        const list = this.grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamps[i] === s) continue;
          this.stamps[i] = s;
          if (overlaps(this.statics[i], region)) out.push(this.statics[i]);
        }
      }
    // dynamic: the enemy's body and crusher heads
    let di = 0;
    const e = w.enemy;
    if (e && e.state !== 'dormant' && e.visible > 0.2) {
      const hw = e.def.stats.width * 0.5;
      const b = (this.dyn[di++] ??= { kind: 'enemy', minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
      b.kind = 'enemy';
      b.minX = e.x - hw;
      b.maxX = e.x + hw;
      b.minY = e.y;
      b.maxY = e.y + e.def.stats.height;
      b.minZ = e.z - hw;
      b.maxZ = e.z + hw;
      if (overlaps(b, region)) out.push(b);
    }
    for (const h of w.hazards.list) {
      if (h.spec.kind !== 'crusher') continue;
      const spec = h.spec;
      if (spec.minX > region.maxX || spec.maxX < region.minX || spec.minZ > region.maxZ || spec.maxZ < region.minZ) continue;
      const lt = w.hazards.localTime(spec, w.time) ?? 0;
      const st = crusherState(spec, lt);
      const b = (this.dyn[di++] ??= { kind: 'moving', minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
      b.kind = 'moving'; // the crusher head moves: treated like doors/pushers
      b.minX = spec.minX;
      b.maxX = spec.maxX;
      b.minY = conservative ? spec.floorY : st.bottom;
      b.maxY = spec.topY + 2.9;
      b.minZ = spec.minZ;
      b.maxZ = spec.maxZ;
      if (overlaps(b, region)) out.push(b);
    }
    return out;
  }
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/**
 * First intersection of segment p→p+d (t in [0,1]) with box b inflated by r.
 * Returns Infinity when missed; boxes that already contain p are ignored
 * (returns Infinity) — the camera can't do better than its pivot.
 */
export function segmentHit(px: number, py: number, pz: number, dx: number, dy: number, dz: number, b: AABB, r: number): number {
  const lo = [b.minX - r, b.minY - r, b.minZ - r];
  const hi = [b.maxX + r, b.maxY + r, b.maxZ + r];
  const o = [px, py, pz];
  const d = [dx, dy, dz];
  let t0 = 0;
  let t1 = 1;
  let inside = true;
  for (let a = 0; a < 3; a++) {
    if (o[a] < lo[a] || o[a] > hi[a]) inside = false;
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return Infinity;
      continue;
    }
    let ta = (lo[a] - o[a]) / d[a];
    let tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return inside ? Infinity : t0;
}

/** Is point p inside box b inflated by r? */
export function pointInBox(x: number, y: number, z: number, b: AABB, r = 0): boolean {
  return x > b.minX - r && x < b.maxX + r && y > b.minY - r && y < b.maxY + r && z > b.minZ - r && z < b.maxZ + r;
}
