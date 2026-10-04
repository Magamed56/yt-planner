/**
 * Module registry. A module is a self-contained chunk of course (e.g. a jump
 * sequence or a crusher corridor) authored in local coordinates. The
 * LevelGenerator strings modules together; new games register new modules.
 */
import type { Rng } from '../core/rng';
import type { DifficultyParams } from './difficulty';
import type { LevelBuilder } from './LevelBuilder';
import type { Frame, SurpriseKind } from './types';

export const STANDARD_MODULES = [
  'START',
  'STRAIGHT',
  'TURN',
  'JUMP',
  'MOVING_PLATFORM',
  'DISAPPEARING_PLATFORM',
  'SPINNER',
  'CRUSHER',
  'LASER',
  'FALLING_OBJECT',
  'NARROW_BRIDGE',
  'CONVEYOR',
  'WALL',
  'DOOR',
  'TRAP',
  'CHASE',
  'CHECKPOINT',
  'BOSS',
  'FINISH',
] as const;

export type ModuleType = (typeof STANDARD_MODULES)[number] | (string & {});

/** Gameplay role a module can fill in the level grammar. */
export type ModuleRole = 'explore' | 'obstacle' | 'danger' | 'flow' | 'special';

export interface ModuleOptions {
  /** TURN direction */
  turn?: 'left' | 'right';
  /** module is part of an active chase (only flow-safe content) */
  inChase?: boolean;
  /** this CHECKPOINT ends a chase (door slams on the enemy) */
  endsChase?: boolean;
  /** surprise planned in this module */
  surprise?: SurpriseKind;
  /** final escape chase starts in this module */
  finalEscape?: boolean;
  /** variant hint (module specific) */
  variant?: string;
}

export interface ModuleContext {
  b: LevelBuilder;
  rng: Rng;
  diff: DifficultyParams;
  index: number;
  count: number;
  opts: ModuleOptions;
  /** decoration kinds with weights from the active theme */
  decor: Array<{ kind: string; weight: number }>;
  /** special floor surface from the theme (ice, jelly) */
  floorSurface?: { surface: 'ice' | 'jelly'; chance: number };
  /** look of falling objects / zones (for naming only — visuals come from the theme) */
  enemy: string;
}

export interface ModuleResult {
  exit: Frame;
  estTime: number;
  beat?: boolean;
  tags?: string[];
}

export interface ModuleDef {
  type: ModuleType;
  roles: ModuleRole[];
  /** can appear inside a chase segment */
  chaseSafe: boolean;
  minDifficulty: number;
  /** relative selection weight at a difficulty */
  weight(diff: DifficultyParams): number;
  /** rough duration estimate (s) used by the beat planner */
  estimate(diff: DifficultyParams): number;
  /** produces a notable "something happens" moment by itself */
  beat: boolean;
  generate(ctx: ModuleContext): ModuleResult;
}

export class ModuleRegistry {
  private readonly map = new Map<string, ModuleDef>();

  register(def: ModuleDef): void {
    this.map.set(def.type, def);
  }

  get(type: string): ModuleDef {
    const d = this.map.get(type);
    if (!d) throw new Error(`Unknown module type ${type}`);
    return d;
  }

  has(type: string): boolean {
    return this.map.has(type);
  }

  list(): ModuleDef[] {
    return [...this.map.values()];
  }

  byRole(role: ModuleRole, diff: DifficultyParams, chase = false): ModuleDef[] {
    return this.list().filter((m) => m.roles.includes(role) && m.minDifficulty <= diff.level + 1e-6 && (!chase || m.chaseSafe));
  }
}
