/**
 * Hazard specifications (pure data). Every hazard is a deterministic function
 * of time (optionally relative to a trigger) so the bot can predict danger and
 * replays stay identical.
 */

interface HazardBase {
  /** if set, the hazard is inactive until this trigger fires; time is measured from the trigger */
  triggerId?: number;
}

/** Rotating arms around a vertical axis. Hit => knockback + stun. */
export interface SpinnerSpec extends HazardBase {
  kind: 'spinner';
  x: number;
  y: number;
  z: number;
  radius: number;
  /** arm half thickness */
  thick: number;
  /** rad/s, sign = direction */
  omega: number;
  phase: number;
  arms: number;
  lethal: boolean;
}

/** Hydraulic press that slams onto the floor. Overlap with head => crushed. */
export interface CrusherSpec extends HazardBase {
  kind: 'crusher';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
  topY: number;
  period: number;
  phase: number;
}

/** Laser beam between two points, blinking and optionally sweeping. */
export interface LaserSpec extends HazardBase {
  kind: 'laser';
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
  period: number;
  /** fraction of the period the beam is on */
  on: number;
  phase: number;
  sweep?: { dx: number; dy: number; dz: number; period: number; phase: number };
}

/** Crate/barrel periodically dropping from the ceiling with a shadow telegraph. */
export interface FallerSpec extends HazardBase {
  kind: 'faller';
  x: number;
  z: number;
  floorY: number;
  topY: number;
  size: number;
  period: number;
  phase: number;
  /** fraction of the period used for the warning shadow */
  warn: number;
  /** fraction of the period used for the drop */
  drop: number;
}

/** Static lethal volume (acid, lava, electric floor). */
export interface ZoneSpec extends HazardBase {
  kind: 'zone';
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  cause: 'zapped' | 'fell' | 'hit';
  style: string;
}

/** Boss fist slam on lanes following a deterministic pattern. */
export interface SlamSpec extends HazardBase {
  kind: 'slam';
  /** lane strips the slam can hit (world boxes, floor level) */
  lanes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  floorY: number;
  /** sequence of lane indices; one slam every `interval` seconds */
  pattern: number[];
  interval: number;
  warn: number;
  active: number;
}

/** Barrels rolling along a lane. */
export interface RollerSpec extends HazardBase {
  kind: 'roller';
  sx: number;
  sy: number;
  sz: number;
  vx: number;
  vz: number;
  radius: number;
  period: number;
  phase: number;
  travel: number;
}

export type HazardSpec = SpinnerSpec | CrusherSpec | LaserSpec | FallerSpec | ZoneSpec | SlamSpec | RollerSpec;
export type HazardKind = HazardSpec['kind'];
