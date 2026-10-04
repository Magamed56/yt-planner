/**
 * Camera collision on top of the CameraDirector's ideal pose.
 *
 * For each frame:
 *   1. try the director's position, then the same distance raised over the
 *      obstacle (rotated up around the player) — seeing over a wall keeps the
 *      shot's framing, unlike pulling the camera into the player's face;
 *   2. otherwise pull in along the clearest candidate to just before the hit
 *      (boxes inflated by the camera's clearance radius = no near-plane clipping);
 *   3. a big pull-in (a long dolly in a few frames = a whip) is not animated:
 *      the result asks for a CUT to a safe shot instead (`needsCut`);
 *   4. small adjustments are smoothed — quick when an obstacle arrives, slow
 *      when it is released, snapped on director cuts. Only the adjustments
 *      (arm ratio, raise angle) are smoothed, so a free camera follows the
 *      director exactly;
 *   5. safety: the final camera point is never inside geometry or right
 *      behind a surface (shortens the arm only, never moves sideways);
 *   6. when the arm is shortened, the look target slides toward the player so
 *      he stays in frame.
 * Pure math over CameraObstacles; runs identically headless and rendered.
 */
import type { CameraPose } from './CameraDirector';
import { pointInBox, segmentHit, type CamBox, type CameraObstacles } from './CameraObstacles';

export interface CollisionResult {
  /** resolved arm length / desired arm length (1 = unobstructed) */
  ratio: number;
  /** extra elevation used to see over obstacles (rad) */
  raise: number;
  /** the shot can't be kept without a whip-like dolly: cut to a safe shot */
  needsCut: boolean;
  /** the camera could not be freed (minimum arm reached inside geometry): cut is mandatory */
  stuck: boolean;
}

/** elevation offsets tried around the player: over walls first, under overhangs last */
const RAISES = [0, 0.18, 0.36, 0.58, 0.82, -0.2, -0.38];

export class CameraCollision {
  /** clearance kept between the camera and any surface (m) */
  radius = 0.35;
  /** closest the arm may get to the pivot (m) */
  minArm = 0.9;
  /** smoothing time constants (s): obstacle arriving / leaving */
  tauIn = 0.1;
  tauOut = 0.45;
  /** pull-ins longer than this (m) become cuts instead of dollies */
  maxDolly = 3.5;
  /** extra clearance when choosing the arm: start raising before contact (m) */
  anticipate = 0.5;
  /** largest arm shortening per frame for mid-arm occlusions (m) */
  maxStep = 1.0;
  /** top speed of collision adjustments (m/s): long arms must not swing in a blink */
  maxSpeed = 20;
  enabled = true;

  /** smoothed collision adjustments: arm ratio and extra elevation */
  private ks = 1;
  private rs = 0;
  private has = false;
  private readonly boxes: CamBox[] = [];
  private readonly region = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  readonly last: CollisionResult = { ratio: 1, raise: 0, needsCut: false, stuck: false };

  constructor(private readonly obstacles: CameraObstacles) {}

  /**
   * Clear fraction of the segment pivot → pivot + (dx,dy,dz). The enemy is not a
   * line-of-sight blocker (filming past Grumbo is the point of a chase shot) —
   * the camera only must not end up inside him (see `insideAny`).
   */
  private clear(px: number, py: number, pz: number, dx: number, dy: number, dz: number, r = this.radius): number {
    let t = 1;
    this.hitMoving = false;
    for (const b of this.boxes) {
      if (b.kind === 'enemy') continue;
      const h = segmentHit(px, py, pz, dx, dy, dz, b, r);
      if (h < t) {
        t = h;
        this.hitMoving = b.kind === 'moving';
      }
    }
    return t;
  }

  /** the nearest blocker of the last `clear()` is a moving solid (door, pusher) */
  private hitMoving = false;

  private insideAny(x: number, y: number, z: number): boolean {
    for (const b of this.boxes) if (pointInBox(x, y, z, b, this.radius)) return true;
    return false;
  }

  private insideEnemy(x: number, y: number, z: number): boolean {
    for (const b of this.boxes) if (b.kind === 'enemy' && pointInBox(x, y, z, b, this.radius)) return true;
    return false;
  }

  private gather(px: number, py: number, pz: number, reach: number, conservative = false): void {
    const R = this.region;
    R.minX = px - reach;
    R.maxX = px + reach;
    R.minY = py - reach;
    R.maxY = py + reach;
    R.minZ = pz - reach;
    R.maxZ = pz + reach;
    this.obstacles.query(R, this.boxes, conservative);
  }

  /**
   * Adjusts `pose` in place. `pivot` = point the camera must see (player chest),
   * `cut` = the director just hard-cut (reset smoothing), `dt` = frame time.
   */
  resolve(pose: CameraPose, px: number, py: number, pz: number, dt: number, cut: boolean, floorY = -Infinity): CollisionResult {
    const res = this.last;
    res.needsCut = false;
    res.stuck = false;
    const dx0 = pose.x - px;
    const dy0 = pose.y - py;
    const dz0 = pose.z - pz;
    const L = Math.hypot(dx0, dy0, dz0);
    if (!this.enabled || L < 1e-3) {
      res.ratio = 1;
      res.raise = 0;
      return res;
    }
    this.gather(px, py, pz, L + 1);
    const hz = Math.hypot(dx0, dz0);
    const elev = Math.atan2(dy0, hz);
    const ux = hz > 1e-4 ? dx0 / hz : 0;
    const uz = hz > 1e-4 ? dz0 / hz : 0;
    const canRaise = elev < 1.2 && hz > 1e-3;
    const c = { x: 0, y: 0, z: 0 };
    const arm = (raise: number) => {
      if (Math.abs(raise) <= 1e-4 || !canRaise) {
        c.x = dx0;
        c.y = dy0;
        c.z = dz0;
      } else {
        const e = Math.max(-1.2, Math.min(1.35, elev + raise));
        c.x = ux * Math.cos(e) * L;
        c.y = Math.sin(e) * L;
        c.z = uz * Math.cos(e) * L;
      }
    };
    // ---- 1–2: target adjustment (raise, arm ratio)
    let bestF = -1;
    let bestR = 0;
    for (const r of RAISES) {
      if (r !== 0 && !canRaise) break;
      arm(r);
      if (r < 0 && py + c.y < floorY) continue; // never under the course's floor plane
      const f = this.clear(px, py, pz, c.x, c.y, c.z, this.radius + this.anticipate);
      if (f >= 0.999 && !this.insideAny(px + c.x, py + c.y, pz + c.z)) {
        bestF = 1;
        bestR = r;
        break;
      }
      // a raise must buy real distance to be worth the changed angle
      if (bestF < 0 || f > bestF + 0.08) {
        bestF = Math.min(f, 0.999);
        bestR = r;
      }
    }
    // the pull-in target also keeps the anticipation margin, so the camera starts
    // easing in before it touches anything (the hard safety pass rarely fires)
    const kt = bestF >= 1 ? 1 : Math.max(Math.min(1, this.minArm / L), (bestF * L - 0.05) / L);
    // ---- 3: big pull-in or big swing up → cut (unless this already is the cut frame)
    if (!cut && this.has && ((this.ks - kt) * L > this.maxDolly || (bestR - this.rs) * L > this.maxDolly)) {
      res.needsCut = true;
    }
    // ---- 4: smooth only the adjustments
    if (!this.has || cut) {
      this.ks = kt;
      this.rs = bestR;
      this.has = true;
    } else {
      // exponential easing, capped in linear camera speed (arm length × change)
      const lim = (this.maxSpeed * Math.max(0, dt)) / L;
      const ak = 1 - Math.exp(-Math.max(0, dt) / (kt < this.ks ? this.tauIn : this.tauOut));
      this.ks += Math.max(-lim, Math.min(lim, (kt - this.ks) * ak));
      const ar = 1 - Math.exp(-Math.max(0, dt) / (Math.abs(bestR) > Math.abs(this.rs) ? this.tauIn : this.tauOut));
      this.rs += Math.max(-lim, Math.min(lim, (bestR - this.rs) * ar));
    }
    arm(this.rs);
    let ox = c.x * this.ks;
    let oy = c.y * this.ks;
    let oz = c.z * this.ks;
    // ---- 5: safety — the camera point itself is never inside / right behind a surface
    let sl = Math.hypot(ox, oy, oz);
    if (sl > 1e-3) {
      // inside Grumbo / a solid that just moved onto the camera: go up over it,
      // not into the player — and if that is a big move, make it a cut
      const sx0 = ox;
      const sy0 = oy;
      const sz0 = oz;
      // (solids are escaped by shortening the arm below; only Grumbo is climbed over)
      for (let i = 0; i < 6 && canRaise && this.insideEnemy(px + ox, py + oy, pz + oz); i++) {
        this.rs = Math.min(1.3 - elev, this.rs + 0.15);
        arm(this.rs);
        ox = c.x * this.ks;
        oy = c.y * this.ks;
        oz = c.z * this.ks;
      }
      if (!cut && Math.hypot(ox - sx0, oy - sy0, oz - sz0) > 1.2) {
        res.needsCut = true;
        res.stuck = true;
      }
      sl = Math.hypot(ox, oy, oz);
      const f = this.clear(px, py, pz, ox, oy, oz);
      // moving solids (a door slamming down, a pusher) can't be anticipated: hard
      const nearCam = (1 - f) * sl;
      const behindWall = f < 1 && (nearCam < 1.5 || (this.hitMoving && nearCam < 3));
      // a moving solid further down the arm: close in at bounded speed and ask for a cut
      if (f < 1 && this.hitMoving && !behindWall && !cut) {
        res.needsCut = true;
        res.stuck = true; // a door closing between runner and camera: cut now
      }
      const inside = this.insideAny(px + ox, py + oy, pz + oz);
      if (f < 1 || inside) {
        let k = f < 1 ? (f * sl - 0.05) / sl : 0.8;
        // an occluder in the middle of the arm (not at the camera): close in at a
        // bounded speed — smoothing/raise resolve it within a few frames
        if (!behindWall && !inside && (1 - k) * sl > this.maxStep) k = 1 - this.maxStep / sl;
        // never into the character: below the minimum arm the shot is cut instead
        const kMin = Math.min(1, this.minArm / sl);
        if (k < kMin) {
          k = kMin;
          if (!cut) res.needsCut = true;
        }
        // a hard hop (wall corner suddenly right behind the camera) is shown as a
        // proper cut to a free shot, not as a teleport of the same shot
        const hop = (1 - k) * sl;
        if (!cut && (behindWall || inside)) {
          if (hop > 1.5) res.needsCut = true;
          if (hop > 2.2) res.stuck = true;
        }
        if (hop > this.maxDolly && !cut) res.needsCut = true;
        ox *= k;
        oy *= k;
        oz *= k;
        this.ks = Math.min(this.ks, (sl * k) / L);
      }
    }
    if (this.insideAny(px + ox, py + oy, pz + oz)) {
      res.stuck = true;
      res.needsCut = true;
    }
    pose.x = px + ox;
    pose.y = py + oy;
    pose.z = pz + oz;
    // ---- 6: keep the subject framed when the arm got shorter
    const ratio = Math.min(1, Math.hypot(ox, oy, oz) / L);
    if (ratio < 0.85) {
      const w = Math.min(1, (0.85 - ratio) / 0.5);
      pose.tx += (px - pose.tx) * w;
      pose.ty += (py - pose.ty) * w;
      pose.tz += (pz - pose.tz) * w;
    }
    res.ratio = ratio;
    res.raise = this.rs;
    return res;
  }

  /** Stateless check: fraction of the arm pivot→pose that is clear (1 = fully free). */
  evaluate(pose: { x: number; y: number; z: number }, px: number, py: number, pz: number): number {
    const dx = pose.x - px;
    const dy = pose.y - py;
    const dz = pose.z - pz;
    this.gather(px, py, pz, Math.hypot(dx, dy, dz) + 1, true);
    if (this.insideAny(pose.x, pose.y, pose.z)) return 0;
    return this.clear(px, py, pz, dx, dy, dz);
  }

  reset(): void {
    this.has = false;
  }
}
