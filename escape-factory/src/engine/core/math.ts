/** Allocation-light math helpers shared by simulation and presentation. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v3copy = (out: Vec3, a: Vec3): Vec3 => {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
};
export const v3set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};
export const v3dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const v3lerp = (out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  lerp(b0, b1, clamp01(invLerp(a0, a1, v)));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};

/** Frame-rate independent exponential smoothing factor. */
export const dampFactor = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, dampFactor(lambda, dt));

/** Move `current` towards `target` by at most `maxDelta`. */
export const approach = (current: number, target: number, maxDelta: number): number =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

export const TAU = Math.PI * 2;
/** Wraps an angle to [-PI, PI). */
export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleLerp = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
export const dampAngle = (a: number, b: number, lambda: number, dt: number): number =>
  angleLerp(a, b, dampFactor(lambda, dt));

/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * Critically damped spring (Unity-style SmoothDamp). Mutates `state.v`.
 * Used for camera motion so cuts and blends feel cinematic.
 */
export function smoothDamp(
  current: number,
  target: number,
  state: { v: number },
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity,
): number {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const maxChange = maxSpeed * st;
  change = clamp(change, -maxChange, maxChange);
  const t = current - change;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  let out = t + (change + temp) * exp;
  if (target - current > 0 === out > target) {
    out = target;
    state.v = (out - target) / dt;
  }
  return out;
}

/** Distance from point p to segment ab in the XZ plane, and the parameter t. */
export function distPointSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { d: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp01(t);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

/** Squared distance between point and 3D segment. */
export function distPointSegment3(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = clamp01(t);
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Axis aligned box stored as min/max — the only collision shape of the kinematic physics. */
export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const aabb = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB => ({
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ,
});

export const aabbFromCenter = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): AABB =>
  aabb(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz);

export const aabbOverlap = (a: AABB, b: AABB): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;

export const aabbContainsXZ = (a: AABB, x: number, z: number, margin = 0): boolean =>
  x >= a.minX + margin && x <= a.maxX - margin && z >= a.minZ + margin && z <= a.maxZ - margin;

/** Overlap test of an AABB against a capsule-ish segment (beam/arm) of radius r. */
export function aabbSegmentOverlap(box: AABB, a: Vec3, b: Vec3, r: number): boolean {
  // Sample along the segment; beams are short so 12 samples is plenty and allocation-free.
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const cx = clamp(x, box.minX, box.maxX);
    const cy = clamp(y, box.minY, box.maxY);
    const cz = clamp(z, box.minZ, box.maxZ);
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    if (dx * dx + dy * dy + dz * dz < r * r) return true;
  }
  return false;
}
