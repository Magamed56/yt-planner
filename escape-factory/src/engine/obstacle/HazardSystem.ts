/**
 * Runtime for all hazards: hit tests against the player, near-miss detection
 * (PLAYER_NEAR_DEATH), event emission for camera/sound, and pure danger
 * prediction for the bot.
 */
import type { AABB } from '../core/math';
import type { HazardPiece, LevelData } from '../level/types';
import type { SimContext } from '../sim/SimContext';
import type { TriggerSystem } from '../sim/TriggerSystem';
import type { HazardSpec } from './hazardTypes';
import {
  CRUSHER_IMPACT_U,
  crusherState,
  fallerState,
  hazardCenter,
  hazardHit,
  laserState,
  slamLaneState,
} from './hazardEval';

export interface HazardRuntime {
  id: number;
  piece: HazardPiece;
  spec: HazardSpec;
  cx: number;
  cy: number;
  cz: number;
  /** previous phase key for transition events */
  last: string;
  nearCooldown: number;
  hitCooldown: number;
}

const EVENT_RADIUS = 38;
const tmpBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

export class HazardSystem {
  readonly list: HazardRuntime[] = [];
  private readonly byId = new Map<number, HazardRuntime>();
  /** number of hazard hits that resulted in death (stats) */
  kills = 0;

  constructor(
    level: LevelData,
    private readonly triggers: TriggerSystem,
  ) {
    for (const p of level.pieces) {
      if (p.type !== 'hazard') continue;
      const c = hazardCenter(p.hazard);
      const r: HazardRuntime = {
        id: p.id,
        piece: p,
        spec: p.hazard,
        cx: c.x,
        cy: c.y,
        cz: c.z,
        last: '',
        nearCooldown: 0,
        hitCooldown: 0,
      };
      this.list.push(r);
      this.byId.set(p.id, r);
    }
  }

  get(id: number): HazardRuntime | undefined {
    return this.byId.get(id);
  }

  /** Hazard-local time or null when the hazard's trigger hasn't fired. */
  localTime(spec: HazardSpec, t: number): number | null {
    if (spec.endTriggerId !== undefined) {
      const end = this.triggers.firedAt(spec.endTriggerId);
      if (end !== null && t >= end) return null;
    }
    if (spec.triggerId === undefined) return t;
    const ft = this.triggers.firedAt(spec.triggerId);
    return ft === null ? null : t - ft;
  }

  update(ctx: SimContext): void {
    const t = ctx.time;
    const pl = ctx.player;
    const alive = pl.isControllable;
    const box = pl.body.bounds(tmpBox);
    const px = pl.body.x;
    const pz = pl.body.z;
    for (const h of this.list) {
      h.nearCooldown = Math.max(0, h.nearCooldown - ctx.dt);
      h.hitCooldown = Math.max(0, h.hitCooldown - ctx.dt);
      const lt = this.localTime(h.spec, t);
      if (lt === null) continue;
      const dist = Math.hypot(h.cx - px, h.cz - pz);
      if (dist > EVENT_RADIUS) continue;
      this.emitTransitions(h, lt, ctx);
      const hitRadius = h.spec.kind === 'roller' || h.spec.kind === 'slam' || h.spec.kind === 'zone' ? EVENT_RADIUS : 14;
      if (!alive || dist > hitRadius) continue;
      const hit = hazardHit(h.spec, lt, box, 0);
      if (hit) {
        if (hit.lethal) {
          this.kills++;
          ctx.killPlayer(hit.cause);
        } else if (h.hitCooldown <= 0) {
          h.hitCooldown = 0.6;
          ctx.events.emit('SPINNER_HIT', { pos: { x: px, y: pl.body.y, z: pz }, id: h.id });
          ctx.events.emit('PLAYER_HIT', { pos: { x: px, y: pl.body.y, z: pz }, cause: h.spec.kind });
          ctx.knockPlayer(hit.pushX, hit.pushZ, 9);
        }
        continue;
      }
      // near miss: expanded box or slightly shifted time would have hit
      // near misses only count while the player is moving through danger (not waiting)
      const moving = !pl.body.grounded || pl.speed > 2.5;
      if (h.nearCooldown <= 0 && moving) {
        // a near miss: slightly bigger, or a split second later, and it would have hit
        const near = hazardHit(h.spec, lt, box, 0.3) !== null || hazardHit(h.spec, lt + 0.15, box, 0) !== null;
        if (near) {
          h.nearCooldown = 2;
          ctx.events.emit('PLAYER_NEAR_DEATH', {
            pos: { x: px, y: pl.body.y, z: pz },
            cause: h.spec.kind,
            margin: 0.3,
          });
        }
      }
    }
  }

  private emitTransitions(h: HazardRuntime, lt: number, ctx: SimContext): void {
    const s = h.spec;
    const pos = { x: h.cx, y: h.cy, z: h.cz };
    let key = '';
    switch (s.kind) {
      case 'crusher': {
        const st = crusherState(s, lt);
        key = st.u >= CRUSHER_IMPACT_U && st.phase === 'hold' ? 'impact' : st.phase;
        if (key === 'impact' && h.last !== 'impact') ctx.events.emit('CRUSHER_SLAM', { pos, id: h.id });
        break;
      }
      case 'laser': {
        key = laserState(s, lt).on ? 'on' : 'off';
        if (key === 'on' && h.last === 'off') ctx.events.emit('LASER_ON', { pos, id: h.id });
        break;
      }
      case 'faller': {
        const st = fallerState(s, lt);
        key = st.phase;
        if (key === 'drop' && h.last !== 'drop') ctx.events.emit('FALLING_OBJECT', { pos, id: h.id });
        if (key === 'rest' && h.last === 'drop')
          ctx.events.emit('OBSTACLE_BREAK', { pos: { x: s.x, y: s.floorY, z: s.z }, kind: 'crate' });
        break;
      }
      case 'slam': {
        let warnLane = -1;
        let activeLane = -1;
        for (let i = 0; i < s.lanes.length; i++) {
          const ph = slamLaneState(s, i, lt).phase;
          if (ph === 'warn') warnLane = i;
          if (ph === 'active') activeLane = i;
        }
        key = `${warnLane}:${activeLane}`;
        if (warnLane >= 0 && !h.last.startsWith(`${warnLane}:`))
          ctx.events.emit('BOSS_ATTACK', { pos, kind: 'slam', lane: warnLane });
        if (activeLane >= 0 && !h.last.endsWith(`:${activeLane}`)) {
          const l = s.lanes[activeLane];
          ctx.events.emit('OBSTACLE_BREAK', {
            pos: { x: (l.minX + l.maxX) / 2, y: s.floorY, z: (l.minZ + l.maxZ) / 2 },
            kind: 'slam',
          });
        }
        break;
      }
      default:
        key = '';
    }
    h.last = key;
  }

  /** Predicts whether hazard `id` would hit `box` at future time t (bot). */
  dangerAt(id: number, t: number, box: AABB, margin = 0.1): boolean {
    const h = this.byId.get(id);
    if (!h) return false;
    const lt = this.localTime(h.spec, t);
    if (lt === null) return false;
    const hit = hazardHit(h.spec, lt, box, margin);
    return hit !== null;
  }

  /** Any hazard (within radius of the box) dangerous at time t. */
  anyDangerAt(t: number, box: AABB, margin = 0.1, radius = 12): HazardRuntime | null {
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    for (const h of this.list) {
      if (Math.abs(h.cx - cx) > radius + 8 || Math.abs(h.cz - cz) > radius + 8) continue;
      const lt = this.localTime(h.spec, t);
      if (lt === null) continue;
      if (hazardHit(h.spec, lt, box, margin)) return h;
    }
    return null;
  }
}
