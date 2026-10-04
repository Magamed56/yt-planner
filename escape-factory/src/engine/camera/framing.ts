/**
 * Framing solver for shots that must show runner AND chaser (CHASE, WIDE,
 * IMPACT): re-aims at the middle of the subjects, widens the lens up to
 * `maxFov`, then (optionally) dollies back along the view axis until all of
 * them sit inside the safe area (|ndc| ≤ 0.78). Continuous in its inputs, so a
 * moving subject never makes the frame chatter. Pure math.
 */
import type { CameraPose } from './CameraDirector';
import { project as projectPoint } from './CameraQuality';

export function frameSubjects(out: CameraPose, pts: Array<{ x: number; y: number; z: number }>, aspect: number, maxFov: number, dolly = true): void {
  const SAFE = 0.78;
  // 1. aim at the centre of the subjects (world-space centroid, then screen-space centre)
  if (!pts.length) return;
  const measure = () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const q = projectPoint(out, aspect, pts[i]);
      // a secondary subject behind the camera is dropped; the runner never is
      if (!(q[2] > 0.3)) {
        if (i === 0) return null;
        continue;
      }
      minX = Math.min(minX, q[0]);
      maxX = Math.max(maxX, q[0]);
      minY = Math.min(minY, q[1]);
      maxY = Math.max(maxY, q[1]);
    }
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, hx: (maxX - minX) / 2, hy: (maxY - minY) / 2 };
  };
  let m = measure();
  if (!m) {
    // the runner is behind the lens: look at him
    out.tx = pts[0].x;
    out.ty = pts[0].y;
    out.tz = pts[0].z;
    m = measure();
    if (!m) return;
  }
  // re-aim so the group is centred (continuous in the inputs → no chatter)
  const d = Math.hypot(out.tx - out.x, out.ty - out.y, out.tz - out.z) || 1;
  const t = Math.tan((out.fov * Math.PI) / 360);
  const fwdX = (out.tx - out.x) / d;
  const fwdY = (out.ty - out.y) / d;
  const fwdZ = (out.tz - out.z) / d;
  let rx = -fwdZ;
  let rz = fwdX;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fwdY;
  const uy = rz * fwdX - rx * fwdZ;
  const uz = rx * fwdY;
  const ox = m.cx * d * t * aspect;
  const oy = m.cy * d * t;
  out.tx += rx * ox + ux * oy;
  out.ty += uy * oy;
  out.tz += rz * ox + uz * oy;
  // 2. how much bigger must the view be? widen the lens first, then dolly back
  const need = Math.max(m.hx, m.hy) / SAFE;
  if (need <= 1) return;
  const tNeed = t * need;
  const tMax = Math.tan((maxFov * Math.PI) / 360);
  const tNew = Math.min(tNeed, tMax);
  out.fov = (Math.atan(tNew) * 360) / Math.PI;
  const rest = Math.min(2.2, tNeed / tNew);
  if (dolly && rest > 1.001) {
    out.x = out.tx + (out.x - out.tx) * rest;
    out.y = out.ty + (out.y - out.ty) * rest;
    out.z = out.tz + (out.z - out.tz) * rest;
  }
  // 3. if the group still doesn't fit, the first subject (the runner) wins:
  //    slide the aim until he is back inside the safe area
  const q = projectPoint(out, aspect, pts[0]);
  if (!(q[2] > 0.3)) return;
  const exX = Math.abs(q[0]) > SAFE ? q[0] - Math.sign(q[0]) * SAFE : 0;
  const exY = Math.abs(q[1]) > SAFE ? q[1] - Math.sign(q[1]) * SAFE : 0;
  if (exX || exY) {
    const d2 = Math.hypot(out.tx - out.x, out.ty - out.y, out.tz - out.z) || 1;
    const t2 = Math.tan((out.fov * Math.PI) / 360);
    const sx = exX * d2 * t2 * aspect;
    const sy = exY * d2 * t2;
    out.tx += rx * sx + ux * sy;
    out.ty += uy * sy;
    out.tz += rz * sx + uz * sy;
  }
}


/**
 * Minimal correction: if `p` left the safe area (|ndc| > safe), turn the aim just
 * enough to bring it back. Used after collision changed the camera position.
 */
export function ensureInFrame(out: CameraPose, p: { x: number; y: number; z: number }, aspect: number, safe = 0.82): void {
  const q = projectPoint(out, aspect, p);
  if (!(q[2] > 0.05)) {
    out.tx = p.x;
    out.ty = p.y;
    out.tz = p.z;
    return;
  }
  const exX = Math.abs(q[0]) > safe ? q[0] - Math.sign(q[0]) * safe : 0;
  const exY = Math.abs(q[1]) > safe ? q[1] - Math.sign(q[1]) * safe : 0;
  if (!exX && !exY) return;
  const d = Math.hypot(out.tx - out.x, out.ty - out.y, out.tz - out.z) || 1;
  const t = Math.tan((out.fov * Math.PI) / 360);
  const fwdX = (out.tx - out.x) / d;
  const fwdY = (out.ty - out.y) / d;
  const fwdZ = (out.tz - out.z) / d;
  let rx = -fwdZ;
  let rz = fwdX;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fwdY;
  const uy = rz * fwdX - rx * fwdZ;
  const uz = rx * fwdY;
  const sx = exX * d * t * aspect;
  const sy = exY * d * t;
  out.tx += rx * sx + ux * sy;
  out.ty += uy * sy;
  out.tz += rz * sx + uz * sy;
}
