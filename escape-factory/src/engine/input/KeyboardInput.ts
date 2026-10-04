/**
 * Human input: keyboard (WASD / arrows / space), gamepad and touch, mapped to a
 * world-space direction relative to the camera yaw supplied by the game.
 */
import type { InputSource, InputState } from './InputState';

export class KeyboardInput implements InputSource {
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private touchVec = { x: 0, y: 0 };
  private touchJump = false;
  /** camera yaw provider (radians, 0 = looking along +Z) */
  cameraYaw: () => number = () => 0;
  enabled = true;

  private readonly down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyW' && e.shiftKey) this.jumpQueued = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };
  private readonly up = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly blur = () => this.keys.clear();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.down);
    target.addEventListener('keyup', this.up);
    target.addEventListener('blur', this.blur);
  }

  /** Virtual joystick / button feed from the touch UI. */
  setTouch(x: number, y: number, jump: boolean): void {
    if (jump && !this.touchJump) this.jumpQueued = true;
    this.touchVec.x = x;
    this.touchVec.y = y;
    this.touchJump = jump;
  }

  sample(out: InputState): void {
    let f = 0;
    let r = 0;
    let jumpHeld = false;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
      jumpHeld = k.has('Space') || this.touchJump;
      f += -this.touchVec.y;
      r += this.touchVec.x;
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        const ax = gp.axes[0] ?? 0;
        const ay = gp.axes[1] ?? 0;
        if (Math.abs(ax) > 0.2) r += ax;
        if (Math.abs(ay) > 0.2) f -= ay;
        if (gp.buttons[0]?.pressed) {
          if (!jumpHeld && !this.padJump) this.jumpQueued = true;
          jumpHeld = true;
        }
        this.padJump = !!gp.buttons[0]?.pressed;
      }
    }
    // camera-relative → world: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw)
    const yaw = this.cameraYaw();
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    let mx = fx * f + rx * r;
    let mz = fz * f + rz * r;
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    out.moveX = mx;
    out.moveZ = mz;
    out.jump = jumpHeld;
    out.jumpPressed = this.jumpQueued && this.enabled;
    this.jumpQueued = false;
  }

  private padJump = false;

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
  }
}
