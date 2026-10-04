/**
 * BotController — an InputSource that plays any generated level.
 *
 * It follows the generator's navigation hints (jumps, lanes, timing gates,
 * rides, door choices, arenas), predicts hazards with the Predictor, and makes
 * human-like mistakes driven by its BotProfile (mistakeChance, reactionTime,
 * riskLevel, aggression, speed) plus optional scripted mistakes for takes.
 */
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { InputSource, InputState } from '../input/InputState';
import type { NavHint } from '../level/types';
import type { World } from '../sim/World';
import type { BotProfile, ForcedMistake } from './BotProfile';
import { Predictor, type TraversalPlan } from './Predictor';

type JumpHint = Extract<NavHint, { kind: 'jump' }>;
type GateHint = Extract<NavHint, { kind: 'gate' }>;
type RideHint = Extract<NavHint, { kind: 'ride' }>;
type ChoiceHint = Extract<NavHint, { kind: 'choice' }>;
type ArenaHint = Extract<NavHint, { kind: 'arena' }>;
type RangeHint = Extract<NavHint, { kind: 'nowait' | 'sprint' }>;
type LaneHint = Extract<NavHint, { kind: 'lane' }>;

interface GateState {
  phase: 'approach' | 'wait' | 'go' | 'done';
  waitSince?: number;
  goTime: number;
  jumpTimes: number[];
  rush: boolean;
  checked: number;
}

interface JumpDecision {
  /** spine offset applied to the ideal take-off (mistakes) */
  offsetS: number;
  skip: boolean;
}

export interface BotStats {
  jumps: number;
  mistakes: number;
  waits: number;
  gatesPassed: number;
  stuck: number;
  givenUp: boolean;
}

const UNSAFE = 1e9;

export class BotController implements InputSource {
  readonly stats: BotStats = { jumps: 0, mistakes: 0, waits: 0, gatesPassed: 0, stuck: 0, givenUp: false };
  private readonly rng: Rng;
  private readonly pred: Predictor;
  private readonly jumps: JumpHint[] = [];
  private readonly gates: GateHint[] = [];
  private readonly rides: RideHint[] = [];
  private readonly choices: ChoiceHint[] = [];
  private readonly arenas: ArenaHint[] = [];
  private readonly lanes: LaneHint[] = [];
  private readonly nowait: RangeHint[] = [];
  private readonly sprint: RangeHint[] = [];
  private readonly gateState = new Map<GateHint, GateState>();
  private readonly jumpDecision = new Map<JumpHint, JumpDecision>();
  private readonly choiceLane = new Map<ChoiceHint, { lateral: number; noticed: boolean; wrongUntil: number }>();
  private readonly forced: ForcedMistake[];
  private arenaLane: number | null = null;
  private arenaNext = 0;
  private arenaSpeed = 1;
  private arenaJumpAt = -1;
  private aim: { landS: number; lateral: number; targetId: number } | null = null;
  private wasGrounded = true;
  private bestS = 0;
  private bestT = 0;
  private unstickUntil = 0;
  private unstickLat = 0;
  private stopUntil = 0;
  private lastPlayerState = '';
  private jumpHeldUntil = 0;
  private lastJumpAt = -99;
  private retreatUntil = 0;
  /** debug info for overlays */
  debug = '';

  constructor(
    private readonly world: World,
    readonly profile: BotProfile,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.pred = new Predictor(world);
    for (const h of world.level.hints) {
      switch (h.kind) {
        case 'jump':
          this.jumps.push(h);
          break;
        case 'gate':
          this.gates.push(h);
          break;
        case 'ride':
          this.rides.push(h);
          break;
        case 'choice':
          this.choices.push(h);
          break;
        case 'arena':
          this.arenas.push(h);
          break;
        case 'lane':
          this.lanes.push(h);
          break;
        case 'nowait':
          this.nowait.push(h);
          break;
        case 'sprint':
          this.sprint.push(h);
          break;
      }
    }
    this.jumps.sort((a, b) => a.s - b.s);
    this.gates.sort((a, b) => a.s0 - b.s0);
    this.forced = [...(profile.forced ?? [])].sort((a, b) => a.atS - b.atS);
  }

  private get skill(): number {
    return 1 - clamp(this.profile.mistakeChance * 3, 0, 1);
  }

  private margin(): number {
    return 0.05 + 0.35 * (1 - this.profile.riskLevel);
  }

  /** after each death the bot "learns": mistakes become rarer on retries */
  private learn = 1;

  private get mistakeChance(): number {
    return this.profile.mistakeChance * this.learn;
  }

  /** Resets per-attempt state after a respawn (mistakes are re-rolled). */
  private respawnWaitUntil = 0;

  private onRespawn(): void {
    this.learn *= 0.6;
    // a short, human-like pause before trying again (also breaks deterministic loops)
    this.respawnWaitUntil = this.world.time + this.rng.range(0.05, 0.9);
    // a scripted mistake that already happened is not repeated on the retry
    if (this.stopUntil !== 0 && this.forced[0]?.kind === 'stop') this.forced.shift();
    this.jumpDecision.clear();
    this.choiceLane.clear();
    this.gateState.clear();
    this.aim = null;
    this.arenaLane = null;
    this.bestT = this.world.time;
    this.bestS = this.world.playerS;
    this.stopUntil = 0;
  }

  sample(out: InputState): void {
    const w = this.world;
    const p = w.player;
    out.jumpPressed = false;
    if (p.state !== this.lastPlayerState) {
      if (p.state === 'run' && (this.lastPlayerState === 'dead' || this.lastPlayerState === 'caught')) this.onRespawn();
      this.lastPlayerState = p.state;
    }
    if (!p.isControllable || w.status !== 'running' || w.time < this.respawnWaitUntil) {
      out.moveX = out.moveZ = 0;
      out.jump = false;
      return;
    }
    const s = w.playerS;
    const t = w.time;
    const b = p.body;
    const grounded = b.grounded;
    if (grounded && !this.wasGrounded) this.aim = null;
    this.wasGrounded = grounded;

    // ---- progress / stuck detection
    if (s > this.bestS + 0.5) {
      this.bestS = s;
      this.bestT = t;
    }
    const waitingSomewhere = [...this.gateState.values()].some((g) => g.phase === 'wait');
    if (!waitingSomewhere && t - this.bestT > 6 && this.unstickUntil < t) {
      this.stats.stuck++;
      this.unstickUntil = t + 1.2;
      this.unstickLat = this.rng.range(-1.5, 1.5);
      this.bestT = t;
    }
    if (t - this.bestT > 40) this.stats.givenUp = true;

    let lateral = 0;
    let speed = clamp(this.profile.speed * (0.88 + 0.12 * this.profile.aggression), 0.4, 1);
    let stopS = Infinity;
    let wantJump = false;
    this.debug = '';

    if (this.inRange(this.sprint, s) || w.enemy?.isChasing) speed = 1;
    // run-up before jumps
    const nextJump = this.nextJumpHint(s);
    if (nextJump && nextJump.s - s < 7) speed = 1;

    // ---- lanes
    const lane = this.lanes.find((h) => s >= h.s0 - 2.5 && s <= h.s1);
    if (lane) lateral = lane.lateral;

    // ---- forced mistakes (scripted takes)
    const fm = this.forced[0];
    let forcedKind: ForcedMistake['kind'] | null = null;
    if (fm && s >= fm.atS - 3) {
      forcedKind = fm.kind;
      if (fm.kind === 'stop' && s >= fm.atS) {
        if (this.stopUntil === 0) this.stopUntil = t + (fm.duration ?? 2.5);
        if (t < this.stopUntil) speed = 0;
        else {
          this.forced.shift();
          this.stopUntil = 0;
        }
      } else if (fm.kind === 'wrongLane' && s >= fm.atS - 3 && s < fm.atS + 3) {
        lateral = -lateral || this.rng.sign() * 1.5;
      } else if (s > fm.atS + 3) this.forced.shift();
    }

    // ---- door choices
    const choice = this.choices.find((h) => s >= h.s0 - 4 && s <= h.s1);
    if (choice) lateral = this.decideChoice(choice, s, t);

    // ---- arenas (boss, falling objects)
    const arena = this.arenas.find((h) => s >= h.s0 - 1 && s <= h.s1);
    if (arena) {
      if (t >= this.arenaNext) this.decideArena(arena, s, t);
      lateral = this.arenaLane ?? lateral;
      speed = Math.min(speed, this.arenaSpeed);
      if (this.arenaJumpAt >= 0 && t >= this.arenaJumpAt) {
        wantJump = true;
        this.arenaJumpAt = -1;
      }
    } else this.arenaLane = null;

    // ---- rides (moving platforms)
    const ground = grounded ? b.ground : null;
    const ride = ground ? this.rides.find((r) => r.pieceId === ground.owner) : undefined;
    let rideTarget: { x: number; z: number } | null = null;
    if (ride && ground) {
      rideTarget = { x: (ground.minX + ground.maxX) / 2, z: (ground.minZ + ground.maxZ) / 2 };
      const exit = this.jumps.find((j) => j.s > ride.s0 && j.targetId !== ride.pieceId);
      if (exit && this.canLand(exit)) wantJump = true;
    }

    // ---- jumps
    if (!rideTarget && nextJump && grounded) {
      const r = this.handleJump(nextJump, s, forcedKind);
      if (r.jump) wantJump = true;
      if (r.stopS < stopS) stopS = r.stopS;
      if (s > nextJump.s - 5) lateral = nextJump.lateral;
    }

    // ---- timing gates
    for (const g of this.gates) {
      if (g.s1 < s - 0.5) continue;
      if (g.s0 > s + 12) break;
      const r = this.handleGate(g, s, t, forcedKind);
      if (r.stopS < stopS) stopS = r.stopS;
      if (r.jump) wantJump = true;
      if (s >= g.s0 - 3) lateral = g.lateral;
      // committed: cross the danger at full speed, exactly as planned
      if (this.gateState.get(g)?.phase === 'go' && s >= g.s0 - 1.5) speed = 1;
      break;
    }

    // ---- fallback: unexpected danger right ahead → hesitate (unless we must keep moving)
    const noWait = this.inRange(this.nowait, s) || (w.enemy?.isChasing ?? false);
    const gateActive = [...this.gateState.entries()].some(([g, st]) => st.phase !== 'done' && s >= g.s0 - 3 && s <= g.s1);
    if (!noWait && !gateActive && stopS === Infinity && grounded && !wantJump) {
      const upcoming = this.jumps.filter((j) => j.s > s - 0.2 && j.s < s + 4).map((j) => j.s);
      const plan: TraversalPlan = { startDelay: 0, lateral, speed, jumpS: upcoming, jumpT: [] };
      const res = this.pred.check(plan, { hazardIds: [], blockerIds: [], supportIds: [], margin: this.margin() * 0.5, untilS: s + 3, horizon: 0.4, anyHazard: true });
      if (!res.safe && this.profile.aggression < 0.98) speed = 0;
    }
    if (noWait) stopS = Infinity;

    // ---- fallback: a real ledge right ahead with no hint → jump
    if (grounded && !wantJump && !rideTarget && stopS === Infinity && b.vx * b.vx + b.vz * b.vz > 9 && !this.jumps.some((j) => j.s > s - 1 && j.s < s + 5)) {
      const sp = Math.hypot(b.vx, b.vz);
      const ax = b.x + (b.vx / sp) * 0.9;
      const az = b.z + (b.vz / sp) * 0.9;
      if (!w.physics.groundBelow(ax, az, b.y + 0.3, 1.6, 0.1)) wantJump = true;
    }

    // ---- unstick
    if (t < this.unstickUntil) {
      lateral = this.unstickLat;
      if (grounded && t - this.lastJumpAt > 0.6) wantJump = true;
      stopS = Infinity;
      speed = 1;
    }

    // ---- braking toward stop point
    if (stopS < Infinity) {
      const dist = stopS - s;
      const vAllowed = Math.sqrt(Math.max(0, 2 * p.stats.decel * 0.7 * Math.max(0, dist - 0.1)));
      speed = Math.min(speed, vAllowed / p.stats.runSpeed);
      if (dist < 0.05) speed = 0;
    }

    // ---- air control toward the planned landing
    let mx: number;
    let mz: number;
    if (t < this.retreatUntil && grounded) {
      const back = w.track.offsetPoint(Math.max(0, s - 2), lateral);
      const dx = back.x - b.x;
      const dz = back.z - b.z;
      const d = Math.hypot(dx, dz) || 1;
      mx = (dx / d) * 0.6;
      mz = (dz / d) * 0.6;
    } else if (!grounded && this.aim && this.aim.targetId >= 0) {
      const target = this.aimPoint(this.aim);
      const st = p.stats;
      const tLeft = Math.max(0.08, (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * st.gravity * Math.max(0, b.y - target.y)))) / st.gravity);
      let tx = target.x;
      let tz = target.z;
      // keep momentum: only brake if the natural landing would overshoot the target
      const box = this.aim.targetId >= 0 ? w.solids.predictBox(this.aim.targetId, w.time + tLeft, this.tmpBox) : null;
      const d = w.solids.get(this.aim.targetId);
      if (box && !(d && d.piece.motion)) {
        const sp = Math.max(Math.hypot(b.vx, b.vz), st.runSpeed * 0.9);
        const dirx = tx - b.x;
        const dirz = tz - b.z;
        const dl = Math.hypot(dirx, dirz) || 1;
        const nx = b.x + (dirx / dl) * sp * tLeft;
        const nz = b.z + (dirz / dl) * sp * tLeft;
        const m = 0.55;
        tx = clamp(nx, box.minX + m, box.maxX - m);
        tz = clamp(nz, box.minZ + m, box.maxZ - m);
        // stay near the hinted lane
        tx = (tx + target.x) * 0.5 + (tx - target.x) * 0.5;
      }
      const dx = tx - b.x;
      const dz = tz - b.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.min(1, dist / tLeft / st.runSpeed);
      mx = dist > 1e-3 ? (dx / dist) * want : 0;
      mz = dist > 1e-3 ? (dz / dist) * want : 0;
    } else if (rideTarget && !wantJump) {
      const dx = rideTarget.x - b.x;
      const dz = rideTarget.z - b.z;
      const k = clamp(Math.hypot(dx, dz) * 1.5, 0, 1);
      const d = Math.hypot(dx, dz) || 1;
      mx = (dx / d) * k;
      mz = (dz / d) * k;
    } else {
      const look = clamp(1.6 + Math.hypot(b.vx, b.vz) * 0.22, 1.6, 3.4);
      const tp = w.track.offsetPoint(Math.min(w.track.length, s + look), lateral);
      const dx = tp.x - b.x;
      const dz = tp.z - b.z;
      const d = Math.hypot(dx, dz) || 1;
      mx = (dx / d) * speed;
      mz = (dz / d) * speed;
      if (speed <= 0.001) {
        // hold position but correct lateral drift gently
        // hold position along the track but still side-step to the target lane
        const err = lateral - w.playerLateral;
        const side = w.track.sample(s);
        const k = clamp(err * 1.6, -0.75, 0.75);
        mx = side.rx * k;
        mz = side.rz * k;
        if (Math.abs(err) < 0.12) mx = mz = 0;
      }
    }
    out.moveX = mx;
    out.moveZ = mz;

    if (wantJump && grounded && t - this.lastJumpAt > 0.25) {
      out.jumpPressed = true;
      this.jumpHeldUntil = t + 0.5;
      this.lastJumpAt = t;
      this.stats.jumps++;
    }
    out.jump = t < this.jumpHeldUntil;
  }

  private inRange(list: RangeHint[], s: number): boolean {
    for (const h of list) if (s >= h.s0 - 0.5 && s <= h.s1) return true;
    return false;
  }

  private nextJumpHint(s: number): JumpHint | null {
    for (const j of this.jumps) if (j.s > s - 0.6) return j;
    return null;
  }

  private aimPoint(a: { landS: number; lateral: number; targetId: number }): { x: number; y: number; z: number } {
    const w = this.world;
    if (a.targetId >= 0) {
      const d = w.solids.get(a.targetId);
      if (d && d.piece.motion) {
        // aim where the moving platform will be when we come down
        const b = w.player.body;
        const st = w.player.stats;
        const c = d.collider;
        const tLeft = Math.max(0.05, (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * st.gravity * Math.max(0, b.y - c.maxY)))) / st.gravity);
        const pb = w.solids.predictBox(a.targetId, w.time + tLeft, this.tmpBox) ?? c;
        return { x: (pb.minX + pb.maxX) / 2, y: pb.maxY, z: (pb.minZ + pb.maxZ) / 2 };
      }
    }
    const pt = w.track.offsetPoint(a.landS, a.lateral);
    const col = a.targetId >= 0 ? w.solids.colliderOf(a.targetId) : undefined;
    return { x: pt.x, y: col ? col.maxY : pt.y, z: pt.z };
  }

  /** Would a jump right now land safely on the hint's target? */
  private canLand(j: JumpHint): boolean {
    const w = this.world;
    if (j.targetId < 0) return true;
    const d = w.solids.get(j.targetId);
    const col = w.solids.colliderOf(j.targetId);
    if (!col) return true;
    const need = 0.15 + 0.25 * (1 - this.profile.riskLevel);
    if (!d || !d.piece.motion) {
      // static (or vanishing in place) target: aim at the hinted landing point
      const pt = w.track.offsetPoint(j.landS, j.lateral);
      const res = this.pred.landing(pt.x, pt.z, j.targetId, col.maxY);
      return res.ok && res.margin > need;
    }
    // moving target: iterate the aim point on its predicted position
    let ax = (col.minX + col.maxX) / 2;
    let az = (col.minZ + col.maxZ) / 2;
    let res = this.pred.landing(ax, az, j.targetId, col.maxY);
    for (let k = 0; k < 2; k++) {
      const pb = w.solids.predictBox(j.targetId, w.time + res.t, this.tmpBox);
      if (!pb) return false;
      ax = (pb.minX + pb.maxX) / 2;
      az = (pb.minZ + pb.maxZ) / 2;
      res = this.pred.landing(ax, az, j.targetId, pb.maxY);
    }
    return res.ok && res.margin > need;
  }

  private readonly tmpBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  private handleJump(j: JumpHint, s: number, forced: ForcedMistake['kind'] | null): { jump: boolean; stopS: number } {
    const w = this.world;
    let dec = this.jumpDecision.get(j);
    if (!dec) {
      // decide timing error once per jump
      const sigma = 0.05 + 0.25 * (1 - this.skill);
      let off = this.rng.gaussian() * sigma * 0.5 + this.profile.reactionTime * 0.35;
      let skip = false;
      if (this.rng.chance(this.mistakeChance)) {
        this.stats.mistakes++;
        off = this.rng.chance(0.5) ? this.rng.range(0.7, 1.4) : -this.rng.range(0.9, 1.8);
      }
      if (forced === 'lateJump') {
        off = 1.3;
        this.forced.shift();
      } else if (forced === 'earlyJump') {
        off = -2.2;
        this.forced.shift();
      } else if (forced === 'noJump') {
        skip = true;
        this.forced.shift();
      }
      dec = { offsetS: off, skip };
      this.jumpDecision.set(j, dec);
    } else if (forced === 'lateJump' || forced === 'earlyJump' || forced === 'noJump') {
      // scripted mistake arriving after the timing was decided: override it
      if (forced === 'lateJump') dec.offsetS = 1.3;
      else if (forced === 'earlyJump') dec.offsetS = -2.2;
      else dec.skip = true;
      this.forced.shift();
    }
    const d = w.solids.get(j.targetId);
    let dynamic = !!d && (!!d.piece.motion || !!d.piece.vanish);
    // blinking platforms inside a committed timing gate: trust the gate's plan
    if (dynamic && d && !d.piece.motion && d.piece.vanish?.kind === 'cycle') {
      for (const [g, st] of this.gateState) if (st.phase === 'go' && g.supportIds.includes(j.targetId)) dynamic = false;
    }
    if (dec.skip) return { jump: false, stopS: Infinity };
    if (dynamic) {
      // moving / vanishing target: jump only when the landing is predicted safe
      if (s >= j.s - 1.6) {
        if (this.canLand(j)) {
          this.aim = { landS: j.landS, lateral: j.lateral, targetId: j.targetId };
          return { jump: true, stopS: Infinity };
        }
        this.stats.waits++;
        return { jump: false, stopS: j.s + 0.15 };
      }
      return { jump: false, stopS: j.s + 0.15 };
    }
    const takeoff = j.s + dec.offsetS;
    if (s >= takeoff) {
      this.aim = { landS: j.landS, lateral: j.lateral, targetId: j.targetId };
      return { jump: true, stopS: Infinity };
    }
    return { jump: false, stopS: Infinity };
  }

  private handleGate(g: GateHint, s: number, t: number, forced: ForcedMistake['kind'] | null): { stopS: number; jump: boolean } {
    let st = this.gateState.get(g);
    if (!st) {
      st = { phase: 'approach', goTime: 0, jumpTimes: [], rush: false, checked: -1 };
      if (this.rng.chance(this.mistakeChance * 0.5)) {
        st.rush = true;
        this.stats.mistakes++;
      }
      if (forced === 'gateRush') {
        st.rush = true;
        this.forced.shift();
      }
      this.gateState.set(g, st);
    }
    if (st.phase === 'done') return { stopS: Infinity, jump: false };
    if (s > g.s1) {
      st.phase = 'done';
      this.stats.gatesPassed++;
      return { stopS: Infinity, jump: false };
    }
    if (st.phase === 'go') {
      // execute planned jumps
      if (st.jumpTimes.length && t >= st.jumpTimes[0]) {
        st.jumpTimes.shift();
        return { stopS: Infinity, jump: true };
      }
      // re-validate the committed plan while still before the danger
      const w0 = this.world;
      if (!st.rush && w0.player.body.grounded && s < g.s0 + 0.6 && w0.tick - st.checked >= 6) {
        st.checked = w0.tick;
        const rest: TraversalPlan = {
          startDelay: Math.max(0, st.goTime - t),
          lateral: g.lateral,
          speed: 1,
          jumpS: g.jumps.slice(),
          jumpT: st.jumpTimes.map((jt) => jt - Math.max(t, st!.goTime)),
        };
        const ok = this.pred.check(rest, { hazardIds: g.hazardIds, blockerIds: g.blockerIds, supportIds: g.supportIds, margin: this.margin() * 0.5, untilS: g.s1 + 0.6, horizon: 3.5 }).safe;
        if (!ok) {
          st.phase = 'wait';
          return { stopS: Math.max(s, g.s0), jump: false };
        }
      }
      return { stopS: Infinity, jump: false };
    }
    const w = this.world;
    const dist = g.s0 - s;
    const v = Math.max(0.5, w.playerSpeedS);
    const brakeDist = (v * v) / (2 * w.player.stats.decel * 0.7) + 0.4;
    if (st.rush) {
      // mistake: charge in without looking
      st.phase = 'go';
      st.jumpTimes = [];
      return { stopS: Infinity, jump: false };
    }
    if (dist > brakeDist + 1.5) return { stopS: Infinity, jump: false };
    // evaluate (throttled)
    if (w.tick - st.checked >= 2) {
      st.checked = w.tick;
      const moving = w.playerSpeedS > 1;
      const delay = moving ? 0 : this.profile.reactionTime;
      const best = this.bestGatePlan(g, delay);
      if (best) {
        if (st.phase === 'wait') {
          // reaction time + human timing error before actually going
          let err = Math.abs(this.rng.gaussian()) * 0.05 * (1 - this.skill);
          if (this.rng.chance(this.mistakeChance * 0.4)) {
            err += this.rng.range(0.2, 0.45);
            this.stats.mistakes++;
          }
          st.goTime = t + delay + err;
        } else st.goTime = t;
        st.jumpTimes = best.jumpT.map((jt) => st!.goTime + jt);
        st.phase = 'go';
        return { stopS: Infinity, jump: false };
      }
      if (st.phase !== 'wait') {
        st.phase = 'wait';
        st.waitSince = t;
        this.stats.waits++;
      }
      // never loiter inside the danger zone, and don't wait forever: commit to the least-bad plan
      if ((s > g.s0 + 0.4 || t - (st.waitSince ?? t) > 4) && w.player.body.grounded) {
        const plan = this.leastBadGatePlan(g);
        st.goTime = t;
        st.jumpTimes = plan.jumpT.map((jt) => t + jt);
        st.phase = 'go';
        return { stopS: Infinity, jump: false };
      }
      // standing too close to the danger? step back a little
      if (w.playerSpeedS < 0.5) {
        const here = this.pred.check(
          { startDelay: 10, lateral: g.lateral, speed: 0, jumpS: [], jumpT: [] },
          { hazardIds: g.hazardIds, blockerIds: g.blockerIds, supportIds: [], margin: this.margin() * 0.6, untilS: Infinity, horizon: 1.0 },
        );
        if (!here.safe) this.retreatUntil = t + 0.25;
      }
    }
    if (st.phase === 'wait' || dist < brakeDist) return { stopS: g.s0, jump: false };
    return { stopS: Infinity, jump: false };
  }

  /** Finds the first safe plan through a gate (with optional jump timings). */
  private bestGatePlan(g: GateHint, delay: number): TraversalPlan | null {
    const base: TraversalPlan = { startDelay: delay, lateral: g.lateral, speed: 1, jumpS: g.jumps.slice(), jumpT: [] };
    const check = {
      hazardIds: g.hazardIds,
      blockerIds: g.blockerIds,
      supportIds: g.supportIds,
      margin: this.margin(),
      untilS: g.s1 + 0.6,
      horizon: 3.5,
    };
    if (this.pred.check(base, check).safe) return base;
    if (g.supportIds.length) return null; // vanishing paths: timing only
    for (let k = 0; k <= 10; k++) {
      const plan: TraversalPlan = { ...base, jumpT: [k * 0.08] };
      if (this.pred.check(plan, check).safe) return plan;
    }
    // two jumps (double spinners / laser pairs)
    for (let a = 0; a <= 6; a++)
      for (let bb = 0; bb <= 6; bb++) {
        const plan: TraversalPlan = { ...base, jumpT: [a * 0.1, 0.8 + a * 0.1 + bb * 0.1] };
        if (this.pred.check(plan, check).safe) return plan;
      }
    return null;
  }

  private leastBadGatePlan(g: GateHint): TraversalPlan {
    const check = { hazardIds: g.hazardIds, blockerIds: g.blockerIds, supportIds: g.supportIds, margin: 0.05, untilS: g.s1 + 0.6, horizon: 3.5 };
    let best: TraversalPlan = { startDelay: 0, lateral: g.lateral, speed: 1, jumpS: g.jumps.slice(), jumpT: [] };
    let bestT = this.pred.check(best, check).failT;
    if (bestT < 0) return best;
    for (let k = 0; k <= 10; k++) {
      const plan: TraversalPlan = { ...best, jumpT: [k * 0.08] };
      const r = this.pred.check(plan, check);
      if (r.safe) return plan;
      if (r.failT > bestT) {
        bestT = r.failT;
        best = plan;
      }
    }
    return best;
  }

  private decideArena(a: ArenaHint, s: number, t: number): void {
    this.arenaNext = t + 0.12;
    const w = this.world;
    const cur = this.arenaLane ?? a.lanes.reduce((best, l) => (Math.abs(l - w.playerLateral) < Math.abs(best - w.playerLateral) ? l : best), a.lanes[0]);
    let bestScore = -UNSAFE;
    let bestLane = cur;
    let bestSpeed = 1;
    const speeds = this.profile.aggression > 0.95 ? [1] : [1, 0.55, 0];
    let bestJump: number | null = null;
    const grounded = w.player.body.grounded;
    for (const lane of a.lanes) {
      for (const sp of speeds) {
        for (const jt of grounded ? [null, 0, 0.12, 0.25] : [null]) {
          const res = this.pred.check(
            { startDelay: 0, lateral: lane, speed: sp, jumpS: [], jumpT: jt === null ? [] : [jt] },
            { hazardIds: a.hazardIds, blockerIds: [], supportIds: [], margin: Math.min(0.2, this.margin()), untilS: s + 9, horizon: 1.4 },
          );
          let score = res.safe ? 100 + sp * 10 : res.failT * 10;
          if (lane === cur) score += 3;
          if (jt !== null) score -= 2; // prefer running when equally safe
          score -= Math.abs(lane - w.playerLateral) * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestLane = lane;
            bestSpeed = sp;
            bestJump = jt;
          }
        }
      }
    }
    this.arenaJumpAt = bestJump === null ? -1 : t + bestJump;
    // occasional misjudgement
    if (this.rng.chance(this.mistakeChance * 0.12)) {
      bestLane = this.rng.pick(a.lanes);
      this.stats.mistakes++;
    }
    this.arenaLane = bestLane;
    this.arenaSpeed = bestSpeed;
  }

  private decideChoice(c: ChoiceHint, s: number, t: number): number {
    const w = this.world;
    let st = this.choiceLane.get(c);
    if (!st) {
      const wrong = this.rng.chance(this.mistakeChance);
      if (wrong) this.stats.mistakes++;
      st = { lateral: this.rng.pick(c.options), noticed: false, wrongUntil: wrong ? 0.45 : 0 };
      this.choiceLane.set(c, st);
    }
    // when do we notice the doors slamming?
    const firstDoor = w.solids.get(c.blockerIds[0]);
    let fired: number | null = null;
    for (const id of c.blockerIds) {
      const d = w.solids.get(id);
      const m = d?.piece.motion;
      if (m && m.kind === 'trigger') fired = w.triggers.firedAt(m.triggerId) ?? fired;
    }
    void firstDoor;
    const noticeAt = fired === null ? Infinity : fired + this.profile.reactionTime + st.wrongUntil;
    const enemyBlocking = w.enemy && w.enemy.state === 'block' ? w.enemy.lateral : null;
    const blocked = (i: number): boolean => {
      if (enemyBlocking !== null && Math.abs(c.options[i] - enemyBlocking) < 1.2 && t >= noticeAt) return true;
      const id = c.blockerIds[i];
      const d = w.solids.get(id);
      if (!d) return false;
      const m = d.piece.motion;
      if (!m || m.kind !== 'trigger') return false;
      if (t < noticeAt) return false;
      return w.triggers.firedAt(m.triggerId) !== null;
    };
    const idx = c.options.indexOf(st.lateral);
    if (idx >= 0 && blocked(idx)) {
      // switch to the nearest open doorway
      let best = st.lateral;
      let bd = Infinity;
      c.options.forEach((o, i) => {
        if (blocked(i)) return;
        const dd = Math.abs(o - w.playerLateral);
        if (dd < bd) {
          bd = dd;
          best = o;
        }
      });
      st.lateral = best;
    }
    void s;
    return st.lateral;
  }
}
