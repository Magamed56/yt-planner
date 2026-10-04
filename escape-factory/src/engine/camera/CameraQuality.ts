/**
 * CameraQualityValidator: per-frame checks of a camera pose against the level
 * (camera inside geometry, below a floor, beyond a ceiling, view of the player
 * blocked) and framing (player / chasing enemy out of frame). Pure math, used by
 * unit tests and the headless camera audit of video takes.
 */
import type { CameraMode, CameraPose } from './CameraDirector';
import { pointInBox, segmentHit, type CamBox, type CameraObstacles } from './CameraObstacles';

export interface FramePoint {
  x: number;
  y: number;
  z: number;
}

export interface CameraFrameInput {
  pose: CameraPose;
  /** width / height of the output frame (9/16 for Shorts) */
  aspect: number;
  /** player chest point */
  player: FramePoint;
  /** player's feet height (ceiling detection) */
  playerFeetY: number;
  /** course height at the player (a falling player is below it) */
  trackY?: number;
  /** enemy body centre when it is visible and chasing */
  enemy: FramePoint | null;
  mode: CameraMode;
}

export interface CameraFrameCheck {
  inside: boolean;
  belowFloor: boolean;
  aboveCeiling: boolean;
  occluded: boolean;
  /** camera closer than 0.7 m to the player's chest (inside the character) */
  tooClose: boolean;
  playerOut: boolean;
  /** null when not applicable (no chasing enemy / mode doesn't frame it) */
  enemyOut: boolean | null;
  /** normalised device coords of the player (|x|,|y| ≤ 1 is on screen) */
  playerNdc: [number, number];
}

/** Modes whose job is to show the chaser together with the runner. */
export const ENEMY_FRAMING_MODES: CameraMode[] = ['CHASE', 'WIDE'];

/** Projects a world point with a pose → NDC [x, y, depth]; depth ≤ 0 = behind the camera. */
export function project(pose: CameraPose, aspect: number, p: FramePoint): [number, number, number] {
  let fx = pose.tx - pose.x;
  let fy = pose.ty - pose.y;
  let fz = pose.tz - pose.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up' = right × forward
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const vx = p.x - pose.x;
  const vy = p.y - pose.y;
  const vz = p.z - pose.z;
  const depth = vx * fx + vy * fy + vz * fz;
  let sx = vx * rx + vz * rz;
  let sy = vx * ux + vy * uy + vz * uz;
  if (pose.roll) {
    const c = Math.cos(-pose.roll);
    const s = Math.sin(-pose.roll);
    [sx, sy] = [sx * c - sy * s, sx * s + sy * c];
  }
  const t = Math.tan((pose.fov * Math.PI) / 360);
  if (depth <= 1e-3) return [Infinity, Infinity, depth];
  return [sx / (depth * t * aspect), sy / (depth * t), depth];
}

const onScreen = (n: [number, number, number], margin = 1) => n[2] > 0.05 && Math.abs(n[0]) <= margin && Math.abs(n[1]) <= margin;

const region = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const boxes: CamBox[] = [];

export function checkCameraFrame(f: CameraFrameInput, obstacles: CameraObstacles): CameraFrameCheck {
  const { pose, player } = f;
  region.minX = Math.min(pose.x, player.x) - 1;
  region.maxX = Math.max(pose.x, player.x) + 1;
  region.minY = Math.min(pose.y, player.y) - 40;
  region.maxY = Math.max(pose.y, player.y) + 1;
  region.minZ = Math.min(pose.z, player.z) - 1;
  region.maxZ = Math.max(pose.z, player.z) + 1;
  obstacles.query(region, boxes);
  let inside = false;
  let belowFloor = false;
  let aboveCeiling = false;
  let occluded = false;
  const dx = pose.x - player.x;
  const dy = pose.y - player.y;
  const dz = pose.z - player.z;
  for (const b of boxes) {
    if (pointInBox(pose.x, pose.y, pose.z, b, 0.05)) inside = true;
    // under a walkable surface (looking at its underside)
    if (b.kind === 'walkable' && pose.x > b.minX && pose.x < b.maxX && pose.z > b.minZ && pose.z < b.maxZ && pose.y < b.minY && b.minY - pose.y < 40) belowFloor = true;
    const t = segmentHit(player.x, player.y, player.z, dx, dy, dz, b, -0.05);
    if (t < 0.999) {
      occluded = true;
      // an overhead structure (roof, lintel, raised door, crusher housing) between player and camera
      // (walkable surfaces are floors, not ceilings — e.g. the ledge above a falling player)
      const level = Math.max(f.playerFeetY, f.trackY ?? -Infinity);
      if (b.kind !== 'enemy' && b.kind !== 'walkable' && b.minY > level + 1.7 && pose.y > b.minY) aboveCeiling = true;
    }
  }
  const pn = project(pose, f.aspect, player);
  let enemyOut: boolean | null = null;
  if (f.enemy && ENEMY_FRAMING_MODES.includes(f.mode)) enemyOut = !onScreen(project(pose, f.aspect, f.enemy));
  const tooClose = Math.hypot(dx, dy, dz) < 0.7;
  return { inside, belowFloor, aboveCeiling, occluded, tooClose, playerOut: !onScreen(pn), enemyOut, playerNdc: [pn[0], pn[1]] };
}

export interface CameraQualitySummary {
  frames: number;
  inside: number;
  belowFloor: number;
  aboveCeiling: number;
  occluded: number;
  tooClose: number;
  playerOut: number;
  enemyFramed: number;
  enemyOut: number;
  /** largest per-frame camera jump without a cut (m) */
  maxJump: number;
  /** frames whose uncut camera jump exceeds 1.2 m */
  jumps: number;
  examples: Array<{ frame: number; t: number; mode: CameraMode; issue: string }>;
}

/** Accumulates per-frame checks into a report. */
export class CameraQualityReport {
  readonly s: CameraQualitySummary = { frames: 0, inside: 0, belowFloor: 0, aboveCeiling: 0, occluded: 0, tooClose: 0, playerOut: 0, enemyFramed: 0, enemyOut: 0, maxJump: 0, jumps: 0, examples: [] };
  private last: { x: number; y: number; z: number } | null = null;

  /** Frames were skipped (death/respawn): don't measure a jump across the gap. */
  gap(): void {
    this.last = null;
  }

  /** `subject` = player position this frame (jumps are measured relative to it). */
  add(c: CameraFrameCheck, mode: CameraMode, t: number, pose: CameraPose, cut: boolean, subject: FramePoint): void {
    const s = this.s;
    const frame = s.frames++;
    const note = (issue: string) => {
      if (s.examples.length < 40) s.examples.push({ frame, t, mode, issue });
    };
    if (c.inside) (s.inside++, note('inside'));
    if (c.belowFloor) (s.belowFloor++, note('belowFloor'));
    if (c.aboveCeiling) (s.aboveCeiling++, note('aboveCeiling'));
    if (c.occluded) s.occluded++;
    if (c.tooClose) (s.tooClose++, note('tooClose'));
    if (c.playerOut) (s.playerOut++, note('playerOut'));
    if (c.enemyOut !== null) {
      s.enemyFramed++;
      if (c.enemyOut) (s.enemyOut++, note('enemyOut'));
    }
    // camera offset from the subject: a big change in one frame without a cut = teleport
    const ox = pose.x - subject.x;
    const oy = pose.y - subject.y;
    const oz = pose.z - subject.z;
    if (this.last && !cut) {
      const j = Math.hypot(ox - this.last.x, oy - this.last.y, oz - this.last.z);
      if (j > s.maxJump) s.maxJump = j;
      if (j > 1.2) (s.jumps++, note(`jump ${j.toFixed(2)}m`));
    }
    this.last = { x: ox, y: oy, z: oz };
  }
}
