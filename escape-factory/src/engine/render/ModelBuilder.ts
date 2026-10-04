/** Turns a data-driven ModelSpec into a Three.js hierarchy with named rig slots. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelPart, ModelSpec } from '../character/ModelSpec';
import { capsuleGeo, coneGeo, cylinderGeo, discGeo, roundBoxGeo, boxGeo, sphereGeo, torusGeo } from './geometry';
import type { MaterialLibrary } from './materials';

export interface BuiltModel {
  root: THREE.Group;
  /** rig slots: joints (pivot groups) or meshes by part name */
  slots: Map<string, THREE.Object3D>;
  /** rest transforms of slots for animation */
  rest: Map<string, { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 }>;
  meshes: THREE.Mesh[];
}

function partGeometry(p: ModelPart): { geo: THREE.BufferGeometry; scale?: [number, number, number] } {
  const [a, b, c] = p.size;
  switch (p.shape) {
    case 'box':
      return { geo: boxGeo(a, b, c) };
    case 'roundBox':
      return { geo: roundBoxGeo(a, b, c, Math.min(a, b, c) * 0.25) };
    case 'sphere':
      return { geo: sphereGeo(20), scale: [a, b, c] };
    case 'capsule':
      return { geo: capsuleGeo(a, b) };
    case 'cylinder':
      return { geo: cylinderGeo(a, b, c) };
    case 'cone':
      return { geo: coneGeo(a, b) };
    case 'torus':
      return { geo: torusGeo(a, b) };
    case 'disc':
      return { geo: discGeo(a) };
  }
}

export function buildModel(spec: ModelSpec, mats: MaterialLibrary, extraParts: ModelPart[] = [], opts: { merge?: boolean } = {}): BuiltModel {
  const root = new THREE.Group();
  const scaleRoot = new THREE.Group();
  root.add(scaleRoot);
  if (spec.scale) scaleRoot.scale.setScalar(spec.scale);
  const slots = new Map<string, THREE.Object3D>();
  const rest = new Map<string, { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 }>();
  const meshes: THREE.Mesh[] = [];
  slots.set('root', scaleRoot);

  for (const p of [...spec.parts, ...extraParts]) {
    const { geo, scale } = partGeometry(p);
    const mat = mats.get(p.color, {
      roughness: p.roughness,
      metalness: p.metalness,
      emissive: p.emissive,
      emissiveIntensity: p.emissiveIntensity,
      side: p.shape === 'disc' ? THREE.DoubleSide : undefined,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !p.noShadow;
    mesh.receiveShadow = false;
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    meshes.push(mesh);

    let node: THREE.Object3D = mesh;
    if (scale && !p.offset) {
      // children of spheres live in unscaled (metre) space: wrap the scaled mesh
      const holder = new THREE.Group();
      holder.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.rot) holder.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      holder.add(mesh);
      node = holder;
    } else if (p.offset) {
      const joint = new THREE.Group();
      joint.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.rot) joint.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      mesh.position.set(p.offset[0], p.offset[1], p.offset[2]);
      joint.add(mesh);
      node = joint;
    } else {
      mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
      if (p.rot) mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    }
    if (scale && p.offset) mesh.scale.set(scale[0], scale[1], scale[2]);
    const parent = (p.parent && slots.get(p.parent)) || scaleRoot;
    parent.add(node);
    if (p.name && !slots.has(p.name)) {
      slots.set(p.name, node);
      rest.set(p.name, { pos: node.position.clone(), rot: node.rotation.clone(), scale: node.scale.clone() });
    }
  }
  const built = { root, slots, rest, meshes };
  return opts.merge === false ? built : mergeModel(built, mats);
}

/**
 * Draw-call optimisation: bakes every unnamed part into one mesh per
 * (animated joint, material, shadow flag). Named rig slots stay untouched, so
 * the procedural animator keeps working — a 40-part Grumbo becomes ~12 draws.
 */
/** Rig slots the procedural animators drive; everything else is static and mergeable. */
export const ANIMATED_SLOTS = ['root', 'body', 'head', 'tail', 'armL', 'armR', 'legL', 'legR', 'eye', 'eyeL', 'eyeR', 'jaw', 'gauge'];

export function mergeModel(m: BuiltModel, mats?: MaterialLibrary, animated: string[] = ANIMATED_SLOTS): BuiltModel {
  m.root.updateMatrixWorld(true);
  const anchors = new Set<THREE.Object3D>();
  for (const name of animated) {
    const n = m.slots.get(name);
    if (n) anchors.add(n);
  }
  const anchorOf = (o: THREE.Object3D): THREE.Object3D => {
    let a = o.parent!;
    while (a && !anchors.has(a) && a.parent) a = a.parent;
    return a;
  };
  // with a material library, colours move into vertex colours so every part with
  // the same surface (roughness/metalness/emissive) on a joint is ONE draw call
  const surfaceKey = (mat: THREE.MeshStandardMaterial) =>
    mats
      ? `${mat.roughness}|${mat.metalness}|${mat.emissive.getHexString()}|${mat.emissiveIntensity}|${mat.side}|${mat.flatShading ? 1 : 0}|${mat.transparent ? mat.opacity : 1}`
      : mat.uuid;
  const groups = new Map<THREE.Object3D, Map<string, THREE.Mesh[]>>();
  for (const mesh of m.meshes) {
    if (anchors.has(mesh)) continue; // animated meshes stay individual
    const a = anchorOf(mesh);
    const key = `${surfaceKey(mesh.material as THREE.MeshStandardMaterial)}|${mesh.castShadow ? 1 : 0}`;
    let byKey = groups.get(a);
    if (!byKey) groups.set(a, (byKey = new Map()));
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(mesh);
  }
  const keep = m.meshes.filter((x) => anchors.has(x));
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  for (const [anchor, byKey] of groups) {
    inv.copy(anchor.matrixWorld).invert();
    for (const list of byKey.values()) {
      const src = list[0].material as THREE.MeshStandardMaterial;
      const multiColour = !!mats && list.some((x) => !(x.material as THREE.MeshStandardMaterial).color.equals(src.color));
      if (list.length === 1) {
        keep.push(list[0]);
        continue;
      }
      const geos = list.map((mesh) => {
        rel.multiplyMatrices(inv, mesh.matrixWorld);
        let g = mesh.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        if (g.index) g = g.toNonIndexed();
        g.applyMatrix4(rel);
        if (multiColour) {
          const c = (mesh.material as THREE.MeshStandardMaterial).color;
          const n = g.attributes.position.count;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            col[i * 3] = c.r;
            col[i * 3 + 1] = c.g;
            col[i * 3 + 2] = c.b;
          }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        return g;
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) {
        keep.push(...list);
        continue;
      }
      const material = multiColour
        ? mats!.get('#ffffff', {
            roughness: src.roughness,
            metalness: src.metalness,
            emissive: src.emissive.getHex() ? `#${src.emissive.getHexString()}` : undefined,
            emissiveIntensity: src.emissiveIntensity,
            side: src.side,
            flat: src.flatShading,
            vertexColors: true,
          })
        : src;
      const mm = new THREE.Mesh(merged, material);
      mm.castShadow = list[0].castShadow;
      mm.receiveShadow = false;
      anchor.add(mm);
      keep.push(mm);
      for (const mesh of list) mesh.removeFromParent();
    }
  }
  // drop now-empty unnamed holder groups
  const prune = (o: THREE.Object3D): void => {
    for (const c of [...o.children]) {
      prune(c);
      if (!(c as THREE.Mesh).isMesh && !anchors.has(c) && c.children.length === 0) c.removeFromParent();
    }
  };
  prune(m.root);
  m.meshes.length = 0;
  m.meshes.push(...keep);
  return m;
}
