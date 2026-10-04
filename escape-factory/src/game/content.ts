/**
 * ESCAPE FACTORY content pack: registers characters, enemies and themes into
 * the engine registries. Another game (ESCAPE SCHOOL…) ships its own pack.
 */
import { characters } from '@engine/character/CharacterRegistry';
import { enemies } from '@engine/enemy/EnemyDef';
import { themes } from '@engine/theme/ThemeDef';
import { ROSTER } from './characters/roster';
import { GRUMBO } from './enemies/grumbo';
import { ALL_THEMES } from './themes';
import { registerThemeDecor } from './themes/decor';

let registered = false;

export function registerContent(): void {
  if (registered) return;
  registered = true;
  ROSTER.forEach((c, i) => characters.register(c, i === 0));
  enemies.register(GRUMBO, true);
  ALL_THEMES.forEach((t, i) => themes.register(t, i === 0));
  registerThemeDecor();
}

export const GAME_TITLE = 'ESCAPE FACTORY';
