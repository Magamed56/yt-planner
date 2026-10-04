/**
 * Player entity: character-agnostic run/jump controller on top of the
 * kinematic body. Emits gameplay events; never reads devices directly.
 */
import { approach, dampAngle } from '../core/math';
import type { EventBus } from '../events/EventBus';
import type { CharacterStats } from '../character/CharacterDef';
import type { InputState } from '../input/InputState';
import { KinematicBody } from '../physics/KinematicBody';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export type PlayerState = 'run' | 'air' | 'stunned' | 'dead' | 'caught' | 'finished';

export class Player {
  readonly body: KinematicBody;
  state: PlayerState = 'run';
  stateTime = 0;
  yaw = 0;
  /** horizontal speed (m/s) */
  speed = 0;
  airTime = 0;
  coyote = 0;
  jumpBuffer = 0;
  jumpCutDone = true;
  jumping = false;
  stepAcc = 0;
  stunTime = 0;
  /** extra knockback velocity that decays */
  kx = 0;
  kz = 0;
  /** previous-step snapshot for render interpolation */
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  prevYaw = 0;
  /** landing impact 0..1 for squash animation */
  landImpact = 0;
  jumpsMade = 0;
  /** speed multiplier (scenario / theme modifiers) */
  speedMul = 1;
  /** friction multiplier (ice themes) */
  frictionMul = 1;
  lastFallSpeed = 0;
  invulnerable = 0;

  constructor(
    public stats: CharacterStats,
    private readonly events: EventBus,
  ) {
    this.body = new KinematicBody(stats.halfWidth, stats.height, 0.35);
  }

  get isControllable(): boolean {
    return this.state === 'run' || this.state === 'air' || this.state === 'stunned';
  }

  get isAlive(): boolean {
    return this.state !== 'dead' && this.state !== 'caught';
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.body.setPosition(x, y, z);
    this.prevX = x;
    this.prevY = y;
    this.prevZ = z;
    this.yaw = yaw;
    this.prevYaw = yaw;
    this.state = 'run';
    this.stateTime = 0;
    this.speed = 0;
    this.kx = this.kz = 0;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = false;
    this.stunTime = 0;
    this.landImpact = 0;
    this.invulnerable = 1.0;
  }

  setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  /** Applies a knockback impulse (spinner hits, explosions). */
  knock(px: number, pz: number, strength: number): void {
    const l = Math.hypot(px, pz) || 1;
    this.kx = (px / l) * strength;
    this.kz = (pz / l) * strength;
    this.body.vy = Math.max(this.body.vy, 5.5);
    this.body.grounded = false;
    this.stunTime = 0.45;
    this.setState('stunned');
  }

  update(dt: number, input: InputState, physics: PhysicsWorld): void {
    const b = this.body;
    const st = this.stats;
    this.prevX = b.x;
    this.prevY = b.y;
    this.prevZ = b.z;
    this.prevYaw = this.yaw;
    this.stateTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.landImpact = Math.max(0, this.landImpact - dt * 4);

    if (this.state === 'dead' || this.state === 'caught' || this.state === 'finished') {
      // passive: decelerate and let gravity act for finished state (victory hop)
      b.vx = approach(b.vx, 0, st.decel * dt);
      b.vz = approach(b.vz, 0, st.decel * dt);
      if (this.state === 'finished') {
        b.vy = Math.max(b.vy - st.gravity * dt, -st.maxFall);
        b.move(physics, dt);
      }
      this.speed = Math.hypot(b.vx, b.vz);
      return;
    }

    const stunned = this.state === 'stunned';
    if (stunned) {
      this.stunTime -= dt;
      if (this.stunTime <= 0) this.setState(b.grounded ? 'run' : 'air');
    }

    // ---- horizontal control
    let mx = stunned ? 0 : input.moveX;
    let mz = stunned ? 0 : input.moveZ;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    const surface = b.grounded && b.ground ? b.ground.surface : 'default';
    const friction = (surface === 'ice' ? 0.18 : 1) * this.frictionMul;
    const maxSpeed = st.runSpeed * this.speedMul;
    const tx = mx * maxSpeed;
    const tz = mz * maxSpeed;
    let accel = b.grounded ? st.accel * friction : st.airAccel;
    if (b.grounded && ml < 0.05) accel = st.decel * friction;
    // accelerate the velocity vector toward target (2D approach)
    const dvx = tx - b.vx;
    const dvz = tz - b.vz;
    const dl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dl <= maxDv || dl === 0) {
      b.vx = tx;
      b.vz = tz;
    } else {
      b.vx += (dvx / dl) * maxDv;
      b.vz += (dvz / dl) * maxDv;
    }

    // ---- jumping (coyote time + buffer + variable height)
    if (input.jumpPressed && !stunned) this.jumpBuffer = st.jumpBuffer;
    if (b.grounded) this.coyote = st.coyoteTime;
    else this.coyote -= dt;
    if (this.jumpBuffer > 0 && this.coyote > 0 && !stunned) {
      b.vy = st.jumpVelocity;
      b.grounded = false;
      b.ground = null;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumping = true;
      this.jumpCutDone = false;
      this.airTime = 0;
      this.jumpsMade++;
      this.events.emit('PLAYER_JUMP', { pos: { x: b.x, y: b.y, z: b.z }, speed: Math.hypot(b.vx, b.vz) });
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumping && !this.jumpCutDone && !input.jump && b.vy > 0) {
      b.vy *= st.jumpCut;
      this.jumpCutDone = true;
    }

    // ---- gravity
    b.vy = Math.max(b.vy - st.gravity * dt, -st.maxFall);

    // ---- knockback decay
    const kdecay = Math.exp(-4 * dt);
    this.kx *= kdecay;
    this.kz *= kdecay;

    // ---- move (conveyor drift as extra displacement)
    const conveyX = b.grounded && b.ground ? b.ground.conveyorX : 0;
    const conveyZ = b.grounded && b.ground ? b.ground.conveyorZ : 0;
    const wasGrounded = b.grounded;
    const prevVy = b.vy;
    b.move(physics, dt, (conveyX + this.kx) * dt, (conveyZ + this.kz) * dt);

    // ---- landing / air bookkeeping
    if (!b.grounded) this.airTime += dt;
    if (b.grounded && !wasGrounded) {
      this.lastFallSpeed = -prevVy;
      this.landImpact = Math.min(1, Math.max(0.2, -prevVy / 18));
      this.events.emit('PLAYER_LAND', {
        pos: { x: b.x, y: b.y, z: b.z },
        fallSpeed: -prevVy,
        airTime: this.airTime,
      });
      // close call: a real jump that lands with the feet half over the edge
      const g = b.ground;
      if (g && this.airTime > 0.4) {
        const hw = b.halfWidth;
        const o = Math.min(Math.min(b.x + hw, g.maxX) - Math.max(b.x - hw, g.minX), Math.min(b.z + hw, g.maxZ) - Math.max(b.z - hw, g.minZ));
        if (o < 0.6) this.events.emit('PLAYER_NEAR_DEATH', { pos: { x: b.x, y: b.y, z: b.z }, cause: 'edge', margin: o });
      }
      this.jumping = false;
      this.airTime = 0;
      // jelly: one comic "boing" after a real jump or drop (no endless chains)
      if (b.ground && b.ground.surface === 'jelly' && -prevVy > 8) {
        b.vy = Math.min(9, -prevVy * 0.6);
        b.grounded = false;
      }
    }
    if (!stunned) this.setState(b.grounded ? 'run' : 'air');

    // ---- speed, facing, footsteps
    this.speed = Math.hypot(b.vx, b.vz);
    if (this.speed > 0.6) this.yaw = dampAngle(this.yaw, Math.atan2(b.vx, b.vz), 14, dt);
    if (b.grounded && this.speed > 1.5) {
      this.stepAcc += this.speed * dt;
      if (this.stepAcc >= st.stepLength) {
        this.stepAcc -= st.stepLength;
        this.events.emit('PLAYER_STEP', { pos: { x: b.x, y: b.y, z: b.z }, speed: this.speed, surface });
      }
    }
  }
}
