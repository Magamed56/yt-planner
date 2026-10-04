/**
 * Physical extent of decorations (visual-only props). Used by the camera to
 * avoid flying through big props, and by the generator to keep props off the
 * play corridor (decor is placed per module, so a later turn could otherwise
 * run the track straight through a prop from an earlier module).
 */
import type { AABB } from '../core/math';
import type { DecorPiece, Piece, SpinePoint, TriggerPiece } from './types';

export interface DecorBox extends AABB {
  kind: 'decor';
}

/** Local boxes [x0, y0, z0, x1, y1, z1] of a decoration (before its yaw/scale). */
export type DecorBoxes = Array<[number, number, number, number, number, number]>;

const decorBounds = new Map<string, DecorBoxes>();

/** Registers camera-blocking bounds for a decoration kind (themes/games add theirs). */
export function registerDecorBounds(kind: string, boxes: DecorBoxes): void {
  decorBounds.set(kind, boxes);
}

/** Cylinder-ish prop of radius r and height h standing on its origin. */
export const prop = (r: number, h: number, y0 = 0): DecorBoxes => [[-r, y0, -r, r, y0 + h, r]];

// engine decor kinds (render/decor.ts); thin posts and small props are ignored on purpose
registerDecorBounds('pipe', [[-1.0, -2, -0.5, 1.2, 6.2, 0.5]]);
registerDecorBounds('crate', prop(0.55, 2.6));
registerDecorBounds('barrel', prop(0.55, 1.3));
registerDecorBounds('gear', [[-2.9, 0, -0.35, 2.9, 6.6, 0.35]]);
registerDecorBounds('vent', prop(0.6, 1.2));
registerDecorBounds('balcony', [[-2.4, -0.6, -2.4, 2.4, 1.1, 2.4], [-0.7, -19, -0.7, 0.7, -0.6, 0.7]]);
registerDecorBounds('ledge', [[-0.8, -0.4, -1.1, 0.8, 0, 1.1]]);
registerDecorBounds('gate', [
  [-4.6, 0, -0.6, -3.8, 6, 0.6],
  [3.8, 0, -0.6, 4.6, 6, 0.6],
  [-4.6, 5.7, -0.6, 4.6, 6.7, 0.6],
  [-3.9, 0, -0.4, 3.9, 5.4, 0.1],
]);
registerDecorBounds('elevatorFrame', [[-1.9, 5.9, -1.9, 1.9, 6.1, 1.9]]);
registerDecorBounds('exitGate', [
  [-4.8, 0, -0.4, -4.0, 6.5, 0.4],
  [4.0, 0, -0.4, 4.8, 6.5, 0.4],
  [-4.8, 6.2, -0.4, 4.8, 7.4, 0.4],
]);
registerDecorBounds('bossPedestal', [[-2.3, -21, -2.3, 2.3, 0.1, 2.3]]);

export function hasDecorBounds(kind: string): boolean {
  return decorBounds.has(kind);
}

/** World AABBs of a decoration piece (yaw + uniform scale, like the renderer applies them). */
export function decorWorldBoxes<T extends { kind: string } & AABB = DecorBox>(d: DecorPiece, out: T[] = []): T[] {
  const boxes = decorBounds.get(d.kind);
  if (!boxes) return out;
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const x of [x0, x1])
      for (const z of [z0, z1]) {
        // Object3D rotation.y: x' = x cos + z sin, z' = -x sin + z cos
        const wx = (x * c + z * s) * d.scale;
        const wz = (-x * s + z * c) * d.scale;
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      }
    out.push({ kind: 'decor', minX: d.x + minX, maxX: d.x + maxX, minY: d.y + y0 * d.scale, maxY: d.y + y1 * d.scale, minZ: d.z + minZ, maxZ: d.z + maxZ } as unknown as T);
  }
  return out;
}


/** Set pieces deliberately placed over or around the path. */
const ON_PATH_KINDS = new Set(['gate', 'exitGate', 'elevatorFrame', 'checkpointBeacon', 'bossPedestal', 'bossBanner', 'confettiCannon']);

interface Sample {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * Removes decorations that intrude into the play corridor (track width + margin,
 * from the floor to above jump height) and moves enemy-peek balconies (with
 * their trigger) outward until clear. Returns counts for diagnostics.
 */
export function clearDecorFromPath(pieces: Piece[], spine: SpinePoint[]): { removed: number; moved: number } {
  const samples: Sample[] = [];
  for (let i = 0; i + 1 < spine.length; i++) {
    const a = spine[i];
    const b = spine[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len));
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      samples.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, r: a.halfWidth + (b.halfWidth - a.halfWidth) * u + 0.6 });
    }
  }
  const CELL = 8;
  const grid = new Map<number, Sample[]>();
  const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
  for (const s of samples) {
    const k = key(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(s);
  }
  const intrudes = (d: DecorPiece): Sample | null => {
    for (const b of decorWorldBoxes(d)) {
      for (let ix = Math.floor((b.minX - 4) / CELL); ix <= Math.floor((b.maxX + 4) / CELL); ix++)
        for (let iz = Math.floor((b.minZ - 4) / CELL); iz <= Math.floor((b.maxZ + 4) / CELL); iz++)
          for (const s of grid.get(key(ix, iz)) ?? []) {
            if (s.x < b.minX - s.r || s.x > b.maxX + s.r || s.z < b.minZ - s.r || s.z > b.maxZ + s.r) continue;
            if (b.maxY < s.y - 0.5 || b.minY > s.y + 3.6) continue;
            return s;
          }
    }
    return null;
  };
  const peeks = pieces.filter((p): p is TriggerPiece => p.type === 'trigger' && p.action.kind === 'enemyPeek');
  const remove = new Set<Piece>();
  let moved = 0;
  for (const p of pieces) {
    if (p.type !== 'decor' || ON_PATH_KINDS.has(p.kind)) continue;
    const hit = intrudes(p);
    if (!hit) continue;
    const peek = p.kind === 'balcony' ? peeks.find((t) => t.action.kind === 'enemyPeek' && Math.abs(t.action.x - p.x) < 0.01 && Math.abs(t.action.z - p.z) < 0.01) : undefined;
    if (peek && peek.action.kind === 'enemyPeek') {
      // push the balcony away from the corridor sample it hits
      let dx = p.x - hit.x;
      let dz = p.z - hit.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const x0 = p.x;
      const z0 = p.z;
      let ok = false;
      for (let step = 2; step <= 24 && !ok; step += 2) {
        p.x = x0 + dx * step;
        p.z = z0 + dz * step;
        ok = !intrudes(p);
      }
      if (ok) {
        peek.action.x = p.x;
        peek.action.z = p.z;
        moved++;
        continue;
      }
      p.x = x0;
      p.z = z0;
      remove.add(peek);
    }
    remove.add(p);
  }
  if (remove.size) {
    let w = 0;
    for (let i = 0; i < pieces.length; i++) if (!remove.has(pieces[i])) pieces[w++] = pieces[i];
    pieces.length = w;
  }
  return { removed: remove.size, moved };
}
