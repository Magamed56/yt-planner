/**
 * Canonical event catalogue of the EscapeKit framework.
 *
 * Events are the backbone of the whole project: gameplay emits them and
 * CAMERA, SOUND, PARTICLES, VIDEO DIRECTOR and RECORDER consume them. Payloads
 * are plain data so the log can be serialised into video metadata.
 */

export interface Pos {
  x: number;
  y: number;
  z: number;
}

export type FailReason = 'caught' | 'fell' | 'crushed' | 'zapped' | 'hit' | 'squashed';
export type DeathCause = FailReason;

export interface GameEventMap {
  LEVEL_START: { seed: number; difficulty: number; theme: string; modules: number };
  LEVEL_END: { result: 'finish' | 'abort'; time: number; deaths: number };
  MODULE_ENTER: { index: number; type: string; s: number };

  PLAYER_START: { pos: Pos };
  PLAYER_STEP: { pos: Pos; speed: number; surface: string };
  PLAYER_JUMP: { pos: Pos; speed: number };
  PLAYER_LAND: { pos: Pos; fallSpeed: number; airTime: number };
  PLAYER_FALL: { pos: Pos };
  PLAYER_NEAR_DEATH: { pos: Pos; cause: string; margin: number };
  PLAYER_HIT: { pos: Pos; cause: string };
  PLAYER_DEATH: { pos: Pos; cause: DeathCause };
  PLAYER_RESPAWN: { pos: Pos; checkpoint: number };
  PLAYER_FAIL: { pos: Pos; reason: FailReason };
  PLAYER_FINISH: { pos: Pos; time: number; deaths: number; coins: number };
  COIN_COLLECT: { pos: Pos; total: number };
  CHECKPOINT_REACHED: { pos: Pos; index: number };

  ENEMY_SPAWN: { pos: Pos; enemy: string };
  ENEMY_APPEAR: { pos: Pos; mode: 'peek' | 'chase' | 'block' | 'boss' };
  ENEMY_DISAPPEAR: { pos: Pos };
  ENEMY_CHASE: { pos: Pos; speed: number };
  ENEMY_NEAR: { pos: Pos; gap: number };
  ENEMY_ROAR: { pos: Pos };
  ENEMY_ACCELERATE: { pos: Pos; speed: number };
  ENEMY_STUMBLE: { pos: Pos };
  ENEMY_BLOCK: { pos: Pos; lateral: number };
  ENEMY_GRAB: { pos: Pos };
  ENEMY_RETREAT: { pos: Pos };
  ENEMY_STEP: { pos: Pos; speed: number };

  OBSTACLE_BREAK: { pos: Pos; kind: string };
  DOOR_CLOSE: { pos: Pos; id: number };
  DOOR_OPEN: { pos: Pos; id: number };
  TRAP_TRIGGER: { pos: Pos; kind: string; id: number };
  FLOOR_COLLAPSE: { pos: Pos; id: number };
  PLATFORM_FALL: { pos: Pos; id: number };
  CRUSHER_SLAM: { pos: Pos; id: number };
  LASER_ON: { pos: Pos; id: number };
  FALLING_OBJECT: { pos: Pos; id: number };
  SPINNER_HIT: { pos: Pos; id: number };
  SURPRISE: { pos: Pos; kind: string };
  LIGHTS_FLICKER: { pos: Pos; duration: number };
  ALARM: { pos: Pos; duration: number };

  CHASE_START: { pos: Pos; s: number };
  CHASE_END: { pos: Pos; s: number; escaped: boolean };
  BOSS_START: { pos: Pos };
  BOSS_ATTACK: { pos: Pos; kind: string; lane: number };
  BOSS_END: { pos: Pos };
  FINAL_ESCAPE: { pos: Pos };
}

export type GameEventType = keyof GameEventMap;

export interface GameEvent<K extends GameEventType = GameEventType> {
  type: K;
  /** Simulation time in seconds when the event fired. */
  t: number;
  /** Simulation tick index. */
  tick: number;
  payload: GameEventMap[K];
}

export const ALL_EVENT_TYPES: GameEventType[] = [
  'LEVEL_START', 'LEVEL_END', 'MODULE_ENTER',
  'PLAYER_START', 'PLAYER_STEP', 'PLAYER_JUMP', 'PLAYER_LAND', 'PLAYER_FALL', 'PLAYER_NEAR_DEATH',
  'PLAYER_HIT', 'PLAYER_DEATH', 'PLAYER_RESPAWN', 'PLAYER_FAIL', 'PLAYER_FINISH', 'COIN_COLLECT',
  'CHECKPOINT_REACHED',
  'ENEMY_SPAWN', 'ENEMY_APPEAR', 'ENEMY_DISAPPEAR', 'ENEMY_CHASE', 'ENEMY_NEAR', 'ENEMY_ROAR',
  'ENEMY_ACCELERATE', 'ENEMY_STUMBLE', 'ENEMY_BLOCK', 'ENEMY_GRAB', 'ENEMY_RETREAT', 'ENEMY_STEP',
  'OBSTACLE_BREAK', 'DOOR_CLOSE', 'DOOR_OPEN', 'TRAP_TRIGGER', 'FLOOR_COLLAPSE', 'PLATFORM_FALL',
  'CRUSHER_SLAM', 'LASER_ON', 'FALLING_OBJECT', 'SPINNER_HIT', 'SURPRISE', 'LIGHTS_FLICKER', 'ALARM',
  'CHASE_START', 'CHASE_END', 'BOSS_START', 'BOSS_ATTACK', 'BOSS_END', 'FINAL_ESCAPE',
];

/**
 * How "interesting" each event is for video editing (0..1). The VideoDirector
 * and highlight finder use these weights to locate the best moments.
 */
export const EVENT_INTEREST: Partial<Record<GameEventType, number>> = {
  PLAYER_NEAR_DEATH: 1.0,
  ENEMY_GRAB: 1.0,
  PLAYER_FAIL: 0.95,
  FINAL_ESCAPE: 0.9,
  BOSS_START: 0.9,
  ENEMY_NEAR: 0.85,
  PLAYER_DEATH: 0.8,
  PLAYER_FINISH: 0.8,
  ENEMY_APPEAR: 0.75,
  FLOOR_COLLAPSE: 0.75,
  CHASE_START: 0.75,
  ENEMY_CHASE: 0.7,
  BOSS_ATTACK: 0.65,
  DOOR_CLOSE: 0.6,
  OBSTACLE_BREAK: 0.6,
  ENEMY_ROAR: 0.55,
  TRAP_TRIGGER: 0.55,
  PLAYER_FALL: 0.6,
  ENEMY_STUMBLE: 0.5,
  CHASE_END: 0.55,
  ENEMY_BLOCK: 0.6,
  PLATFORM_FALL: 0.45,
  CRUSHER_SLAM: 0.3,
  FALLING_OBJECT: 0.35,
  SURPRISE: 0.5,
  ALARM: 0.4,
  LIGHTS_FLICKER: 0.35,
  CHECKPOINT_REACHED: 0.3,
  SPINNER_HIT: 0.5,
  PLAYER_HIT: 0.5,
  PLAYER_JUMP: 0.08,
  PLAYER_LAND: 0.05,
  COIN_COLLECT: 0.05,
};
