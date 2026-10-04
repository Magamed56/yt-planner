/**
 * Minimal deterministic kinematic physics: axis aligned boxes, a uniform XZ
 * grid broadphase for static geometry and a short list of kinematic colliders.
 * Purpose-built for obstacle-course platforming: cheap, predictable, testable.
 */
import type { AABB } from '../core/math';
import type { SurfaceType } from '../level/types';

export interface Collider extends AABB {
  id: number;
  enabled: boolean;
  kinematic: boolean;
  /** displacement during the last step (platform carry) */
  dx: number;
  dy: number;
  dz: number;
  surface: SurfaceType;
  conveyorX: number;
  conveyorZ: number;
  /** owning level piece id (-1 if none) */
  owner: number;
  /** internal query stamp */
  _stamp: number;
}

export interface ColliderOptions {
  surface?: SurfaceType;
  conveyorX?: number;
  conveyorZ?: number;
  owner?: number;
  enabled?: boolean;
}

const CELL = 8;
const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

export class PhysicsWorld {
  readonly colliders: Collider[] = [];
  private readonly kinematics: Collider[] = [];
  private readonly grid = new Map<number, Collider[]>();
  private stamp = 1;
  private nextId = 1;

  clear(): void {
    this.colliders.length = 0;
    this.kinematics.length = 0;
    this.grid.clear();
    this.nextId = 1;
  }

  private make(box: AABB, kinematic: boolean, o: ColliderOptions): Collider {
    return {
      id: this.nextId++,
      minX: box.minX,
      minY: box.minY,
      minZ: box.minZ,
      maxX: box.maxX,
      maxY: box.maxY,
      maxZ: box.maxZ,
      enabled: o.enabled ?? true,
      kinematic,
      dx: 0,
      dy: 0,
      dz: 0,
      surface: o.surface ?? 'default',
      conveyorX: o.conveyorX ?? 0,
      conveyorZ: o.conveyorZ ?? 0,
      owner: o.owner ?? -1,
      _stamp: 0,
    };
  }

  addStatic(box: AABB, o: ColliderOptions = {}): Collider {
    const c = this.make(box, false, o);
    this.colliders.push(c);
    const ix0 = Math.floor(c.minX / CELL);
    const ix1 = Math.floor(c.maxX / CELL);
    const iz0 = Math.floor(c.minZ / CELL);
    const iz1 = Math.floor(c.maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = key(ix, iz);
        let cell = this.grid.get(k);
        if (!cell) {
          cell = [];
          this.grid.set(k, cell);
        }
        cell.push(c);
      }
    }
    return c;
  }

  /** Kinematic colliders move every step via `moveKinematic` and carry bodies. */
  addKinematic(box: AABB, o: ColliderOptions = {}): Collider {
    const c = this.make(box, true, o);
    this.colliders.push(c);
    this.kinematics.push(c);
    return c;
  }

  /** Sets a kinematic collider's box, recording its displacement for carry. */
  moveKinematic(c: Collider, minX: number, minY: number, minZ: number): void {
    const w = c.maxX - c.minX;
    const h = c.maxY - c.minY;
    const d = c.maxZ - c.minZ;
    c.dx = minX - c.minX;
    c.dy = minY - c.minY;
    c.dz = minZ - c.minZ;
    c.minX = minX;
    c.minY = minY;
    c.minZ = minZ;
    c.maxX = minX + w;
    c.maxY = minY + h;
    c.maxZ = minZ + d;
  }

  get kinematicList(): readonly Collider[] {
    return this.kinematics;
  }

  /** Collects enabled colliders overlapping `box` (inclusive of touching) into `out`. */
  query(box: AABB, out: Collider[], includeDisabled = false): Collider[] {
    out.length = 0;
    const s = ++this.stamp;
    const ix0 = Math.floor(box.minX / CELL);
    const ix1 = Math.floor(box.maxX / CELL);
    const iz0 = Math.floor(box.minZ / CELL);
    const iz1 = Math.floor(box.maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const cell = this.grid.get(key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._stamp === s) continue;
          c._stamp = s;
          if ((c.enabled || includeDisabled) && overlaps(c, box)) out.push(c);
        }
      }
    }
    for (const c of this.kinematics) {
      if (c._stamp === s) continue;
      c._stamp = s;
      if ((c.enabled || includeDisabled) && overlaps(c, box)) out.push(c);
    }
    return out;
  }

  private rayTmp: Collider[] = [];
  private rayBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  /**
   * Finds the highest collider top below (x, fromY, z) within `maxDist`, using a
   * square footprint of half size `hw`. Returns null when nothing is below.
   */
  groundBelow(x: number, z: number, fromY: number, maxDist: number, hw = 0): { y: number; collider: Collider } | null {
    const b = this.rayBox;
    b.minX = x - hw;
    b.maxX = x + hw;
    b.minZ = z - hw;
    b.maxZ = z + hw;
    b.minY = fromY - maxDist;
    b.maxY = fromY;
    const list = this.query(b, this.rayTmp);
    let best: Collider | null = null;
    for (const c of list) {
      if (c.maxY <= fromY + 1e-6 && (!best || c.maxY > best.maxY)) best = c;
    }
    return best ? { y: best.maxY, collider: best } : null;
  }

  get staticCount(): number {
    return this.colliders.length - this.kinematics.length;
  }
}

/** Strict overlap with a tiny tolerance so touching faces count as contact for queries. */
function overlaps(c: AABB, b: AABB): boolean {
  return c.minX <= b.maxX && c.maxX >= b.minX && c.minY <= b.maxY && c.maxY >= b.minY && c.minZ <= b.maxZ && c.maxZ >= b.minZ;
}
