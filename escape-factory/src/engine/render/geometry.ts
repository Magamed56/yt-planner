/** Cached procedural geometries (one instance per unique size). */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`box:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

/** Rounded box; radius is clamped so thin boxes keep a clean bevel. */
export function roundBoxGeo(w: number, h: number, d: number, radius = 0.08, segs = 2): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  if (r <= 0.005) return boxGeo(w, h, d);
  return cached(`rbox:${r3(w)}:${r3(h)}:${r3(d)}:${r3(r)}:${segs}`, () => new RoundedBoxGeometry(w, h, d, segs, r));
}

export function sphereGeo(segs = 20): THREE.BufferGeometry {
  return cached(`sphere:${segs}`, () => new THREE.SphereGeometry(1, segs, Math.max(8, Math.floor(segs * 0.6))));
}

export function capsuleGeo(radius: number, length: number): THREE.BufferGeometry {
  return cached(`caps:${r3(radius)}:${r3(length)}`, () => new THREE.CapsuleGeometry(radius, length, 6, 14));
}

export function cylinderGeo(rTop: number, rBottom: number, h: number, segs = 18): THREE.BufferGeometry {
  return cached(`cyl:${r3(rTop)}:${r3(rBottom)}:${r3(h)}:${segs}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segs));
}

export function coneGeo(r: number, h: number, segs = 16): THREE.BufferGeometry {
  return cached(`cone:${r3(r)}:${r3(h)}:${segs}`, () => new THREE.ConeGeometry(r, h, segs));
}

export function torusGeo(R: number, tube: number): THREE.BufferGeometry {
  return cached(`torus:${r3(R)}:${r3(tube)}`, () => new THREE.TorusGeometry(R, tube, 10, 24));
}

export function discGeo(r: number): THREE.BufferGeometry {
  return cached(`disc:${r3(r)}`, () => new THREE.CircleGeometry(r, 24));
}

export function planeGeo(w: number, h: number): THREE.BufferGeometry {
  return cached(`plane:${r3(w)}:${r3(h)}`, () => new THREE.PlaneGeometry(w, h));
}

export function geometryCacheSize(): number {
  return cache.size;
}
