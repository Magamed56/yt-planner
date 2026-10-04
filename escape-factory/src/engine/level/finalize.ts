import { difficultyName } from './difficulty';
import type { LevelBuilder } from './LevelBuilder';
import type { Dir, LevelData, ModuleInstance } from './types';

export const LEVEL_FORMAT_VERSION = 1;

export interface FinalizeMeta {
  seed: number;
  difficulty: number;
  theme: string;
  enemy: string;
  specialEvents: string[];
  modules: ModuleInstance[];
  spawn: { x: number; y: number; z: number; dir: Dir };
  generationMs: number;
}

/** Packs builder output into immutable LevelData with computed statistics. */
export function finalizeLevel(b: LevelBuilder, m: FinalizeMeta): LevelData {
  let solids = 0;
  let hazards = 0;
  let triggers = 0;
  let coins = 0;
  for (const p of b.pieces) {
    if (p.type === 'solid') solids++;
    else if (p.type === 'hazard') hazards++;
    else if (p.type === 'trigger') triggers++;
    else if (p.type === 'coin') coins++;
  }
  const est = m.modules.reduce((a, x) => a + x.estTime, 0);
  // beat spacing (estimated seconds between notable moments)
  const beatTimes = m.modules.filter((x) => x.beat).map((x) => x.estStart + x.estTime * 0.4);
  let maxGap = 0;
  let prev = 0;
  for (const t of [...beatTimes, est]) {
    maxGap = Math.max(maxGap, t - prev);
    prev = t;
  }
  return {
    version: LEVEL_FORMAT_VERSION,
    seed: m.seed,
    difficulty: m.difficulty,
    difficultyName: difficultyName(m.difficulty),
    theme: m.theme,
    enemy: m.enemy,
    specialEvents: m.specialEvents,
    modules: m.modules,
    pieces: b.pieces,
    spine: b.spine,
    hints: b.hints,
    spawn: m.spawn,
    checkpoints: b.checkpoints,
    finish: b.finish,
    minY: b.minY,
    stats: {
      pieces: b.pieces.length,
      solids,
      hazards,
      triggers,
      coins,
      checkpoints: b.checkpoints.length,
      totalLength: b.spine.length ? b.spine[b.spine.length - 1].s : 0,
      estDuration: est,
      beats: beatTimes.length,
      maxBeatGap: maxGap,
      generationMs: m.generationMs,
    },
  };
}
