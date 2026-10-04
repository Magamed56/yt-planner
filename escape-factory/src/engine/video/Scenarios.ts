/**
 * Scenarios and takes: the levers that turn ONE level into MANY different
 * videos. A scenario shapes the level + direction; a take shapes the
 * performance (bot personality, enemy behaviour, chaos).
 */
import { BOT_PROFILES, type BotProfile } from '../bot/BotProfile';
import type { EnemyTuning } from '../enemy/Enemy';
import type { VideoScenario } from './VideoConfig';

export interface ScenarioPreset {
  id: VideoScenario;
  label: string;
  /** generator flags merged into the level params */
  specialEvents: string[];
  /** forced difficulty (else from config) */
  difficulty?: number;
  bot: BotProfile;
  enemy: Partial<EnemyTuning>;
  chaos: number;
  /** what the shorts highlight finder should prefer */
  focus: Array<'chase' | 'nearDeath' | 'fail' | 'boss' | 'finish' | 'surprise'>;
  /** prefer takes without deaths */
  wantClean: boolean;
  /** script a dramatic failure */
  wantFail: boolean;
}

export const SCENARIOS: Record<VideoScenario, ScenarioPreset> = {
  CHASE: {
    id: 'CHASE',
    label: 'Chase',
    specialEvents: ['doubleChase'],
    bot: BOT_PROFILES.SKILLED,
    enemy: { aggression: 1.3, nearGapOffset: -0.2 },
    chaos: 0,
    focus: ['chase', 'nearDeath', 'finish'],
    wantClean: false,
    wantFail: false,
  },
  NEAR_DEATH: {
    id: 'NEAR_DEATH',
    label: 'Near Death',
    specialEvents: ['more:CRUSHER', 'more:LASER', 'more:SPINNER'],
    bot: { ...BOT_PROFILES.DAREDEVIL, mistakeChance: 0.02 },
    enemy: { aggression: 1.5, nearGapOffset: -0.5 },
    chaos: 0,
    focus: ['nearDeath', 'chase'],
    wantClean: true,
    wantFail: false,
  },
  PERFECT_RUN: {
    id: 'PERFECT_RUN',
    label: 'Perfect Run',
    specialEvents: [],
    bot: BOT_PROFILES.PERFECT,
    enemy: {},
    chaos: 0,
    focus: ['finish', 'chase'],
    wantClean: true,
    wantFail: false,
  },
  FAIL: {
    id: 'FAIL',
    label: 'Fail',
    specialEvents: [],
    bot: BOT_PROFILES.SKILLED,
    enemy: { aggression: 1.2 },
    chaos: 0,
    focus: ['fail', 'chase', 'nearDeath'],
    wantClean: false,
    wantFail: true,
  },
  IMPOSSIBLE: {
    id: 'IMPOSSIBLE',
    label: 'Impossible',
    specialEvents: ['chaos'],
    difficulty: 5,
    bot: { ...BOT_PROFILES.PERFECT, riskLevel: 0.6 },
    enemy: { aggression: 1.4 },
    chaos: 0.6,
    focus: ['nearDeath', 'chase', 'boss', 'finish'],
    wantClean: false,
    wantFail: false,
  },
  BOSS_ESCAPE: {
    id: 'BOSS_ESCAPE',
    label: 'Boss Escape',
    specialEvents: ['boss'],
    bot: BOT_PROFILES.SKILLED,
    enemy: { aggression: 1.2 },
    chaos: 0,
    focus: ['boss', 'chase', 'finish'],
    wantClean: false,
    wantFail: false,
  },
  CHAOS: {
    id: 'CHAOS',
    label: 'Chaos',
    specialEvents: ['chaos', 'doubleChase', 'more:FALLING_OBJECT', 'more:TRAP'],
    bot: BOT_PROFILES.AVERAGE,
    enemy: { aggression: 1.4 },
    chaos: 1,
    focus: ['surprise', 'fail', 'chase', 'nearDeath'],
    wantClean: false,
    wantFail: false,
  },
};

export interface TakePreset {
  take: number;
  id: string;
  label: string;
  /** overrides applied on top of the scenario bot */
  bot: Partial<BotProfile>;
  enemy: Partial<EnemyTuning>;
  chaos?: number;
  wantClean?: boolean;
  wantFail?: boolean;
}

/** TAKE 1..6 of the same level. */
export const TAKES: TakePreset[] = [
  { take: 1, id: 'PERFECT', label: 'Perfect', bot: { ...BOT_PROFILES.PERFECT }, enemy: {}, wantClean: true },
  { take: 2, id: 'ONE_FAIL', label: 'One fail', bot: { mistakeChance: 0.02 }, enemy: {}, wantFail: true },
  { take: 3, id: 'NEAR_DEATH', label: 'Near death', bot: { riskLevel: 0.95, aggression: 1, mistakeChance: 0.02 }, enemy: { nearGapOffset: -0.5, aggression: 1.4 } },
  { take: 4, id: 'FAST_RUN', label: 'Fast run', bot: { ...BOT_PROFILES.PERFECT, reactionTime: 0.03, aggression: 1, riskLevel: 0.7 }, enemy: {}, wantClean: true },
  { take: 5, id: 'CHAOS', label: 'Chaos', bot: { mistakeChance: 0.1 }, enemy: { aggression: 1.4 }, chaos: 1 },
  { take: 6, id: 'ENEMY_ALMOST_CATCHES', label: 'Grumbo almost catches me', bot: { mistakeChance: 0.03 }, enemy: { aggression: 1.8, nearGapOffset: -0.9, mercy: true } },
];

export function takePreset(n: number): TakePreset {
  return TAKES[Math.max(1, Math.min(6, Math.round(n))) - 1];
}
