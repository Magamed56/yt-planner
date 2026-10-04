/**
 * Builds and animates the visual representation of a level from LevelData.
 * Static geometry is merged per material (few draw calls); dynamic solids and
 * hazards get individual lightweight views updated from simulation state.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelData, SolidPiece } from '../level/types';
import type { DynamicSolid } from '../obstacle/SolidSystem';
import type { ThemeDef, ThemePalette } from '../theme/ThemeDef';
import type { World } from '../sim/World';
import { boxGeo, roundBoxGeo } from './geometry';
import type { MaterialLibrary } from './materials';

export interface ViewPart {
  update(world: World, t: number, dt: number): void;
  dispose?(): void;
}

/** Hook for game/theme specific view builders (hazards, decor, checkpoints…). */
export interface LevelViewExtension {
  build(ctx: LevelViewContext): ViewPart[];
}

export interface LevelViewContext {
  level: LevelData;
  world: World;
  theme: ThemeDef;
  mats: MaterialLibrary;
  root: THREE.Group;
  /** collects static geometry to be merged by material */
  addStatic(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, material: THREE.Material): void;
}

export function styleColor(style: string, p: ThemePalette, module: number): string {
  switch (style) {
    case 'floor':
      return module % 2 === 0 ? p.floor : p.floorAlt;
    case 'platform':
      return p.platform;
    case 'bridge':
      return p.bridge;
    case 'grate':
      return p.metal;
    case 'wall':
      return p.wall;
    case 'conveyor':
      return p.conveyor;
    case 'trap':
    case 'tile':
      return p.trap;
    case 'moving':
      return p.moving;
    case 'vanish':
      return p.vanish;
    case 'crate':
      return '#c98b4f';
    case 'door':
      return p.metal;
    case 'pusher':
      return p.hazard;
    case 'barrier':
      return p.accent;
    case 'ice':
      return '#bfe9ff';
    case 'jelly':
      return '#ff7eb6';
    case 'checkpoint':
      return p.checkpoint;
    case 'finish':
      return p.accent2;
    default:
      return p.floor;
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

interface DynView {
  d: DynamicSolid;
  obj: THREE.Object3D;
  mat: THREE.MeshStandardMaterial | null;
  baseColor: THREE.Color;
  tex?: THREE.Texture;
  conv?: { u: number; v: number };
}

export class LevelView {
  readonly root = new THREE.Group();
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly dyn: DynView[] = [];
  private readonly parts: ViewPart[] = [];
  private readonly ownedGeo: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private stripeTex: THREE.Texture | null = null;
  staticMeshes = 0;

  constructor(
    readonly level: LevelData,
    world: World,
    readonly theme: ThemeDef,
    readonly mats: MaterialLibrary,
    extensions: LevelViewExtension[] = [],
  ) {
    const p = theme.palette;
    const dynamicIds = new Set(world.solids.dynamics.map((d) => d.piece.id));
    for (const piece of level.pieces) {
      if (piece.type !== 'solid') continue;
      if (dynamicIds.has(piece.id)) continue;
      this.addStaticSolid(piece, p);
    }
    for (const d of world.solids.dynamics) this.addDynamic(d, p);

    const ctx: LevelViewContext = {
      level,
      world,
      theme,
      mats,
      root: this.root,
      addStatic: (geo, m, mat) => this.pushStatic(geo, m, mat),
    };
    for (const ext of extensions) this.parts.push(...ext.build(ctx));
    this.flushStatic();
  }

  private pushStatic(geo: THREE.BufferGeometry, m: THREE.Matrix4, mat: THREE.Material): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    // keep attribute sets uniform for merging
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
  }

  private boxMatrix(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): THREE.Matrix4 {
    tmpP.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    tmpQ.identity();
    tmpS.set(1, 1, 1);
    return tmpM.compose(tmpP, tmpQ, tmpS);
  }

  private addStaticSolid(s: SolidPiece, p: ThemePalette): void {
    const b = s.box;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const d = b.maxZ - b.minZ;
    const color = styleColor(s.style, p, s.module);
    const mat = this.mats.get(color, { roughness: s.style === 'wall' ? 0.85 : 0.62, metalness: s.style === 'grate' ? 0.4 : 0.08 });
    this.pushStatic(roundBoxGeo(w, h, d, 0.07, 2), this.boxMatrix(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ), mat);
    if (s.walkable) {
      // bright edge trim for readability of platform edges
      const trim = this.mats.get(p.edge, { roughness: 0.4, emissive: p.edge, emissiveIntensity: 0.12 });
      const t = 0.09;
      const y0 = b.maxY - 0.005;
      const y1 = b.maxY + 0.035;
      if (d > 0.6) {
        this.pushStatic(boxGeo(t, y1 - y0, d - 0.04), this.boxMatrix(b.minX + 0.02, y0, b.minZ + 0.02, b.minX + 0.02 + t, y1, b.maxZ - 0.02), trim);
        this.pushStatic(boxGeo(t, y1 - y0, d - 0.04), this.boxMatrix(b.maxX - 0.02 - t, y0, b.minZ + 0.02, b.maxX - 0.02, y1, b.maxZ - 0.02), trim);
      }
      if (w > 0.6) {
        this.pushStatic(boxGeo(w - 0.04, y1 - y0, t), this.boxMatrix(b.minX + 0.02, y0, b.minZ + 0.02, b.maxX - 0.02, y1, b.minZ + 0.02 + t), trim);
        this.pushStatic(boxGeo(w - 0.04, y1 - y0, t), this.boxMatrix(b.minX + 0.02, y0, b.maxZ - 0.02 - t, b.maxX - 0.02, y1, b.maxZ - 0.02), trim);
      }
      // support pillar into the abyss (depth cue), only under larger floors
      if (w * d > 6 && s.style !== 'bridge') {
        const pil = this.mats.get(p.pillar, { roughness: 0.9 });
        const pw = Math.min(1.2, w * 0.3);
        const pd = Math.min(1.2, d * 0.3);
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const len = 26;
        this.pushStatic(boxGeo(pw, len, pd), this.boxMatrix(cx - pw / 2, b.minY - len, cz - pd / 2, cx + pw / 2, b.minY, cz + pd / 2), pil);
      }
    }
  }

  private getStripeTexture(): THREE.Texture {
    if (this.stripeTex) return this.stripeTex;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a2f3d';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#4a5268';
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 16, 64, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.stripeTex = tex;
    return tex;
  }

  private addDynamic(d: DynamicSolid, p: ThemePalette): void {
    const b = d.base;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const dd = b.maxZ - b.minZ;
    const s = d.piece;
    const style = s.vanish && s.style === 'floor' ? 'vanish' : s.motion && s.style === 'floor' ? 'moving' : s.style;
    const color = styleColor(style, p, s.module);
    const mat = this.mats.unique(color, { roughness: 0.5, metalness: 0.1 });
    this.ownedMats.push(mat);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(roundBoxGeo(w, h, dd, 0.08, 2), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    let tex: THREE.Texture | undefined;
    let conv: { u: number; v: number } | undefined;
    if (s.conveyor) {
      tex = this.getStripeTexture().clone();
      tex.needsUpdate = true;
      tex.repeat.set(w / 2, dd / 2);
      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 0.1, dd - 0.1),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
      );
      this.ownedGeo.push(top.geometry);
      this.ownedMats.push(top.material as THREE.Material);
      top.rotation.x = -Math.PI / 2;
      top.position.y = h / 2 + 0.01;
      top.receiveShadow = true;
      group.add(top);
      conv = { u: -s.conveyor.x / 2, v: s.conveyor.z / 2 };
    }
    if (s.walkable && !s.conveyor) {
      // glowing top rim makes moving/vanishing platforms read clearly
      const rim = new THREE.Mesh(boxGeo(w - 0.06, 0.05, dd - 0.06), this.mats.get(p.edge, { emissive: p.edge, emissiveIntensity: 0.25 }));
      rim.position.y = h / 2 + 0.005;
      rim.scale.set(1, 1, 1);
      group.add(rim);
    }
    if (s.style === 'pusher' || s.style === 'door') {
      // hazard stripes
      const stripeMat = this.mats.get(p.stripe, { roughness: 0.6 });
      const n = Math.max(2, Math.floor(Math.max(w, dd) / 0.8));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n - 0.5;
        const st = new THREE.Mesh(boxGeo(w > dd ? 0.25 : w + 0.02, h * 0.18, w > dd ? dd + 0.02 : 0.25), stripeMat);
        st.position.set(w > dd ? k * w : 0, h * 0.3, w > dd ? 0 : k * dd);
        group.add(st);
      }
    }
    group.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    this.root.add(group);
    this.dyn.push({ d, obj: group, mat, baseColor: new THREE.Color(color), tex, conv });
  }

  private flushStatic(): void {
    for (const [mat, list] of this.buckets) {
      if (list.length === 0) continue;
      // merge in chunks to keep frustum culling useful
      const CHUNK = 64;
      for (let i = 0; i < list.length; i += CHUNK) {
        const merged = mergeGeometries(list.slice(i, i + CHUNK), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        this.ownedGeo.push(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.root.add(mesh);
        this.staticMeshes++;
      }
      for (const g of list) g.dispose();
    }
    this.buckets.clear();
  }

  update(world: World, t: number, dt: number): void {
    for (const v of this.dyn) {
      const d = v.d;
      const b = d.base;
      const shake = d.warn > 0 ? Math.sin(t * 60) * 0.05 * d.warn : 0;
      v.obj.position.set((b.minX + b.maxX) / 2 + d.ox + shake, (b.minY + b.maxY) / 2 + d.oy + d.fallY, (b.minZ + b.maxZ) / 2 + d.oz - shake);
      const gone = d.state === 'gone' || d.broken;
      v.obj.visible = !gone || d.fallY > -30;
      if (d.piece.vanish?.kind === 'cycle') v.obj.visible = d.state !== 'gone';
      if (v.mat) {
        const flash = d.warn > 0 ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
        v.mat.emissive.setRGB(flash * 0.6, flash * 0.15, flash * 0.1);
      }
      if (v.tex && v.conv) {
        v.tex.offset.x += v.conv.u * dt;
        v.tex.offset.y += v.conv.v * dt;
      }
    }
    for (const part of this.parts) part.update(world, t, dt);
  }

  dispose(): void {
    for (const g of this.ownedGeo) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    for (const part of this.parts) part.dispose?.();
    this.stripeTex?.dispose();
    this.root.removeFromParent();
  }
}
