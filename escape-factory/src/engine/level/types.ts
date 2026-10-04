/**
 * Level data model — pure, serialisable data produced by the LevelGenerator and
 * consumed by the simulation (World), the renderer (LevelView), the bot and the
 * camera. Nothing here depends on Three.js.
 */
import type { AABB } from '../core/math';
import type { GameEventType } from '../events/GameEvents';
import type { HazardSpec } from '../obstacle/hazardTypes';

/** Track heading: 0:+Z, 1:+X, 2:-Z, 3:-X (90° steps keep every collider axis-aligned). */
export type Dir = 0 | 1 | 2 | 3;

export interface Frame {
  x: number;
  y: number;
  z: number;
  dir: Dir;
}

export type SurfaceType = 'default' | 'metal' | 'grate' | 'conveyor' | 'ice' | 'jelly' | 'bridge';

export type MotionSpec =
  /** offset = A * sin(2π(t/period + phase)) */
  | { kind: 'sine'; ax: number; ay: number; az: number; period: number; phase: number }
  /** eased back-and-forth with pauses (`hold` = fraction of the cycle spent paused at each end) */
  | { kind: 'pingpong'; ax: number; ay: number; az: number; period: number; phase: number; hold: number }
  /** moves once by A over `duration` when trigger `triggerId` fires (doors, slamming walls) */
  | { kind: 'trigger'; ax: number; ay: number; az: number; duration: number; delay: number; triggerId: number };

export type VanishSpec =
  /** solid while ((t/period + phase) mod 1) < on */
  | { kind: 'cycle'; period: number; on: number; phase: number }
  /** falls `delay` seconds after the player stands on it, respawns after `respawn` (0 = never) */
  | { kind: 'step'; delay: number; respawn: number }
  /** collapses `delay` seconds after trigger `triggerId` fires */
  | { kind: 'trigger'; triggerId: number; delay: number };

interface PieceBase {
  id: number;
  module: number;
}

export interface SolidPiece extends PieceBase {
  type: 'solid';
  box: AABB;
  /** semantic visual style; the active theme maps it to materials */
  style: string;
  surface: SurfaceType;
  conveyor?: { x: number; z: number };
  motion?: MotionSpec;
  vanish?: VanishSpec;
  /** the enemy smashes it during chases (OBSTACLE_BREAK) */
  breakable?: boolean;
  /** true when the player can stand on it (used by bot / camera / spawn) */
  walkable?: boolean;
}

export interface HazardPiece extends PieceBase {
  type: 'hazard';
  hazard: HazardSpec;
}

export type SurpriseKind =
  | 'enemyPeek'
  | 'lightsFlicker'
  | 'alarm'
  | 'floorCollapse'
  | 'wallSlam'
  | 'debris'
  | 'fakeSafe'
  | 'steamBurst'
  | 'enemyRoar';

export type TriggerAction =
  | { kind: 'chaseStart'; intensity: number }
  | { kind: 'chaseEnd' }
  | { kind: 'finalEscape' }
  | { kind: 'bossStart'; x: number; y: number; z: number; hazardId: number }
  | { kind: 'bossEnd' }
  | { kind: 'enemyPeek'; x: number; y: number; z: number; duration: number }
  | { kind: 'enemyBlock'; x: number; y: number; z: number; lateral: number }
  | { kind: 'surprise'; surprise: SurpriseKind; chaosOnly?: boolean }
  | { kind: 'event'; event: GameEventType }
  /** fires dependent pieces (trigger motions / trigger vanish / triggered hazards) */
  | { kind: 'fire' };

export interface TriggerPiece extends PieceBase {
  type: 'trigger';
  /** spine distance at which the trigger fires when the player passes it */
  s: number;
  action: TriggerAction;
  /** other trigger-driven pieces listen to this id */
  triggerId: number;
}

export interface CheckpointPiece extends PieceBase {
  type: 'checkpoint';
  index: number;
  x: number;
  y: number;
  z: number;
  dir: Dir;
  s: number;
}

export interface CoinPiece extends PieceBase {
  type: 'coin';
  x: number;
  y: number;
  z: number;
}

export interface DecorPiece extends PieceBase {
  type: 'decor';
  kind: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  variant: number;
}

export interface FinishPiece extends PieceBase {
  type: 'finish';
  box: AABB;
  x: number;
  y: number;
  z: number;
  dir: Dir;
  s: number;
}

export type Piece = SolidPiece | HazardPiece | TriggerPiece | CheckpointPiece | CoinPiece | DecorPiece | FinishPiece;

export interface SpinePoint {
  x: number;
  y: number;
  z: number;
  /** cumulative distance along the spine */
  s: number;
  /** half-width of walkable track around this point */
  halfWidth: number;
  /** true when no floor exists under this point (gap) */
  gap: boolean;
}

/**
 * Navigation hints emitted by modules. The generator knows the exact geometry
 * so it tells the bot where jumps, timing gates and lane choices are.
 */
export type NavHint =
  | { kind: 'lane'; s0: number; s1: number; lateral: number }
  | {
      kind: 'jump';
      /** ideal take-off spine distance */
      s: number;
      /** landing spine distance */
      landS: number;
      lateral: number;
      /** piece the bot must land on (may be moving or vanishing) */
      targetId: number;
      /** height difference landing - takeoff */
      dy: number;
    }
  | {
      kind: 'gate';
      /** wait point before the danger zone */
      s0: number;
      /** end of the danger zone */
      s1: number;
      lateral: number;
      hazardIds: number[];
      /** solids (pushers, doors) that block the path when they overlap it */
      blockerIds: number[];
      /** vanishing supports that must be solid while crossing */
      supportIds: number[];
      /** jump points (spine distances) inside the gate, e.g. to clear spinner arms */
      jumps: number[];
    }
  | { kind: 'ride'; pieceId: number; s0: number; s1: number }
  | { kind: 'choice'; s0: number; s1: number; options: number[]; blockerIds: number[] }
  | { kind: 'arena'; s0: number; s1: number; lanes: number[]; hazardIds: number[] }
  | { kind: 'nowait'; s0: number; s1: number }
  | { kind: 'sprint'; s0: number; s1: number };

export interface ModuleInstance {
  index: number;
  type: string;
  s0: number;
  s1: number;
  entry: Frame;
  exit: Frame;
  footprint: AABB;
  /** estimated traversal seconds for the reference character */
  estTime: number;
  /** cumulative estimated time at module entry */
  estStart: number;
  /** module produces a notable "something happens" moment */
  beat: boolean;
  tags: string[];
}

export interface LevelStats {
  pieces: number;
  solids: number;
  hazards: number;
  triggers: number;
  coins: number;
  checkpoints: number;
  totalLength: number;
  estDuration: number;
  beats: number;
  maxBeatGap: number;
  generationMs: number;
}

export interface LevelData {
  version: number;
  seed: number;
  difficulty: number;
  difficultyName: string;
  theme: string;
  enemy: string;
  specialEvents: string[];
  modules: ModuleInstance[];
  pieces: Piece[];
  spine: SpinePoint[];
  hints: NavHint[];
  spawn: { x: number; y: number; z: number; dir: Dir };
  checkpoints: CheckpointPiece[];
  finish: FinishPiece | null;
  /** lowest walkable height — used for fall detection fallback */
  minY: number;
  stats: LevelStats;
}

// ---- Frame math -----------------------------------------------------------

const FWD: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** World forward (x, z) of a heading. */
export const dirForward = (d: Dir): readonly [number, number] => FWD[d];
/** World right (x, z) = forward × up. */
export const dirRight = (d: Dir): readonly [number, number] => {
  const f = FWD[d];
  return [-f[1], f[0]];
};
/** Yaw angle (radians, around +Y) such that local +Z maps to the heading. */
export const dirYaw = (d: Dir): number => (d * Math.PI) / 2;
export const turnLeft = (d: Dir): Dir => ((d + 1) % 4) as Dir;
export const turnRight = (d: Dir): Dir => ((d + 3) % 4) as Dir;

/** Converts module-local coordinates (lx: right, ly: up, lz: forward) to world. */
export function localToWorld(f: Frame, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const [fx, fz] = FWD[f.dir];
  const rx = -fz;
  const rz = fx;
  return { x: f.x + fx * lz + rx * lx, y: f.y + ly, z: f.z + fz * lz + rz * lx };
}

/** Converts a local direction vector to world (no translation). */
export function localDirToWorld(d: Dir, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const [fx, fz] = FWD[d];
  return { x: fx * lz - fz * lx, y: ly, z: fz * lz + fx * lx };
}

/** Converts a local box (ranges) to a world AABB. */
export function localBoxToWorld(
  f: Frame,
  lx0: number,
  lx1: number,
  ly0: number,
  ly1: number,
  lz0: number,
  lz1: number,
): AABB {
  const a = localToWorld(f, lx0, ly0, lz0);
  const b = localToWorld(f, lx1, ly1, lz1);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    minZ: Math.min(a.z, b.z),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
    maxZ: Math.max(a.z, b.z),
  };
}
