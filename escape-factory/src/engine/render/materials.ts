/**
 * Material library: one material per unique look, shared across meshes to
 * minimise state changes and allow geometry merging by material.
 */
import * as THREE from 'three';

export interface MatOpts {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  flat?: boolean;
  side?: THREE.Side;
  /** per-vertex colours (merged multi-colour meshes); `color` then tints */
  vertexColors?: boolean;
}

export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly basic = new Map<string, THREE.MeshBasicMaterial>();

  get(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${o.roughness ?? 0.7}|${o.metalness ?? 0.05}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 1}|${
      o.transparent ? o.opacity ?? 1 : 1
    }|${o.flat ? 1 : 0}|${o.side ?? 0}|${o.vertexColors ? 1 : 0}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: o.roughness ?? 0.7,
        metalness: o.metalness ?? 0.05,
        flatShading: o.flat ?? false,
        side: o.side ?? THREE.FrontSide,
        vertexColors: o.vertexColors ?? false,
      });
      if (o.emissive) {
        m.emissive = new THREE.Color(o.emissive);
        m.emissiveIntensity = o.emissiveIntensity ?? 1;
      }
      if (o.transparent) {
        m.transparent = true;
        m.opacity = o.opacity ?? 0.5;
        m.depthWrite = false;
      }
      this.cache.set(key, m);
    }
    return m;
  }

  /** Unlit material (beams, glows, UI-ish markers). */
  unlit(color: string, opacity = 1, additive = false): THREE.MeshBasicMaterial {
    const key = `${color}|${opacity}|${additive}`;
    let m = this.basic.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: opacity < 1 || additive,
        opacity,
        depthWrite: !(opacity < 1 || additive),
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.basic.set(key, m);
    }
    return m;
  }

  /** Private (non-shared) clone for per-object animated properties. */
  unique(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
    return this.get(color, o).clone();
  }

  get size(): number {
    return this.cache.size + this.basic.size;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    for (const m of this.basic.values()) m.dispose();
    this.cache.clear();
    this.basic.clear();
  }
}
