/**
 * Pure evaluators for solid-piece motion and vanish behaviour. Shared by the
 * simulation (colliders), the renderer (meshes) and the bot (prediction).
 */
import type { MotionSpec, VanishSpec } from '../level/types';
import { TAU, easeInOut, mod } from '../core/math';

export interface Offset {
  x: number;
  y: number;
  z: number;
}

/**
 * Motion offset at time t. `triggerTime` is when the motion's trigger fired
 * (null = not fired yet).
 */
export function evalMotion(m: MotionSpec, t: number, triggerTime: number | null, out: Offset): Offset {
  let k = 0;
  switch (m.kind) {
    case 'sine':
      k = Math.sin(TAU * (t / m.period + m.phase));
      break;
    case 'pingpong': {
      const u = mod(t / m.period + m.phase, 1);
      const h = Math.min(0.45, Math.max(0, m.hold));
      const move = 0.5 - h;
      // 0..h hold at -1, h..h+move go to +1, ..+h hold, ..end return
      if (u < h) k = -1;
      else if (u < h + move) k = -1 + 2 * easeInOut((u - h) / move);
      else if (u < 2 * h + move) k = 1;
      else k = 1 - 2 * easeInOut((u - 2 * h - move) / move);
      break;
    }
    case 'trigger':
      if (triggerTime === null) k = 0;
      else k = easeInOut((t - triggerTime - m.delay) / Math.max(0.01, m.duration));
      break;
  }
  out.x = m.ax * k;
  out.y = m.ay * k;
  out.z = m.az * k;
  return out;
}

/** Whether a cycle-vanish piece is solid at time t, and how close it is to vanishing (0..1 warning). */
export function cycleVanish(v: Extract<VanishSpec, { kind: 'cycle' }>, t: number): { solid: boolean; warn: number } {
  const u = mod(t / v.period + v.phase, 1);
  const solid = u < v.on;
  const warnWindow = Math.min(0.35 / v.period, v.on * 0.5);
  const warn = solid && u > v.on - warnWindow ? (u - (v.on - warnWindow)) / warnWindow : 0;
  return { solid, warn };
}

/** Max displacement magnitude of a motion (for bounds / culling). */
export function motionExtent(m: MotionSpec): number {
  return Math.hypot(m.ax, m.ay, m.az);
}
