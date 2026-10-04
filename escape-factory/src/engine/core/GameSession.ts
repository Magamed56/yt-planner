/**
 * GameSession = one run of one level: the deterministic World plus optional
 * presentation (view, camera director, audio). Used by PLAY, VIDEO and RECORD
 * modes and headless tools alike.
 */
import { CameraDirector, type CameraSubject, type DirectorStyle } from '../camera/CameraDirector';
import type { CharacterDef } from '../character/CharacterDef';
import type { EnemyDef } from '../enemy/EnemyDef';
import { emptyInput, type InputSource, type InputState } from '../input/InputState';
import type { LevelData } from '../level/types';
import type { AudioSystem } from '../audio/AudioSystem';
import { GameView } from '../render/GameView';
import type { MaterialLibrary } from '../render/materials';
import type { RenderContext } from '../render/RenderContext';
import type { LevelViewExtension } from '../render/LevelView';
import { World, type WorldOptions } from '../sim/World';
import type { ThemeDef } from '../theme/ThemeDef';
import { FixedLoop } from './FixedLoop';
import { dampAngle, lerp } from './math';

export interface SessionConfig {
  level: LevelData;
  character: CharacterDef;
  enemy: EnemyDef | null;
  theme: ThemeDef;
  input: InputSource;
  style: DirectorStyle;
  world?: Partial<Omit<WorldOptions, 'level' | 'character' | 'enemy'>>;
  rc?: RenderContext;
  mats?: MaterialLibrary;
  audio?: AudioSystem | null;
  portrait?: boolean;
  extensions?: LevelViewExtension[];
}

export class GameSession {
  readonly world: World;
  readonly view: GameView | null;
  readonly director: CameraDirector;
  readonly loop = new FixedLoop(1 / 60);
  readonly input: InputSource;
  readonly audio: AudioSystem | null;
  readonly config: SessionConfig;
  paused = false;
  /** smoothed track heading — the reference for camera-relative controls */
  heading = 0;
  /** accumulated presentation (real/video) time */
  presentTime = 0;
  private readonly inp: InputState = emptyInput();
  private readonly subject: CameraSubject;

  constructor(cfg: SessionConfig) {
    this.config = cfg;
    this.input = cfg.input;
    this.world = new World({
      level: cfg.level,
      character: cfg.character,
      enemy: cfg.enemy,
      physicsMods: cfg.theme.physics,
      ...cfg.world,
    });
    this.heading = this.world.track.yawAt(this.world.playerS);
    this.director = new CameraDirector(cfg.style, this.world.events);
    this.director.portrait = !!cfg.portrait;
    this.subject = {
      x: 0,
      y: 0,
      z: 0,
      heading: this.heading,
      vy: 0,
      grounded: true,
      alive: true,
      groundY: 0,
      enemy: cfg.enemy ? { x: 0, y: 0, z: 0, visible: false, chasing: false } : null,
    };
    this.view =
      cfg.rc && cfg.mats
        ? new GameView({ rc: cfg.rc, mats: cfg.mats, world: this.world, theme: cfg.theme, character: cfg.character, enemy: cfg.enemy, extensions: cfg.extensions })
        : null;
    this.audio = cfg.audio ?? null;
    if (this.audio) {
      this.audio.attach(this.world.events, () => ({ x: this.world.player.body.x, z: this.world.player.body.z, yaw: this.heading }), 1);
    }
  }

  /** One fixed simulation step with input sampling. */
  stepFixed(): void {
    this.input.sample(this.inp, this.loop.step);
    this.world.step(this.inp);
  }

  /**
   * Advances presentation time by `dt` seconds (wall clock in play, exact
   * frame duration in recording). Slow motion from the director scales the
   * simulation. Renders if a view exists.
   */
  frame(dt: number): void {
    if (this.paused) {
      this.renderOnly(0);
      return;
    }
    this.presentTime += dt;
    this.loop.advance(dt, () => this.stepFixed(), this.director.timeScale);
    this.audio?.update(this.world, dt);
    this.renderOnly(dt);
  }

  private renderOnly(dt: number): void {
    const w = this.world;
    const alpha = this.loop.alpha;
    const b = w.player.body;
    const targetHeading = w.track.yawAt(Math.min(w.track.length, w.playerS + 1.5));
    this.heading = dampAngle(this.heading, targetHeading, 3.5, Math.max(dt, 1e-3));
    const s = this.subject;
    s.x = lerp(w.player.prevX, b.x, alpha);
    s.y = lerp(w.player.prevY, b.y, alpha);
    s.z = lerp(w.player.prevZ, b.z, alpha);
    s.heading = this.heading;
    s.vy = b.vy;
    s.grounded = b.grounded;
    s.alive = w.player.isAlive;
    s.groundY = Math.min(w.track.heightAt(w.playerS), s.y) - 0.5;
    if (s.enemy && w.enemy) {
      const e = w.enemy;
      s.enemy.x = lerp(e.prevX, e.x, alpha);
      s.enemy.y = lerp(e.prevY, e.y, alpha);
      s.enemy.z = lerp(e.prevZ, e.z, alpha);
      s.enemy.visible = e.state !== 'dormant' && e.visible > 0.2;
      s.enemy.chasing = e.isChasing;
    }
    const pose = this.director.update(s, dt);
    if (this.view) {
      const t = w.time - (1 - alpha) * w.dt;
      this.view.sync(w, alpha, dt, t);
      this.view.render(pose, dt, this.presentTime);
    }
  }

  get cameraSubject(): CameraSubject {
    return this.subject;
  }

  dispose(): void {
    this.audio?.detach();
    this.view?.dispose();
    this.director.dispose();
    this.input.dispose?.();
    this.world.events.clear();
  }
}
