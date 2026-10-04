/**
 * Highlight analysis: turns a take's event log into an "interest" curve and
 * finds the best moments/windows for Shorts and long-form edits.
 */
import { EVENT_INTEREST, type GameEvent, type GameEventType } from '../events/GameEvents';

export type Focus = 'chase' | 'nearDeath' | 'fail' | 'boss' | 'finish' | 'surprise';

const FOCUS_EVENTS: Record<Focus, GameEventType[]> = {
  chase: ['CHASE_START', 'ENEMY_NEAR', 'ENEMY_ROAR', 'ENEMY_ACCELERATE', 'CHASE_END', 'FINAL_ESCAPE', 'OBSTACLE_BREAK'],
  nearDeath: ['PLAYER_NEAR_DEATH', 'ENEMY_NEAR', 'SPINNER_HIT'],
  fail: ['PLAYER_FAIL', 'PLAYER_DEATH', 'ENEMY_GRAB', 'PLAYER_FALL'],
  boss: ['BOSS_START', 'BOSS_ATTACK', 'BOSS_END'],
  finish: ['PLAYER_FINISH', 'FINAL_ESCAPE', 'CHECKPOINT_REACHED'],
  surprise: ['SURPRISE', 'FLOOR_COLLAPSE', 'ENEMY_APPEAR', 'DOOR_CLOSE', 'ENEMY_BLOCK', 'LIGHTS_FLICKER', 'ALARM'],
};

const RESOLUTION: Partial<Record<GameEventType, number>> = {
  PLAYER_FINISH: 1,
  CHASE_END: 0.8,
  PLAYER_FAIL: 0.9,
  BOSS_END: 0.8,
  CHECKPOINT_REACHED: 0.35,
};

export interface InterestCurve {
  step: number;
  values: Float32Array;
  duration: number;
}

/** Builds the interest curve (0.1 s grid) from events. */
export function interestCurve(events: GameEvent[], duration: number, focus: Focus[] = []): InterestCurve {
  const step = 0.1;
  const n = Math.max(1, Math.ceil(duration / step) + 1);
  const v = new Float32Array(n);
  const boost = new Set<GameEventType>(focus.flatMap((f) => FOCUS_EVENTS[f]));
  const add = (t: number, w: number, before = 0.6, after = 1.6) => {
    const i0 = Math.max(0, Math.floor((t - before) / step));
    const i1 = Math.min(n - 1, Math.ceil((t + after) / step));
    for (let i = i0; i <= i1; i++) {
      const dt = i * step - t;
      const k = dt < 0 ? 1 + dt / before : 1 - dt / after;
      if (k > 0) v[i] += w * k;
    }
  };
  let chaseFrom = -1;
  let bossFrom = -1;
  const span = (a: number, b: number, w: number) => {
    for (let i = Math.max(0, Math.floor(a / step)); i <= Math.min(n - 1, Math.floor(b / step)); i++) v[i] += w;
  };
  for (const e of events) {
    let w = EVENT_INTEREST[e.type] ?? 0;
    if (!w) {
      if (e.type === 'CHASE_START' || e.type === 'FINAL_ESCAPE') chaseFrom = e.t;
      continue;
    }
    if (e.type === 'ENEMY_NEAR') w *= 1 + Math.max(0, 4 - ((e.payload as { gap?: number }).gap ?? 4)) * 0.25;
    if (boost.has(e.type)) w *= 1.8;
    add(e.t, w);
    if (e.type === 'CHASE_START' || e.type === 'FINAL_ESCAPE') chaseFrom = e.t;
    if ((e.type === 'CHASE_END' || e.type === 'PLAYER_FINISH' || e.type === 'PLAYER_DEATH') && chaseFrom >= 0) {
      span(chaseFrom, e.t, focus.includes('chase') ? 0.35 : 0.22);
      chaseFrom = -1;
    }
    if (e.type === 'BOSS_START') bossFrom = e.t;
    if (e.type === 'BOSS_END' && bossFrom >= 0) {
      span(bossFrom, e.t, focus.includes('boss') ? 0.4 : 0.25);
      bossFrom = -1;
    }
  }
  return { step, values: v, duration };
}

export interface WindowPick {
  start: number;
  end: number;
  score: number;
  climax: number;
  hook: number;
  resolution: { type: GameEventType; t: number } | null;
}

/**
 * Best window of length `len` following the Shorts structure:
 * hook in the first second, escalation, climax at ~55–85 %, resolution at the end.
 */
export function bestWindow(
  curve: InterestCurve,
  events: GameEvent[],
  len: number,
  opts: { minStart?: number; maxEnd?: number; contain?: number; endAt?: number } = {},
): WindowPick {
  const { step, values } = curve;
  const n = values.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  const wl = Math.round(len / step);
  const minI = Math.max(0, Math.round((opts.minStart ?? 0) / step));
  const maxEndI = Math.min(n, Math.round((opts.maxEnd ?? curve.duration) / step));
  let best: WindowPick = { start: 0, end: len, score: -Infinity, climax: len * 0.7, hook: 0, resolution: null };
  const resEvents = events.filter((e) => RESOLUTION[e.type]);
  for (let a = minI; a + wl <= Math.max(maxEndI, minI + wl); a += 2) {
    const b = Math.min(n - 1, a + wl);
    if (opts.contain !== undefined && (opts.contain < a * step + 0.8 || opts.contain > b * step - 1.2)) continue;
    if (opts.endAt !== undefined && Math.abs(b * step - opts.endAt) > step * 1.5) continue;
    const sum = (prefix[b] - prefix[a]) / wl;
    // hook: strongest moment in the first 1.2 s
    let hook = 0;
    for (let i = a; i < Math.min(b, a + 12); i++) hook = Math.max(hook, values[i]);
    // climax placement
    let cMax = -1;
    let cI = a;
    for (let i = a; i < b; i++)
      if (values[i] > cMax) {
        cMax = values[i];
        cI = i;
      }
    const rel = (cI - a) / wl;
    const placement = rel >= 0.5 && rel <= 0.88 ? 1 : rel > 0.88 ? 0.6 : 0.35;
    // resolution near the end
    const ta = a * step;
    const tb = b * step;
    let res: WindowPick['resolution'] = null;
    let resScore = 0;
    for (const e of resEvents) {
      if (e.t >= tb - 6 && e.t <= tb - 0.6) {
        const w = RESOLUTION[e.type]!;
        if (w > resScore) {
          resScore = w;
          res = { type: e.type, t: e.t };
        }
      }
    }
    // dead air penalty
    let dead = 0;
    let run = 0;
    for (let i = a; i < b; i++) {
      if (values[i] < 0.05) {
        run++;
        if (run > 25) dead++;
      } else run = 0;
    }
    const score = sum * 4 + hook * 2.2 + cMax * placement * 1.5 + resScore * 2.5 - dead * 0.05;
    if (score > best.score) best = { start: ta, end: tb, score, climax: cI * step, hook, resolution: res };
  }
  return best;
}

/** Top-k peaks (moments) separated by `minGap` seconds. */
export function peaks(curve: InterestCurve, k: number, minGap = 4): number[] {
  const idx = Array.from(curve.values.keys()).sort((a, b) => curve.values[b] - curve.values[a]);
  const out: number[] = [];
  for (const i of idx) {
    const t = i * curve.step;
    if (out.every((o) => Math.abs(o - t) >= minGap)) out.push(t);
    if (out.length >= k) break;
  }
  return out.sort((a, b) => a - b);
}

/** Best camera for a flash-forward of moment `t`: CHASE when Grumbo is involved, else DRAMATIC. */
export function coldOpenCamera(events: GameEvent[], t: number): 'CHASE' | 'DRAMATIC' {
  const enemy = events.some(
    (e) => Math.abs(e.t - t) < 1.6 && (e.type.startsWith('ENEMY_') || e.type === 'CHASE_START' || e.type === 'FINAL_ESCAPE') && e.type !== 'ENEMY_STEP',
  );
  return enemy ? 'CHASE' : 'DRAMATIC';
}
