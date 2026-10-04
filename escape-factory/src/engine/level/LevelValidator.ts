/**
 * Structural validation of generated levels. Fast checks that run on every
 * generated level in tests (and optionally at runtime in debug mode). The
 * definitive playability check is the bot simulation (tools/validate-levels).
 */
import { Track } from './Track';
import type { LevelData, SolidPiece } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

/** Longest gap a reference character can clear with a running jump (m). */
export const MAX_STATIC_GAP = 5.4;

export function validateLevel(level: LevelData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });

  // spine
  const sp = level.spine;
  if (sp.length < 2) err('spine.short', 'spine has < 2 points');
  for (let i = 1; i < sp.length; i++) {
    const a = sp[i - 1];
    const b = sp[i];
    if (!(b.s > a.s)) err('spine.order', `spine s not increasing at ${i}`);
    if (Math.hypot(b.x - a.x, b.z - a.z) > 45) err('spine.jump', `spine segment ${i} too long`);
    if (!Number.isFinite(b.x + b.y + b.z)) err('spine.nan', `spine point ${i} not finite`);
  }

  // pieces & hints
  const ids = new Set(level.pieces.map((p) => p.id));
  if (ids.size !== level.pieces.length) err('pieces.dupid', 'duplicate piece ids');
  for (const h of level.hints) {
    if (h.kind === 'jump' && h.targetId !== -1 && !ids.has(h.targetId)) err('hint.target', `jump hint target ${h.targetId} missing`);
    if (h.kind === 'ride' && !ids.has(h.pieceId)) err('hint.ride', `ride hint piece ${h.pieceId} missing`);
    if (h.kind === 'gate') for (const id of [...h.hazardIds, ...h.blockerIds, ...h.supportIds]) if (!ids.has(id)) err('hint.gate', `gate ref ${id} missing`);
    if (h.kind === 'arena') for (const id of h.hazardIds) if (!ids.has(id)) err('hint.arena', `arena ref ${id} missing`);
  }

  // structure
  if (!level.finish) err('finish.missing', 'no finish');
  if (level.modules[0]?.type !== 'START') err('start.missing', 'first module is not START');
  if (level.modules[level.modules.length - 1]?.type !== 'FINISH') err('finish.last', 'last module is not FINISH');
  for (let i = 1; i < level.checkpoints.length; i++)
    if (level.checkpoints[i].s <= level.checkpoints[i - 1].s) err('cp.order', 'checkpoints out of order');

  // footprint overlap between non-adjacent modules
  const fps = level.modules.map((m) => m.footprint);
  for (let i = 0; i < fps.length; i++)
    for (let j = i + 3; j < fps.length; j++) {
      const a = fps[i];
      const b = fps[j];
      if (a.minX < b.maxX - 0.3 && a.maxX > b.minX + 0.3 && a.minZ < b.maxZ - 0.3 && a.maxZ > b.minZ + 0.3)
        warn('module.overlap', `modules ${i} (${level.modules[i].type}) and ${j} (${level.modules[j].type}) overlap`);
    }

  // static gaps along the spine must be jumpable (moving/vanishing pieces excepted)
  const track = new Track(level.spine);
  const solids = level.pieces.filter((p): p is SolidPiece => p.type === 'solid' && !!p.walkable);
  const helpers = solids.filter((p) => p.motion || p.vanish);
  const statics = solids.filter((p) => !p.motion && !p.vanish);
  let runStart = -1;
  const step = 0.4;
  for (let s = 0; s <= track.length + 1e-6; s += step) {
    const pt = track.pointAt(Math.min(s, track.length));
    const has = statics.some(
      (p) => pt.x >= p.box.minX - 0.4 && pt.x <= p.box.maxX + 0.4 && pt.z >= p.box.minZ - 0.4 && pt.z <= p.box.maxZ + 0.4 && Math.abs(p.box.maxY - pt.y) < 2.5,
    );
    if (!has && runStart < 0) runStart = s;
    if ((has || s + step > track.length) && runStart >= 0) {
      const len = s - runStart;
      if (len > MAX_STATIC_GAP) {
        const mid = track.pointAt(runStart + len / 2);
        const helped = helpers.some((p) => Math.hypot((p.box.minX + p.box.maxX) / 2 - mid.x, (p.box.minZ + p.box.maxZ) / 2 - mid.z) < len + 4);
        if (!helped) err('gap.too_long', `unassisted gap of ${len.toFixed(1)} m at s=${runStart.toFixed(1)}`);
      }
      runStart = -1;
    }
  }

  if (level.stats.maxBeatGap > 24) warn('beats.sparse', `max beat gap ${level.stats.maxBeatGap.toFixed(1)} s`);
  return issues;
}

export function assertValid(level: LevelData): void {
  const errors = validateLevel(level).filter((i) => i.level === 'error');
  if (errors.length) throw new Error(`Invalid level ${level.seed}: ${errors.map((e) => e.message).join('; ')}`);
}
