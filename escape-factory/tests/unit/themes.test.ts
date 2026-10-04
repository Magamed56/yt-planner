import { describe, expect, it } from 'vitest';
import { decorRegistry } from '../../src/engine/render/decor';
import { generateLevel } from '../../src/engine/level/LevelGenerator';
import { validateLevel } from '../../src/engine/level/LevelValidator';
import { themes } from '../../src/engine/theme/ThemeDef';
import { registerContent } from '../../src/game/content';
import { GRUMBO } from '../../src/game/enemies/grumbo';
import { ALL_THEMES } from '../../src/game/themes';

registerContent();
const REQUIRED = ['NORMAL', 'HALLOWEEN', 'CHRISTMAS', 'WINTER', 'CANDY', 'NIGHT', 'UNDERWATER', 'SPACE', 'FACTORY', 'VOLCANO'];

describe('Themes', () => {
  it('all ten seasons/themes are registered with unique ids', () => {
    for (const id of REQUIRED) expect(themes.has(id), id).toBe(true);
    expect(new Set(ALL_THEMES.map((t) => t.id)).size).toBe(ALL_THEMES.length);
  });

  it('every decoration a theme asks for has a builder', () => {
    for (const t of ALL_THEMES) for (const d of t.decorations) expect(decorRegistry.has(d.kind), `${t.id}:${d.kind}`).toBe(true);
  });

  it('theme physics keep the jump range fair (≤ +12 % of the reference)', () => {
    for (const t of ALL_THEMES) {
      const range = (t.physics?.speedMul ?? 1) / Math.sqrt(t.physics?.gravityScale ?? 1);
      expect(range, t.id).toBeLessThanOrEqual(1.125);
      expect(range, t.id).toBeGreaterThan(0.8);
    }
  });

  it('Grumbo has a costume for every seasonal theme', () => {
    for (const t of ALL_THEMES) if (t.enemyVariant !== 'default') expect(GRUMBO.themeParts?.[t.enemyVariant], t.id).toBeTruthy();
  });

  it('the same seed in another theme is a valid level with themed decor and special surfaces', () => {
    for (const t of ALL_THEMES) {
      const level = generateLevel({ seed: 4242, difficulty: 3, theme: t.id });
      expect(validateLevel(level).filter((i) => i.level === 'error'), t.id).toEqual([]);
      expect(level.theme).toBe(t.id);
      const kinds = new Set(level.pieces.filter((p) => p.type === 'decor').map((p) => (p as { kind: string }).kind));
      expect(t.decorations.some((d) => kinds.has(d.kind)), t.id).toBe(true);
    }
    const winter = generateLevel({ seed: 4242, difficulty: 3, theme: 'WINTER', length: 22 });
    expect(winter.pieces.some((p) => p.type === 'solid' && p.surface === 'ice')).toBe(true);
  });

  it('theme generation is deterministic', () => {
    const a = generateLevel({ seed: 777, difficulty: 2.5, theme: 'CANDY' });
    const b = generateLevel({ seed: 777, difficulty: 2.5, theme: 'CANDY' });
    expect(JSON.stringify(a.pieces)).toBe(JSON.stringify(b.pieces));
  });
});
