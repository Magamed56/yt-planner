/**
 * Difficulty presets. Difficulty is a continuous number 1..5 (EASY..IMPOSSIBLE)
 * so campaign levels can ramp smoothly; named presets are anchor points.
 */
import { clamp, lerp } from '../core/math';

export type DifficultyName = 'EASY' | 'NORMAL' | 'HARD' | 'INSANE' | 'IMPOSSIBLE';
export const DIFFICULTY_NAMES: DifficultyName[] = ['EASY', 'NORMAL', 'HARD', 'INSANE', 'IMPOSSIBLE'];

export interface DifficultyParams {
  level: number;
  name: DifficultyName;
  /** multiplier for hazard speed (periods are divided by it) */
  obstacleSpeed: number;
  /** 0..1 probability that optional traps are added to a module */
  trapDensity: number;
  lengthMin: number;
  lengthMax: number;
  gapMin: number;
  gapMax: number;
  platformMin: number;
  platformMax: number;
  trackHalfWidth: number;
  bridgeWidth: number;
  enemyHunt: number;
  enemyMax: number;
  enemyBaseGap: number;
  enemyNearGap: number;
  enemyLungeMin: number;
  enemyLungeMax: number;
  /** expected surprises per 20 seconds */
  surpriseRate: number;
  /** safe-window scale for timing hazards (1 = generous) */
  timingWindow: number;
  chaseSegments: number;
  checkpointEvery: number;
  coinRate: number;
}

type Anchor = Omit<DifficultyParams, 'level' | 'name'>;

const ANCHORS: Anchor[] = [
  // EASY
  {
    obstacleSpeed: 0.75, trapDensity: 0.25, lengthMin: 10, lengthMax: 12, gapMin: 1.6, gapMax: 2.6,
    platformMin: 3.2, platformMax: 4.5, trackHalfWidth: 3.0, bridgeWidth: 1.6, enemyHunt: 5.0, enemyMax: 12,
    enemyBaseGap: 9, enemyNearGap: 3.2, enemyLungeMin: 6, enemyLungeMax: 9, surpriseRate: 0.9,
    timingWindow: 1.3, chaseSegments: 1, checkpointEvery: 4, coinRate: 1,
  },
  // NORMAL
  {
    obstacleSpeed: 0.9, trapDensity: 0.4, lengthMin: 13, lengthMax: 16, gapMin: 2.0, gapMax: 3.2,
    platformMin: 2.8, platformMax: 4.0, trackHalfWidth: 2.8, bridgeWidth: 1.3, enemyHunt: 5.6, enemyMax: 13,
    enemyBaseGap: 8, enemyNearGap: 3.0, enemyLungeMin: 5, enemyLungeMax: 8, surpriseRate: 1.1,
    timingWindow: 1.15, chaseSegments: 1, checkpointEvery: 5, coinRate: 1,
  },
  // HARD
  {
    obstacleSpeed: 1.05, trapDensity: 0.55, lengthMin: 16, lengthMax: 20, gapMin: 2.4, gapMax: 3.7,
    platformMin: 2.5, platformMax: 3.6, trackHalfWidth: 2.6, bridgeWidth: 1.1, enemyHunt: 6.2, enemyMax: 14,
    enemyBaseGap: 7, enemyNearGap: 2.7, enemyLungeMin: 4.5, enemyLungeMax: 7, surpriseRate: 1.3,
    timingWindow: 1.0, chaseSegments: 2, checkpointEvery: 5, coinRate: 1.1,
  },
  // INSANE
  {
    obstacleSpeed: 1.2, trapDensity: 0.7, lengthMin: 20, lengthMax: 25, gapMin: 2.8, gapMax: 4.2,
    platformMin: 2.2, platformMax: 3.2, trackHalfWidth: 2.4, bridgeWidth: 0.95, enemyHunt: 6.7, enemyMax: 15,
    enemyBaseGap: 6.2, enemyNearGap: 2.5, enemyLungeMin: 4, enemyLungeMax: 6, surpriseRate: 1.5,
    timingWindow: 0.9, chaseSegments: 2, checkpointEvery: 6, coinRate: 1.2,
  },
  // IMPOSSIBLE
  {
    obstacleSpeed: 1.38, trapDensity: 0.85, lengthMin: 24, lengthMax: 30, gapMin: 3.1, gapMax: 4.6,
    platformMin: 2.0, platformMax: 2.8, trackHalfWidth: 2.2, bridgeWidth: 0.85, enemyHunt: 7.2, enemyMax: 16,
    enemyBaseGap: 5.5, enemyNearGap: 2.3, enemyLungeMin: 3.5, enemyLungeMax: 5, surpriseRate: 1.8,
    timingWindow: 0.8, chaseSegments: 3, checkpointEvery: 6, coinRate: 1.3,
  },
];

export function difficultyFromName(n: string): number {
  const i = DIFFICULTY_NAMES.indexOf(n.toUpperCase() as DifficultyName);
  return i < 0 ? 2 : i + 1;
}

export function difficultyName(level: number): DifficultyName {
  return DIFFICULTY_NAMES[clamp(Math.round(level), 1, 5) - 1];
}

/** Resolves a numeric (1..5, fractional allowed) or named difficulty into parameters. */
export function resolveDifficulty(d: number | string): DifficultyParams {
  const level = clamp(typeof d === 'string' ? (isNaN(Number(d)) ? difficultyFromName(d) : Number(d)) : d, 1, 5);
  const i = Math.min(3, Math.floor(level - 1));
  const t = level - 1 - i;
  const a = ANCHORS[i];
  const b = ANCHORS[i + 1];
  const out = { level, name: difficultyName(level) } as DifficultyParams;
  for (const k of Object.keys(a) as Array<keyof Anchor>) {
    const v = lerp(a[k], b[k], t);
    (out as unknown as Record<string, number>)[k] =
      k === 'lengthMin' || k === 'lengthMax' || k === 'chaseSegments' || k === 'checkpointEvery' ? Math.round(v) : v;
  }
  return out;
}
