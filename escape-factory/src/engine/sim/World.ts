/**
 * World = the complete deterministic simulation of one level run.
 * Headless: no rendering, no audio, no DOM. Step it with an InputState.
 *
 * Step order: platforms → triggers → player → hazards → enemy → progress.
 */
import { damp } from '../core/math';
import { Rng, mixSeed } from '../core/rng';
import { EventBus } from '../events/EventBus';
import type { FailReason, GameEventType, Pos } from '../events/GameEvents';
import { resolveStats, type CharacterDef } from '../character/CharacterDef';
import type { EnemyDef } from '../enemy/EnemyDef';
import { Enemy, type EnemyTuning } from '../enemy/Enemy';
import type { InputState } from '../input/InputState';
import { resolveDifficulty, type DifficultyParams } from '../level/difficulty';
import { Track, type TrackProjection } from '../level/Track';
import type { CheckpointPiece, CoinPiece, LevelData, TriggerAction, TriggerPiece } from '../level/types';
import { dirYaw } from '../level/types';
import { HazardSystem } from '../obstacle/HazardSystem';
import { SolidSystem } from '../obstacle/SolidSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Player } from './Player';
import type { SimContext } from './SimContext';
import { TriggerSystem } from './TriggerSystem';

export interface PhysicsMods {
  gravityScale?: number;
  frictionMul?: number;
  speedMul?: number;
}

export interface WorldOptions {
  level: LevelData;
  character: CharacterDef;
  enemy?: EnemyDef | null;
  /** 0..1 — enables chaos-only surprises and extra enemy improvisation */
  chaos?: number;
  enemyTuning?: Partial<EnemyTuning>;
  /** extra seed for runtime randomness (different takes of the same level) */
  runtimeSeed?: number;
  physicsMods?: PhysicsMods;
}

export type WorldStatus = 'running' | 'finished';

export class World implements SimContext {
  readonly dt = 1 / 60;
  time = 0;
  tick = 0;
  readonly events = new EventBus();
  readonly physics = new PhysicsWorld();
  readonly track: Track;
  readonly level: LevelData;
  readonly rng: Rng;
  readonly diff: DifficultyParams;
  readonly player: Player;
  readonly enemy: Enemy | null;
  readonly triggers: TriggerSystem;
  readonly solids: SolidSystem;
  readonly hazards: HazardSystem;
  readonly character: CharacterDef;

  playerS = 0;
  playerLateral = 0;
  playerSpeedS = 0;
  status: WorldStatus = 'running';
  deaths = 0;
  coins = 0;
  checkpointIndex = -1;
  moduleIndex = 0;
  finishTime = 0;
  /** seconds with the player dead/caught waiting for respawn */
  respawnTimer = 0;
  /** total time the enemy was chasing (stats) */
  chaseTime = 0;
  lastDeathCause: FailReason | null = null;

  private readonly proj: TrackProjection = { s: 0, lateral: 0, seg: -1, dist: 0 };
  private fallAnnounced = false;
  private readonly coinsLeft: CoinPiece[];
  /** ids of collected coin pieces */
  readonly collectedCoins = new Set<number>();
  private readonly finalEscapeS: number;

  constructor(opts: WorldOptions) {
    this.level = opts.level;
    this.character = opts.character;
    this.diff = resolveDifficulty(opts.level.difficulty);
    this.track = new Track(opts.level.spine);
    this.rng = new Rng(mixSeed(opts.level.seed, 'runtime', opts.runtimeSeed ?? 0));
    this.events.setClock(() => ({ t: this.time, tick: this.tick }));

    const stats = resolveStats(opts.character);
    const pm = opts.physicsMods;
    if (pm?.gravityScale && pm.gravityScale !== 1) {
      stats.gravity *= pm.gravityScale;
      stats.jumpVelocity *= Math.sqrt(pm.gravityScale);
      stats.maxFall *= Math.sqrt(pm.gravityScale);
    }
    this.player = new Player(stats, this.events);
    this.player.frictionMul = pm?.frictionMul ?? 1;
    this.player.speedMul = pm?.speedMul ?? 1;

    const triggers = opts.level.pieces.filter((p): p is TriggerPiece => p.type === 'trigger');
    this.triggers = new TriggerSystem(triggers);
    this.triggers.chaos = opts.chaos ?? 0;
    this.triggers.onAction = (piece, action, t) => this.onTrigger(piece, action, t);
    this.solids = new SolidSystem(opts.level, this.physics, this.triggers);
    this.hazards = new HazardSystem(opts.level, this.triggers);
    this.coinsLeft = opts.level.pieces.filter((p): p is CoinPiece => p.type === 'coin');
    const fe = triggers.find((t) => t.action.kind === 'finalEscape');
    this.finalEscapeS = fe ? fe.s : Infinity;

    this.enemy = opts.enemy
      ? new Enemy(
          opts.enemy,
          this.diff,
          this.track,
          this.rng.fork('enemy'),
          { aggression: 1, nearGapOffset: 0, mercy: false, ...opts.enemyTuning },
          opts.level,
        )
      : null;

    const sp = opts.level.spawn;
    this.player.spawn(sp.x, sp.y, sp.z, dirYaw(sp.dir));
    this.player.invulnerable = 0;
    this.updateProgress(true);
    this.events.emit('LEVEL_START', {
      seed: opts.level.seed,
      difficulty: opts.level.difficulty,
      theme: opts.level.theme,
      modules: opts.level.modules.length,
    });
    this.events.emit('PLAYER_START', { pos: this.playerPos() });
    if (this.enemy) this.events.emit('ENEMY_SPAWN', { pos: { x: sp.x, y: -100, z: sp.z }, enemy: opts.enemy!.id });
  }

  playerPos(): Pos {
    const b = this.player.body;
    return { x: b.x, y: b.y, z: b.z };
  }

  /** Advances the simulation by one fixed step. */
  step(input: InputState): void {
    this.time += this.dt;
    this.tick++;

    this.solids.update(this);
    if (this.status === 'running') this.triggers.update(this.playerS, this.time);

    this.player.update(this.dt, input, this.physics);
    if (this.player.body.crushed && this.player.isControllable) this.killPlayer('squashed');

    this.hazards.update(this);
    if (this.enemy) {
      this.enemy.update(this, this.solids, this.hazards);
      if (this.enemy.isChasing) this.chaseTime += this.dt;
    }
    this.updateProgress(false);

    if (this.respawnTimer > 0) {
      this.respawnTimer -= this.dt;
      if (this.respawnTimer <= 0) this.respawn();
    }
  }

  private updateProgress(initial: boolean): void {
    const b = this.player.body;
    const prevS = this.playerS;
    this.track.project(b.x, b.z, this.proj.seg, this.proj);
    this.playerS = this.proj.s;
    this.playerLateral = this.proj.lateral;
    if (!initial) this.playerSpeedS = damp(this.playerSpeedS, (this.playerS - prevS) / this.dt, 10, this.dt);
    if (this.status !== 'running') return;

    // module enter
    const mods = this.level.modules;
    while (this.moduleIndex < mods.length - 1 && this.playerS >= mods[this.moduleIndex + 1].s0) {
      this.moduleIndex++;
      const m = mods[this.moduleIndex];
      this.events.emit('MODULE_ENTER', { index: m.index, type: m.type, s: m.s0 });
    }

    if (!this.player.isControllable) return;

    // falling
    const ref = Math.min(this.track.heightAt(this.playerS), this.track.heightAt(Math.max(0, this.playerS - 3)));
    if (!b.grounded && b.vy < 0 && b.y < ref - 2.2 && !this.fallAnnounced) {
      const below = this.physics.groundBelow(b.x, b.z, b.y, 25, b.halfWidth);
      if (!below) {
        this.fallAnnounced = true;
        this.events.emit('PLAYER_FALL', { pos: this.playerPos() });
      }
    }
    if (b.y < Math.min(ref, this.level.minY) - 9) this.killPlayer('fell');
    if (b.grounded) this.fallAnnounced = false;

    // checkpoints
    const cps = this.level.checkpoints;
    for (let i = this.checkpointIndex + 1; i < cps.length; i++) {
      const cp = cps[i];
      if (this.playerS >= cp.s - 0.3 && Math.abs(b.y - cp.y) < 2.5) {
        this.checkpointIndex = i;
        this.events.emit('CHECKPOINT_REACHED', { pos: { x: cp.x, y: cp.y, z: cp.z }, index: cp.index });
      } else break;
    }

    // coins
    const cy = b.y + b.height * 0.5;
    for (const c of this.coinsLeft) {
      if (this.collectedCoins.has(c.id)) continue;
      const dx = c.x - b.x;
      const dz = c.z - b.z;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) continue;
      if (dx * dx + dz * dz + (c.y - cy) * (c.y - cy) < 1.0) {
        this.collectedCoins.add(c.id);
        this.coins++;
        this.events.emit('COIN_COLLECT', { pos: { x: c.x, y: c.y, z: c.z }, total: this.coins });
      }
    }

    // finish
    const f = this.level.finish;
    if (f) {
      const bb = b.bounds();
      if (bb.maxX > f.box.minX && bb.minX < f.box.maxX && bb.maxZ > f.box.minZ && bb.minZ < f.box.maxZ && bb.maxY > f.box.minY && bb.minY < f.box.maxY) {
        this.finish();
      }
    }
  }

  private finish(): void {
    this.status = 'finished';
    this.finishTime = this.time;
    this.player.setState('finished');
    this.player.body.vy = 7;
    if (this.enemy && this.enemy.isChasing) this.enemy.endChase(this);
    this.events.emit('PLAYER_FINISH', { pos: this.playerPos(), time: this.time, deaths: this.deaths, coins: this.coins });
    this.events.emit('LEVEL_END', { result: 'finish', time: this.time, deaths: this.deaths });
  }

  killPlayer(cause: FailReason): void {
    const p = this.player;
    if (!p.isControllable || this.status !== 'running') return;
    if (p.invulnerable > 0 && cause !== 'fell') return;
    p.setState(cause === 'caught' ? 'caught' : 'dead');
    this.deaths++;
    this.lastDeathCause = cause;
    const pos = this.playerPos();
    this.events.emit('PLAYER_DEATH', { pos, cause });
    this.events.emit('PLAYER_FAIL', { pos, reason: cause });
    this.respawnTimer = cause === 'fell' ? 1.0 : 1.8;
  }

  knockPlayer(pushX: number, pushZ: number, strength: number): void {
    if (this.player.isControllable && this.player.invulnerable <= 0) this.player.knock(pushX, pushZ, strength);
  }

  /** Current respawn point (last checkpoint or spawn). */
  respawnPoint(): { x: number; y: number; z: number; dir: number; s: number; module: number } {
    const cp: CheckpointPiece | undefined = this.level.checkpoints[this.checkpointIndex];
    if (cp) return { x: cp.x, y: cp.y, z: cp.z, dir: cp.dir, s: cp.s, module: cp.module };
    const sp = this.level.spawn;
    return { x: sp.x, y: sp.y, z: sp.z, dir: sp.dir, s: 0, module: 0 };
  }

  respawn(): void {
    const rp = this.respawnPoint();
    this.player.spawn(rp.x, rp.y + 0.05, rp.z, dirYaw(rp.dir as 0 | 1 | 2 | 3));
    this.proj.seg = -1;
    this.updateProgress(true);
    this.playerSpeedS = 0;
    this.fallAnnounced = false;
    this.triggers.resetFrom(rp.s);
    this.solids.resetFromModule(rp.module);
    if (this.enemy) {
      // a final escape behind the checkpoint keeps chasing; otherwise it re-triggers later
      const keepFinal = this.enemy.isFinalEscape && this.finalEscapeS <= rp.s;
      this.enemy.onRespawn(this, keepFinal);
    }
    this.events.emit('PLAYER_RESPAWN', { pos: this.playerPos(), checkpoint: this.checkpointIndex });
  }

  private onTrigger(piece: TriggerPiece, a: TriggerAction, _t: number): void {
    const pos = this.playerPos();
    const e = this.enemy;
    switch (a.kind) {
      case 'chaseStart':
        this.events.emit('CHASE_START', { pos, s: piece.s });
        e?.startChase(this, a.intensity);
        break;
      case 'chaseEnd':
        if (e?.isChasing && !e.isFinalEscape) {
          this.events.emit('CHASE_END', { pos, s: piece.s, escaped: true });
          e.endChase(this);
        }
        break;
      case 'finalEscape':
        this.events.emit('FINAL_ESCAPE', { pos });
        e?.startChase(this, 1, true);
        break;
      case 'bossStart':
        this.events.emit('BOSS_START', { pos: { x: a.x, y: a.y, z: a.z } });
        e?.startBoss(this, a.x, a.y, a.z, this.hazards, a.hazardId);
        break;
      case 'bossEnd':
        this.events.emit('BOSS_END', { pos });
        e?.endBoss(this);
        break;
      case 'enemyPeek':
        e?.peek(this, a.x, a.y, a.z, a.duration);
        break;
      case 'enemyBlock':
        e?.block(this, a.x, a.y, a.z, a.lateral);
        break;
      case 'surprise': {
        this.events.emit('SURPRISE', { pos, kind: a.surprise });
        if (a.surprise === 'lightsFlicker') this.events.emit('LIGHTS_FLICKER', { pos, duration: 1.6 });
        else if (a.surprise === 'alarm') this.events.emit('ALARM', { pos, duration: 3 });
        else if (a.surprise === 'enemyRoar') this.events.emit('ENEMY_ROAR', { pos });
        break;
      }
      case 'event':
        this.emitGeneric(a.event, pos, piece.id);
        break;
      case 'fire':
        break;
    }
  }

  private emitGeneric(type: GameEventType, pos: Pos, id: number): void {
    // Generic trigger events carry a superset payload; consumers read what they need.
    (this.events.emit as (t: GameEventType, p: unknown) => void)(type, { pos, id, duration: 2, kind: 'trigger' });
  }

  /** Summary used by tests, bot validation and video metadata. */
  summary() {
    return {
      status: this.status,
      time: this.time,
      finishTime: this.finishTime,
      deaths: this.deaths,
      coins: this.coins,
      progress: this.playerS / this.track.length,
      checkpoint: this.checkpointIndex,
      chaseTime: this.chaseTime,
      catches: this.enemy?.catches ?? 0,
    };
  }
}
