/**
 * The 100-level ESCAPE FACTORY campaign. Levels are not hand-built: each is a
 * (seed, difficulty, theme, specialEvents) recipe for the LevelGenerator.
 * Level N uses seed 1000+N, so level 1 = seed 1001, level 2 = seed 1002 …
 */
import type { LevelGenParams } from '@engine/level/LevelGenerator';

export interface CampaignLevel {
  number: number;
  title: string;
  seed: number;
  difficulty: number;
  theme: string;
  specialEvents: string[];
  length?: number;
  boss: boolean;
}

export const CAMPAIGN_SIZE = 100;

/** Theme blocks (inclusive level ranges). */
export const THEME_BLOCKS: Array<{ from: number; to: number; theme: string }> = [
  { from: 1, to: 20, theme: 'FACTORY' },
  { from: 21, to: 30, theme: 'NIGHT' },
  { from: 31, to: 40, theme: 'WINTER' },
  { from: 41, to: 50, theme: 'CANDY' },
  { from: 51, to: 60, theme: 'UNDERWATER' },
  { from: 61, to: 70, theme: 'VOLCANO' },
  { from: 71, to: 80, theme: 'SPACE' },
  { from: 81, to: 90, theme: 'HALLOWEEN' },
  { from: 91, to: 100, theme: 'CHRISTMAS' },
];

const ADJ = ['Rusty', 'Noisy', 'Wobbly', 'Sneaky', 'Steamy', 'Crooked', 'Bouncy', 'Greasy', 'Spinning', 'Clanky', 'Shaky', 'Sticky', 'Grumpy', 'Speedy', 'Haunted', 'Frozen', 'Sugary', 'Soggy', 'Cosmic', 'Molten'];
const NOUN = ['Corridor', 'Conveyor', 'Catwalk', 'Boiler Room', 'Assembly Line', 'Warehouse', 'Crusher Hall', 'Laser Lab', 'Loading Dock', 'Pipe Maze', 'Packing Room', 'Furnace', 'Elevator Shaft', 'Gear Works', 'Control Room', 'Storage Bay', 'Factory Floor', 'Vault', 'Tunnel', 'Workshop'];
const SPECIAL_TITLES: Record<number, string> = {
  1: 'First Shift',
  2: 'Grumbo Wakes Up',
  3: 'Mind The Gap',
  5: 'Double Trouble',
  10: 'The Foreman',
  20: 'Overtime',
  30: 'Lights Out',
  40: 'Snow Day',
  50: 'Sugar Rush',
  60: 'Deep Shift',
  70: 'Hot Hot Hot',
  80: 'Zero Gravity Panic',
  90: 'Pumpkin Panic',
  99: 'Almost Free',
  100: 'The Great Escape',
};

export function themeForLevel(n: number): string {
  for (const b of THEME_BLOCKS) if (n >= b.from && n <= b.to) return b.theme;
  return 'FACTORY';
}

/** Smooth ramp 1 → 5 with a small saw-tooth inside every block of 10 (relief after bosses). */
export function difficultyForLevel(n: number): number {
  const base = 1 + 4 * Math.pow((n - 1) / (CAMPAIGN_SIZE - 1), 0.92);
  const inBlock = ((n - 1) % 10) / 9;
  const saw = (inBlock - 0.5) * 0.35;
  return Math.max(1, Math.min(5, Math.round((base + saw) * 100) / 100));
}

export function campaignLevel(n: number): CampaignLevel {
  const num = Math.max(1, Math.min(CAMPAIGN_SIZE, Math.round(n)));
  const boss = num % 10 === 0;
  const special: string[] = [];
  if (boss) special.push('boss');
  else if (num % 5 === 0) special.push('doubleChase');
  if (num >= 40 && num % 7 === 0) special.push('chaos');
  let length: number | undefined;
  if (num <= 3) length = 7 + num;
  const title =
    SPECIAL_TITLES[num] ?? `The ${ADJ[(num * 7) % ADJ.length]} ${NOUN[(num * 13) % NOUN.length]}`;
  return { number: num, title, seed: 1000 + num, difficulty: difficultyForLevel(num), theme: themeForLevel(num), specialEvents: special, length, boss };
}

export function campaignParams(n: number, enemy = 'grumbo'): LevelGenParams {
  const c = campaignLevel(n);
  return { seed: c.seed, difficulty: c.difficulty, theme: c.theme, enemy, specialEvents: c.specialEvents, length: c.length };
}

export function allCampaignLevels(): CampaignLevel[] {
  return Array.from({ length: CAMPAIGN_SIZE }, (_, i) => campaignLevel(i + 1));
}
