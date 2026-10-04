/**
 * LevelGenerator — turns (seed, difficulty, length, theme, enemy, specialEvents)
 * into a complete, reproducible LevelData by stringing modules together along a
 * level grammar that mirrors the core gameplay loop:
 *
 *   START → EXPLORE → OBSTACLE → DANGER → CHASE → ESCAPE(CHECKPOINT) →
 *   NEW DANGER … → FINAL ESCAPE → FINISH
 *
 * A beat planner guarantees a notable moment every ~10–20 s of play.
 */
import { clamp } from '../core/math';
import { Rng, mixSeed } from '../core/rng';
import type { AABB } from '../core/math';
import { themes } from '../theme/ThemeDef';
import { resolveDifficulty, type DifficultyParams } from './difficulty';
import { clearDecorFromPath } from './decorBounds';
import { finalizeLevel } from './finalize';
import { LevelBuilder } from './LevelBuilder';
import type { ModuleContext, ModuleDef, ModuleOptions, ModuleRegistry, ModuleRole } from './ModuleRegistry';
import { createStandardModules } from './modules';
import type { Dir, Frame, LevelData, ModuleInstance, SurpriseKind } from './types';
import { localToWorld } from './types';

export interface LevelGenParams {
  seed: number;
  /** 1..5 (fractional allowed) or EASY/NORMAL/HARD/INSANE/IMPOSSIBLE */
  difficulty: number | string;
  /** total module count including START and FINISH (default: by difficulty) */
  length?: number;
  theme?: string;
  /** enemy id or 'none' */
  enemy?: string;
  /**
   * Special events / generation flags:
   *  boss, doubleChase, noChase, noTurns, chaos, and surprise names
   *  (enemyPeek, lightsFlicker, alarm, floorCollapse, wallSlam, debris, enemyRoar, steamBurst)
   *  to restrict the surprise pool. `more:<MODULE>` boosts a module type.
   */
  specialEvents?: string[];
  /** custom module library (other games) */
  modules?: ModuleRegistry;
}

interface Slot {
  type?: string;
  role?: ModuleRole;
  opts: ModuleOptions;
}

const SURPRISES: Array<{ kind: SurpriseKind; weight: number; needsEnemy?: boolean; onlyStraight?: boolean }> = [
  { kind: 'enemyPeek', weight: 3, needsEnemy: true },
  { kind: 'lightsFlicker', weight: 1.4 },
  { kind: 'alarm', weight: 1 },
  { kind: 'debris', weight: 1.6 },
  { kind: 'wallSlam', weight: 1.2 },
  { kind: 'enemyRoar', weight: 1.2, needsEnemy: true },
  { kind: 'steamBurst', weight: 0.9 },
  { kind: 'floorCollapse', weight: 2.2, onlyStraight: true },
];

const ROLE_CYCLE: ModuleRole[] = ['explore', 'obstacle', 'danger', 'explore', 'obstacle', 'danger', 'explore', 'danger', 'obstacle'];

let defaultModules: ModuleRegistry | null = null;

export function generateLevel(p: LevelGenParams): LevelData {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const diff = resolveDifficulty(p.difficulty);
  const modules = p.modules ?? (defaultModules ??= createStandardModules());
  const special = new Set((p.specialEvents ?? []).map((s) => s.trim()).filter(Boolean));
  const enemy = p.enemy ?? 'grumbo';
  const themeId = (p.theme ?? 'FACTORY').toUpperCase();
  const theme = themes.has(themeId) ? themes.get(themeId) : null;
  const root = new Rng(mixSeed(p.seed, 'level', Math.round(diff.level * 100)));
  const planRng = root.fork('plan');
  const genRng = root.fork('gen');

  const total = clamp(Math.round(p.length ?? planRng.int(diff.lengthMin, diff.lengthMax)), 6, 80);
  const boss = special.has('boss');
  let chases = enemy === 'none' || special.has('noChase') ? 0 : diff.chaseSegments + (special.has('doubleChase') ? 1 : 0);

  // ---- 1. grammar plan ----------------------------------------------------
  const plan: Slot[] = [{ type: 'START', opts: {} }];
  const tail: Slot[] = [];
  if (boss) tail.push({ type: 'BOSS', opts: {} });
  if (enemy !== 'none') tail.push({ role: 'flow', opts: { inChase: true, finalEscape: true } });
  tail.push({ type: 'FINISH', opts: {} });
  const bodyLen = Math.max(1, total - 1 - tail.length);
  chases = Math.min(chases, Math.floor(bodyLen / 4));
  const chaseAt: number[] = [];
  for (let k = 0; k < chases; k++) chaseAt.push(Math.floor(bodyLen * (chases === 1 ? 0.45 : 0.3 + (0.5 * k) / (chases - 1))));
  const body: Slot[] = [];
  let roleIdx = 0;
  let sinceCp = 0;
  while (body.length < bodyLen) {
    const remaining = bodyLen - body.length;
    if (chaseAt.length && body.length >= chaseAt[0] && remaining >= 3) {
      chaseAt.shift();
      body.push({ type: 'CHASE', opts: { inChase: true } });
      body.push({ role: 'flow', opts: { inChase: true } });
      body.push({ type: 'CHECKPOINT', opts: { endsChase: true } });
      sinceCp = 0;
      continue;
    }
    if (sinceCp >= diff.checkpointEvery && remaining >= 3) {
      body.push({ type: 'CHECKPOINT', opts: {} });
      sinceCp = 0;
      continue;
    }
    body.push({ role: body.length === 0 ? 'explore' : ROLE_CYCLE[roleIdx++ % ROLE_CYCLE.length], opts: {} });
    sinceCp++;
  }
  plan.push(...body.slice(0, bodyLen), ...tail);

  // ---- 2. assign module types ---------------------------------------------
  const weightMul = (type: string): number => {
    let w = theme?.special.moduleWeights?.[type] ?? 1;
    if (special.has(`more:${type}`)) w *= 3;
    if (type === 'TURN' && special.has('noTurns')) w = 0;
    return w;
  };
  let prevType = 'START';
  let dangerRun = 0;
  for (const slot of plan) {
    if (!slot.type) {
      const role = slot.role ?? 'explore';
      let pool = modules.byRole(role, diff, !!slot.opts.inChase).filter((m) => m.type !== prevType);
      if (dangerRun >= 2) pool = pool.filter((m) => !m.roles.includes('danger') || m.roles.includes('flow')) as ModuleDef[];
      if (!pool.length) pool = modules.byRole('flow', diff, true);
      const pick = planRng.weighted(pool, (m) => m.weight(diff) * weightMul(m.type) * (m.type === 'TURN' ? (role === 'explore' ? 1.6 : 0.5) : 1));
      slot.type = pick.type;
    }
    const def = modules.get(slot.type);
    dangerRun = def.roles.includes('danger') ? dangerRun + 1 : 0;
    prevType = slot.type;
  }

  // ---- 3. beat planner: something notable every 10–20 s --------------------
  const surprisePool = SURPRISES.filter((s) => (enemy !== 'none' || !s.needsEnemy) && (![...special].some((x) => SURPRISES.some((q) => q.kind === x)) || special.has(s.kind)));
  let sinceBeat = 0;
  let target = planRng.range(10, 16) / Math.sqrt(diff.surpriseRate);
  for (const slot of plan) {
    const def = modules.get(slot.type!);
    const isBeat = def.beat || slot.opts.endsChase || slot.opts.finalEscape;
    const est = def.estimate(diff);
    if (isBeat) {
      sinceBeat = 0;
      continue;
    }
    sinceBeat += est;
    const extra = planRng.chance(0.12 * diff.surpriseRate);
    if ((sinceBeat >= target || extra) && surprisePool.length && slot.type !== 'CHECKPOINT') {
      const candidates = surprisePool.filter((s) => !s.onlyStraight || slot.type === 'STRAIGHT');
      if (candidates.length) {
        slot.opts.surprise = planRng.weighted(candidates, (s) => s.weight).kind;
        sinceBeat = 0;
        target = planRng.range(10, 16) / Math.sqrt(diff.surpriseRate);
      }
    }
  }

  // ---- 4. build geometry ----------------------------------------------------
  const b = new LevelBuilder();
  const instances: ModuleInstance[] = [];
  const footprints: AABB[] = [];
  let frame: Frame = { x: 0, y: 0, z: 0, dir: 0 };
  let estStart = 0;
  const decor = theme?.decorations ?? [];
  const phys = theme?.physics;
  const rangeScale = (phys?.speedMul ?? 1) / Math.sqrt(phys?.gravityScale ?? 1);
  const floorSurface =
    theme?.special.floorSurface === 'ice' || theme?.special.floorSurface === 'jelly'
      ? { surface: theme.special.floorSurface, chance: theme.special.floorSurfaceChance ?? 0.3 }
      : undefined;
  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i];
    let def = modules.get(slot.type!);
    let attempt = 0;
    let result: ReturnType<ModuleDef['generate']> | null = null;
    let fp: AABB | null = null;
    let mark = b.mark();
    while (attempt < 3) {
      const opts: ModuleOptions = { ...slot.opts };
      if (def.type === 'TURN') opts.turn = decideTurn(frame, genRng, attempt);
      mark = b.mark();
      b.begin(frame, i);
      const ctx: ModuleContext = { b, rng: genRng, diff, index: i, count: plan.length, opts, decor, floorSurface, enemy, rangeScale };
      result = def.generate(ctx);
      fp = b.footprintSince(mark);
      if (!fp || !overlapsAny(fp, footprints, 2)) {
        slot.opts = opts;
        break;
      }
      b.rollback(mark);
      attempt++;
      // an overlapping module is replaced by a compact straight piece, then retried
      if (attempt === 2 && def.type !== 'STRAIGHT' && def.roles.includes('flow')) def = modules.get('STRAIGHT');
      if (attempt === 3) {
        // give up: accept the overlap (rare, validated by tests)
        b.begin(frame, i);
        result = def.generate({ b, rng: genRng, diff, index: i, count: plan.length, opts: { ...slot.opts }, decor, floorSurface, enemy, rangeScale });
        fp = b.footprintSince(mark);
      }
    }
    if (slot.opts.finalEscape) b.trigger(b.s0 + 1.0, { kind: 'finalEscape' });
    if (special.has('chaos')) {
      const kinds: SurpriseKind[] = ['lightsFlicker', 'alarm', 'steamBurst', ...(enemy !== 'none' ? (['enemyRoar'] as SurpriseKind[]) : [])];
      b.trigger(b.s0 + 2, { kind: 'surprise', surprise: genRng.pick(kinds), chaosOnly: true });
    }
    const r = result!;
    const s1 = b.spine.length ? b.spine[b.spine.length - 1].s : 0;
    const inst: ModuleInstance = {
      index: i,
      type: def.type,
      s0: b.s0,
      s1,
      entry: { ...frame },
      exit: r.exit,
      footprint: fp ?? { minX: frame.x, minY: frame.y, minZ: frame.z, maxX: frame.x, maxY: frame.y, maxZ: frame.z },
      estTime: r.estTime,
      estStart,
      beat: !!(r.beat ?? def.beat) || !!slot.opts.surprise || !!slot.opts.endsChase || !!slot.opts.finalEscape,
      tags: [...(r.tags ?? []), ...(slot.opts.surprise ? [`surprise:${slot.opts.surprise}`] : []), ...(slot.opts.inChase ? ['chase'] : [])],
    };
    instances.push(inst);
    if (fp) footprints.push(fp);
    estStart += r.estTime;
    frame = r.exit;
  }

  // props from one module must not stand in the track of a later (turning) one
  clearDecorFromPath(b.pieces, b.spine);
  const start = instances[0];
  const sp = localToWorld(start.entry, 0, 0, 1.5);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return finalizeLevel(b, {
    seed: p.seed,
    difficulty: diff.level,
    theme: themeId,
    enemy,
    specialEvents: [...special],
    modules: instances,
    spawn: { x: sp.x, y: sp.y, z: sp.z, dir: start.entry.dir },
    generationMs: t1 - t0,
  });
}

/** Turn choice that never heads "backwards" (-Z), so the course can't self-intersect. */
function decideTurn(frame: Frame, rng: Rng, attempt: number): 'left' | 'right' {
  const d: Dir = frame.dir;
  if (d === 1) return 'right';
  if (d === 3) return 'left';
  // facing +Z: lean back toward x = 0
  let left = rng.chance(frame.x > 20 ? 0.25 : frame.x < -20 ? 0.75 : 0.5);
  if (attempt > 0) left = !left;
  return left ? 'left' : 'right';
}

function overlapsAny(fp: AABB, list: AABB[], skipLast: number): boolean {
  const n = list.length - skipLast;
  for (let i = 0; i < n; i++) {
    const o = list[i];
    if (fp.minX < o.maxX - 0.3 && fp.maxX > o.minX + 0.3 && fp.minZ < o.maxZ - 0.3 && fp.maxZ > o.minZ + 0.3) return true;
  }
  return false;
}

export type { DifficultyParams };
