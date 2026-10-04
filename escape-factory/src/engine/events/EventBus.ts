import type { GameEvent, GameEventMap, GameEventType } from './GameEvents';

type Handler<K extends GameEventType> = (e: GameEvent<K>) => void;
type AnyHandler = (e: GameEvent) => void;

/**
 * Synchronous, typed publish/subscribe bus with an optional ring-buffer log.
 * The clock is injected so every event carries deterministic sim time.
 */
export class EventBus {
  private handlers = new Map<GameEventType, Set<Handler<GameEventType>>>();
  private anyHandlers = new Set<AnyHandler>();
  private clock: () => { t: number; tick: number } = () => ({ t: 0, tick: 0 });
  /** Full event history of the current session (cleared on reset). */
  readonly log: GameEvent[] = [];
  logEnabled = true;
  /** Events excluded from the log to keep it compact. */
  logExclude = new Set<GameEventType>(['PLAYER_STEP']);
  private emitting = 0;

  setClock(clock: () => { t: number; tick: number }): void {
    this.clock = clock;
  }

  on<K extends GameEventType>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as unknown as Handler<GameEventType>);
    return () => set!.delete(fn as unknown as Handler<GameEventType>);
  }

  onAny(fn: AnyHandler): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  emit<K extends GameEventType>(type: K, payload: GameEventMap[K]): GameEvent<K> {
    const { t, tick } = this.clock();
    const e: GameEvent<K> = { type, t, tick, payload };
    if (this.logEnabled && !this.logExclude.has(type)) this.log.push(e as unknown as GameEvent);
    if (this.emitting > 32) return e; // recursion guard
    this.emitting++;
    try {
      const set = this.handlers.get(type);
      if (set) for (const h of set) (h as unknown as Handler<K>)(e);
      for (const h of this.anyHandlers) h(e as unknown as GameEvent);
    } finally {
      this.emitting--;
    }
    return e;
  }

  clearLog(): void {
    this.log.length = 0;
  }

  /** Removes every subscriber (used when tearing down a session). */
  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }

  count(type: GameEventType): number {
    let n = 0;
    for (const e of this.log) if (e.type === type) n++;
    return n;
  }
}
