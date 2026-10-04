/** Hand-built test course used during early phases and in e2e smoke tests. */
import { LevelBuilder } from '@engine/level/LevelBuilder';
import { finalizeLevel } from '@engine/level/finalize';
import type { LevelData, ModuleInstance } from '@engine/level/types';

export function sandboxLevel(): LevelData {
  const b = new LevelBuilder();
  b.begin({ x: 0, y: 0, z: 0, dir: 0 }, 0);
  const hw = 3;
  b.spinePoint(0, 0, 0, hw);
  b.floor(-3, 3, -2, 16);
  b.spinePoint(0, 0, 16, hw);
  b.spinePoint(0, 0, 19, hw, true);
  b.floor(-2.5, 2.5, 19, 26);
  b.spinePoint(0, 0, 26, hw);
  b.spinePoint(0, 0, 29, hw, true);
  b.floor(-1.5, 1.5, 29, 32, 0, { motion: { kind: 'sine', lx: 2.2, ly: 0, lz: 0, period: 3, phase: 0 } });
  b.spinePoint(0, 0, 32, hw, true);
  b.spinePoint(0, 0, 35, hw, true);
  b.floor(-3, 3, 35, 48);
  b.spinePoint(0, 0, 35, hw);
  b.floor(-3, 3, 48, 60, 0, { style: 'conveyor', conveyor: { lx: 0, lz: -3 } });
  b.spinePoint(0, 0, 60, hw);
  for (let i = 0; i < 4; i++)
    b.floor(-1.2, 1.2, 62 + i * 3.5, 64.5 + i * 3.5, 0, { style: 'trap', vanish: { kind: 'step', delay: 0.5, respawn: 3 } });
  b.spinePoint(0, 0, 76, hw, true);
  b.floor(-3, 3, 76, 100);
  b.solid(-3, -2.6, 0, 3, 80, 100, { style: 'wall' });
  b.solid(2.6, 3, 0, 3, 80, 100, { style: 'wall' });
  b.spinePoint(0, 0, 100, hw);
  const mod: ModuleInstance = {
    index: 0,
    type: 'SANDBOX',
    s0: 0,
    s1: 100,
    entry: { x: 0, y: 0, z: 0, dir: 0 },
    exit: { x: 0, y: 0, z: 100, dir: 0 },
    footprint: { minX: -3, minY: -1, minZ: 0, maxX: 3, maxY: 5, maxZ: 100 },
    estTime: 15,
    estStart: 0,
    beat: false,
    tags: [],
  };
  return finalizeLevel(b, {
    seed: 0,
    difficulty: 1,
    theme: 'FACTORY',
    enemy: 'grumbo',
    specialEvents: [],
    modules: [mod],
    spawn: { x: 0, y: 0, z: 1, dir: 0 },
    generationMs: 0,
  });
}
