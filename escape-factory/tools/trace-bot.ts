/**
 * Debug: traces a bot run on one campaign level around a module type.
 *   tsx tools/trace-bot.ts <level> [profile] [seconds]
 */
import { BotController } from '../src/engine/bot/BotController';
import { botProfile } from '../src/engine/bot/BotProfile';
import { characters } from '../src/engine/character/CharacterRegistry';
import { enemies } from '../src/engine/enemy/EnemyDef';
import { generateLevel } from '../src/engine/level/LevelGenerator';
import { World } from '../src/engine/sim/World';
import { emptyInput } from '../src/engine/input/InputState';
import { campaignParams } from '../src/game/campaign';
import { registerContent } from '../src/game/content';

registerContent();
const [n = '2', prof = 'PERFECT', secs = '30'] = process.argv.slice(2);
const level = generateLevel(campaignParams(Number(n)));
console.log(level.modules.map((m) => `${m.index}:${m.type}[${m.s0.toFixed(1)}-${m.s1.toFixed(1)}] ${m.tags.join(',')}`).join('\n'));
const near = (s: number) => level.hints.filter((h) => ('s' in h ? Math.abs(h.s - s) < 3 : 's0' in h && s > h.s0 - 3 && s < h.s1 + 1));
const world = new World({ level, character: characters.get('pip'), enemy: enemies.get(level.enemy) });
const bot = new BotController(world, botProfile(prof), 1234 + Number(n));
const inp = emptyInput();
let deaths = 0;
world.events.onAny((e) => {
  if (['PLAYER_JUMP', 'PLAYER_LAND', 'PLAYER_DEATH', 'PLAYER_RESPAWN', 'TRAP_TRIGGER', 'PLATFORM_FALL', 'DOOR_CLOSE', 'ENEMY_GRAB'].includes(e.type))
    console.log(`  ${e.t.toFixed(2)} ${e.type} s=${world.playerS.toFixed(2)} lat=${world.playerLateral.toFixed(2)} y=${world.player.body.y.toFixed(2)} ${JSON.stringify(e.payload).slice(0, 80)}`);
  if (e.type === 'PLAYER_DEATH') deaths++;
});
while (world.time < Number(secs) && world.status === 'running' && deaths < 3) {
  bot.sample(inp);
  world.step(inp);
  if (world.tick % 15 === 0) {
    const b = world.player.body;
    console.log(`t=${world.time.toFixed(2)} s=${world.playerS.toFixed(2)} lat=${world.playerLateral.toFixed(2)} y=${b.y.toFixed(2)} v=${Math.hypot(b.vx, b.vz).toFixed(1)} g=${b.grounded ? 1 : 0} in=(${inp.moveX.toFixed(2)},${inp.moveZ.toFixed(2)}) mod=${level.modules[world.moduleIndex].type} hints=${near(world.playerS).map((h) => h.kind + ('s' in h ? '@' + h.s.toFixed(1) : '@' + (h as { s0: number }).s0.toFixed(1))).join(',')}`);
  }
}
