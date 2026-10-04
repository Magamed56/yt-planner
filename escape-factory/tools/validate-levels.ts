/**
 * Plays campaign / random levels headlessly with a bot and reports completion.
 *   tsx tools/validate-levels.ts [from] [to] [profile]
 * Exit code 1 if any level is not completed.
 */
import { BotController } from '../src/engine/bot/BotController';
import { botProfile } from '../src/engine/bot/BotProfile';
import { characters } from '../src/engine/character/CharacterRegistry';
import { enemies } from '../src/engine/enemy/EnemyDef';
import { generateLevel } from '../src/engine/level/LevelGenerator';
import { themes } from '../src/engine/theme/ThemeDef';
import { World } from '../src/engine/sim/World';
import { emptyInput } from '../src/engine/input/InputState';
import { campaignLevel, campaignParams } from '../src/game/campaign';
import { registerContent } from '../src/game/content';

registerContent();
const [fromArg = '1', toArg = '100', prof = 'PERFECT', char = 'pip'] = process.argv.slice(2);
const from = Number(fromArg);
const to = Number(toArg);
const profile = botProfile(prof);
let failed = 0;
const t0 = Date.now();
const rows: string[] = [];
for (let n = from; n <= to; n++) {
  const level = generateLevel(campaignParams(n));
  const theme = themes.get(level.theme);
  const world = new World({ level, character: characters.get(char), enemy: enemies.get(level.enemy), physicsMods: theme.physics });
  const bot = new BotController(world, profile, 1234 + n);
  const inp = emptyInput();
  const maxT = Math.max(240, level.stats.estDuration * 6);
  while (world.status === 'running' && world.time < maxT && !bot.stats.givenUp) {
    bot.sample(inp);
    world.step(inp);
  }
  const ok = world.status === 'finished';
  if (!ok) failed++;
  const c = campaignLevel(n);
  const cause = world.lastDeathCause ?? '-';
  rows.push(
    `${String(n).padStart(3)} ${ok ? 'OK  ' : 'FAIL'} ${c.theme.padEnd(10)} d${level.difficulty.toFixed(2)} mods ${String(level.modules.length).padStart(2)} t ${world.time.toFixed(1).padStart(6)}s deaths ${String(world.deaths).padStart(2)} (${cause}) prog ${(world.summary().progress * 100).toFixed(0)}% @${world.level.modules[world.moduleIndex].type} jumps ${bot.stats.jumps} waits ${bot.stats.waits} stuck ${bot.stats.stuck}`,
  );
}
console.log(rows.join('\n'));
console.log(`\n${to - from + 1 - failed}/${to - from + 1} completed with ${profile.name} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
