import type { Rng } from '../core/rng';
import type { EventBus } from '../events/EventBus';
import type { FailReason } from '../events/GameEvents';
import type { Track } from '../level/Track';
import type { LevelData } from '../level/types';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Player } from './Player';

/** The subset of World that subsystems are allowed to touch. */
export interface SimContext {
  readonly time: number;
  readonly dt: number;
  readonly events: EventBus;
  readonly physics: PhysicsWorld;
  readonly track: Track;
  readonly level: LevelData;
  /** runtime randomness (surprises, enemy improvisation) — seeded */
  readonly rng: Rng;
  readonly player: Player;
  /** player progress along the spine */
  readonly playerS: number;
  readonly playerLateral: number;
  /** smoothed player speed along the spine (m/s) */
  readonly playerSpeedS: number;
  killPlayer(cause: FailReason): void;
  knockPlayer(pushX: number, pushZ: number, strength: number): void;
}
