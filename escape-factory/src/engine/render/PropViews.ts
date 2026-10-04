/**
 * LevelView extension for collectibles, checkpoints and decorations.
 * Coins are one InstancedMesh; static decor is merged into level geometry.
 */
import * as THREE from 'three';
import type { CoinPiece, DecorPiece } from '../level/types';
import { decorRegistry } from './decor';
import { cylinderGeo, torusGeo } from './geometry';
import type { LevelViewExtension, ViewPart } from './LevelView';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();

export const propViewsExtension: LevelViewExtension = {
  build(ctx) {
    const parts: ViewPart[] = [];
    const { level, theme, mats, root } = ctx;

    // ---- coins
    const coins = level.pieces.filter((p): p is CoinPiece => p.type === 'coin');
    if (coins.length) {
      const geo = cylinderGeo(0.3, 0.3, 0.07, 18);
      const mat = mats.get(theme.palette.coin, { metalness: 0.8, roughness: 0.25, emissive: theme.palette.coin, emissiveIntensity: 0.35 });
      const inst = new THREE.InstancedMesh(geo, mat, coins.length);
      inst.castShadow = true;
      inst.frustumCulled = false;
      root.add(inst);
      parts.push({
        update(world, t) {
          for (let i = 0; i < coins.length; i++) {
            const c = coins[i];
            const hidden = world.collectedCoins.has(c.id);
            e.set(Math.PI / 2, 0, t * 3 + i * 0.4);
            q.setFromEuler(e);
            v.set(c.x, c.y + Math.sin(t * 2.5 + i) * 0.12, c.z);
            sc.setScalar(hidden ? 0.0001 : 1);
            m4.compose(v, q, sc);
            inst.setMatrixAt(i, m4);
          }
          inst.instanceMatrix.needsUpdate = true;
        },
      });
    }

    // ---- checkpoint pads
    for (const cp of level.checkpoints) {
      const ringMat = mats.unique(theme.palette.danger, { emissive: theme.palette.danger, emissiveIntensity: 0.8 });
      const ring = new THREE.Mesh(torusGeo(1.4, 0.08), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cp.x, cp.y + 0.06, cp.z);
      root.add(ring);
      const green = new THREE.Color(theme.palette.checkpoint);
      parts.push({
        update(world, t) {
          const active = world.checkpointIndex >= cp.index;
          if (active) {
            ringMat.emissive.copy(green);
            ringMat.color.copy(green);
          }
          ring.scale.setScalar(active ? 1 + 0.05 * Math.sin(t * 5) : 1);
        },
        dispose() {
          ringMat.dispose();
        },
      });
    }

    // ---- decorations
    const animated: Array<{ obj: THREE.Object3D; fn: NonNullable<ReturnType<typeof decorRegistry.build>>['animate'] }> = [];
    for (const p of level.pieces) {
      if (p.type !== 'decor') continue;
      const d = p as DecorPiece;
      const built = decorRegistry.build(d.kind, { mats, theme, variant: d.variant });
      if (!built) continue;
      const obj = built.object;
      obj.position.set(d.x, d.y, d.z);
      obj.rotation.set(0, d.rotY, 0);
      obj.scale.setScalar(d.scale);
      if (built.animate) {
        root.add(obj);
        animated.push({ obj, fn: built.animate });
      } else {
        obj.updateMatrixWorld(true);
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) ctx.addStatic(mesh.geometry, mesh.matrixWorld, mesh.material as THREE.Material);
        });
      }
    }
    if (animated.length)
      parts.push({
        update(world, t) {
          for (const a of animated) a.fn!(t, world, a.obj);
        },
      });
    return parts;
  },
};
