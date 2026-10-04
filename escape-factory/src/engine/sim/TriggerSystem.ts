/**
 * Fires level triggers when the player's spine progress passes them. Other
 * systems query `firedAt(triggerId)` to drive triggered motions, collapses and
 * hazards; trigger actions (chase start, boss…) are dispatched to a handler.
 */
import type { TriggerAction, TriggerPiece } from '../level/types';

export class TriggerSystem {
  private readonly list: TriggerPiece[];
  private readonly fired = new Map<number, number>();
  /** 0..1; chaos-only surprises fire when chaos >= 0.5 */
  chaos = 0;
  onAction: (piece: TriggerPiece, action: TriggerAction, t: number) => void = () => {};

  constructor(triggers: TriggerPiece[]) {
    this.list = [...triggers].sort((a, b) => a.s - b.s);
  }

  update(playerS: number, t: number): void {
    for (const tr of this.list) {
      if (tr.s > playerS) break;
      if (this.fired.has(tr.triggerId)) continue;
      if (tr.action.kind === 'surprise' && tr.action.chaosOnly && this.chaos < 0.5) {
        this.fired.set(tr.triggerId, -1); // consumed silently
        continue;
      }
      this.fired.set(tr.triggerId, t);
      this.onAction(tr, tr.action, t);
    }
  }

  /** Time the trigger fired, or null. Silently consumed triggers return null. */
  firedAt(triggerId: number): number | null {
    const v = this.fired.get(triggerId);
    return v === undefined || v < 0 ? null : v;
  }

  /** Manually fires a trigger id (scripted video events). */
  fire(triggerId: number, t: number): void {
    if (!this.fired.has(triggerId)) this.fired.set(triggerId, t);
  }

  /** Re-arms every trigger beyond spine distance `s` (used on respawn). */
  resetFrom(s: number): void {
    for (const tr of this.list) if (tr.s > s) this.fired.delete(tr.triggerId);
  }

  get all(): readonly TriggerPiece[] {
    return this.list;
  }
}
