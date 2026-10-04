/**
 * Fixed-timestep accumulator. Simulation always advances in exact `step`
 * increments which keeps physics, bots and replays deterministic regardless of
 * the display refresh rate. Rendering interpolates using `alpha`.
 */
export class FixedLoop {
  private acc = 0;
  alpha = 0;

  constructor(
    readonly step = 1 / 60,
    private readonly maxSubSteps = 8,
  ) {}

  /**
   * Advances by real `frameDt` scaled by `timeScale`, calling `tick` for each
   * fixed step. Returns number of steps taken.
   */
  advance(frameDt: number, tick: (dt: number) => void, timeScale = 1): number {
    this.acc += Math.min(frameDt, 0.25) * timeScale;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSubSteps) {
      tick(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSubSteps) this.acc = Math.min(this.acc, this.step);
    this.alpha = this.acc / this.step;
    return steps;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
