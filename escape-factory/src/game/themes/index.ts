import type { ThemeDef } from '@engine/theme/ThemeDef';
import { FACTORY } from './factory';
import { CANDY, CHRISTMAS, HALLOWEEN, NIGHT, NORMAL, SPACE, UNDERWATER, VOLCANO, WINTER } from './seasons';

/** All themes; FACTORY first (default). */
export const ALL_THEMES: ThemeDef[] = [FACTORY, NORMAL, NIGHT, WINTER, CANDY, UNDERWATER, VOLCANO, SPACE, HALLOWEEN, CHRISTMAS];

export const THEME_IDS = ALL_THEMES.map((t) => t.id);
