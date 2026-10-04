/**
 * Enemy brain: a deterministic state machine that creates the core feeling of
 * the game — "he's RIGHT behind me!". The enemy moves along the track spine
 * (it is a set-piece actor, not a physics body), rubber-banding to a desired
 * gap with periodic lunges, and only catches players who lose speed.
 */
import { approach, clamp, damp, dampAngle } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyParams } from '../level/difficulty';
import type { Track } from '../level/Track';
import type { LevelData } from '../level/types';
import type { SlamSpec } from '../obstacle/hazardTypes';
import { slamLaneState } from '../obstacle/hazardEval';
import type { SolidSystem } from '../obstacle/SolidSystem';
import type { HazardSystem } from '../obstacle/HazardSystem';
import type { SimContext } from '../sim/SimContext';
import type { EnemyDef } from './EnemyDef';

export type EnemyState = 'dormant' | 'peek' | 'chase' | 'block' | 'boss' | 'grab' | 'retreat';
export type EnemyAction = 'idle' | 'run' | 'roar' | 'grab' | 'stumble' | 'slam' | 'peek' | 'sink' | 'bonk' | 'cheer';

export interface EnemyTuning {
  /** scenario multiplier on lunge frequency */
  aggression: number;
  /** scenario offset added to the near gap (negative = scarier) */
  nearGapOffset: number;
  /** if true the enemy never catches (cinematic takes) */
  mercy: boolean;
}

export class Enemy {
  state: EnemyState = 'dormant';
  action: EnemyAction = 'idle';
  stateTime = 0;
  actionTime = 0;
  s = 0;
  lateral = 0;
  x = 0;
  y = -100;
  z = 0;
  yaw = 0;
  speed = 0;
  /** 0..1 visibility for fade/rise animations */
  visible = 0;
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  prevYaw = 0;
  /** boss arm target (world) */
  armX = 0;
  armZ = 0;
  armPhase: 'idle' | 'warn' | 'active' = 'idle';
  /** gauge needle 0..1 (mood) — a signature visual of Grumbo */
  mood = 0;

  private desiredGap = 8;
  private lungeTimer = 6;
  private lungeLeft = 0;
  private stumbleLeft = 0;
  private nearCooldown = 0;
  private nearDeathCooldown = 0;
  private graceLeft = 0;
  private intensity = 0.5;
  private finalEscape = false;
  private peekLeft = 0;
  private blockS = 0;
  private boss: SlamSpec | null = null;
  private bossHazardId = -1;
  private breakables: Array<{ id: number; s: number; x: number; y: number; z: number }> = [];
  private nextBreakable = 0;
  catches = 0;

  constructor(
    readonly def: EnemyDef,
    private readonly diff: DifficultyParams,
    private readonly track: Track,
    private readonly rng: Rng,
    readonly tuning: EnemyTuning,
    level: LevelData,
  ) {
    const proj = { s: 0, lateral: 0, seg: 0, dist: 0 };
    for (const p of level.pieces) {
      if (p.type === 'solid' && p.breakable) {
        const cx = (p.box.minX + p.box.maxX) / 2;
        const cz = (p.box.minZ + p.box.maxZ) / 2;
        track.project(cx, cz, -1, proj);
        this.breakables.push({ id: p.id, s: proj.s, x: cx, y: p.box.maxY, z: cz });
      }
    }
    this.breakables.sort((a, b) => a.s - b.s);
  }

  get isChasing(): boolean {
    return this.state === 'chase';
  }
  get isFinalEscape(): boolean {
    return this.finalEscape;
  }

  private setState(s: EnemyState): void {
    this.state = s;
    this.stateTime = 0;
  }

  private setAction(a: EnemyAction): void {
    if (this.action === a) return;
    this.action = a;
    this.actionTime = 0;
  }

  private pos() {
    return { x: this.x, y: this.y, z: this.z };
  }

  // ---- commands from triggers -------------------------------------------

  startChase(ctx: SimContext, intensity: number, final = false): void {
    if (this.state === 'chase') {
      this.intensity = Math.max(this.intensity, intensity);
      if (final) this.finalEscape = true;
      return;
    }
    this.intensity = intensity;
    this.finalEscape = final;
    this.setState('chase');
    this.s = Math.max(0, ctx.playerS - (final ? 13 : 15));
    this.lateral = ctx.playerLateral * 0.5;
    this.speed = ctx.playerSpeedS;
    this.desiredGap = this.diff.enemyBaseGap;
    this.lungeTimer = this.rng.range(2.2, 3.5);
    this.lungeLeft = 0;
    this.graceLeft = 0;
    this.nextBreakable = this.breakables.findIndex((b) => b.s > this.s);
    if (this.nextBreakable < 0) this.nextBreakable = this.breakables.length;
    this.placeOnTrack();
    this.snapPrev();
    ctx.events.emit('ENEMY_APPEAR', { pos: this.pos(), mode: 'chase' });
    ctx.events.emit('ENEMY_CHASE', { pos: this.pos(), speed: this.speed });
    ctx.events.emit('ENEMY_ROAR', { pos: this.pos() });
    this.setAction('roar');
  }

  endChase(ctx: SimContext): void {
    if (this.state !== 'chase') return;
    this.finalEscape = false;
    this.setState('retreat');
    this.setAction('bonk');
    ctx.events.emit('ENEMY_RETREAT', { pos: this.pos() });
  }

  peek(ctx: SimContext, x: number, y: number, z: number, duration: number): void {
    if (this.state !== 'dormant' && this.state !== 'retreat') return;
    this.setState('peek');
    this.setAction('peek');
    this.x = x;
    this.y = y;
    this.z = z;
    this.peekLeft = duration;
    this.visible = 0;
    this.snapPrev();
    ctx.events.emit('ENEMY_APPEAR', { pos: this.pos(), mode: 'peek' });
  }

  block(ctx: SimContext, x: number, y: number, z: number, lateral: number): void {
    if (this.state === 'chase' || this.state === 'boss') return;
    this.setState('block');
    this.setAction('roar');
    this.x = x;
    this.y = y;
    this.z = z;
    this.lateral = lateral;
    const proj = this.track.project(x, z);
    this.blockS = proj.s;
    this.visible = 0;
    this.snapPrev();
    ctx.events.emit('ENEMY_APPEAR', { pos: this.pos(), mode: 'block' });
    ctx.events.emit('ENEMY_BLOCK', { pos: this.pos(), lateral });
  }

  startBoss(ctx: SimContext, x: number, y: number, z: number, hazards: HazardSystem, hazardId: number): void {
    this.setState('boss');
    this.setAction('roar');
    this.x = x;
    this.y = y;
    this.z = z;
    this.visible = 0;
    const h = hazards.get(hazardId);
    this.boss = h && h.spec.kind === 'slam' ? h.spec : null;
    this.bossHazardId = hazardId;
    this.snapPrev();
    ctx.events.emit('ENEMY_APPEAR', { pos: this.pos(), mode: 'boss' });
    ctx.events.emit('ENEMY_ROAR', { pos: this.pos() });
  }

  endBoss(ctx: SimContext): void {
    if (this.state !== 'boss') return;
    this.setState('retreat');
    this.setAction('sink');
    this.boss = null;
    ctx.events.emit('ENEMY_DISAPPEAR', { pos: this.pos() });
  }

  /** Called after the player respawns at a checkpoint. */
  onRespawn(ctx: SimContext, keepFinal: boolean): void {
    if (!keepFinal) this.finalEscape = false;
    if (this.finalEscape) {
      this.setState('chase');
      this.s = Math.max(0, ctx.playerS - 16);
      this.speed = 0;
      this.graceLeft = 1.6;
      this.desiredGap = this.diff.enemyBaseGap + 3;
      this.lungeTimer = 4;
      this.placeOnTrack();
      this.snapPrev();
    } else {
      this.setState('dormant');
      this.visible = 0;
      this.y = -100;
      this.snapPrev();
    }
    this.setAction('idle');
  }

  // ---- per-step update ---------------------------------------------------

  update(ctx: SimContext, solids: SolidSystem, hazards: HazardSystem): void {
    const dt = ctx.dt;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;
    this.stateTime += dt;
    this.actionTime += dt;
    this.nearCooldown = Math.max(0, this.nearCooldown - dt);
    this.nearDeathCooldown = Math.max(0, this.nearDeathCooldown - dt);
    const pl = ctx.player;
    const px = pl.body.x;
    const pz = pl.body.z;

    switch (this.state) {
      case 'dormant':
        this.visible = 0;
        this.mood = damp(this.mood, 0, 2, dt);
        return;
      case 'peek': {
        this.peekLeft -= dt;
        this.visible = Math.min(1, this.visible + dt * 2.5);
        this.faceTowards(px, pz, dt, 6);
        this.mood = damp(this.mood, 0.45, 2, dt);
        const d = Math.hypot(px - this.x, pz - this.z);
        if (this.peekLeft <= 0 || d < 10) {
          this.setState('retreat');
          this.setAction('sink');
          ctx.events.emit('ENEMY_DISAPPEAR', { pos: this.pos() });
        }
        return;
      }
      case 'retreat': {
        this.visible = Math.max(0, this.visible - dt * 1.2);
        this.speed = approach(this.speed, 0, 18 * dt);
        if (this.action === 'sink') this.y -= dt * 2.5;
        if (this.visible <= 0) {
          this.setState('dormant');
          this.y = -100;
        }
        return;
      }
      case 'block': {
        this.visible = Math.min(1, this.visible + dt * 3);
        this.faceTowards(px, pz, dt, 8);
        this.mood = damp(this.mood, 0.8, 3, dt);
        if (this.actionTime > 1.0) this.setAction('idle');
        const d = Math.hypot(px - this.x, pz - this.z);
        if (pl.isControllable && d < this.def.stats.width * 0.5 + 0.6 && !this.tuning.mercy) {
          this.grab(ctx);
          return;
        }
        if (ctx.playerS > this.blockS + 4) {
          this.setState('retreat');
          this.setAction('sink');
          ctx.events.emit('ENEMY_DISAPPEAR', { pos: this.pos() });
        }
        return;
      }
      case 'boss': {
        this.visible = Math.min(1, this.visible + dt * 2);
        this.faceTowards(px, pz, dt, 4);
        this.mood = damp(this.mood, 1, 2, dt);
        this.updateBossArm(ctx, hazards);
        return;
      }
      case 'grab': {
        this.speed = approach(this.speed, 0, 30 * dt);
        if (this.stateTime > 1.4) {
          this.setAction('cheer');
        }
        return;
      }
      case 'chase':
        this.updateChase(ctx, solids);
        return;
    }
  }

  private updateBossArm(ctx: SimContext, hazards: HazardSystem): void {
    const spec = this.boss;
    if (!spec) return;
    const h = hazards.get(this.bossHazardId);
    const lt = h ? hazards.localTime(h.spec, ctx.time) : null;
    if (lt === null) return;
    let phase: 'idle' | 'warn' | 'active' = 'idle';
    for (let i = 0; i < spec.lanes.length; i++) {
      const st = slamLaneState(spec, i, lt);
      if (st.phase !== 'idle') {
        phase = st.phase;
        const l = spec.lanes[i];
        this.armX = (l.minX + l.maxX) / 2;
        this.armZ = (l.minZ + l.maxZ) / 2;
        if (st.phase === 'active') break;
      }
    }
    if (phase !== 'idle') this.setAction('slam');
    else if (this.action === 'slam' && this.actionTime > 0.3) this.setAction('idle');
    this.armPhase = phase;
  }

  private updateChase(ctx: SimContext, solids: SolidSystem): void {
    const dt = ctx.dt;
    const d = this.diff;
    const pl = ctx.player;
    this.visible = Math.min(1, this.visible + dt * 3);
    if (this.action === 'roar' && this.actionTime > 0.9) this.setAction('run');
    if (this.action === 'stumble' && this.stumbleLeft <= 0) this.setAction('run');
    if (this.action === 'idle') this.setAction('run');

    // --- desired gap with lunges
    const nearGap = Math.max(this.def.stats.catchDistance + 0.8, d.enemyNearGap + this.tuning.nearGapOffset);
    const baseGap = d.enemyBaseGap * (this.finalEscape ? 0.85 : 1);
    if (this.lungeLeft > 0) {
      this.lungeLeft -= dt;
      this.desiredGap = damp(this.desiredGap, nearGap, 3.2, dt);
      if (this.lungeLeft <= 0) {
        this.lungeTimer =
          this.rng.range(d.enemyLungeMin, d.enemyLungeMax) / Math.max(0.3, this.tuning.aggression * (0.7 + 0.6 * this.intensity));
      }
    } else {
      this.desiredGap = damp(this.desiredGap, baseGap, 0.8, dt);
      this.lungeTimer -= dt;
      if (this.lungeTimer <= 0 && pl.isControllable) {
        this.lungeLeft = this.rng.range(1.4, 2.2);
        ctx.events.emit('ENEMY_ROAR', { pos: this.pos() });
        ctx.events.emit('ENEMY_ACCELERATE', { pos: this.pos(), speed: this.speed });
        this.setAction('roar');
      }
    }

    // --- speed: never slower than the hunt speed, rubber band toward desired gap
    const gap = ctx.playerS - this.s;
    const hunt = d.enemyHunt * this.def.stats.speedMul * (0.92 + 0.16 * this.intensity);
    let target = Math.max(hunt, ctx.playerSpeedS + 2.2 * (gap - this.desiredGap));
    let maxSpeed = d.enemyMax;
    if (gap > 22) maxSpeed = 22;
    if (this.graceLeft > 0) {
      this.graceLeft -= dt;
      target = Math.min(target, 3);
    }
    if (this.stumbleLeft > 0) {
      this.stumbleLeft -= dt;
      target = Math.min(target, 2.5);
    }
    if (!pl.isControllable) target = Math.min(target, 4);
    target = clamp(target, 0, maxSpeed);
    this.speed = approach(this.speed, target, 24 * dt);
    this.s = Math.min(this.track.length, this.s + this.speed * dt);
    this.lateral = damp(this.lateral, clamp(ctx.playerLateral * 0.6, -2, 2), 3, dt);

    // --- smash breakables on the way (comedy + OBSTACLE_BREAK beats)
    while (this.nextBreakable < this.breakables.length && this.breakables[this.nextBreakable].s <= this.s + 1.2) {
      const b = this.breakables[this.nextBreakable++];
      if (solids.breakPiece(b.id)) {
        ctx.events.emit('OBSTACLE_BREAK', { pos: { x: b.x, y: b.y, z: b.z }, kind: 'crate' });
        if (this.rng.chance(0.35) && this.lungeLeft <= 0) {
          this.stumbleLeft = 0.55;
          this.setAction('stumble');
          ctx.events.emit('ENEMY_STUMBLE', { pos: this.pos() });
        }
      }
    }

    this.placeOnTrack();
    const sm = this.track.sample(Math.min(this.track.length, this.s + 2));
    const wantYaw = Math.atan2(sm.x - this.x, sm.z - this.z);
    this.yaw = dampAngle(this.yaw, wantYaw, 8, dt);
    this.mood = damp(this.mood, this.lungeLeft > 0 ? 1 : 0.75, 3, dt);

    // --- proximity events and catching
    const newGap = ctx.playerS - this.s;
    if (pl.isControllable) {
      if (newGap < this.def.stats.nearDistance && this.nearCooldown <= 0) {
        this.nearCooldown = 2.5;
        ctx.events.emit('ENEMY_NEAR', { pos: this.pos(), gap: newGap });
      }
      if (newGap < this.def.stats.catchDistance + 0.9 && newGap > this.def.stats.catchDistance && this.nearDeathCooldown <= 0) {
        this.nearDeathCooldown = 3;
        ctx.events.emit('PLAYER_NEAR_DEATH', {
          pos: { x: pl.body.x, y: pl.body.y, z: pl.body.z },
          cause: 'enemy',
          margin: newGap - this.def.stats.catchDistance,
        });
      }
      if (newGap <= this.def.stats.catchDistance && !this.tuning.mercy && pl.invulnerable <= 0) this.grab(ctx);
    }
  }

  private grab(ctx: SimContext): void {
    this.setState('grab');
    this.setAction('grab');
    this.catches++;
    const pl = ctx.player;
    ctx.events.emit('ENEMY_GRAB', { pos: { x: pl.body.x, y: pl.body.y, z: pl.body.z } });
    ctx.killPlayer('caught');
  }

  private faceTowards(x: number, z: number, dt: number, rate: number): void {
    this.yaw = dampAngle(this.yaw, Math.atan2(x - this.x, z - this.z), rate, dt);
  }

  private placeOnTrack(): void {
    const p = this.track.offsetPoint(this.s, this.lateral);
    this.x = p.x;
    this.z = p.z;
    const g = this.track.gapAt(this.s);
    if (g) {
      const u = (this.s - g.s0) / Math.max(0.01, g.s1 - g.s0);
      const hgt = 1.5 + (g.s1 - g.s0) * 0.25;
      this.y = g.y0 + (g.y1 - g.y0) * u + 4 * hgt * u * (1 - u);
    } else this.y = p.y;
  }

  private snapPrev(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;
  }

  /** Gap to the player along the track (Infinity when not chasing). */
  gapTo(playerS: number): number {
    return this.state === 'chase' ? playerS - this.s : Infinity;
  }
}
