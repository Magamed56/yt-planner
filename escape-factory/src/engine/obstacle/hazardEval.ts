/**
 * Pure, allocation-free hazard evaluators. `t` is the hazard-local time
 * (absolute sim time, or time since its trigger for triggered hazards).
 */
import type { AABB } from '../core/math';
import { TAU, aabbSegmentOverlap, mod } from '../core/math';
import type {
  CrusherSpec,
  FallerSpec,
  HazardSpec,
  LaserSpec,
  RollerSpec,
  SlamSpec,
  SpinnerSpec,
} from './hazardTypes';

// ---- spinner ---------------------------------------------------------------
export function spinnerAngle(h: SpinnerSpec, t: number): number {
  return h.omega * t + h.phase;
}

const segA = { x: 0, y: 0, z: 0 };
const segB = { x: 0, y: 0, z: 0 };

function spinnerHit(h: SpinnerSpec, t: number, box: AABB, margin: number): number {
  const ang = spinnerAngle(h, t);
  for (let i = 0; i < h.arms; i++) {
    const a = ang + (i * TAU) / h.arms;
    const s = Math.sin(a);
    const c = Math.cos(a);
    segA.x = h.x + s * 0.3;
    segA.z = h.z + c * 0.3;
    segA.y = h.y;
    segB.x = h.x + s * h.radius;
    segB.z = h.z + c * h.radius;
    segB.y = h.y;
    if (aabbSegmentOverlap(box, segA, segB, h.thick + margin)) return a;
  }
  return NaN;
}

// ---- crusher ---------------------------------------------------------------
/** Crusher cycle fractions. */
const CR_UP = 0.42;
const CR_WARN = 0.14;
const CR_SLAM = 0.06;
const CR_HOLD = 0.12;
// remaining = rise

export type CrusherPhase = 'up' | 'warn' | 'slam' | 'hold' | 'rise';

export function crusherState(h: CrusherSpec, t: number): { phase: CrusherPhase; bottom: number; u: number } {
  const u = mod(t / h.period + h.phase, 1);
  const travel = h.topY - h.floorY;
  if (u < CR_UP) return { phase: 'up', bottom: h.topY, u };
  if (u < CR_UP + CR_WARN) return { phase: 'warn', bottom: h.topY - 0.15 * Math.sin(((u - CR_UP) / CR_WARN) * Math.PI), u };
  if (u < CR_UP + CR_WARN + CR_SLAM) {
    const k = (u - CR_UP - CR_WARN) / CR_SLAM;
    return { phase: 'slam', bottom: h.topY - travel * k * k, u };
  }
  if (u < CR_UP + CR_WARN + CR_SLAM + CR_HOLD) return { phase: 'hold', bottom: h.floorY, u };
  const k = (u - CR_UP - CR_WARN - CR_SLAM - CR_HOLD) / (1 - CR_UP - CR_WARN - CR_SLAM - CR_HOLD);
  return { phase: 'rise', bottom: h.floorY + travel * k, u };
}

/** Fraction of the cycle at which the slam lands (for event emission). */
export const CRUSHER_IMPACT_U = CR_UP + CR_WARN + CR_SLAM;

function crusherHit(h: CrusherSpec, t: number, box: AABB, margin: number): boolean {
  const { bottom } = crusherState(h, t);
  return (
    box.maxX > h.minX - margin &&
    box.minX < h.maxX + margin &&
    box.maxZ > h.minZ - margin &&
    box.minZ < h.maxZ + margin &&
    box.maxY > bottom - margin &&
    box.minY < bottom + 1.6
  );
}

// ---- laser -----------------------------------------------------------------
const lzA = { x: 0, y: 0, z: 0 };
const lzB = { x: 0, y: 0, z: 0 };

export function laserState(
  h: LaserSpec,
  t: number,
  a: { x: number; y: number; z: number } = lzA,
  b: { x: number; y: number; z: number } = lzB,
): { on: boolean; warn: number } {
  const u = mod(t / h.period + h.phase, 1);
  let ox = 0;
  let oy = 0;
  let oz = 0;
  if (h.sweep) {
    const k = Math.sin(TAU * (t / h.sweep.period + h.sweep.phase));
    ox = h.sweep.dx * k;
    oy = h.sweep.dy * k;
    oz = h.sweep.dz * k;
  }
  a.x = h.ax + ox;
  a.y = h.ay + oy;
  a.z = h.az + oz;
  b.x = h.bx + ox;
  b.y = h.by + oy;
  b.z = h.bz + oz;
  const on = u < h.on;
  const warnWin = Math.min(0.3 / h.period, (1 - h.on) * 0.6);
  const warn = !on && u > 1 - warnWin ? (u - (1 - warnWin)) / warnWin : 0;
  return { on, warn };
}

function laserHit(h: LaserSpec, t: number, box: AABB, margin: number): boolean {
  const st = laserState(h, t);
  if (!st.on) return false;
  return aabbSegmentOverlap(box, lzA, lzB, h.radius + margin);
}

// ---- faller ----------------------------------------------------------------
export type FallerPhase = 'idle' | 'warn' | 'drop' | 'rest';

export function fallerState(h: FallerSpec, t: number): { phase: FallerPhase; y: number; warn: number; u: number } {
  const u = mod(t / h.period + h.phase, 1);
  if (u < h.warn) return { phase: 'warn', y: h.topY, warn: u / h.warn, u };
  if (u < h.warn + h.drop) {
    const k = (u - h.warn) / h.drop;
    return { phase: 'drop', y: h.topY - (h.topY - h.floorY) * k * k, warn: 1, u };
  }
  if (u < h.warn + h.drop + 0.12) return { phase: 'rest', y: h.floorY, warn: 0, u };
  return { phase: 'idle', y: h.topY, warn: 0, u };
}

function fallerHit(h: FallerSpec, t: number, box: AABB, margin: number): boolean {
  const st = fallerState(h, t);
  if (st.phase !== 'drop') return false;
  const r = h.size / 2 + margin;
  return (
    box.maxX > h.x - r && box.minX < h.x + r && box.maxZ > h.z - r && box.minZ < h.z + r && box.maxY > st.y && box.minY < st.y + h.size
  );
}

// ---- slam ------------------------------------------------------------------
export type SlamLanePhase = 'idle' | 'warn' | 'active';

/** State of one lane of a boss slam hazard at time t (t = time since trigger). */
export function slamLaneState(h: SlamSpec, lane: number, t: number): { phase: SlamLanePhase; k: number } {
  if (t < 0) return { phase: 'idle', k: 0 };
  const n = h.pattern.length;
  const cycle = n * h.interval;
  const local = mod(t, cycle);
  // slam j starts its warning at j*interval
  for (let j = 0; j < n; j++) {
    if (h.pattern[j] !== lane) continue;
    const start = j * h.interval;
    const dt = mod(local - start, cycle);
    if (dt < h.warn) return { phase: 'warn', k: dt / h.warn };
    if (dt < h.warn + h.active) return { phase: 'active', k: (dt - h.warn) / h.active };
  }
  return { phase: 'idle', k: 0 };
}

function slamHit(h: SlamSpec, t: number, box: AABB, margin: number): boolean {
  if (box.minY > h.floorY + 1.2) return false;
  for (let i = 0; i < h.lanes.length; i++) {
    if (slamLaneState(h, i, t).phase !== 'active') continue;
    const l = h.lanes[i];
    if (box.maxX > l.minX - margin && box.minX < l.maxX + margin && box.maxZ > l.minZ - margin && box.minZ < l.maxZ + margin)
      return true;
  }
  return false;
}

// ---- roller ----------------------------------------------------------------
/** Calls `cb(x, y, z, roll)` for every barrel alive at time t. */
export function rollerForEach(h: RollerSpec, t: number, cb: (x: number, y: number, z: number, roll: number) => void): void {
  const speed = Math.hypot(h.vx, h.vz);
  if (speed <= 0) return;
  const life = h.travel / speed;
  const off = h.phase * h.period;
  const k0 = Math.ceil((t - life - off) / h.period);
  const k1 = Math.floor((t - off) / h.period);
  for (let k = Math.max(k0, 0); k <= k1; k++) {
    const age = t - (off + k * h.period);
    if (age < 0 || age > life) continue;
    cb(h.sx + h.vx * age, h.sy, h.sz + h.vz * age, (age * speed) / h.radius);
  }
}

function rollerHit(h: RollerSpec, t: number, box: AABB, margin: number): boolean {
  let hit = false;
  const r = h.radius + margin;
  rollerForEach(h, t, (x, y, z) => {
    if (hit) return;
    if (box.maxX > x - r && box.minX < x + r && box.maxZ > z - r && box.minZ < z + r && box.minY < y + r && box.maxY > y - r)
      hit = true;
  });
  return hit;
}

// ---- generic ---------------------------------------------------------------
export interface HazardHit {
  lethal: boolean;
  cause: 'crushed' | 'zapped' | 'hit' | 'fell' | 'squashed';
  /** knockback direction for non-lethal hits */
  pushX: number;
  pushZ: number;
}

const HIT: HazardHit = { lethal: true, cause: 'hit', pushX: 0, pushZ: 0 };

/** Returns a (shared, do not keep) hit descriptor or null. `t` is hazard-local time. */
export function hazardHit(h: HazardSpec, t: number, box: AABB, margin = 0): HazardHit | null {
  switch (h.kind) {
    case 'spinner': {
      const a = spinnerHit(h, t, box, margin);
      if (Number.isNaN(a)) return null;
      // push tangentially in the direction of rotation + outward
      const dir = Math.sign(h.omega) || 1;
      const cx = (box.minX + box.maxX) / 2 - h.x;
      const cz = (box.minZ + box.maxZ) / 2 - h.z;
      const len = Math.hypot(cx, cz) || 1;
      HIT.lethal = h.lethal;
      HIT.cause = 'hit';
      HIT.pushX = (Math.cos(a) * dir) * 0.8 + (cx / len) * 0.6;
      HIT.pushZ = (-Math.sin(a) * dir) * 0.8 + (cz / len) * 0.6;
      return HIT;
    }
    case 'crusher':
      if (!crusherHit(h, t, box, margin)) return null;
      HIT.lethal = true;
      HIT.cause = 'crushed';
      return HIT;
    case 'laser':
      if (!laserHit(h, t, box, margin)) return null;
      HIT.lethal = true;
      HIT.cause = 'zapped';
      return HIT;
    case 'faller':
      if (!fallerHit(h, t, box, margin)) return null;
      HIT.lethal = true;
      HIT.cause = 'squashed';
      return HIT;
    case 'zone':
      if (
        !(
          box.maxX > h.minX - margin &&
          box.minX < h.maxX + margin &&
          box.maxY > h.minY - margin &&
          box.minY < h.maxY + margin &&
          box.maxZ > h.minZ - margin &&
          box.minZ < h.maxZ + margin
        )
      )
        return null;
      HIT.lethal = true;
      HIT.cause = h.cause;
      return HIT;
    case 'slam':
      if (!slamHit(h, t, box, margin)) return null;
      HIT.lethal = true;
      HIT.cause = 'squashed';
      return HIT;
    case 'roller':
      if (!rollerHit(h, t, box, margin)) return null;
      HIT.lethal = true;
      HIT.cause = 'squashed';
      return HIT;
  }
}

/** Approximate world centre of a hazard (for event positions / culling). */
export function hazardCenter(h: HazardSpec): { x: number; y: number; z: number } {
  switch (h.kind) {
    case 'spinner':
      return { x: h.x, y: h.y, z: h.z };
    case 'crusher':
      return { x: (h.minX + h.maxX) / 2, y: h.floorY, z: (h.minZ + h.maxZ) / 2 };
    case 'laser':
      return { x: (h.ax + h.bx) / 2, y: (h.ay + h.by) / 2, z: (h.az + h.bz) / 2 };
    case 'faller':
      return { x: h.x, y: h.floorY, z: h.z };
    case 'zone':
      return { x: (h.minX + h.maxX) / 2, y: (h.minY + h.maxY) / 2, z: (h.minZ + h.maxZ) / 2 };
    case 'slam': {
      let x = 0;
      let z = 0;
      for (const l of h.lanes) {
        x += (l.minX + l.maxX) / 2;
        z += (l.minZ + l.maxZ) / 2;
      }
      const n = Math.max(1, h.lanes.length);
      return { x: x / n, y: h.floorY, z: z / n };
    }
    case 'roller':
      return { x: h.sx + (h.vx * h.travel) / 2 / Math.max(0.01, Math.hypot(h.vx, h.vz)), y: h.sy, z: h.sz + (h.vz * h.travel) / 2 / Math.max(0.01, Math.hypot(h.vx, h.vz)) };
  }
}

