/**
 * Draw-call helper: bakes all meshes below a rigid group (one that only moves
 * as a whole) into one mesh per material + shadow flag. Meshes listed in
 * `keep` (individually animated or with private materials) are left alone.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeRigid(group: THREE.Object3D, keep: THREE.Object3D[] = []): THREE.BufferGeometry[] {
  group.updateMatrixWorld(true);
  const skip = new Set(keep);
  const byKey = new Map<string, THREE.Mesh[]>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip.has(m)) return;
    const key = `${(m.material as THREE.Material).uuid}|${m.castShadow ? 1 : 0}`;
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(m);
  });
  const owned: THREE.BufferGeometry[] = [];
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      rel.multiplyMatrices(inv, m.matrixWorld);
      let g = m.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
      if (g.index) g = g.toNonIndexed();
      return g.applyMatrix4(rel);
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    group.add(mesh);
    owned.push(merged);
    for (const m of list) m.removeFromParent();
  }
  // remove empty helper groups left behind
  const prune = (o: THREE.Object3D): void => {
    for (const c of [...o.children]) {
      prune(c);
      if (!(c as THREE.Mesh).isMesh && c.children.length === 0 && !skip.has(c)) c.removeFromParent();
    }
  };
  prune(group);
  return owned;
}
