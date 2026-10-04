import { describe, expect, it } from 'vitest';
import { BotController } from '../../src/engine/bot/BotController';
import { BOT_PROFILES, botProfile } from '../../src/engine/bot/BotProfile';
import { characters } from '../../src/engine/character/CharacterRegistry';
import { enemies } from '../../src/engine/enemy/EnemyDef';
import { generateLevel, type LevelGenParams } from '../../src/engine/level/LevelGenerator';
import { World } from '../../src/engine/sim/World';
import { emptyInput } from '../../src/engine/input/InputState';
import { campaignParams } from '../../src/game/campaign';
import { registerContent } from '../../src/game/content';
import type { BotProfile } from '../../src/engine/bot/BotProfile';

registerContent();

function play(params: LevelGenParams, profile: BotProfile, seed = 1, maxT = 300) {
  const level = generateLevel(params);
  const world = new World({ level, character: characters.get('pip'), enemy: level.enemy === 'none' ? null : enemies.get(level.enemy) });
  const bot = new BotController(world, profile, seed);
  const inp = emptyInput();
  let near = 0;
  world.events.on('PLAYER_NEAR_DEATH', (e) => {
    if (e.payload.cause !== 'enemy') near++;
  });
  while (world.status === 'running' && world.time < maxT && !bot.stats.givenUp) {
    bot.sample(inp);
    world.step(inp);
  }
  return { world, bot, near, level };
}

describe('Bot', () => {
  it('PERFECT bot completes the first 30 campaign levels', () => {
    let deaths = 0;
    for (let n = 1; n <= 30; n++) {
      const r = play(campaignParams(n), BOT_PROFILES.PERFECT, 1234 + n);
      expect(r.world.status, `level ${n}`).toBe('finished');
      deaths += r.world.deaths;
    }
    expect(deaths).toBeLessThan(15);
  });

  it('is deterministic: same seed → identical run', () => {
    const a = play(campaignParams(12), BOT_PROFILES.AVERAGE, 77);
    const b = play(campaignParams(12), BOT_PROFILES.AVERAGE, 77);
    expect(a.world.time).toBe(b.world.time);
    expect(a.world.deaths).toBe(b.world.deaths);
    expect(a.world.events.log.length).toBe(b.world.events.log.length);
  });

  it('different take seeds give different runs of the same level', () => {
    const a = play(campaignParams(25), BOT_PROFILES.CLUMSY, 1);
    const b = play(campaignParams(25), BOT_PROFILES.CLUMSY, 2);
    expect(a.world.time === b.world.time && a.world.deaths === b.world.deaths).toBe(false);
  });

  it('mistakeChance makes the bot die more often', () => {
    let perfect = 0;
    let clumsy = 0;
    for (let n = 20; n < 35; n++) {
      perfect += play(campaignParams(n), BOT_PROFILES.PERFECT, n).world.deaths;
      clumsy += play(campaignParams(n), BOT_PROFILES.CLUMSY, n).world.deaths;
    }
    expect(clumsy).toBeGreaterThan(perfect + 5);
  });

  it('high riskLevel produces more near-death moments than a cautious bot', () => {
    let risky = 0;
    let safe = 0;
    for (let n = 30; n < 45; n++) {
      risky += play(campaignParams(n), botProfile({ ...BOT_PROFILES.DAREDEVIL, mistakeChance: 0 }), n).near;
      safe += play(campaignParams(n), botProfile({ ...BOT_PROFILES.CAUTIOUS, mistakeChance: 0 }), n).near;
    }
    expect(risky).toBeGreaterThan(safe);
  });

  it('forced mistakes create a deterministic fail at the chosen spot (FAIL takes)', () => {
    const params = campaignParams(15);
    const level = generateLevel(params);
    const jump = level.hints.find((h) => h.kind === 'jump' && h.targetId >= 0 && h.s > 40)!;
    expect(jump).toBeTruthy();
    const s = (jump as { s: number }).s;
    const r = play(params, botProfile({ ...BOT_PROFILES.PERFECT, forced: [{ atS: s, kind: 'noJump' }] }), 3);
    const death = r.world.events.log.find((e) => e.type === 'PLAYER_DEATH');
    expect(death).toBeTruthy();
    expect(r.world.status).toBe('finished'); // recovers after the scripted fail
  });

  it('reaction time slows the bot down at timing obstacles', () => {
    let fast = 0;
    let slow = 0;
    for (const d of [1.5, 2.5, 3.5]) {
      const params = { seed: 777, difficulty: d, enemy: 'none', specialEvents: ['more:CRUSHER', 'more:LASER'] };
      fast += play(params, botProfile({ ...BOT_PROFILES.PERFECT, reactionTime: 0.02 }), 1).world.time;
      slow += play(params, botProfile({ ...BOT_PROFILES.PERFECT, reactionTime: 0.6 }), 1).world.time;
    }
    expect(slow).toBeGreaterThan(fast);
  });

  it('speed factor changes the pace on calm sections', () => {
    const quick = play({ seed: 4242, difficulty: 1, enemy: 'none' }, botProfile({ ...BOT_PROFILES.PERFECT, speed: 1 }), 1);
    const slow = play({ seed: 4242, difficulty: 1, enemy: 'none' }, botProfile({ ...BOT_PROFILES.PERFECT, speed: 0.6 }), 1);
    expect(quick.world.status).toBe('finished');
    expect(slow.world.time).toBeGreaterThan(quick.world.time);
  });

  it('handles every moving-platform variant and both blinking-platform variants', () => {
    for (const special of [['more:MOVING_PLATFORM'], ['more:DISAPPEARING_PLATFORM'], ['more:SPINNER', 'more:LASER'], ['more:DOOR', 'more:WALL'], ['boss']]) {
      for (const d of [1.5, 3, 4.5]) {
        const r = play({ seed: 9000 + Math.round(d * 10), difficulty: d, specialEvents: special }, BOT_PROFILES.PERFECT, 5);
        expect(r.world.status, `${special.join('+')} d${d}`).toBe('finished');
      }
    }
  });
});
