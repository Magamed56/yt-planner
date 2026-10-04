import type { InputSource, InputState } from './InputState';

/** Input that forwards to a target set later (e.g. a bot that needs the world first). */
export class ProxyInput implements InputSource {
  target: InputSource | null = null;
  sample(out: InputState, dt: number): void {
    if (this.target) this.target.sample(out, dt);
    else {
      out.moveX = out.moveZ = 0;
      out.jump = out.jumpPressed = false;
    }
  }
}
