/**
 * Character System. Gameplay never references a concrete character: it reads a
 * `CharacterDef` (stats + model + animation + sound flavour). Adding Robot, Cat,
 * Cookie… is a data registration — no gameplay code changes.
 */
import type { ModelSpec } from './ModelSpec';

export interface CharacterStats {
  /** m/s */
  runSpeed: number;
  /** ground acceleration m/s² */
  accel: number;
  /** air acceleration m/s² */
  airAccel: number;
  /** ground deceleration when no input m/s² */
  decel: number;
  /** initial jump velocity m/s */
  jumpVelocity: number;
  /** gravity m/s² (positive) */
  gravity: number;
  maxFall: number;
  halfWidth: number;
  height: number;
  /** seconds after leaving ground a jump is still allowed */
  coyoteTime: number;
  /** seconds a jump press is remembered before landing */
  jumpBuffer: number;
  /** velocity multiplier when jump is released early */
  jumpCut: number;
  /** distance between footsteps (sound/particles) */
  stepLength: number;
}

/**
 * Reference stats every level is generated and validated against. Characters
 * may deviate slightly (see `clampToReference`) so all 100 levels stay beatable.
 */
export const REFERENCE_STATS: CharacterStats = {
  runSpeed: 8,
  accel: 60,
  airAccel: 26,
  decel: 50,
  jumpVelocity: 12,
  gravity: 32,
  maxFall: 34,
  halfWidth: 0.35,
  height: 1.4,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  jumpCut: 0.55,
  stepLength: 1.15,
};

export interface CharacterAnimStyle {
  /** body bob amplitude while running */
  bob: number;
  /** leg swing amplitude (radians) */
  legSwing: number;
  /** arm swing amplitude (radians) */
  armSwing: number;
  /** squash & stretch strength on jump/land */
  squash: number;
  /** lean forward while running (radians) */
  lean: number;
  /** waddle (side tilt) amplitude */
  waddle: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  /** multipliers applied to REFERENCE_STATS (clamped to ±8% for fairness) */
  statMods?: Partial<Record<'runSpeed' | 'jumpVelocity' | 'accel' | 'airAccel', number>>;
  model: ModelSpec;
  anim: CharacterAnimStyle;
  /** sound flavour: base pitch multiplier and voice type for squeaks */
  voice: { pitch: number; type: 'squeak' | 'beep' | 'meow' | 'boing' | 'crunch' | 'hollow' | 'warble' };
  /** coins needed to unlock (0 = unlocked by default) */
  unlockCost: number;
  /** highlight color used in UI / particles */
  color: string;
}

export const DEFAULT_ANIM: CharacterAnimStyle = {
  bob: 0.06,
  legSwing: 0.9,
  armSwing: 0.8,
  squash: 0.22,
  lean: 0.18,
  waddle: 0.04,
};

const FAIR = 0.08;

/** Resolves final stats for a character (with fairness clamps). */
export function resolveStats(def: CharacterDef | undefined): CharacterStats {
  const s = { ...REFERENCE_STATS };
  if (!def?.statMods) return s;
  for (const [k, v] of Object.entries(def.statMods)) {
    const m = Math.min(1 + FAIR, Math.max(1 - FAIR, v ?? 1));
    (s as unknown as Record<string, number>)[k] *= m;
  }
  return s;
}
