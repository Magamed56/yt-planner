/**
 * EscapeKit standard module library — 19 modules shared by every "Escape"
 * game. Games re-skin them via themes and may register extra modules.
 */
import { ModuleRegistry } from '../ModuleRegistry';
import { CHECKPOINT, FINISH, START, STRAIGHT, TURN } from './basic';
import { CONVEYOR, DISAPPEARING_PLATFORM, JUMP, MOVING_PLATFORM, NARROW_BRIDGE } from './platforming';
import { CRUSHER, DOOR, FALLING_OBJECT, LASER, SPINNER, TRAP, WALL } from './danger';
import { BOSS, CHASE } from './setpieces';

export const STANDARD_MODULE_DEFS = [
  START,
  STRAIGHT,
  TURN,
  JUMP,
  MOVING_PLATFORM,
  DISAPPEARING_PLATFORM,
  SPINNER,
  CRUSHER,
  LASER,
  FALLING_OBJECT,
  NARROW_BRIDGE,
  CONVEYOR,
  WALL,
  DOOR,
  TRAP,
  CHASE,
  CHECKPOINT,
  BOSS,
  FINISH,
];

export function createStandardModules(): ModuleRegistry {
  const reg = new ModuleRegistry();
  for (const m of STANDARD_MODULE_DEFS) reg.register(m);
  return reg;
}
