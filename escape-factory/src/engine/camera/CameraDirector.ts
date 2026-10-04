/**
 * Camera Director System — an automatic, event-driven cinematographer.
 *
 * Pure logic (no Three.js): it consumes game events and the subject state and
 * outputs a camera pose (position, target, fov, roll) plus a time-scale for
 * slow motion. Styles (gameplay / video / shorts) are data: event→shot rules
 * and coverage rotations.
 */
import { clamp, lerp, smoothDamp } from '../core/math';
import type { EventBus } from '../events/EventBus';
import type { GameEvent, GameEventType } from '../events/GameEvents';

export type CameraMode =
  | 'FOLLOW'
  | 'SIDE'
  | 'FRONT'
  | 'BACK'
  | 'TOP'
  | 'LOW'
  | 'WIDE'
  | 'CLOSE'
  | 'CHASE'
  | 'DRAMATIC'
  | 'IMPACT'
  | 'SLOW'
  | 'FINISH';

export const CAMERA_MODES: CameraMode[] = ['FOLLOW', 'SIDE', 'FRONT', 'BACK', 'TOP', 'LOW', 'WIDE', 'CLOSE', 'CHASE', 'DRAMATIC', 'IMPACT', 'SLOW', 'FINISH'];

export interface CameraSubject {
  x: number;
  y: number;
  z: number;
  /** track heading yaw at the player (0 = +Z) */
  heading: number;
  vy: number;
  grounded: boolean;
  alive: boolean;
  /** ground height under the player (for camera floor clamp) */
  groundY: number;
  enemy: { x: number; y: number; z: number; visible: boolean; chasing: boolean } | null;
}

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  roll: number;
}

export interface ShotRule {
  event: GameEventType;
  mode: CameraMode;
  priority: number;
  /** seconds the shot is held */
  hold: number;
  /** optional slow-motion time scale while held */
  slowmo?: number;
  slowmoTime?: number;
  /** hard cut instead of blend */
  cut?: boolean;
  /** min seconds between triggers of this rule */
  cooldown?: number;
  /** probability the rule fires (variety) */
  chance?: number;
  /** extra predicate on the event */
  when?: (e: GameEvent, s: CameraSubject) => boolean;
}

export interface DirectorStyle {
  name: string;
  /** coverage rotation when nothing special happens */
  base: CameraMode[];
  /** coverage while the enemy is chasing */
  chaseBase: CameraMode[];
  baseShot: [number, number];
  rules: ShotRule[];
  allowSlowmo: boolean;
  /** probability of hard cuts on base rotation */
  cutChance: number;
}

interface ActiveShot {
  mode: CameraMode;
  priority: number;
  hold: number;
  time: number;
  side: 1 | -1;
  focus: { x: number; y: number; z: number } | null;
  slowmo: number;
  slowmoTime: number;
}

export class CameraDirector {
  readonly pose: CameraPose = { x: 0, y: 5, z: -8, tx: 0, ty: 1, tz: 0, fov: 60, roll: 0 };
  private readonly vel = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 }, tx: { v: 0 }, ty: { v: 0 }, tz: { v: 0 }, fov: { v: 0 } };
  private shot: ActiveShot;
  private baseIdx = 0;
  private baseTimer = 4;
  private cutPending = true;
  private readonly cooldowns = new Map<ShotRule, number>();
  private readonly offs: Array<() => void> = [];
  private seq = 0;
  /** output: simulation time-scale (slow motion) */
  timeScale = 1;
  /** portrait (9:16) framing */
  portrait = false;
  /** shot changes log (for tests / video metadata) */
  readonly log: Array<{ t: number; mode: CameraMode; cause: string }> = [];
  /** wall-clock seconds since director start */
  private clock = 0;
  enabled = true;
  private lastSubject: CameraSubject | null = null;

  constructor(
    public style: DirectorStyle,
    events: EventBus | null,
  ) {
    this.shot = { mode: style.base[0] ?? 'FOLLOW', priority: 0, hold: 3, time: 0, side: 1, focus: null, slowmo: 1, slowmoTime: 0 };
    if (events) this.offs.push(events.onAny((e) => this.onEvent(e)));
  }

  get mode(): CameraMode {
    return this.shot.mode;
  }

  /** Deterministic pseudo-random in [0,1) (keeps recordings reproducible). */
  private rand(): number {
    this.seq = (this.seq * 1664525 + 1013904223) >>> 0;
    return this.seq / 4294967296;
  }

  setStyle(style: DirectorStyle): void {
    this.style = style;
    this.baseIdx = 0;
    this.request(style.base[0] ?? 'FOLLOW', 0, 3, 'style', true);
  }

  /** Forces a shot (scripted video events / tests). */
  request(mode: CameraMode, priority: number, hold: number, cause: string, cut = false, focus: CameraShotFocus = null, slowmo = 1, slowmoTime = 0): boolean {
    if (this.shot.priority > priority && this.shot.time < this.shot.hold) return false;
    const side: 1 | -1 = this.rand() < 0.5 ? 1 : -1;
    this.shot = { mode, priority, hold, time: 0, side, focus, slowmo: this.style.allowSlowmo ? slowmo : 1, slowmoTime };
    if (cut) this.cutPending = true;
    this.log.push({ t: this.clock, mode, cause });
    return true;
  }

  onEvent(e: GameEvent, subject?: CameraSubject): void {
    if (!this.enabled) return;
    for (const r of this.style.rules) {
      if (r.event !== e.type) continue;
      const cd = this.cooldowns.get(r) ?? -99;
      if (r.cooldown && this.clock - cd < r.cooldown) continue;
      if (r.chance !== undefined && this.rand() > r.chance) continue;
      const subj = subject ?? this.lastSubject;
      if (r.when && subj && !r.when(e, subj)) continue;
      const pos = (e.payload as { pos?: { x: number; y: number; z: number } }).pos ?? null;
      if (this.request(r.mode, r.priority, r.hold, e.type, r.cut ?? false, pos, r.slowmo ?? 1, r.slowmoTime ?? r.hold)) {
        this.cooldowns.set(r, this.clock);
      }
      break;
    }
  }

  /** Advances the director by real (wall/video) time `dt` and returns the pose. */
  update(s: CameraSubject, dt: number): CameraPose {
    this.clock += dt;
    this.lastSubject = s;
    const sh = this.shot;
    sh.time += dt;
    // slow motion envelope
    if (sh.slowmo < 1 && sh.time < sh.slowmoTime) {
      const k = sh.time / Math.max(0.01, sh.slowmoTime);
      // ease back to real time over the last 30 %
      this.timeScale = k < 0.7 ? sh.slowmo : lerp(sh.slowmo, 1, (k - 0.7) / 0.3);
    } else this.timeScale = 1;

    // shot expiry → base coverage rotation
    if (sh.time >= sh.hold) {
      this.baseTimer -= dt;
      if (sh.priority > 0 || this.baseTimer <= 0) {
        const list = s.enemy?.chasing && this.style.chaseBase.length ? this.style.chaseBase : this.style.base;
        if (sh.priority > 0) this.baseIdx = 0;
        else this.baseIdx = (this.baseIdx + 1) % list.length;
        const [a, b] = this.style.baseShot;
        this.baseTimer = a + (b - a) * this.rand();
        this.request(list[this.baseIdx % list.length], 0, this.baseTimer, 'coverage', this.rand() < this.style.cutChance);
      }
    }

    const target = this.computeShot(this.shot, s);
    // keep the camera above the floor
    target.y = Math.max(target.y, s.groundY + 0.35);
    if (this.cutPending) {
      Object.assign(this.pose, target);
      for (const k of Object.keys(this.vel) as Array<keyof typeof this.vel>) this.vel[k].v = 0;
      this.cutPending = false;
      return this.pose;
    }
    const st = this.smoothTime(this.shot.mode);
    const p = this.pose;
    p.x = smoothDamp(p.x, target.x, this.vel.x, st, dt);
    p.y = smoothDamp(p.y, target.y, this.vel.y, st, dt);
    p.z = smoothDamp(p.z, target.z, this.vel.z, st, dt);
    p.tx = smoothDamp(p.tx, target.tx, this.vel.tx, st * 0.6, dt);
    p.ty = smoothDamp(p.ty, target.ty, this.vel.ty, st * 0.6, dt);
    p.tz = smoothDamp(p.tz, target.tz, this.vel.tz, st * 0.6, dt);
    p.fov = smoothDamp(p.fov, target.fov, this.vel.fov, 0.3, dt);
    p.roll = lerp(p.roll, target.roll, clamp(dt * 4, 0, 1));
    return p;
  }

  private smoothTime(m: CameraMode): number {
    switch (m) {
      case 'FOLLOW':
      case 'BACK':
        return 0.14;
      case 'CHASE':
      case 'FRONT':
        return 0.2;
      case 'IMPACT':
        return 0.08;
      case 'SLOW':
      case 'DRAMATIC':
      case 'FINISH':
        return 0.45;
      default:
        return 0.3;
    }
  }

  /** Ideal pose for a shot (before smoothing). */
  computeShot(sh: ActiveShot, s: CameraSubject): CameraPose {
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const rx = -fz;
    const rz = fx;
    const P = this.portrait;
    const side = sh.side;
    const out: CameraPose = { x: 0, y: 0, z: 0, tx: s.x, ty: s.y + 1, tz: s.z, fov: P ? 70 : 60, roll: 0 };
    const at = (f: number, r: number, u: number) => {
      out.x = s.x + fx * f + rx * r;
      out.y = s.y + u;
      out.z = s.z + fz * f + rz * r;
    };
    const look = (f: number, r: number, u: number) => {
      out.tx = s.x + fx * f + rx * r;
      out.ty = s.y + u;
      out.tz = s.z + fz * f + rz * r;
    };
    const k = clamp(sh.time / Math.max(0.01, sh.hold), 0, 1);
    switch (sh.mode) {
      case 'FOLLOW':
        at(P ? -8.5 : -7.2, 0, P ? 4.6 : 3.7);
        look(P ? 3 : 4.5, 0, 1.1);
        break;
      case 'BACK':
        at(-4.2, 0.6, 1.7);
        look(7, 0, 1.3);
        out.fov = P ? 74 : 66;
        break;
      case 'SIDE':
        at(1.2, side * (P ? 7.5 : 9), 2.2);
        look(1.6, 0, 1.1);
        out.fov = P ? 62 : 50;
        break;
      case 'FRONT':
        at(P ? 6.5 : 6, side * 0.8, 2.1);
        look(-3, 0, 1.2);
        out.fov = P ? 68 : 56;
        break;
      case 'TOP':
        at(-3, 0, 15);
        look(3, 0, 0);
        out.fov = 55;
        break;
      case 'LOW':
        at(-2.8, side * 1.4, 0.35);
        look(3, 0, 1.9);
        out.fov = 72;
        break;
      case 'WIDE': {
        const e = s.enemy && s.enemy.visible ? s.enemy : null;
        const mx = e ? (s.x + e.x) / 2 : s.x + fx * 6;
        const my = e ? (s.y + e.y) / 2 + 1 : s.y + 1;
        const mz = e ? (s.z + e.z) / 2 : s.z + fz * 6;
        const span = e ? Math.hypot(e.x - s.x, e.z - s.z) : 10;
        const dist = Math.max(14, span * 1.1) * (P ? 1.25 : 1);
        out.x = mx + rx * side * dist - fx * 5;
        out.y = my + 7 + span * 0.15;
        out.z = mz + rz * side * dist - fz * 5;
        out.tx = mx;
        out.ty = my;
        out.tz = mz;
        out.fov = 52;
        break;
      }
      case 'CLOSE':
        at(2.3, side * 0.7, 1.35);
        look(0, 0, 1.0);
        out.fov = P ? 50 : 40;
        break;
      case 'CHASE': {
        const e = s.enemy && s.enemy.visible ? s.enemy : null;
        at(P ? 5.5 : 5, side * (P ? 1.8 : 2.6), 2.3);
        if (e) {
          out.tx = lerp(s.x, e.x, 0.4);
          out.ty = lerp(s.y + 1.2, e.y + 2.5, 0.4);
          out.tz = lerp(s.z, e.z, 0.4);
        } else look(-4, 0, 1.4);
        out.fov = P ? 74 : 62;
        break;
      }
      case 'DRAMATIC': {
        const dolly = lerp(5, 3.2, k);
        at(-1.5, side * dolly, 1.2);
        look(0.5, 0, 1.0);
        out.fov = lerp(48, 36, k);
        out.roll = 0.07 * side;
        break;
      }
      case 'IMPACT': {
        const f = sh.focus ?? { x: s.x, y: s.y, z: s.z };
        const dx = f.x - s.x;
        const dz = f.z - s.z;
        const d = Math.hypot(dx, dz);
        // frame both the player and the impact point
        const mx = (s.x + f.x) / 2;
        const mz = (s.z + f.z) / 2;
        out.x = mx + rx * side * (5 + d * 0.5) - fx * 2;
        out.y = Math.max(s.y, f.y) + 2.5;
        out.z = mz + rz * side * (5 + d * 0.5) - fz * 2;
        out.tx = mx;
        out.ty = (s.y + f.y) / 2 + 0.8;
        out.tz = mz;
        out.fov = 46;
        break;
      }
      case 'SLOW': {
        const a = sh.time * 0.9 * side - Math.PI / 2;
        out.x = s.x + (Math.cos(a) * rx + Math.sin(a) * fx) * 5;
        out.z = s.z + (Math.cos(a) * rz + Math.sin(a) * fz) * 5;
        out.y = s.y + 1.4;
        look(0, 0, 0.8);
        out.fov = 50;
        break;
      }
      case 'FINISH':
        at(lerp(5, 3, k), side * lerp(2, 4, k), lerp(1.5, 5.5, k));
        look(0, 0, lerp(1.2, 0.8, k));
        out.fov = 55;
        break;
    }
    return out;
  }

  dispose(): void {
    for (const o of this.offs) o();
  }
}

export type CameraShotFocus = { x: number; y: number; z: number } | null;

