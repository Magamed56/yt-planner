/** Bot personality parameters. */

export type ForcedMistakeKind = 'lateJump' | 'earlyJump' | 'noJump' | 'stop' | 'wrongLane' | 'gateRush';

/** A scripted mistake at a spine distance — used by FAIL / ONE_FAIL takes. */
export interface ForcedMistake {
  atS: number;
  kind: ForcedMistakeKind;
  /** stop duration for 'stop' */
  duration?: number;
}

export interface BotProfile {
  name: string;
  /** probability (0..1) of a notable mistake per obstacle */
  mistakeChance: number;
  /** seconds between seeing something and reacting */
  reactionTime: number;
  /** 0 = huge safety margins, 1 = takes razor-thin windows (near misses!) */
  riskLevel: number;
  /** 0 = waits a lot, 1 = never slows down, pushes through */
  aggression: number;
  /** cruising speed factor 0.5..1 */
  speed: number;
  forced?: ForcedMistake[];
}

export const BOT_PROFILES: Record<string, BotProfile> = {
  PERFECT: { name: 'PERFECT', mistakeChance: 0, reactionTime: 0.05, riskLevel: 0.2, aggression: 0.75, speed: 1 },
  SKILLED: { name: 'SKILLED', mistakeChance: 0.03, reactionTime: 0.12, riskLevel: 0.4, aggression: 0.65, speed: 1 },
  AVERAGE: { name: 'AVERAGE', mistakeChance: 0.08, reactionTime: 0.2, riskLevel: 0.5, aggression: 0.5, speed: 0.95 },
  CLUMSY: { name: 'CLUMSY', mistakeChance: 0.2, reactionTime: 0.3, riskLevel: 0.6, aggression: 0.45, speed: 0.9 },
  DAREDEVIL: { name: 'DAREDEVIL', mistakeChance: 0.04, reactionTime: 0.07, riskLevel: 0.95, aggression: 1, speed: 1 },
  CAUTIOUS: { name: 'CAUTIOUS', mistakeChance: 0.02, reactionTime: 0.25, riskLevel: 0.05, aggression: 0.2, speed: 0.85 },
};

export function botProfile(name: string | Partial<BotProfile> | undefined): BotProfile {
  if (!name) return BOT_PROFILES.SKILLED;
  if (typeof name === 'string') return BOT_PROFILES[name.toUpperCase()] ?? BOT_PROFILES.SKILLED;
  return { ...BOT_PROFILES.SKILLED, ...name };
}
