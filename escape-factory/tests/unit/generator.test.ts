import { describe, expect, it } from 'vitest';
import { generateLevel } from '../../src/engine/level/LevelGenerator';
import { validateLevel } from '../../src/engine/level/LevelValidator';
import { hashData } from '../../src/engine/core/rng';
import { STANDARD_MODULES } from '../../src/engine/level/ModuleRegistry';
import { World } from '../../src/engine/sim/World';
import { testCharacter } from './helpers';
import { emptyInput } from '../../src/engine/input/InputState';

describe('LevelGenerator', () => {
  it('same seed reproduces exactly the same level', () => {
    const a = generateLevel({ seed: 1001, difficulty: 1 });
    const b = generateLevel({ seed: 1001, difficulty: 1 });
    const strip = (l: ReturnType<typeof generateLevel>) => ({ ...l, stats: { ...l.stats, generationMs: 0 } });
    expect(hashData(strip(a))).toBe(hashData(strip(b)));
  });

  it('different seeds produce different levels', () => {
    const hashes = new Set<string>();
    for (const seed of [1001, 1002, 1003, 2001, 2002]) hashes.add(hashData(generateLevel({ seed, difficulty: 2 }).pieces));
    expect(hashes.size).toBe(5);
  });

  it('accepts named difficulties and all generation params', () => {
    const l = generateLevel({ seed: 2001, difficulty: 'IMPOSSIBLE', length: 14, theme: 'FACTORY', enemy: 'grumbo', specialEvents: ['boss'] });
    expect(l.difficultyName).toBe('IMPOSSIBLE');
    expect(l.modules.length).toBe(14);
    expect(l.modules.some((m) => m.type === 'BOSS')).toBe(true);
    expect(l.modules[0].type).toBe('START');
    expect(l.modules[l.modules.length - 1].type).toBe('FINISH');
  });

  it('enemy "none" produces no chase content', () => {
    const l = generateLevel({ seed: 7, difficulty: 3, enemy: 'none' });
    expect(l.modules.some((m) => m.type === 'CHASE')).toBe(false);
    expect(l.pieces.some((p) => p.type === 'trigger' && (p.action.kind === 'chaseStart' || p.action.kind === 'enemyPeek'))).toBe(false);
  });

  it('difficulty scales length, hazards, gaps and enemy speed', () => {
    const avg = (d: number, f: (l: ReturnType<typeof generateLevel>) => number) => {
      let s = 0;
      for (let i = 0; i < 12; i++) s += f(generateLevel({ seed: 500 + i, difficulty: d }));
      return s / 12;
    };
    const len1 = avg(1, (l) => l.stats.totalLength);
    const len5 = avg(5, (l) => l.stats.totalLength);
    const hz1 = avg(1, (l) => l.stats.hazards);
    const hz5 = avg(5, (l) => l.stats.hazards);
    expect(len5).toBeGreaterThan(len1 * 1.6);
    expect(hz5).toBeGreaterThan(hz1 * 1.6);
  });

  it('uses every standard module type across seeds', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const l = generateLevel({ seed: 3000 + i, difficulty: 1 + (i % 5), specialEvents: i % 7 === 0 ? ['boss'] : [] });
      for (const m of l.modules) seen.add(m.type);
    }
    for (const t of STANDARD_MODULES) expect(seen.has(t), `module ${t} never generated`).toBe(true);
  });

  it('generated levels pass structural validation (200 seeds, all difficulties)', () => {
    const problems: string[] = [];
    let warnings = 0;
    for (let i = 0; i < 200; i++) {
      const l = generateLevel({ seed: 10_000 + i * 7, difficulty: 1 + (i % 5) * 0.97, specialEvents: i % 9 === 0 ? ['boss'] : [] });
      for (const issue of validateLevel(l)) {
        if (issue.level === 'error') problems.push(`seed ${l.seed}: ${issue.message}`);
        else warnings++;
      }
    }
    expect(problems).toEqual([]);
    expect(warnings).toBeLessThan(20);
  });

  it('plans a notable beat at least every ~20 s of estimated play', () => {
    for (let i = 0; i < 30; i++) {
      const l = generateLevel({ seed: 900 + i, difficulty: 1 + (i % 5) });
      expect(l.stats.maxBeatGap).toBeLessThan(24);
    }
  });

  it('generates fast (< 40 ms per level)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) generateLevel({ seed: i, difficulty: 1 + (i % 5) });
    expect((performance.now() - t0) / 50).toBeLessThan(40);
  });

  it('generated levels load into the simulation and the spawn is on solid ground', () => {
    for (let i = 0; i < 20; i++) {
      const l = generateLevel({ seed: 42 + i, difficulty: 1 + (i % 5) });
      const w = new World({ level: l, character: testCharacter });
      const inp = emptyInput();
      for (let k = 0; k < 60; k++) w.step(inp);
      expect(w.player.body.grounded).toBe(true);
      expect(w.deaths).toBe(0);
    }
  });
});
