/**
 * Track spine: a polyline through the centre of the walkable course with
 * cumulative distance `s`. Used to measure progress, steer the bot, place the
 * enemy, orient the camera and detect falls.
 */
import type { SpinePoint } from './types';

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** unit forward (XZ) */
  fx: number;
  fz: number;
  /** unit right (XZ) */
  rx: number;
  rz: number;
  halfWidth: number;
  gap: boolean;
}

export interface TrackProjection {
  s: number;
  lateral: number;
  seg: number;
  dist: number;
}

export class Track {
  readonly points: SpinePoint[];
  readonly length: number;
  readonly gaps: Array<{ s0: number; s1: number; y0: number; y1: number }> = [];

  constructor(points: SpinePoint[]) {
    if (points.length < 2) throw new Error('Track needs at least 2 points');
    this.points = points;
    this.length = points[points.length - 1].s;
    // gap intervals: runs of consecutive gap points
    let i = 0;
    while (i < points.length) {
      if (points[i].gap) {
        const start = Math.max(0, i - 1);
        let j = i;
        while (j < points.length && points[j].gap) j++;
        const end = Math.min(points.length - 1, j);
        this.gaps.push({ s0: points[start].s, s1: points[end].s, y0: points[start].y, y1: points[end].y });
        i = j;
      } else i++;
    }
  }

  /** Index of the segment containing distance s (binary search). */
  segmentAt(s: number): number {
    const p = this.points;
    if (s <= 0) return 0;
    if (s >= this.length) return p.length - 2;
    let lo = 0;
    let hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid].s <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Position on the spine at distance s (unsmoothed). */
  pointAt(s: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
    const i = this.segmentAt(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    const len = b.s - a.s;
    const t = len > 0 ? Math.min(1, Math.max(0, (s - a.s) / len)) : 0;
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  private tmpA = { x: 0, y: 0, z: 0 };
  private tmpB = { x: 0, y: 0, z: 0 };

  /** Full sample with smoothed heading (averaged over ±smooth metres). */
  sample(s: number, out: TrackSample = blankSample(), smooth = 1.5): TrackSample {
    const a = this.pointAt(Math.max(0, s - smooth), this.tmpA);
    const ax = a.x;
    const az = a.z;
    const b = this.pointAt(Math.min(this.length, s + smooth), this.tmpB);
    let fx = b.x - ax;
    let fz = b.z - az;
    const l = Math.hypot(fx, fz);
    if (l > 1e-6) {
      fx /= l;
      fz /= l;
    } else {
      fx = 0;
      fz = 1;
    }
    out.fx = fx;
    out.fz = fz;
    out.rx = -fz;
    out.rz = fx;
    const i = this.segmentAt(s);
    const pa = this.points[i];
    const pb = this.points[i + 1];
    out.halfWidth = Math.min(pa.halfWidth, pb.halfWidth);
    out.gap = pa.gap && pb.gap;
    const p = this.pointAt(s, this.tmpA);
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    return out;
  }

  heightAt(s: number): number {
    return this.pointAt(s, this.tmpA).y;
  }

  /** Smoothed yaw (radians around +Y, 0 = facing +Z). */
  yawAt(s: number, smooth = 3): number {
    const smp = this.sample(s, scratch, smooth);
    return Math.atan2(smp.fx, smp.fz);
  }

  /**
   * Projects a world XZ point onto the spine. `hint` = previous segment index
   * for a cheap local search; falls back to a global search when far away.
   */
  project(x: number, z: number, hint = -1, out: TrackProjection = { s: 0, lateral: 0, seg: 0, dist: 0 }): TrackProjection {
    const p = this.points;
    let bestD = Infinity;
    let bestSeg = 0;
    let bestT = 0;
    const scan = (i0: number, i1: number) => {
      for (let i = Math.max(0, i0); i <= Math.min(p.length - 2, i1); i++) {
        const a = p[i];
        const b = p[i + 1];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const len2 = abx * abx + abz * abz;
        let t = len2 > 0 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = a.x + abx * t;
        const cz = a.z + abz * t;
        const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        if (d < bestD - 1e-9) {
          bestD = d;
          bestSeg = i;
          bestT = t;
        }
      }
    };
    if (hint >= 0) scan(hint - 6, hint + 10);
    if (hint < 0 || bestD > 64) scan(0, p.length - 2);
    const a = p[bestSeg];
    const b = p[bestSeg + 1];
    out.seg = bestSeg;
    out.s = a.s + (b.s - a.s) * bestT;
    out.dist = Math.sqrt(bestD);
    const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const fx = (b.x - a.x) / segLen;
    const fz = (b.z - a.z) / segLen;
    const cx = a.x + (b.x - a.x) * bestT;
    const cz = a.z + (b.z - a.z) * bestT;
    out.lateral = (x - cx) * -fz + (z - cz) * fx;
    return out;
  }

  /** World position at distance s with a lateral offset. */
  offsetPoint(s: number, lateral: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
    const smp = this.sample(s, scratch, 0.5);
    out.x = smp.x + smp.rx * lateral;
    out.y = smp.y;
    out.z = smp.z + smp.rz * lateral;
    return out;
  }

  /** Returns the gap interval containing s, if any. */
  gapAt(s: number): { s0: number; s1: number; y0: number; y1: number } | null {
    for (const g of this.gaps) if (s > g.s0 && s < g.s1) return g;
    return null;
  }
}

const scratch: TrackSample = blankSample();

export function blankSample(): TrackSample {
  return { x: 0, y: 0, z: 0, fx: 0, fz: 1, rx: -1, rz: 0, halfWidth: 2, gap: false };
}
