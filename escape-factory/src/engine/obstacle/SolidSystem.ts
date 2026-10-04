/**
 * Creates colliders for every solid piece and animates the dynamic ones
 * (moving platforms, doors, pushers, vanishing / collapsing floors).
 */
import type { AABB } from '../core/math';
import type { LevelData, SolidPiece } from '../level/types';
import type { Collider, PhysicsWorld } from '../physics/PhysicsWorld';
import type { SimContext } from '../sim/SimContext';
import type { TriggerSystem } from '../sim/TriggerSystem';
import { cycleVanish, evalMotion, type Offset } from './motion';

export type SolidState = 'solid' | 'shaking' | 'falling' | 'gone';

export interface DynamicSolid {
  piece: SolidPiece;
  collider: Collider;
  base: AABB;
  ox: number;
  oy: number;
  oz: number;
  state: SolidState;
  stateT: number;
  /** visual fall offset (negative y) */
  fallY: number;
  fallV: number;
  /** 0..1 shake intensity for the renderer */
  warn: number;
  broken: boolean;
}

const off: Offset = { x: 0, y: 0, z: 0 };

export class SolidSystem {
  readonly dynamics: DynamicSolid[] = [];
  private readonly byPiece = new Map<number, DynamicSolid>();
  private readonly staticByPiece = new Map<number, Collider>();
  private readonly collapseAnnounced = new Set<number>();

  constructor(
    level: LevelData,
    physics: PhysicsWorld,
    private readonly triggers: TriggerSystem,
  ) {
    for (const p of level.pieces) {
      if (p.type !== 'solid') continue;
      const opts = {
        surface: p.surface,
        conveyorX: p.conveyor?.x ?? 0,
        conveyorZ: p.conveyor?.z ?? 0,
        owner: p.id,
      };
      if (p.motion || p.vanish || p.breakable) {
        const collider = p.motion ? physics.addKinematic(p.box, opts) : physics.addStatic(p.box, opts);
        const d: DynamicSolid = {
          piece: p,
          collider,
          base: { ...p.box },
          ox: 0,
          oy: 0,
          oz: 0,
          state: 'solid',
          stateT: 0,
          fallY: 0,
          fallV: 0,
          warn: 0,
          broken: false,
        };
        this.dynamics.push(d);
        this.byPiece.set(p.id, d);
      } else {
        this.staticByPiece.set(p.id, physics.addStatic(p.box, opts));
      }
    }
  }

  get(pieceId: number): DynamicSolid | undefined {
    return this.byPiece.get(pieceId);
  }

  colliderOf(pieceId: number): Collider | undefined {
    return this.byPiece.get(pieceId)?.collider ?? this.staticByPiece.get(pieceId);
  }

  update(ctx: SimContext): void {
    const t = ctx.time;
    const dt = ctx.dt;
    const ground = ctx.player.body.grounded ? ctx.player.body.ground : null;
    const physics = ctx.physics;
    for (const d of this.dynamics) {
      const p = d.piece;
      // --- motion
      if (p.motion) {
        const trig = p.motion.kind === 'trigger' ? this.triggers.firedAt(p.motion.triggerId) : null;
        evalMotion(p.motion, t, trig, off);
        d.ox = off.x;
        d.oy = off.y;
        d.oz = off.z;
        physics.moveKinematic(d.collider, d.base.minX + off.x, d.base.minY + off.y + d.fallY, d.base.minZ + off.z);
      }
      // --- vanish
      const v = p.vanish;
      if (v) {
        if (v.kind === 'cycle') {
          const c = cycleVanish(v, t);
          d.warn = c.warn;
          d.state = c.solid ? (c.warn > 0 ? 'shaking' : 'solid') : 'gone';
          d.collider.enabled = c.solid && !d.broken;
        } else if (v.kind === 'step') {
          if (d.state === 'solid' && ground === d.collider) {
            d.state = 'shaking';
            d.stateT = t;
            ctx.events.emit('TRAP_TRIGGER', { pos: center(d), kind: p.style, id: p.id });
          } else if (d.state === 'shaking') {
            d.warn = Math.min(1, (t - d.stateT) / Math.max(0.05, v.delay));
            if (t - d.stateT >= v.delay) this.startFall(d, t, ctx, false);
          } else if (d.state === 'falling' || d.state === 'gone') {
            this.animateFall(d, dt);
            if (v.respawn > 0 && t - d.stateT > v.respawn) this.restore(d);
          }
        } else if (v.kind === 'trigger') {
          const ft = this.triggers.firedAt(v.triggerId);
          if (ft !== null && (d.state === 'solid' || d.state === 'shaking')) {
            const local = t - ft - v.delay;
            if (local >= 0) {
              this.startFall(d, t, ctx, true);
              if (!this.collapseAnnounced.has(v.triggerId)) {
                this.collapseAnnounced.add(v.triggerId);
                ctx.events.emit('FLOOR_COLLAPSE', { pos: center(d), id: p.id });
              }
            } else if (local > -0.45) {
              d.state = 'shaking';
              d.warn = 1 + local / 0.45;
            }
          } else if (d.state === 'falling' || d.state === 'gone') {
            this.animateFall(d, dt);
          }
        }
      }
    }
  }

  private startFall(d: DynamicSolid, t: number, ctx: SimContext, collapse: boolean): void {
    d.state = 'falling';
    d.stateT = t;
    d.fallV = 0;
    d.warn = 0;
    d.collider.enabled = false;
    if (!collapse) ctx.events.emit('PLATFORM_FALL', { pos: center(d), id: d.piece.id });
  }

  private animateFall(d: DynamicSolid, dt: number): void {
    if (d.fallY > -40) {
      d.fallV -= 25 * dt;
      d.fallY += d.fallV * dt;
    } else d.state = 'gone';
  }

  private restore(d: DynamicSolid): void {
    d.state = 'solid';
    d.fallY = 0;
    d.fallV = 0;
    d.warn = 0;
    d.broken = false;
    d.collider.enabled = true;
    if (!d.piece.motion) {
      // static collider: restore its box (it never moved)
      d.collider.minY = d.base.minY;
      d.collider.maxY = d.base.maxY;
    }
  }

  /** The enemy smashes a breakable piece. */
  breakPiece(pieceId: number): boolean {
    const d = this.byPiece.get(pieceId);
    if (!d || d.broken || !d.piece.breakable) return false;
    d.broken = true;
    d.collider.enabled = false;
    return true;
  }

  /** Restores vanished / broken pieces in modules >= `fromModule` (respawn). */
  resetFromModule(fromModule: number): void {
    for (const d of this.dynamics) {
      if (d.piece.module < fromModule) continue;
      if (d.piece.vanish?.kind === 'cycle') {
        d.broken = false;
        continue;
      }
      this.restore(d);
    }
    for (const id of [...this.collapseAnnounced]) this.collapseAnnounced.delete(id);
  }

  // ---- prediction (bot) --------------------------------------------------

  /** Predicted world box of a piece at future time t, or null if it won't be solid. */
  predictBox(pieceId: number, t: number, out: AABB): AABB | null {
    const d = this.byPiece.get(pieceId);
    if (!d) {
      const c = this.staticByPiece.get(pieceId);
      if (!c) return null;
      out.minX = c.minX;
      out.minY = c.minY;
      out.minZ = c.minZ;
      out.maxX = c.maxX;
      out.maxY = c.maxY;
      out.maxZ = c.maxZ;
      return out;
    }
    if (!this.predictSolid(d, t)) return null;
    const p = d.piece;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (p.motion) {
      const trig = p.motion.kind === 'trigger' ? this.triggers.firedAt(p.motion.triggerId) : null;
      evalMotion(p.motion, t, trig, off);
      ox = off.x;
      oy = off.y;
      oz = off.z;
    }
    out.minX = d.base.minX + ox;
    out.maxX = d.base.maxX + ox;
    out.minY = d.base.minY + oy;
    out.maxY = d.base.maxY + oy;
    out.minZ = d.base.minZ + oz;
    out.maxZ = d.base.maxZ + oz;
    return out;
  }

  private predictSolid(d: DynamicSolid, t: number): boolean {
    if (d.broken) return false;
    const v = d.piece.vanish;
    if (!v) return true;
    if (v.kind === 'cycle') return cycleVanish(v, t).solid;
    if (v.kind === 'step') {
      if (d.state === 'falling' || d.state === 'gone') return false;
      if (d.state === 'shaking') return t < d.stateT + v.delay;
      return true;
    }
    const ft = this.triggers.firedAt(v.triggerId);
    if (d.state === 'falling' || d.state === 'gone') return false;
    return ft === null || t < ft + v.delay;
  }
}

function center(d: DynamicSolid) {
  const c = d.collider;
  return { x: (c.minX + c.maxX) / 2, y: c.maxY, z: (c.minZ + c.maxZ) / 2 };
}
