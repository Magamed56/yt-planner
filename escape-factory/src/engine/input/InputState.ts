/**
 * Input abstraction consumed by the simulation. Humans (keyboard/touch/gamepad)
 * and the Bot both produce this structure, so gameplay can't tell them apart.
 * Movement is a WORLD-space XZ direction (length <= 1).
 */
export interface InputState {
  moveX: number;
  moveZ: number;
  /** jump button is held */
  jump: boolean;
  /** jump was pressed since the previous sim step (edge) */
  jumpPressed: boolean;
}

export const emptyInput = (): InputState => ({ moveX: 0, moveZ: 0, jump: false, jumpPressed: false });

export interface InputSource {
  /** Fills `out` for the upcoming fixed step. */
  sample(out: InputState, dt: number): void;
  dispose?(): void;
}
