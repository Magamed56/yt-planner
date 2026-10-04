/**
 * Kinematic character body: move-and-slide against AABB colliders with
 * grounding, platform carry, conveyor surfaces, step-up and crush detection.
 * Position (x, y, z) is the bottom-centre (feet) of the body.
 */
import type { AABB } from '../core/math';
import type { Collider, PhysicsWorld } from './PhysicsWorld';

const EPS = 1e-4;

export class KinematicBody {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = false;
  ground: Collider | null = null;
  hitWall = false;
  hitCeiling = false;
  crushed = false;
  /** colliders touched during the last move (for triggers like step-platforms) */
  private readonly tmp: Collider[] = [];
  private readonly box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  constructor(
    public halfWidth = 0.35,
    public height = 1.4,
    public stepHeight = 0.35,
  ) {}

  setPosition(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    this.ground = null;
    this.crushed = false;
  }

  bounds(out: AABB = this.box): AABB {
    out.minX = this.x - this.halfWidth;
    out.maxX = this.x + this.halfWidth;
    out.minY = this.y;
    out.maxY = this.y + this.height;
    out.minZ = this.z - this.halfWidth;
    out.maxZ = this.z + this.halfWidth;
    return out;
  }

  /**
   * Advances the body by its velocity for `dt` seconds.
   * `extraX/extraZ` are additional displacements (e.g. conveyor drift).
   */
  move(world: PhysicsWorld, dt: number, extraX = 0, extraZ = 0): void {
    this.hitWall = false;
    this.hitCeiling = false;
    this.crushed = false;

    // 1. platform carry
    const g = this.ground;
    if (this.grounded && g && g.kinematic && g.enabled) {
      this.x += g.dx;
      this.z += g.dz;
      if (g.dy !== 0) this.y += g.dy;
    }

    // 2. depenetrate from kinematic solids that moved into us
    this.depenetrate(world);

    // 3. integrate with sub-steps to avoid tunnelling
    const dx = this.vx * dt + extraX;
    const dy = this.vy * dt;
    const dz = this.vz * dt + extraZ;
    const maxD = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.min(8, Math.max(1, Math.ceil(maxD / 0.25)));
    const wasGrounded = this.grounded;
    this.grounded = false;
    this.ground = null;
    for (let i = 0; i < steps; i++) {
      this.moveY(world, dy / steps);
      this.moveH(world, dx / steps, 0, wasGrounded);
      this.moveH(world, dz / steps, 2, wasGrounded);
    }

    // 4. ground probe keeps us grounded on flat floors / descending platforms
    if (!this.grounded && this.vy <= 0) {
      const probe = this.probeGround(world, wasGrounded ? 0.12 : 0.03);
      if (probe) {
        this.y = probe.maxY;
        this.grounded = true;
        this.ground = probe;
        this.vy = 0;
      }
    }
  }

  private probeGround(world: PhysicsWorld, dist: number): Collider | null {
    const b = this.bounds();
    b.minX += EPS;
    b.maxX -= EPS;
    b.minZ += EPS;
    b.maxZ -= EPS;
    b.maxY = this.y + 0.02;
    b.minY = this.y - dist;
    const list = world.query(b, this.tmp);
    let best: Collider | null = null;
    for (const c of list) {
      if (c.maxY <= this.y + 0.02 && c.maxY >= this.y - dist && (!best || c.maxY > best.maxY)) best = c;
    }
    return best;
  }

  private moveY(world: PhysicsWorld, d: number): void {
    if (d === 0) return;
    const prevY = this.y;
    this.y += d;
    const b = this.bounds();
    shrinkXZ(b);
    const list = world.query(b, this.tmp);
    for (const c of list) {
      if (!strictOverlap(c, b)) continue;
      if (d < 0) {
        // only land on tops we were above (or nearly) before the move
        if (prevY >= c.maxY - 0.3) {
          this.y = c.maxY;
          this.grounded = true;
          if (!this.ground || c.maxY >= this.ground.maxY) this.ground = c;
          if (this.vy < 0) this.vy = 0;
          this.bounds(b);
          shrinkXZ(b);
        }
      } else {
        if (prevY + this.height <= c.minY + 0.3) {
          this.y = c.minY - this.height - EPS;
          this.hitCeiling = true;
          if (this.vy > 0) this.vy = 0;
          this.bounds(b);
          shrinkXZ(b);
        }
      }
    }
  }

  /** axis 0 = X, 2 = Z */
  private moveH(world: PhysicsWorld, d: number, axis: 0 | 2, allowStep: boolean): void {
    if (d === 0) return;
    if (axis === 0) this.x += d;
    else this.z += d;
    const b = this.bounds();
    b.minY += EPS;
    const list = world.query(b, this.tmp);
    for (const c of list) {
      if (!strictOverlap(c, b)) continue;
      // auto step-up onto low ledges
      const rise = c.maxY - this.y;
      if (allowStep && rise > 0 && rise <= this.stepHeight && this.headroomAt(world, c.maxY)) {
        this.y = c.maxY;
        this.grounded = true;
        this.ground = c;
        this.bounds(b);
        b.minY += EPS;
        continue;
      }
      if (axis === 0) {
        this.x = d > 0 ? c.minX - this.halfWidth - EPS : c.maxX + this.halfWidth + EPS;
        this.vx = 0;
      } else {
        this.z = d > 0 ? c.minZ - this.halfWidth - EPS : c.maxZ + this.halfWidth + EPS;
        this.vz = 0;
      }
      this.hitWall = true;
      this.bounds(b);
      b.minY += EPS;
    }
  }

  private headroomAt(world: PhysicsWorld, y: number): boolean {
    const b: AABB = {
      minX: this.x - this.halfWidth + EPS,
      maxX: this.x + this.halfWidth - EPS,
      minY: y + EPS,
      maxY: y + this.height,
      minZ: this.z - this.halfWidth + EPS,
      maxZ: this.z + this.halfWidth - EPS,
    };
    const list = world.query(b, []);
    for (const c of list) if (strictOverlap(c, b)) return false;
    return true;
  }

  private depenetrate(world: PhysicsWorld): void {
    const b = this.bounds();
    for (const k of world.kinematicList) {
      if (!k.enabled || !strictOverlap(k, b)) continue;
      const penUp = k.maxY - this.y;
      const penDown = this.y + this.height - k.minY;
      const penPX = k.maxX - b.minX;
      const penNX = b.maxX - k.minX;
      const penPZ = k.maxZ - b.minZ;
      const penNZ = b.maxZ - k.minZ;
      // prefer standing on top if we are mostly above it
      if (penUp <= 0.45) {
        this.y = k.maxY;
        this.grounded = true;
        this.ground = k;
        if (this.vy < 0) this.vy = 0;
      } else {
        // push along the kinematic's motion when it is clearly moving, else minimal axis
        const ax = Math.abs(k.dx);
        const az = Math.abs(k.dz);
        let axis: 'px' | 'nx' | 'pz' | 'nz' | 'down';
        if (ax > 1e-4 && ax >= az) axis = k.dx > 0 ? 'px' : 'nx';
        else if (az > 1e-4) axis = k.dz > 0 ? 'pz' : 'nz';
        else {
          const m = Math.min(penPX, penNX, penPZ, penNZ, penDown);
          axis = m === penPX ? 'px' : m === penNX ? 'nx' : m === penPZ ? 'pz' : m === penNZ ? 'nz' : 'down';
        }
        if (axis === 'px') this.x += penPX + EPS;
        else if (axis === 'nx') this.x -= penNX + EPS;
        else if (axis === 'pz') this.z += penPZ + EPS;
        else if (axis === 'nz') this.z -= penNZ + EPS;
        else this.y -= penDown + EPS;
      }
      this.bounds(b);
      // squeezed into static geometry => crushed
      const list = world.query(b, this.tmp);
      for (const c of list) {
        if (c !== k && !c.kinematic && strictOverlap(c, b, 0.08)) {
          this.crushed = true;
          break;
        }
      }
    }
  }
}

function shrinkXZ(b: AABB): void {
  b.minX += EPS;
  b.maxX -= EPS;
  b.minZ += EPS;
  b.maxZ -= EPS;
}

function strictOverlap(c: AABB, b: AABB, tol = 0): boolean {
  return (
    c.minX < b.maxX - tol &&
    c.maxX > b.minX + tol &&
    c.minY < b.maxY - tol &&
    c.maxY > b.minY + tol &&
    c.minZ < b.maxZ - tol &&
    c.maxZ > b.minZ + tol
  );
}
