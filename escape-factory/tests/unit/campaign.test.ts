import { describe, expect, it } from 'vitest';
import { BotController } from '../../src/engine/bot/BotController';
import { botProfile } from '../../src/engine/bot/BotProfile';
import { characters } from '../../src/engine/character/CharacterRegistry';
import { enemies } from '../../src/engine/enemy/EnemyDef';
import { emptyInput } from '../../src/engine/input/InputState';
import { hashData } from '../../src/engine/core/rng';
import { generateLevel } from '../../src/engine/level/LevelGenerator';
import { validateLevel } from '../../src/engine/level/LevelValidator';
import { World } from '../../src/engine/sim/World';
import { themes } from '../../src/engine/theme/ThemeDef';
import { allCampaignLevels, campaignParams, CAMPAIGN_SIZE } from '../../src/game/campaign';
import { registerContent } from '../../src/game/content';

registerContent();

function play(n: number, profile = 'SKILLED', char = 'pip') {
  const level = generateLevel(campaignParams(n));
  const world = new World({ level, character: characters.get(char), enemy: enemies.get(level.enemy), physicsMods: themes.get(level.theme).physics });
  const bot = new BotController(world, botProfile(profile), 1234 + n);
  const inp = emptyInput();
  const maxT = Math.max(240, level.stats.estDuration * 6);
  while (world.status === 'running' && world.time < maxT && !bot.stats.givenUp) {
    bot.sample(inp);
    world.step(inp);
  }
  return { finished: world.status === 'finished', deaths: world.deaths, time: world.time, level };
}

describe('Campaign (100 levels)', () => {
  it('has 100 distinct, valid, reproducible levels across all themes', () => {
    const levels = allCampaignLevels();
    expect(levels.length).toBe(CAMPAIGN_SIZE);
    expect(CAMPAIGN_SIZE).toBeGreaterThanOrEqual(100);
    const seeds = new Set<number>();
    const themeSet = new Set<string>();
    for (const c of levels) {
      const a = generateLevel(campaignParams(c.number));
      expect(validateLevel(a).filter((i) => i.level === 'error'), `level ${c.number}`).toEqual([]);
      seeds.add(a.seed);
      themeSet.add(a.theme);
      if (c.number % 9 === 0) {
        const b = generateLevel(campaignParams(c.number));
        expect(hashData([b.pieces, b.hints, b.spine]), `level ${c.number} reproducible`).toBe(hashData([a.pieces, a.hints, a.spine]));
      }
    }
    expect(seeds.size).toBe(CAMPAIGN_SIZE);
    expect(themeSet.size).toBeGreaterThanOrEqual(9);
  });

  it('the SKILLED bot completes every campaign level', () => {
    const failed: number[] = [];
    for (let n = 1; n <= CAMPAIGN_SIZE; n++) if (!play(n).finished) failed.push(n);
    expect(failed).toEqual([]);
  }, 240000);

  it('difficulty ramps up: late levels are longer and harder', () => {
    const early = [1, 2, 3, 4, 5].map((n) => generateLevel(campaignParams(n)));
    const late = [91, 92, 93, 94, 95].map((n) => generateLevel(campaignParams(n)));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(late.map((l) => l.difficulty))).toBeGreaterThan(avg(early.map((l) => l.difficulty)) + 2.5);
    expect(avg(late.map((l) => l.stats.estDuration))).toBeGreaterThan(avg(early.map((l) => l.stats.estDuration)));
  });
});
