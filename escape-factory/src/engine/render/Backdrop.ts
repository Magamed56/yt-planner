/**
 * Environment backdrop: gradient sky dome, abyss far below the course and
 * distant theme silhouettes (smokestacks, gears, mountains, coral…) placed
 * along the track. All static and merged — a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { LevelData } from '../level/types';
import type { ThemeDef } from '../theme/ThemeDef';

export class Backdrop {
  readonly root = new THREE.Group();
  private readonly sky: THREE.Mesh;
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly stars: THREE.Points | null = null;

  constructor(level: LevelData, theme: ThemeDef) {
    const p = theme.palette;
    // ---- sky dome with vertical gradient
    const skyGeo = new THREE.SphereGeometry(600, 24, 16);
    const top = new THREE.Color(p.skyTop);
    const hor = new THREE.Color(p.skyHorizon);
    const abyss = new THREE.Color(p.abyss);
    const colors: number[] = [];
    const pos = skyGeo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 600;
      if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
      else c.copy(hor).lerp(abyss, Math.min(1, -y * 3));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);
    this.owned.push(skyGeo, skyMat);

    // ---- stars for night/space/spooky themes
    if (theme.backdrop === 'night' || theme.backdrop === 'space' || theme.backdrop === 'spooky' || theme.backdrop === 'xmas') {
      const rng = new Rng(7);
      const pts: number[] = [];
      for (let i = 0; i < 700; i++) {
        const th = rng.range(0, Math.PI * 2);
        const ph = rng.range(0.05, Math.PI / 2);
        pts.push(Math.cos(th) * Math.cos(ph) * 550, Math.sin(ph) * 550, Math.sin(th) * Math.cos(ph) * 550);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 });
      this.stars = new THREE.Points(g, m);
      this.stars.frustumCulled = false;
      this.root.add(this.stars);
      this.owned.push(g, m);
    }

    // ---- silhouettes along the track
    const rng = new Rng(level.seed ^ 0x5eed);
    const geos = new Map<string, THREE.BufferGeometry[]>();
    const add = (color: string, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) => {
      const gg = g.index ? g.toNonIndexed() : g.clone();
      gg.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz)));
      for (const n of Object.keys(gg.attributes)) if (n !== 'position' && n !== 'normal') gg.deleteAttribute(n);
      let list = geos.get(color);
      if (!list) geos.set(color, (list = []));
      list.push(gg);
      g.dispose();
    };
    const minY = level.minY;
    const spine = level.spine;
    const total = spine[spine.length - 1].s;
    const stepS = 26;
    // widest silhouette radius per backdrop style (mountains and volcanoes are huge)
    const footprint = ({ snow: 30, xmas: 30, volcano: 30, underwater: 16, space: 14, candy: 9, spooky: 6 } as Record<string, number>)[theme.backdrop] ?? 16;
    let idx = 0;
    for (let s = -40; s < total + 60; s += stepS) {
      // find spine point near s
      while (idx < spine.length - 2 && spine[idx + 1].s < s) idx++;
      const a = spine[Math.max(0, Math.min(idx, spine.length - 1))];
      const b = spine[Math.min(spine.length - 1, idx + 1)];
      const fx = b.x - a.x || 0;
      const fz = b.z - a.z || 1;
      const l = Math.hypot(fx, fz) || 1;
      const rx = -fz / l;
      const rz = fx / l;
      for (const side of [-1, 1]) {
        if (!rng.chance(0.8)) continue;
        const dist = rng.range(38, 95) + footprint;
        const x = a.x + rx * dist * side + rng.range(-8, 8);
        const z = a.z + rz * dist * side + rng.range(-8, 8);
        // the track turns: keep every silhouette clear of ALL of it, not just this stretch
        const clear = footprint + 26;
        if (spine.some((q) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < clear * clear)) continue;
        this.silhouette(theme, rng, add, x, minY - 30, z, p);
      }
    }
    const fogC = new THREE.Color(p.fog);
    for (const [color, list] of geos) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      // distant silhouettes are pre-tinted toward the fog for aerial perspective
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(fogC, 0.45), roughness: 0.95, metalness: 0 });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.owned.push(merged, mat);
    }

    // ---- abyss floor far below (depth cue + fog sink)
    const ag = new THREE.PlaneGeometry(4000, 4000);
    const am = new THREE.MeshStandardMaterial({ color: p.abyss, roughness: 1 });
    const abyssMesh = new THREE.Mesh(ag, am);
    abyssMesh.rotation.x = -Math.PI / 2;
    abyssMesh.position.y = minY - 34;
    this.root.add(abyssMesh);
    this.owned.push(ag, am);
  }

  private silhouette(
    theme: ThemeDef,
    rng: Rng,
    add: (color: string, g: THREE.BufferGeometry, x: number, y: number, z: number, ry?: number, sx?: number, sy?: number, sz?: number) => void,
    x: number,
    baseY: number,
    z: number,
    p: ThemeDef['palette'],
  ): void {
    const dark = p.wall;
    const mid = p.pillar;
    switch (theme.backdrop) {
      case 'factory':
      case 'lab':
      case 'night': {
        const kind = rng.int(0, 3);
        if (kind === 0) {
          // smokestack
          const h = rng.range(50, 95);
          add(dark, new THREE.CylinderGeometry(2.5, 4, h, 10), x, baseY + h / 2, z);
          add(p.danger, new THREE.CylinderGeometry(2.6, 2.6, 2, 10), x, baseY + h * 0.85, z);
          add(p.edge, new THREE.CylinderGeometry(2.7, 2.7, 1.5, 10), x, baseY + h * 0.7, z);
        } else if (kind === 1) {
          // building block with windows band
          const w = rng.range(14, 30);
          const h = rng.range(35, 70);
          add(mid, new THREE.BoxGeometry(w, h, w * 0.8), x, baseY + h / 2, z, rng.range(0, 1.5));
          add(dark, new THREE.BoxGeometry(w * 0.6, 8, w * 0.5), x, baseY + h + 4, z);
        } else if (kind === 2) {
          // giant gear
          const R = rng.range(8, 14);
          const gy = baseY + 22 + R;
          add(p.metal, new THREE.CylinderGeometry(R, R, 2.5, 20).rotateX(Math.PI / 2), x, gy, z, rng.range(0, 3));
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            add(p.metal, new THREE.BoxGeometry(2.4, 2.6, 2.5).rotateZ(a), x + Math.cos(a) * (R + 1), gy + Math.sin(a) * (R + 1), z);
          }
          add(dark, new THREE.CylinderGeometry(1.2, 1.2, 22, 8), x, baseY + 11, z);
        } else {
          // pipe tower
          const h = rng.range(40, 70);
          for (let i = 0; i < 3; i++) add(i === 1 ? p.pipe : dark, new THREE.CylinderGeometry(1.4, 1.4, h, 8), x + i * 3.2, baseY + h / 2, z);
        }
        break;
      }
      case 'snow':
      case 'xmas': {
        const h = rng.range(30, 70);
        add('#e8f4ff', new THREE.ConeGeometry(rng.range(15, 30), h, 7), x, baseY + 25 + h / 2, z, rng.range(0, 3));
        if (rng.chance(0.5)) add('#2d6a4f', new THREE.ConeGeometry(4, 16, 7), x + 12, baseY + 34, z);
        break;
      }
      case 'candy': {
        const h = rng.range(30, 60);
        add(rng.pick(['#ff8fab', '#ffd6e0', '#bde0fe', '#cdb4db']), new THREE.CylinderGeometry(1.2, 1.2, h, 8), x, baseY + h / 2 + 10, z);
        add(rng.pick(['#ff5d8f', '#ffd23f', '#80ed99']), new THREE.SphereGeometry(rng.range(5, 9), 12, 8), x, baseY + h + 12, z);
        break;
      }
      case 'underwater': {
        const h = rng.range(20, 45);
        add(rng.pick(['#ff7f50', '#ff9fb2', '#c77dff']), new THREE.ConeGeometry(rng.range(3, 6), h, 6), x, baseY + 30 + h / 2, z);
        add('#1d3557', new THREE.DodecahedronGeometry(rng.range(8, 16), 0), x + 6, baseY + 30, z);
        break;
      }
      case 'space': {
        add(rng.pick(['#8d99ae', '#5c677d', '#b8c0ff']), new THREE.DodecahedronGeometry(rng.range(5, 14), 0), x, baseY + rng.range(20, 80), z, rng.range(0, 3));
        break;
      }
      case 'volcano': {
        const h = rng.range(35, 70);
        add('#3d2b2b', new THREE.ConeGeometry(rng.range(18, 30), h, 8), x, baseY + 25 + h / 2, z);
        add('#ff6d00', new THREE.CylinderGeometry(3, 5, 2, 8), x, baseY + 25 + h - 0.5, z);
        break;
      }
      case 'spooky': {
        const h = rng.range(25, 50);
        add('#2b2033', new THREE.CylinderGeometry(0.8, 2, h, 6), x, baseY + 25 + h / 2, z);
        add('#2b2033', new THREE.ConeGeometry(4, 10, 6), x, baseY + 25 + h + 4, z);
        break;
      }
    }
  }

  /** Keeps the sky centred on the camera. */
  update(camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    if (this.stars) this.stars.position.copy(camera.position);
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}
