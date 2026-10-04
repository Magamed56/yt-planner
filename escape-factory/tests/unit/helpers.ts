import type { CharacterDef } from '../../src/engine/character/CharacterDef';
import { DEFAULT_ANIM } from '../../src/engine/character/CharacterDef';
import { LevelBuilder } from '../../src/engine/level/LevelBuilder';
import { finalizeLevel } from '../../src/engine/level/finalize';
import type { LevelData, ModuleInstance } from '../../src/engine/level/types';
import { emptyInput, type InputState } from '../../src/engine/input/InputState';
import type { World } from '../../src/engine/sim/World';

export const testCharacter: CharacterDef = {
  id: 'test',
  name: 'Test',
  description: '',
  model: { parts: [] },
  anim: DEFAULT_ANIM,
  voice: { pitch: 1, type: 'squeak' },
  unlockCost: 0,
  color: '#fff',
};

/** Builds a straight test level; `build` adds pieces in local coords of a single module. */
export function straightLevel(length: number, build: (b: LevelBuilder) => void, halfWidth = 3): LevelData {
  const b = new LevelBuilder();
  b.begin({ x: 0, y: 0, z: 0, dir: 0 }, 0);
  b.spinePoint(0, 0, 0, halfWidth);
  build(b);
  b.spinePoint(0, 0, length, halfWidth);
  const mod: ModuleInstance = {
    index: 0,
    type: 'TEST',
    s0: 0,
    s1: length,
    entry: { x: 0, y: 0, z: 0, dir: 0 },
    exit: { x: 0, y: 0, z: length, dir: 0 },
    footprint: { minX: -halfWidth, minY: -1, minZ: 0, maxX: halfWidth, maxY: 5, maxZ: length },
    estTime: length / 8,
    estStart: 0,
    beat: false,
    tags: [],
  };
  return finalizeLevel(b, {
    seed: 1,
    difficulty: 1,
    theme: 'NORMAL',
    enemy: 'none',
    specialEvents: [],
    modules: [mod],
    spawn: { x: 0, y: 0, z: 1, dir: 0 },
    generationMs: 0,
  });
}

export function run(world: World, seconds: number, input: Partial<InputState> | ((w: World) => Partial<InputState>)) {
  const inp = emptyInput();
  const n = Math.round(seconds / world.dt);
  for (let i = 0; i < n; i++) {
    const v = typeof input === 'function' ? input(world) : input;
    inp.moveX = v.moveX ?? 0;
    inp.moveZ = v.moveZ ?? 0;
    inp.jump = v.jump ?? false;
    inp.jumpPressed = v.jumpPressed ?? false;
    world.step(inp);
  }
}
