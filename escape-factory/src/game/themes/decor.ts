/**
 * Theme decorations for ESCAPE FACTORY (registered into the engine's decor
 * registry). Built from shared primitives + cached materials, so static decor
 * merges into the level's static geometry at near-zero draw-call cost.
 */
import * as THREE from 'three';
import { prop, registerDecorBounds } from '@engine/level/decorBounds';
import { decorRegistry, type DecorBuildCtx } from '@engine/render/decor';
import { boxGeo, coneGeo, cylinderGeo, roundBoxGeo, sphereGeo, torusGeo } from '@engine/render/geometry';

type M = THREE.Material;

function part(g: THREE.Group, geo: THREE.BufferGeometry, mat: M, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = shadow;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function reg(kind: string, build: (g: THREE.Group, c: DecorBuildCtx) => void): void {
  decorRegistry.register(kind, (c) => {
    const g = new THREE.Group();
    build(g, c);
    return { object: g };
  });
}

let done = false;

export function registerThemeDecor(): void {
  if (done) return;
  done = true;
  // camera-blocking bounds of the larger props (small ones are ignored)
  for (const [kind, r, h] of [
    ['plant', 0.5, 1.6], ['tree', 1.3, 4.4], ['neonSign', 0.9, 3.9], ['snowPile', 1.1, 0.6], ['iceCrystal', 0.6, 2.2],
    ['snowman', 0.65, 2.6], ['pineTree', 1.2, 4.3], ['lollipop', 0.75, 3.8], ['candyCane', 0.6, 3.3], ['coral', 0.7, 2.1],
    ['treasureChest', 0.6, 0.9], ['lavaRock', 0.9, 1.1], ['obsidianSpike', 0.6, 2.5], ['lavaVent', 1.0, 0.7],
    ['satDish', 1.0, 2.7], ['crystal', 0.6, 2.5], ['pumpkin', 0.8, 1.3], ['tombstone', 0.5, 1.6], ['deadTree', 0.9, 3.6],
    ['xmasTree', 1.3, 4.1], ['present', 0.7, 0.9], ['cupcake', 0.6, 1.3],
  ] as Array<[string, number, number]>)
    registerDecorBounds(kind, prop(r, h));
  const sphere = sphereGeo(14);

  // ---- NORMAL / generic
  reg('plant', (g, { mats, variant }) => {
    part(g, cylinderGeo(0.45, 0.35, 0.7, 10), mats.get('#d9825b', { roughness: 0.8 }), 0, 0.35, 0);
    const leaf = mats.get(variant % 2 ? '#52b788' : '#40916c', { roughness: 0.8 });
    for (let i = 0; i < 3; i++) part(g, sphere, leaf, Math.sin(i * 2.1) * 0.25, 1.0 + i * 0.25, Math.cos(i * 2.1) * 0.25, 0.45 - i * 0.08);
  });
  reg('tree', (g, { mats, variant }) => {
    part(g, cylinderGeo(0.22, 0.3, 2.4, 8), mats.get('#8d5a3b', { roughness: 0.9 }), 0, 1.2, 0);
    const leaf = mats.get(['#74c69d', '#52b788', '#95d5b2'][variant % 3], { roughness: 0.85 });
    part(g, sphere, leaf, 0, 3.1, 0, 1.3);
    part(g, sphere, leaf, 0.7, 2.6, 0.2, 0.8);
    part(g, sphere, leaf, -0.6, 2.7, -0.3, 0.85);
  });

  // ---- NIGHT
  reg('neonSign', (g, { mats, theme, variant }) => {
    const p = theme.palette;
    const col = [p.accent2, p.accent, p.laser][variant % 3];
    part(g, cylinderGeo(0.07, 0.07, 3.2, 6), mats.get(p.metal), 0, 1.6, 0);
    part(g, roundBoxGeo(1.8, 0.9, 0.15, 0.06), mats.get('#141826', { roughness: 0.5 }), 0, 3.4, 0);
    const neon = mats.get(col, { emissive: col, emissiveIntensity: 2.2, roughness: 0.3 });
    part(g, torusGeo(0.3, 0.05), neon, -0.45, 3.4, 0.1, 1, 1, 1, false);
    part(g, boxGeo(0.7, 0.09, 0.06), neon, 0.35, 3.55, 0.1, 1, 1, 1, false);
    part(g, boxGeo(0.7, 0.09, 0.06), neon, 0.35, 3.25, 0.1, 1, 1, 1, false);
  });
  reg('streetLamp', (g, { mats, theme }) => {
    const p = theme.palette;
    part(g, cylinderGeo(0.08, 0.12, 4.2, 8), mats.get(p.metal, { metalness: 0.5 }), 0, 2.1, 0);
    part(g, boxGeo(0.9, 0.08, 0.08), mats.get(p.metal, { metalness: 0.5 }), 0.4, 4.15, 0);
    part(g, sphere, mats.get('#fff1c1', { emissive: '#ffd27a', emissiveIntensity: 2.5 }), 0.8, 4.0, 0, 0.22, 0.22, 0.22, false);
  });

  // ---- WINTER
  reg('snowPile', (g, { mats, variant }) => {
    const snow = mats.get('#f4f9ff', { roughness: 0.95 });
    part(g, sphere, snow, 0, 0, 0, 1.1, 0.5, 0.9);
    part(g, sphere, snow, 0.7, 0, 0.3, 0.6, 0.35, 0.6);
    if (variant % 2) part(g, sphere, snow, -0.6, 0, -0.2, 0.5, 0.3, 0.5);
  });
  reg('iceCrystal', (g, { mats, variant }) => {
    const ice = mats.get('#a8dcff', { roughness: 0.15, metalness: 0.1, emissive: '#5ab4ff', emissiveIntensity: 0.35 });
    const n = 3 + (variant % 3);
    for (let i = 0; i < n; i++) {
      const h = 1.2 + ((i * 37) % 10) / 6;
      const c = part(g, coneGeo(0.28, h, 5), ice, Math.sin(i * 2.4) * 0.35, h / 2, Math.cos(i * 2.4) * 0.35);
      c.rotation.set(Math.sin(i) * 0.3, i, Math.cos(i * 1.7) * 0.3);
    }
  });
  reg('snowman', (g, { mats, theme }) => {
    const snow = mats.get('#f7fbff', { roughness: 0.9 });
    part(g, sphere, snow, 0, 0.6, 0, 0.65);
    part(g, sphere, snow, 0, 1.45, 0, 0.45);
    part(g, sphere, snow, 0, 2.05, 0, 0.32);
    const coal = mats.get('#222222');
    for (const x of [-0.11, 0.11]) part(g, sphere, coal, x, 2.12, 0.28, 0.045, 0.045, 0.045, false);
    const nose = part(g, coneGeo(0.06, 0.3, 8), mats.get('#ff8c1a'), 0, 2.03, 0.42, 1, 1, 1, false);
    nose.rotation.x = Math.PI / 2;
    part(g, cylinderGeo(0.36, 0.36, 0.1, 14), mats.get(theme.palette.danger), 0, 1.78, 0);
    part(g, cylinderGeo(0.2, 0.22, 0.35, 12), coal, 0, 2.42, 0);
  });
  reg('pineTree', (g, { mats, variant }) => {
    part(g, cylinderGeo(0.15, 0.2, 1, 6), mats.get('#6b4226'), 0, 0.5, 0);
    const green = mats.get(variant % 2 ? '#2d6a4f' : '#1b4332', { roughness: 0.85, flat: true });
    const snow = mats.get('#f4f9ff', { roughness: 0.95, flat: true });
    for (let i = 0; i < 3; i++) {
      part(g, coneGeo(1.2 - i * 0.3, 1.6, 7), green, 0, 1.4 + i * 0.95, 0);
      part(g, coneGeo(0.55 - i * 0.12, 0.5, 7), snow, 0, 2.0 + i * 0.95, 0, 1, 1, 1, false);
    }
  });

  // ---- CANDY
  reg('lollipop', (g, { mats, variant }) => {
    part(g, cylinderGeo(0.06, 0.06, 2.6, 6), mats.get('#ffffff', { roughness: 0.4 }), 0, 1.3, 0);
    const col = ['#ff5d8f', '#8338ec', '#3a86ff', '#ffbe0b'][variant % 4];
    const disc = part(g, cylinderGeo(0.75, 0.75, 0.18, 20), mats.get(col, { roughness: 0.25 }), 0, 3.0, 0);
    disc.rotation.x = Math.PI / 2;
    part(g, torusGeo(0.42, 0.08), mats.get('#ffffff', { roughness: 0.25 }), 0, 3.0, 0.08, 1, 1, 1, false);
  });
  reg('gumdrop', (g, { mats, variant }) => {
    const cols = ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#06d6a0'];
    for (let i = 0; i < 2 + (variant % 2); i++) {
      const m = mats.get(cols[(variant + i) % cols.length], { roughness: 0.2 });
      part(g, sphere, m, i * 0.8 - 0.4, 0.3, (i % 2) * 0.5, 0.45, 0.55, 0.45);
    }
  });
  reg('candyCane', (g, { mats }) => {
    const red = mats.get('#e63946', { roughness: 0.3 });
    const white = mats.get('#ffffff', { roughness: 0.3 });
    for (let i = 0; i < 6; i++) part(g, cylinderGeo(0.14, 0.14, 0.45, 10), i % 2 ? red : white, 0, 0.22 + i * 0.45, 0);
    part(g, torusGeo(0.4, 0.14), red, 0.4, 2.85, 0);
  });
  reg('cupcake', (g, { mats, variant }) => {
    part(g, cylinderGeo(0.6, 0.45, 0.6, 12), mats.get('#c97c5d', { roughness: 0.8 }), 0, 0.3, 0);
    part(g, sphere, mats.get(['#ffafcc', '#cdb4db', '#bde0fe'][variant % 3], { roughness: 0.5 }), 0, 0.75, 0, 0.62, 0.4, 0.62);
    part(g, sphere, mats.get('#e63946', { roughness: 0.3 }), 0, 1.15, 0, 0.14);
  });

  // ---- UNDERWATER
  reg('coral', (g, { mats, variant }) => {
    const col = ['#ff7f50', '#ff9fb2', '#c77dff', '#ffb703'][variant % 4];
    const m = mats.get(col, { roughness: 0.7 });
    for (let i = 0; i < 5; i++) {
      const h = 0.9 + ((i * 29) % 7) / 5;
      const b = part(g, cylinderGeo(0.08, 0.14, h, 6), m, Math.sin(i * 1.9) * 0.4, h / 2, Math.cos(i * 1.9) * 0.4);
      b.rotation.set(Math.sin(i * 3) * 0.4, 0, Math.cos(i * 2) * 0.4);
      part(g, sphere, m, b.position.x * 1.4, h, b.position.z * 1.4, 0.16);
    }
  });
  decorRegistry.register('seaweed', ({ mats, variant }) => {
    const g = new THREE.Group();
    const m = mats.get(variant % 2 ? '#2a9d8f' : '#40916c', { roughness: 0.8 });
    const blades: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const b = part(g, boxGeo(0.12, 2.4 + i * 0.4, 0.04), m, i * 0.25 - 0.25, 1.2 + i * 0.2, 0);
      blades.push(b);
    }
    return {
      object: g,
      animate: (t) => {
        for (let i = 0; i < blades.length; i++) blades[i].rotation.z = Math.sin(t * 1.3 + i + variant) * 0.18;
      },
    };
  });
  reg('shell', (g, { mats, variant }) => {
    const m = mats.get(['#ffd6a5', '#ffadad', '#fdffb6'][variant % 3], { roughness: 0.5 });
    const c = part(g, coneGeo(0.45, 0.9, 9), m, 0, 0.3, 0);
    c.rotation.z = Math.PI / 2.4;
    part(g, sphere, mats.get('#f1faee', { roughness: 0.3 }), 0.6, 0.12, 0.3, 0.14);
  });
  reg('treasureChest', (g, { mats }) => {
    part(g, roundBoxGeo(1.1, 0.6, 0.7, 0.05), mats.get('#8d5524', { roughness: 0.8 }), 0, 0.3, 0);
    part(g, cylinderGeo(0.35, 0.35, 1.1, 12).rotateZ(Math.PI / 2), mats.get('#a0522d', { roughness: 0.8 }), 0, 0.62, 0, 1, 1, 1);
    part(g, boxGeo(1.14, 0.1, 0.74), mats.get('#ffd166', { metalness: 0.6, roughness: 0.3 }), 0, 0.6, 0);
    part(g, sphere, mats.get('#ffd700', { emissive: '#ffb703', emissiveIntensity: 0.6, metalness: 0.7 }), 0.2, 0.75, 0.2, 0.12);
  });

  // ---- VOLCANO
  reg('lavaRock', (g, { mats, variant }) => {
    const rock = mats.get('#3b2f2f', { roughness: 0.95, flat: true });
    const glow = mats.get('#ff6d00', { emissive: '#ff4800', emissiveIntensity: 1.6 });
    const r = part(g, new THREE.DodecahedronGeometry(0.8, 0), rock, 0, 0.45, 0, 1, 0.7, 1);
    r.rotation.y = variant;
    part(g, boxGeo(0.9, 0.06, 0.08), glow, 0, 0.7, 0.55, 1, 1, 1, false).rotation.y = 0.4;
    if (variant % 2) part(g, new THREE.DodecahedronGeometry(0.45, 0), rock, 0.9, 0.25, 0.2);
  });
  reg('obsidianSpike', (g, { mats, variant }) => {
    const m = mats.get('#1c1424', { roughness: 0.2, metalness: 0.3, flat: true });
    for (let i = 0; i < 3 + (variant % 2); i++) {
      const h = 1.4 + i * 0.5;
      const c = part(g, coneGeo(0.35, h, 5), m, Math.sin(i * 2) * 0.4, h / 2, Math.cos(i * 2) * 0.4);
      c.rotation.z = Math.sin(i * 1.3) * 0.25;
    }
  });
  reg('lavaVent', (g, { mats }) => {
    part(g, cylinderGeo(0.7, 1.0, 0.6, 10), mats.get('#2d2424', { roughness: 0.95, flat: true }), 0, 0.3, 0);
    part(g, cylinderGeo(0.5, 0.5, 0.1, 10), mats.get('#ff7b00', { emissive: '#ff4d00', emissiveIntensity: 2 }), 0, 0.62, 0, 1, 1, 1, false);
  });

  // ---- SPACE
  reg('antenna', (g, { mats, theme }) => {
    const p = theme.palette;
    part(g, cylinderGeo(0.06, 0.12, 4, 6), mats.get(p.metal, { metalness: 0.6 }), 0, 2, 0);
    for (let i = 0; i < 3; i++) part(g, boxGeo(0.9 - i * 0.25, 0.05, 0.05), mats.get(p.metal, { metalness: 0.6 }), 0, 2.8 + i * 0.45, 0);
    part(g, sphere, mats.get(p.danger, { emissive: p.danger, emissiveIntensity: 2 }), 0, 4.1, 0, 0.12, 0.12, 0.12, false);
  });
  reg('satDish', (g, { mats, theme }) => {
    const p = theme.palette;
    part(g, cylinderGeo(0.1, 0.18, 1.6, 8), mats.get(p.metal), 0, 0.8, 0);
    const dish = part(g, sphere, mats.get('#e9ecef', { roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }), 0, 1.9, 0, 1.0, 0.35, 1.0);
    dish.rotation.x = -0.7;
    part(g, cylinderGeo(0.03, 0.03, 0.9, 5), mats.get(p.metal), 0, 2.15, 0.25).rotation.x = -0.7;
  });
  reg('crystal', (g, { mats, theme, variant }) => {
    const col = [theme.palette.accent2, theme.palette.vanish, '#72efdd'][variant % 3];
    const m = mats.get(col, { roughness: 0.15, emissive: col, emissiveIntensity: 0.8, flat: true });
    for (let i = 0; i < 3; i++) {
      const h = 1.0 + i * 0.6;
      const c = part(g, new THREE.OctahedronGeometry(0.4, 0), m, Math.sin(i * 2.2) * 0.4, h * 0.6, Math.cos(i * 2.2) * 0.4, 0.8, h, 0.8);
      c.rotation.z = Math.sin(i) * 0.3;
    }
  });

  // ---- HALLOWEEN
  reg('pumpkin', (g, { mats, variant }) => {
    const orange = mats.get('#f77f00', { roughness: 0.55 });
    const n = 1 + (variant % 2);
    for (let i = 0; i < n; i++) {
      const s = i ? 0.45 : 0.7;
      const x = i * 0.9;
      part(g, sphere, orange, x, s * 0.8, 0, s, s * 0.8, s);
      part(g, cylinderGeo(0.06, 0.08, 0.25, 6), mats.get('#3a5a40'), x, s * 1.6, 0);
      const face = mats.get('#ffd166', { emissive: '#ffb703', emissiveIntensity: 2.2 });
      for (const ex of [-0.22, 0.22]) part(g, coneGeo(0.1, 0.14, 3), face, x + ex * s * 1.4, s * 0.95, s * 0.95, 1, 1, 0.4, false);
      part(g, boxGeo(0.4 * s, 0.08, 0.05), face, x, s * 0.55, s * 0.97, 1, 1, 1, false);
    }
  });
  reg('tombstone', (g, { mats, variant }) => {
    const stone = mats.get('#8d99ae', { roughness: 0.95 });
    part(g, roundBoxGeo(0.9, 1.2, 0.25, 0.1), stone, 0, 0.6, 0).rotation.z = (variant % 3 - 1) * 0.08;
    part(g, cylinderGeo(0.45, 0.45, 0.25, 14).rotateX(Math.PI / 2), stone, 0, 1.2, 0);
    part(g, boxGeo(0.5, 0.08, 0.05), mats.get('#4a4e69'), 0, 0.95, 0.14, 1, 1, 1, false);
    part(g, boxGeo(0.08, 0.4, 0.05), mats.get('#4a4e69'), 0, 0.95, 0.14, 1, 1, 1, false);
  });
  reg('deadTree', (g, { mats }) => {
    const bark = mats.get('#2b2033', { roughness: 0.95 });
    part(g, cylinderGeo(0.12, 0.28, 3.2, 6), bark, 0, 1.6, 0);
    for (let i = 0; i < 4; i++) {
      const br = part(g, cylinderGeo(0.04, 0.1, 1.4, 5), bark, 0, 2.2 + i * 0.3, 0);
      br.rotation.set(0, i * 1.7, 0.9);
      br.position.x = Math.cos(i * 1.7) * 0.45;
      br.position.z = -Math.sin(i * 1.7) * 0.45;
    }
  });
  reg('candle', (g, { mats }) => {
    const wax = mats.get('#f1e3c8', { roughness: 0.6 });
    const flame = mats.get('#ffd166', { emissive: '#ff9f1c', emissiveIntensity: 3 });
    for (let i = 0; i < 3; i++) {
      const h = 0.5 + i * 0.25;
      part(g, cylinderGeo(0.09, 0.1, h, 8), wax, i * 0.25 - 0.25, h / 2, (i % 2) * 0.15);
      part(g, sphere, flame, i * 0.25 - 0.25, h + 0.08, (i % 2) * 0.15, 0.05, 0.1, 0.05, false);
    }
  });

  // ---- CHRISTMAS
  reg('xmasTree', (g, { mats, variant }) => {
    part(g, cylinderGeo(0.18, 0.22, 0.8, 6), mats.get('#6b4226'), 0, 0.4, 0);
    const green = mats.get('#2d6a4f', { roughness: 0.8, flat: true });
    for (let i = 0; i < 3; i++) part(g, coneGeo(1.3 - i * 0.32, 1.5, 8), green, 0, 1.2 + i * 0.85, 0);
    const cols = ['#e63946', '#ffd166', '#4cc9f0', '#f72585'];
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4 + variant;
      const y = 0.9 + (i / 10) * 2.4;
      const r = 1.15 - (i / 10) * 0.9;
      const c = cols[i % cols.length];
      part(g, sphere, mats.get(c, { emissive: c, emissiveIntensity: 1.2, roughness: 0.3 }), Math.sin(a) * r, y, Math.cos(a) * r, 0.1, 0.1, 0.1, false);
    }
    part(g, new THREE.OctahedronGeometry(0.25, 0), mats.get('#ffd700', { emissive: '#ffcc00', emissiveIntensity: 2 }), 0, 3.85, 0, 1, 1, 1, false);
  });
  reg('present', (g, { mats, variant }) => {
    const wraps = ['#e63946', '#2a9d8f', '#4361ee', '#f72585'];
    for (let i = 0; i < 1 + (variant % 3); i++) {
      const s = 0.8 - i * 0.18;
      const x = i * 0.7 - 0.3;
      const y = s / 2;
      const w = mats.get(wraps[(variant + i) % wraps.length], { roughness: 0.5 });
      const rib = mats.get('#ffd166', { roughness: 0.4 });
      const box = part(g, roundBoxGeo(s, s, s, 0.04), w, x, y, (i % 2) * 0.4);
      box.rotation.y = i * 0.5;
      const r1 = part(g, boxGeo(s * 1.03, s * 1.03, s * 0.16), rib, x, y, box.position.z, 1, 1, 1, false);
      r1.rotation.y = i * 0.5;
      const r2 = part(g, boxGeo(s * 0.16, s * 1.03, s * 1.03), rib, x, y, box.position.z, 1, 1, 1, false);
      r2.rotation.y = i * 0.5;
    }
  });
}
