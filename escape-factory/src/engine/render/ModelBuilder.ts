/** Turns a data-driven ModelSpec into a Three.js hierarchy with named rig slots. */
import * as THREE from 'three';
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

export function buildModel(spec: ModelSpec, mats: MaterialLibrary, extraParts: ModelPart[] = []): BuiltModel {
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
    if (p.offset) {
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
    const parent = (p.parent && slots.get(p.parent)) || scaleRoot;
    parent.add(node);
    if (p.name && !slots.has(p.name)) {
      slots.set(p.name, node);
      rest.set(p.name, { pos: node.position.clone(), rot: node.rotation.clone(), scale: node.scale.clone() });
    }
  }
  return { root, slots, rest, meshes };
}
