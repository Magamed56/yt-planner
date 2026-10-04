/**
 * Audio System: maps game events to procedural SFX (with distance
 * attenuation & panning) and drives adaptive music intensity from the world
 * state. Works with AudioContext (play) or OfflineAudioContext (recording).
 */
import type { EventBus } from '../events/EventBus';
import type { GameEvent, GameEventType } from '../events/GameEvents';
import type { World } from '../sim/World';
import type { ThemeMusic } from '../theme/ThemeDef';
import { MusicEngine } from './music';
import { Synth, type SfxName } from './synth';

export interface Listener {
  x: number;
  z: number;
  /** camera yaw (for panning) */
  yaw: number;
}

/** Event → sound mapping (data, so other games can override). */
export const EVENT_SFX: Partial<Record<GameEventType, { sfx: SfxName; gain?: number; spatial?: boolean }>> = {
  PLAYER_JUMP: { sfx: 'jump' },
  PLAYER_LAND: { sfx: 'land', gain: 0.8 },
  PLAYER_STEP: { sfx: 'step', gain: 0.6 },
  PLAYER_FALL: { sfx: 'fall' },
  PLAYER_HIT: { sfx: 'boing' },
  PLAYER_DEATH: { sfx: 'death' },
  PLAYER_NEAR_DEATH: { sfx: 'nearDeath', gain: 0.8 },
  COIN_COLLECT: { sfx: 'coin' },
  CHECKPOINT_REACHED: { sfx: 'checkpoint' },
  PLAYER_FINISH: { sfx: 'finish' },
  ENEMY_ROAR: { sfx: 'roar', spatial: true },
  ENEMY_GRAB: { sfx: 'grab' },
  ENEMY_STUMBLE: { sfx: 'bonk', spatial: true },
  ENEMY_RETREAT: { sfx: 'bonk', spatial: true, gain: 1.2 },
  ENEMY_STEP: { sfx: 'stomp', spatial: true, gain: 0.9 },
  OBSTACLE_BREAK: { sfx: 'break', spatial: true },
  DOOR_CLOSE: { sfx: 'door', spatial: true },
  TRAP_TRIGGER: { sfx: 'trap', spatial: true },
  FLOOR_COLLAPSE: { sfx: 'collapse', spatial: true },
  PLATFORM_FALL: { sfx: 'click', spatial: true },
  CRUSHER_SLAM: { sfx: 'crusher', spatial: true },
  LASER_ON: { sfx: 'laser', spatial: true, gain: 0.6 },
  FALLING_OBJECT: { sfx: 'whoosh', spatial: true },
  SPINNER_HIT: { sfx: 'hit' },
  ALARM: { sfx: 'alarm' },
  CHASE_START: { sfx: 'sting' },
  BOSS_START: { sfx: 'sting', gain: 1.3 },
  BOSS_ATTACK: { sfx: 'whoosh', spatial: true },
  FINAL_ESCAPE: { sfx: 'alarm' },
  LIGHTS_FLICKER: { sfx: 'click' },
  SURPRISE: { sfx: 'whoosh', gain: 0.6 },
};

/** Music intensity (0..1) derived from the simulation — shared by play and offline render. */
export function musicIntensity(world: World): number {
  const e = world.enemy;
  if (world.status === 'finished') return 0.2;
  let k = 0.3;
  if (e) {
    if (e.state === 'boss') k = 0.9;
    if (e.isChasing) {
      const gap = e.gapTo(world.playerS);
      k = e.isFinalEscape ? 1 : 0.78 + (gap < 4 ? 0.2 : 0);
    } else if (e.state === 'peek' || e.state === 'block') k = 0.5;
  }
  return Math.min(1, k);
}

export class AudioSystem {
  readonly master: GainNode;
  readonly sfxBus: GainNode;
  readonly musicBus: GainNode;
  readonly synth: Synth;
  music: MusicEngine | null = null;
  private intensity = 0.3;
  private offs: Array<() => void> = [];
  private stepPitch = 1;

  constructor(readonly ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.synth = new Synth(ctx, this.sfxBus);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.master.gain.value = master;
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = sfx;
  }

  startMusic(theme: ThemeMusic, seed: number, at = this.ctx.currentTime + 0.05): void {
    this.music?.stop();
    this.music = new MusicEngine(this.ctx, this.musicBus, theme, seed);
    this.music.start(at);
  }

  /** Subscribes to a world's events. `listener` gives the hearing position. */
  attach(events: EventBus, listener: () => Listener, pitch = 1): void {
    this.detach();
    this.stepPitch = pitch;
    this.offs.push(events.onAny((e) => this.onEvent(e, listener(), this.ctx.currentTime)));
  }

  detach(): void {
    for (const o of this.offs) o();
    this.offs = [];
  }

  /** Plays the sound for an event at audio time `t` (used by offline rendering too). */
  onEvent(e: GameEvent, l: Listener, t: number): void {
    const m = EVENT_SFX[e.type];
    if (!m) return;
    let gain = m.gain ?? 1;
    let pan = 0;
    const pos = (e.payload as { pos?: { x: number; z: number } }).pos;
    if (m.spatial && pos) {
      const dx = pos.x - l.x;
      const dz = pos.z - l.z;
      const d = Math.hypot(dx, dz);
      gain *= Math.max(0, 1 - d / 45);
      if (gain < 0.02) return;
      // listener right vector from yaw
      const rx = -Math.cos(l.yaw);
      const rz = Math.sin(l.yaw);
      pan = d > 0.5 ? ((dx * rx + dz * rz) / d) * 0.7 : 0;
    }
    const pitch = e.type === 'PLAYER_STEP' || e.type === 'PLAYER_JUMP' ? this.stepPitch * (0.92 + ((e.tick * 7919) % 17) / 100) : 1;
    this.synth.play(m.sfx, t, { gain, pan, pitch });
  }

  private heartT = 0;

  /** Per-frame: music intensity follows the world state; heartbeat when Grumbo is close. */
  update(world: World, dt: number): void {
    const gap = world.enemy ? world.enemy.gapTo(world.playerS) : Infinity;
    if (gap < 5 && world.player.isControllable) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.32 + gap * 0.06;
        this.synth.play('stomp', this.ctx.currentTime, { gain: 0.35, pitch: 1.4 });
      }
    }
    const target = musicIntensity(world);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.5);
    this.music?.pump(this.intensity);
  }

  get currentIntensity(): number {
    return this.intensity;
  }

  dispose(): void {
    this.detach();
    this.music?.stop();
    this.master.disconnect();
  }
}
