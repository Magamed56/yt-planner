/**
 * Traversal predictor: cheaply simulates the player's future motion along the
 * track (running, optional jumps, lane changes) and checks it against the
 * deterministic hazard / moving-solid / vanishing-support schedules.
 * This is what lets the bot "see the future" of timing obstacles.
 */
import type { AABB } from '../core/math';
import type { World } from '../sim/World';

export interface TraversalPlan {
  /** seconds to wait before starting to move */
  startDelay: number;
  /** target lateral offset */
  lateral: number;
  /** speed factor 0..1 */
  speed: number;
  /** jumps at absolute spine distances */
  jumpS: number[];
  /** jumps at times relative to plan start */
  jumpT: number[];
}

export interface TraversalCheck {
  hazardIds: number[];
  blockerIds: number[];
  supportIds: number[];
  /** safety margin (m) added to the player box */
  margin: number;
  /** stop evaluating after passing this spine distance */
  untilS: number;
  /** max seconds to simulate */
  horizon: number;
  /** also scan every hazard within range (fallback safety) */
  anyHazard?: boolean;
}

export interface TraversalResult {
  safe: boolean;
  /** time (relative) of the first problem */
  failT: number;
  reason: string;
}

const box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const pbox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const pt = { x: 0, y: 0, z: 0 };

export class Predictor {
  constructor(private readonly world: World) {}

  /**
   * Simulates a plan from the player's current state. Returns whether the
   * player survives (no hazard hit, not blocked, always supported).
   */
  check(plan: TraversalPlan, c: TraversalCheck): TraversalResult {
    const w = this.world;
    const st = w.player.stats;
    const b = w.player.body;
    const track = w.track;
    const t0 = w.time;
    // same step as the simulation: coarser steps can skip short danger windows
    const dt = 1 / 60;
    let s = w.playerS;
    let lat = w.playerLateral;
    let v = Math.max(0, w.playerSpeedS);
    let y = b.y;
    let vy = 0;
    let airborne = !b.grounded;
    if (airborne) vy = b.vy;
    const vmax = st.runSpeed * w.player.speedMul * plan.speed;
    const jumpS = plan.jumpS.filter((j) => j >= s - 0.05).sort((a, b2) => a - b2);
    const jumpT = [...plan.jumpT].sort((a, b2) => a - b2);
    const hw = st.halfWidth + c.margin;
    for (let t = 0; t <= c.horizon; t += dt) {
      const moving = t >= plan.startDelay;
      // horizontal
      if (moving) v = Math.min(vmax, v + (airborne ? st.airAccel : st.accel) * dt);
      else v = Math.max(0, v - st.decel * dt);
      s += v * dt;
      const dl = plan.lateral - lat;
      lat += Math.sign(dl) * Math.min(Math.abs(dl), (v > 1 ? 5.5 : 4.8) * dt);
      // jumps
      if (!airborne && moving) {
        let jump = false;
        if (jumpS.length && s >= jumpS[0]) {
          jumpS.shift();
          jump = true;
        }
        if (jumpT.length && t - plan.startDelay >= jumpT[0]) {
          jumpT.shift();
          jump = true;
        }
        if (jump) {
          airborne = true;
          vy = st.jumpVelocity;
        }
      }
      const floor = track.heightAt(s);
      if (airborne) {
        vy -= st.gravity * dt;
        y += vy * dt;
        if (vy < 0 && y <= floor && !track.gapAt(s)) {
          y = floor;
          airborne = false;
          vy = 0;
        }
      } else {
        y = floor;
      }
      track.offsetPoint(s, lat, pt);
      box.minX = pt.x - hw;
      box.maxX = pt.x + hw;
      box.minZ = pt.z - hw;
      box.maxZ = pt.z + hw;
      box.minY = y;
      box.maxY = y + st.height;
      const tt = t0 + t;
      for (const id of c.hazardIds) if (w.hazards.dangerAt(id, tt, box, 0)) return { safe: false, failT: t, reason: `hazard:${id}` };
      if (c.anyHazard) {
        const h = w.hazards.anyDangerAt(tt, box, 0, 6);
        if (h) return { safe: false, failT: t, reason: `hazard:${h.id}` };
      }
      for (const id of c.blockerIds) {
        const pb = w.solids.predictBox(id, tt, pbox);
        if (pb && pb.minX < box.maxX && pb.maxX > box.minX && pb.minZ < box.maxZ && pb.maxZ > box.minZ && pb.minY < box.maxY && pb.maxY > box.minY + 0.2)
          return { safe: false, failT: t, reason: `blocked:${id}` };
      }
      if (!airborne) {
        for (const id of c.supportIds) {
          const base = w.solids.get(id)?.base;
          if (!base) continue;
          // standing over this support's footprint → it must be solid now
          if (pt.x > base.minX - 0.1 && pt.x < base.maxX + 0.1 && pt.z > base.minZ - 0.1 && pt.z < base.maxZ + 0.1 && Math.abs(base.maxY - y) < 0.6) {
            if (!w.solids.predictBox(id, tt + 0.05, pbox)) return { safe: false, failT: t, reason: `support:${id}` };
          }
        }
      }
      if (s >= c.untilS) return { safe: true, failT: -1, reason: '' };
    }
    return { safe: true, failT: -1, reason: 'horizon' };
  }

  /**
   * Predicts where a jump started now lands, assuming air control toward
   * (aimX, aimZ). Returns landing time (s), position and whether it lands on
   * the target piece (moving/vanishing aware).
   */
  landing(
    aimX: number,
    aimZ: number,
    targetId: number,
    targetTopY: number,
    delay = 0,
  ): { ok: boolean; t: number; x: number; z: number; margin: number } {
    const w = this.world;
    const st = w.player.stats;
    const b = w.player.body;
    let x = b.x;
    let z = b.z;
    let vx = b.vx;
    let vz = b.vz;
    let y = b.y;
    let vy = st.jumpVelocity;
    const dt = 1 / 60;
    const vmax = st.runSpeed * w.player.speedMul;
    for (let t = 0; t < 1.6; t += dt) {
      // air control toward the aim point, braking to stop over it
      const dx = aimX - x;
      const dz = aimZ - z;
      const d = Math.hypot(dx, dz);
      const tLeft = Math.max(0.05, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * st.gravity * (y - targetTopY)))) / st.gravity);
      const want = Math.min(vmax, d / tLeft);
      const tvx = d > 1e-3 ? (dx / d) * want : 0;
      const tvz = d > 1e-3 ? (dz / d) * want : 0;
      const dvx = tvx - vx;
      const dvz = tvz - vz;
      const dl = Math.hypot(dvx, dvz);
      const mx = st.airAccel * dt;
      if (dl <= mx) {
        vx = tvx;
        vz = tvz;
      } else {
        vx += (dvx / dl) * mx;
        vz += (dvz / dl) * mx;
      }
      vy -= st.gravity * dt;
      x += vx * dt;
      z += vz * dt;
      y += vy * dt;
      if (vy < 0 && y <= targetTopY + 0.02) {
        const when = w.time + delay + t;
        if (targetId < 0) return { ok: true, t, x, z, margin: 1 };
        const pb = w.solids.predictBox(targetId, when, pbox);
        if (!pb) return { ok: false, t, x, z, margin: -1 };
        const margin = Math.min(x - pb.minX, pb.maxX - x, z - pb.minZ, pb.maxZ - z) - st.halfWidth * 0.5;
        // also require the target to still exist slightly after landing
        const after = w.solids.predictBox(targetId, when + 0.25, box);
        return { ok: margin > 0 && !!after, t, x, z, margin };
      }
    }
    return { ok: false, t: 1.6, x, z, margin: -1 };
  }
}
