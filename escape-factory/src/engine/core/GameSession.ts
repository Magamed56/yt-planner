/**
 * GameSession = one run of one level: the deterministic World plus optional
 * presentation (view, camera director, audio). Used by PLAY, VIDEO and RECORD
 * modes and headless tools alike.
 */
import { CameraCollision } from '../camera/CameraCollision';
import { CameraDirector, type CameraMode, type CameraPose, type CameraSubject, type DirectorStyle } from '../camera/CameraDirector';
import { CameraObstacles } from '../camera/CameraObstacles';
import { ensureInFrame, frameSubjects } from '../camera/framing';
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

/** Safe shots, in order of preference, used when a shot is blocked by geometry. */
const FALLBACK_SHOTS: CameraMode[] = ['FOLLOW', 'BACK', 'TOP', 'CHASE', 'SIDE', 'LOW'];

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
  /** what the camera may not pass through + the collision resolver */
  readonly camObstacles: CameraObstacles;
  readonly camCollision: CameraCollision;
  private blockedFor = 0;
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
    // framing uses the real output aspect (9:16 Shorts, 16:9 video, window in play)
    this.director.aspect = cfg.portrait ? 9 / 16 : cfg.rc ? cfg.rc.aspect : 16 / 9;
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
    this.camObstacles = new CameraObstacles(this.world);
    this.camCollision = new CameraCollision(this.camObstacles);
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
  frame(dt: number, draw = true): void {
    if (this.paused) {
      this.renderOnly(0, draw);
      return;
    }
    this.presentTime += dt;
    this.loop.advance(dt, () => this.stepFixed(), this.director.timeScale);
    this.audio?.update(this.world, dt);
    this.renderOnly(dt, draw);
  }

  /** `draw=false` keeps camera/visual state current without issuing GPU work (fast-forward). */
  private renderOnly(dt: number, draw = true): void {
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
    s.trackY = w.track.heightAt(w.playerS);
    s.groundY = Math.min(s.trackY, s.y) - 0.5;
    if (s.enemy && w.enemy) {
      const e = w.enemy;
      s.enemy.x = lerp(e.prevX, e.x, alpha);
      s.enemy.y = lerp(e.prevY, e.y, alpha);
      s.enemy.z = lerp(e.prevZ, e.z, alpha);
      s.enemy.visible = e.state !== 'dormant' && e.visible > 0.2;
      s.enemy.chasing = e.isChasing;
    }
    let pose = this.director.update(s, dt);
    // collision: never through walls/ceilings/floors/props/Grumbo; smooth in & out.
    // Runs headless too, so audits and video planning see exactly what renders.
    // pivot = runner's chest, but never below the course's floor plane: when he
    // falls into the abyss the camera stays above the floor and films him from there
    const pivotY = Math.max(s.y + 1, (s.trackY ?? -Infinity) + 0.6);
    const floorY = (s.trackY ?? -Infinity) + 0.4;
    let col = this.camCollision.resolve(pose, s.x, pivotY, s.z, dt, this.director.lastCut, floorY);
    // a shot that needs a whip-like dolly, or stays badly blocked, is replaced by a
    // safe one — as a cut in this very frame (keeps priority and slow-mo)
    this.blockedFor = col.ratio < 0.5 ? this.blockedFor + dt : 0;
    if (col.needsCut || this.blockedFor > 0.35) {
      // only cut when a clearly freer standard shot exists (no flicker between blocked ones)
      const fb = this.safestFallback(s);
      // the cooldown is skipped when the camera is stuck in geometry, or when a fully
      // clear standard shot exists (a cut to it beats pulling into a moving obstacle)
      const since = this.presentTime - this.lastForcedCut;
      const force = (col.stuck && fb.free >= 0.5 && since > 0.1) || (col.needsCut && fb.free >= 0.999 && since > 0.25);
      if (this.director.onBlocked(force, fb.mode)) {
        if (force) this.lastForcedCut = this.presentTime;
        this.blockedFor = 0;
        pose = this.director.update(s, 0);
        col = this.camCollision.resolve(pose, s.x, pivotY, s.z, 0, true, floorY);
      }
    }
    // a shorter arm must not lose the chaser from shots built to show him:
    // re-aim and widen (the safe camera position stays where it is)
    const m = this.director.mode;
    if (col.ratio < 0.98 && (m === 'CHASE' || m === 'WIDE') && s.enemy && (s.enemy.visible || s.enemy.chasing)) {
      const eh = this.config.enemy?.stats.height ?? 3;
      frameSubjects(pose, [{ x: s.x, y: s.y + 1, z: s.z }, { x: s.enemy.x, y: s.enemy.y + eh * 0.4, z: s.enemy.z }], this.director.frameAspect, this.config.portrait ? 92 : 80, false);
    }
    // raising/pulling the camera must never push the runner off screen
    if (col.ratio < 0.98 || col.raise > 0.01) ensureInFrame(pose, { x: s.x, y: s.y + 1, z: s.z }, this.director.frameAspect);
    if (this.view) {
      const t = w.time - (1 - alpha) * w.dt;
      this.view.sync(w, alpha, dt, t);
      this.view.render(pose, dt, this.presentTime, draw);
    }
  }

  /** The first standard safe shot whose ideal camera position is actually free here. */
  private safestFallback(s: CameraSubject): { mode: CameraMode; free: number } {
    const cur = this.director.mode;
    let best: CameraMode = cur === 'FOLLOW' ? 'TOP' : 'FOLLOW';
    let bestF = -1;
    for (const m of FALLBACK_SHOTS) {
      if (m === cur) continue;
      const f = this.camCollision.evaluate(this.director.previewShot(m, s), s.x, Math.max(s.y + 1, (s.trackY ?? -Infinity) + 0.6), s.z);
      if (f >= 0.999) return { mode: m, free: 1 };
      if (f > bestF) {
        bestF = f;
        best = m;
      }
    }
    return { mode: best, free: Math.max(0, bestF) };
  }

  private lastForcedCut = -99;

  get cameraSubject(): CameraSubject {
    return this.subject;
  }

  /** Final camera pose of the last frame (after collision handling). */
  get cameraPose(): CameraPose {
    return this.director.pose;
  }

  dispose(): void {
    this.audio?.detach();
    this.view?.dispose();
    this.director.dispose();
    this.input.dispose?.();
    this.world.events.clear();
  }
}
