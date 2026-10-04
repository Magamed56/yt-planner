/**
 * "ONE GAME → MANY VIDEOS": builds a deterministic series of distinct video
 * configs from the title recipes × campaign levels × characters, and checks
 * each one actually delivers what its title promises (a CAUGHT video must end
 * in a catch, a PERFECT RUN must have zero deaths, a BOSS video must contain
 * the boss fight…).
 */
import { Rng } from '@engine/core/rng';
import type { Resolver } from '@engine/video/Edit';
import { planShortEdit } from '@engine/video/plans';
import { validateVideoConfig, type VideoConfig } from '@engine/video/VideoConfig';
import { simulateTake } from '@engine/video/VideoSession';
import { campaignLevel } from '../campaign';
import { ROSTER } from '../characters/roster';
import { RECIPES, type VideoRecipe } from '../recipes';

/** Which campaign levels suit each recipe. */
export const RECIPE_LEVELS: Record<string, number[]> = {
  CAN_I_ESCAPE: range(1, 9),
  MONSTER_FASTER: range(5, 45),
  ALMOST_DIED: range(8, 60),
  ONE_JUMP: range(8, 50),
  FLOOR_DISAPPEARED: range(12, 70),
  IMPOSSIBLE_ESCAPE: range(60, 99),
  RIGHT_BEHIND_ME: range(4, 50),
  EVERYTHING_WRONG: range(20, 80),
  BOSS_ESCAPE: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  PERFECT_RUN: range(1, 100),
  CAUGHT: range(5, 60),
  PICK_A_DOOR: range(10, 60),
};

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const DURATIONS = [28, 32, 35, 38, 30, 34];

export interface SeriesItem {
  config: VideoConfig;
  recipe: VideoRecipe;
}

export function configFromRecipe(r: VideoRecipe, level: number, character: string, n: number, take = r.take): VideoConfig {
  const L = campaignLevel(level);
  const charName = ROSTER.find((c) => c.id === character)?.name ?? character;
  const raw = {
    id: `video_${String(n).padStart(3, '0')}`,
    title: r.title,
    recipe: r.id,
    level,
    seed: L.seed,
    difficulty: r.difficulty ?? L.difficulty,
    theme: L.theme,
    character,
    enemy: 'grumbo',
    scenario: r.scenario,
    take,
    cameraStyle: r.cameraStyle ?? 'shorts',
    duration: DURATIONS[n % DURATIONS.length],
    format: 'short',
    fps: 30,
    music: 'auto',
    voice: { enabled: true, lines: [{ at: 0.2, text: r.hook.replace(/[!?.…]+$/, '') + '?' }] },
    captions: [{ at: 0, duration: 1.8, text: r.hook, style: 'hook' }],
    events: [],
    highlight: 'auto',
    specialEvents: r.specialEvents ?? [],
    meta: { description: `${r.description} (Level ${level}: ${L.title} · ${charName})`, tags: [...r.tags, 'escape factory', 'shorts'] },
  };
  return validateVideoConfig(raw).config;
}

export interface SeriesCheck {
  ok: boolean;
  reason: string;
  duration: number;
  ending: string;
  deaths: number;
  finished: boolean;
}

/** Does the take deliver what the title promises? */
export function checkPromise(config: VideoConfig, recipe: VideoRecipe, resolve: Resolver): SeriesCheck {
  const take = simulateTake(resolve(config));
  const plan = planShortEdit(config, resolve, { hook: recipe.hook, climax: recipe.climax, outro: recipe.outro, focus: recipe.focus });
  const ending = String(plan.meta.ending);
  const has = (t: string) => take.events.some((e) => e.type === t);
  const base = { duration: plan.duration, ending, deaths: take.deaths, finished: take.finished };
  const fail = (reason: string): SeriesCheck => ({ ok: false, reason, ...base });
  // the promised moment must be ON SCREEN, not just somewhere in the take
  const main = plan.segments.filter((s) => s.kind === 'main');
  const shown = (t: string) => take.events.some((e) => e.type === t && main.some((s) => e.t >= s.from && e.t <= s.to));
  if (plan.duration < 25 || plan.duration > 40) return fail(`duration ${plan.duration.toFixed(1)} s`);
  switch (recipe.id) {
    case 'PERFECT_RUN':
      if (take.deaths > 0 || !take.finished) return fail('not a perfect run');
      break;
    case 'CAUGHT':
      if (!shown('ENEMY_GRAB')) return fail('catch not shown');
      if (ending !== 'fail') return fail('does not end on the catch');
      break;
    case 'BOSS_ESCAPE':
      if (!shown('BOSS_START') && !shown('BOSS_ATTACK')) return fail('no boss on screen');
      break;
    case 'ALMOST_DIED':
    case 'ONE_JUMP':
      if (!has('PLAYER_NEAR_DEATH') && !take.events.some((e) => e.type === 'ENEMY_NEAR' && (e.payload as { gap: number }).gap < 2.5)) return fail('no near-death moment');
      break;
    case 'RIGHT_BEHIND_ME':
    case 'MONSTER_FASTER':
      if (!has('ENEMY_NEAR')) return fail('monster never close');
      break;
    case 'EVERYTHING_WRONG':
      if (!shown('PLAYER_DEATH')) return fail('nothing went wrong on screen');
      break;
    case 'FLOOR_DISAPPEARED':
      if (!shown('FLOOR_COLLAPSE') && !shown('PLATFORM_FALL') && !shown('TRAP_TRIGGER')) return fail('floor never disappeared on screen');
      break;
    case 'PICK_A_DOOR':
      if (!shown('DOOR_CLOSE') && !shown('ENEMY_BLOCK')) return fail('no door moment on screen');
      break;
  }
  return { ok: true, reason: '', ...base };
}

/**
 * Deterministic series: round-robin over recipes, each with a fresh level and
 * character; rejected candidates are re-rolled (other level / take seed).
 */
export function planSeries(count: number, resolve: Resolver, opts: { startIndex?: number; seed?: number; verify?: boolean; onItem?: (i: SeriesItem, c: SeriesCheck | null) => void } = {}): Array<SeriesItem & { check: SeriesCheck | null }> {
  const rng = new Rng(opts.seed ?? 2024);
  const start = opts.startIndex ?? 2;
  const used = new Set<string>();
  const out: Array<SeriesItem & { check: SeriesCheck | null }> = [];
  const pools = new Map(RECIPES.map((r) => [r.id, rng.fork(r.id).shuffle([...(RECIPE_LEVELS[r.id] ?? range(1, 100))])]));
  let ci = 0;
  for (let i = 0; out.length < count && i < count * 6; i++) {
    const recipe = RECIPES[i % RECIPES.length];
    const pool = pools.get(recipe.id)!;
    const n = start + out.length;
    let accepted: (SeriesItem & { check: SeriesCheck | null }) | null = null;
    for (let attempt = 0; attempt < 6 && pool.length && !accepted; attempt++) {
      const level = pool.shift()!;
      const character = ROSTER[ci % ROSTER.length].id;
      const config = configFromRecipe(recipe, level, character, n);
      const key = `${config.seed}:${config.scenario}:${config.take}:${character}`;
      if (used.has(key)) continue;
      const check = opts.verify === false ? null : checkPromise(config, recipe, resolve);
      if (check && !check.ok) continue;
      used.add(key);
      ci++;
      accepted = { config, recipe, check };
    }
    if (accepted) {
      out.push(accepted);
      opts.onItem?.(accepted, accepted.check);
    }
  }
  return out;
}
