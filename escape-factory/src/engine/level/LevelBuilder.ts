/**
 * LevelBuilder — authoring helper used by module generators. All coordinates
 * are module-local: lx = right, ly = up (relative to entry floor height),
 * lz = forward from the module entry. The builder converts to world space,
 * allocates ids and accumulates spine points / nav hints.
 */
import type { AABB } from '../core/math';
import type { HazardSpec } from '../obstacle/hazardTypes';
import type {
  CheckpointPiece,
  CoinPiece,
  DecorPiece,
  FinishPiece,
  Frame,
  HazardPiece,
  MotionSpec,
  NavHint,
  Piece,
  SolidPiece,
  SpinePoint,
  SurfaceType,
  TriggerAction,
  TriggerPiece,
  VanishSpec,
} from './types';
import { localBoxToWorld, localDirToWorld, localToWorld } from './types';

export interface SolidOpts {
  style?: string;
  surface?: SurfaceType;
  /** local conveyor velocity (lx, lz) */
  conveyor?: { lx: number; lz: number };
  /** local motion amplitude vector */
  motion?: LocalMotion;
  vanish?: VanishSpec;
  breakable?: boolean;
  walkable?: boolean;
}

export type LocalMotion =
  | { kind: 'sine'; lx: number; ly: number; lz: number; period: number; phase: number }
  | { kind: 'pingpong'; lx: number; ly: number; lz: number; period: number; phase: number; hold: number }
  | { kind: 'trigger'; lx: number; ly: number; lz: number; duration: number; delay: number; triggerId: number };

export interface BuilderMark {
  pieces: number;
  spine: number;
  hints: number;
  checkpoints: number;
  finish: FinishPiece | null;
  minY: number;
  nextId: number;
  lastSpine: SpinePoint | null;
}

export class LevelBuilder {
  readonly pieces: Piece[] = [];
  readonly spine: SpinePoint[] = [];
  readonly hints: NavHint[] = [];
  readonly checkpoints: CheckpointPiece[] = [];
  finish: FinishPiece | null = null;
  frame: Frame = { x: 0, y: 0, z: 0, dir: 0 };
  module = 0;
  /** spine distance at the current module entry */
  s0 = 0;
  minY = 0;
  private nextId = 1;

  id(): number {
    return this.nextId++;
  }

  /** Snapshot for rollback (used when a module overlaps earlier geometry). */
  mark(): BuilderMark {
    return {
      pieces: this.pieces.length,
      spine: this.spine.length,
      hints: this.hints.length,
      checkpoints: this.checkpoints.length,
      finish: this.finish,
      minY: this.minY,
      nextId: this.nextId,
      lastSpine: this.spine.length ? { ...this.spine[this.spine.length - 1] } : null,
    };
  }

  rollback(m: BuilderMark): void {
    this.pieces.length = m.pieces;
    this.spine.length = m.spine;
    if (m.lastSpine && this.spine.length) this.spine[this.spine.length - 1] = m.lastSpine;
    this.hints.length = m.hints;
    this.checkpoints.length = m.checkpoints;
    this.finish = m.finish;
    this.minY = m.minY;
    this.nextId = m.nextId;
  }

  /** XZ footprint of walkable/solid pieces added since `m`. */
  footprintSince(m: BuilderMark): AABB | null {
    let fp: AABB | null = null;
    for (let i = m.pieces; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (p.type !== 'solid') continue;
      const b = p.box;
      if (!fp) fp = { ...b };
      else {
        fp.minX = Math.min(fp.minX, b.minX);
        fp.minY = Math.min(fp.minY, b.minY);
        fp.minZ = Math.min(fp.minZ, b.minZ);
        fp.maxX = Math.max(fp.maxX, b.maxX);
        fp.maxY = Math.max(fp.maxY, b.maxY);
        fp.maxZ = Math.max(fp.maxZ, b.maxZ);
      }
    }
    return fp;
  }

  begin(frame: Frame, module: number): void {
    this.frame = { ...frame };
    this.module = module;
    this.s0 = this.spine.length ? this.spine[this.spine.length - 1].s : 0;
  }

  /** Spine distance of a local forward offset — valid for straight modules. */
  sAt(lz: number): number {
    return this.s0 + lz;
  }

  w(lx: number, ly: number, lz: number) {
    return localToWorld(this.frame, lx, ly, lz);
  }

  box(lx0: number, lx1: number, ly0: number, ly1: number, lz0: number, lz1: number): AABB {
    return localBoxToWorld(this.frame, lx0, lx1, ly0, ly1, lz0, lz1);
  }

  private motionToWorld(m: LocalMotion): MotionSpec {
    const v = localDirToWorld(this.frame.dir, m.lx, m.ly, m.lz);
    if (m.kind === 'sine') return { kind: 'sine', ax: v.x, ay: v.y, az: v.z, period: m.period, phase: m.phase };
    if (m.kind === 'pingpong')
      return { kind: 'pingpong', ax: v.x, ay: v.y, az: v.z, period: m.period, phase: m.phase, hold: m.hold };
    return { kind: 'trigger', ax: v.x, ay: v.y, az: v.z, duration: m.duration, delay: m.delay, triggerId: m.triggerId };
  }

  solid(lx0: number, lx1: number, ly0: number, ly1: number, lz0: number, lz1: number, o: SolidOpts = {}): SolidPiece {
    const p: SolidPiece = {
      type: 'solid',
      id: this.id(),
      module: this.module,
      box: this.box(lx0, lx1, ly0, ly1, lz0, lz1),
      style: o.style ?? 'floor',
      surface: o.surface ?? 'default',
    };
    if (o.conveyor) {
      const v = localDirToWorld(this.frame.dir, o.conveyor.lx, 0, o.conveyor.lz);
      p.conveyor = { x: v.x, z: v.z };
      p.surface = 'conveyor';
    }
    if (o.motion) p.motion = this.motionToWorld(o.motion);
    if (o.vanish) p.vanish = o.vanish;
    if (o.breakable) p.breakable = true;
    if (o.walkable ?? (o.style === undefined || /floor|platform|bridge|conveyor|grate|trap|tile/.test(o.style)))
      p.walkable = true;
    this.minY = Math.min(this.minY, this.frame.y + ly1);
    this.pieces.push(p);
    return p;
  }

  /** Walkable slab whose top is at local height `top` (1 m thick). */
  floor(lx0: number, lx1: number, lz0: number, lz1: number, top = 0, o: SolidOpts = {}): SolidPiece {
    return this.solid(lx0, lx1, top - 1, top, lz0, lz1, { style: 'floor', walkable: true, ...o });
  }

  hazard(spec: HazardSpec): HazardPiece {
    const p: HazardPiece = { type: 'hazard', id: this.id(), module: this.module, hazard: spec };
    this.pieces.push(p);
    return p;
  }

  trigger(s: number, action: TriggerAction): TriggerPiece {
    const id = this.id();
    const p: TriggerPiece = { type: 'trigger', id, module: this.module, s, action, triggerId: id };
    this.pieces.push(p);
    return p;
  }

  checkpoint(lz: number, lx = 0, ly = 0): CheckpointPiece {
    const w = this.w(lx, ly, lz);
    const p: CheckpointPiece = {
      type: 'checkpoint',
      id: this.id(),
      module: this.module,
      index: this.checkpoints.length,
      x: w.x,
      y: w.y,
      z: w.z,
      dir: this.frame.dir,
      s: this.sAt(lz),
    };
    this.pieces.push(p);
    this.checkpoints.push(p);
    return p;
  }

  coin(lx: number, ly: number, lz: number): CoinPiece {
    const w = this.w(lx, ly, lz);
    const p: CoinPiece = { type: 'coin', id: this.id(), module: this.module, x: w.x, y: w.y, z: w.z };
    this.pieces.push(p);
    return p;
  }

  decor(kind: string, lx: number, ly: number, lz: number, rotY = 0, scale = 1, variant = 0): DecorPiece {
    const w = this.w(lx, ly, lz);
    const p: DecorPiece = {
      type: 'decor',
      id: this.id(),
      module: this.module,
      kind,
      x: w.x,
      y: w.y,
      z: w.z,
      rotY: rotY + (this.frame.dir * Math.PI) / 2,
      scale,
      variant,
    };
    this.pieces.push(p);
    return p;
  }

  setFinish(lx0: number, lx1: number, lz0: number, lz1: number): FinishPiece {
    const w = this.w(0, 0, (lz0 + lz1) / 2);
    const p: FinishPiece = {
      type: 'finish',
      id: this.id(),
      module: this.module,
      box: this.box(lx0, lx1, 0, 4, lz0, lz1),
      x: w.x,
      y: w.y,
      z: w.z,
      dir: this.frame.dir,
      s: this.sAt((lz0 + lz1) / 2),
    };
    this.pieces.push(p);
    this.finish = p;
    return p;
  }

  /** Appends a spine point at local coords (s accumulates XZ distance). */
  spinePoint(lx: number, ly: number, lz: number, halfWidth: number, gap = false): SpinePoint {
    const w = this.w(lx, ly, lz);
    const prev = this.spine[this.spine.length - 1];
    const s = prev ? prev.s + Math.hypot(w.x - prev.x, w.z - prev.z) : 0;
    if (prev && s - prev.s < 1e-6) {
      // same point: just update flags
      prev.gap = prev.gap && gap;
      prev.halfWidth = Math.min(prev.halfWidth, halfWidth);
      return prev;
    }
    const p: SpinePoint = { x: w.x, y: w.y, z: w.z, s, halfWidth, gap };
    this.spine.push(p);
    return p;
  }

  hint(h: NavHint): void {
    this.hints.push(h);
  }

  /** World-space helpers for hazard specs. */
  wx(lx: number, lz: number): { x: number; z: number } {
    const w = this.w(lx, 0, lz);
    return { x: w.x, z: w.z };
  }
}
