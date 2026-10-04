/**
 * Generic object pool. Prevents GC churn for short-lived objects (particles,
 * debris, sound voices). Objects are reset by the caller-provided `reset`.
 */
export class Pool<T> {
  private free: T[] = [];
  private created = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void = () => {},
    prewarm = 0,
    private readonly max = Infinity,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(this.make());
  }

  private make(): T {
    this.created++;
    return this.factory();
  }

  /** Returns null when the pool is exhausted and `max` is reached. */
  acquire(): T | null {
    const item = this.free.pop();
    if (item !== undefined) return item;
    if (this.created >= this.max) return null;
    return this.make();
  }

  release(item: T): void {
    this.reset(item);
    this.free.push(item);
  }

  get totalCreated(): number {
    return this.created;
  }

  get available(): number {
    return this.free.length;
  }
}
