/**
 * Decoration builders. Static decor is merged into the level's static
 * geometry (near-zero draw-call cost); animated decor stays as live objects.
 * Games/themes register extra kinds (pumpkins, candy canes, coral…).
 */
import * as THREE from 'three';
import type { ThemeDef } from '../theme/ThemeDef';
import type { World } from '../sim/World';
import { boxGeo, coneGeo, cylinderGeo, planeGeo, roundBoxGeo, sphereGeo, torusGeo } from './geometry';
import type { MaterialLibrary } from './materials';
import { mergeRigid } from './merge';

export interface DecorBuildCtx {
  mats: MaterialLibrary;
  theme: ThemeDef;
  variant: number;
}

export interface DecorBuilt {
  object: THREE.Object3D;
  /** animated decor gets a per-frame callback; omitted => merged as static */
  animate?: (t: number, world: World, obj: THREE.Object3D) => void;
}

export type DecorBuilder = (ctx: DecorBuildCtx) => DecorBuilt;

export class DecorRegistry {
  private readonly map = new Map<string, DecorBuilder>();
  register(kind: string, b: DecorBuilder): void {
    this.map.set(kind, b);
  }
  has(kind: string): boolean {
    return this.map.has(kind);
  }
  build(kind: string, ctx: DecorBuildCtx): DecorBuilt | null {
    const b = this.map.get(kind);
    return b ? b(ctx) : null;
  }
}

export const decorRegistry = new DecorRegistry();

// ---- helpers ---------------------------------------------------------------

const textCache = new Map<string, THREE.CanvasTexture>();

/** Cached canvas texture with bold text (signs, banners). */
export function textTexture(text: string, bg: string, fg: string, w = 256, h = 128): THREE.Texture {
  const key = `${text}|${bg}|${fg}|${w}|${h}`;
  let tex = textCache.get(key);
  if (tex) return tex;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return new THREE.Texture();
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = Math.max(4, h * 0.06);
  g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = h * 0.5;
  g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  while (g.measureText(text).width > w * 0.86 && size > 8) {
    size -= 2;
    g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  }
  g.fillText(text, w / 2, h / 2 + size * 0.04);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textCache.set(key, tex);
  return tex;
}

const signMatCache = new Map<string, THREE.MeshStandardMaterial>();
function signMaterial(text: string, bg: string, fg: string, emissive = 0.25): THREE.MeshStandardMaterial {
  const key = `${text}|${bg}|${fg}|${emissive}`;
  let m = signMatCache.get(key);
  if (!m) {
    const map = textTexture(text, bg, fg);
    m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: emissive, roughness: 0.6 });
    signMatCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// ---- standard factory decor ------------------------------------------------

decorRegistry.register('pipe', ({ mats, theme, variant }) => {
  const g = new THREE.Group();
  const p = theme.palette;
  const col = variant % 2 === 0 ? p.pipe : p.metal;
  const m = mats.get(col, { roughness: 0.4, metalness: 0.35 });
  const fl = mats.get(p.metal, { metalness: 0.6, roughness: 0.3 });
  const h = 5 + variant;
  for (let i = 0; i < 2 + (variant % 2); i++) {
    const r = 0.22 + i * 0.06;
    const x = i * 0.65 - 0.4;
    g.add(mesh(cylinderGeo(r, r, h, 12), m, x, h / 2 - 2, 0));
    for (let k = 0; k < 3; k++) g.add(mesh(cylinderGeo(r + 0.07, r + 0.07, 0.14, 12), fl, x, k * 1.6 - 1.4, 0, false));
  }
  const elbow = mesh(torusGeo(0.5, 0.22), m, -0.4 + 0.5, h - 2, 0);
  elbow.rotation.x = Math.PI / 2;
  g.add(elbow);
  return { object: g };
});

decorRegistry.register('crate', ({ mats, variant }) => {
  const g = new THREE.Group();
  const wood = mats.get('#c98b4f', { roughness: 0.85 });
  const band = mats.get('#8a5a2b', { roughness: 0.85 });
  const n = 1 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const s = 0.9 - i * 0.12;
    const y = i === 0 ? s / 2 : i * 0.85 + s / 2 - 0.05;
    const c = mesh(roundBoxGeo(s, s, s, 0.05), wood, i === 2 ? 0.25 : 0, y, i === 1 ? 0.1 : 0);
    c.rotation.y = i * 0.4;
    g.add(c);
    const b = mesh(boxGeo(s * 1.02, s * 0.12, s * 1.02), band, c.position.x, y, c.position.z, false);
    b.rotation.y = i * 0.4;
    g.add(b);
  }
  return { object: g };
});

decorRegistry.register('barrel', ({ mats, theme, variant }) => {
  const g = new THREE.Group();
  const cols = theme.palette.decor;
  const n = 1 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const m = mats.get(cols[(variant + i) % cols.length], { roughness: 0.5, metalness: 0.2 });
    const x = (i % 2) * 0.75;
    const z = Math.floor(i / 2) * 0.75;
    g.add(mesh(cylinderGeo(0.34, 0.34, 1.0, 14), m, x, 0.5, z));
    g.add(mesh(torusGeo(0.345, 0.03), mats.get('#2b2d42'), x, 0.8, z, false).rotateX(Math.PI / 2));
    g.add(mesh(torusGeo(0.345, 0.03), mats.get('#2b2d42'), x, 0.2, z, false).rotateX(Math.PI / 2));
  }
  return { object: g };
});

decorRegistry.register('gear', ({ mats, theme, variant }) => {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  const m = mats.get(variant % 2 ? theme.palette.metal : theme.palette.accent, { metalness: 0.55, roughness: 0.35 });
  const R = 1.4 + (variant % 3) * 0.5;
  inner.add(mesh(cylinderGeo(R, R, 0.3, 24), m).rotateX(Math.PI / 2));
  const teeth = 12 + variant * 2;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = mesh(boxGeo(0.35, 0.45, 0.3), m, Math.cos(a) * (R + 0.15), Math.sin(a) * (R + 0.15), 0, false);
    t.rotation.z = a;
    inner.add(t);
  }
  inner.add(mesh(cylinderGeo(R * 0.25, R * 0.25, 0.5, 12), mats.get('#2b2d42', { metalness: 0.6 })).rotateX(Math.PI / 2));
  inner.position.y = R + 1;
  mergeRigid(inner); // ~16 teeth + disc → 2 draw calls (geometries owned by the decor object)
  g.add(inner);
  const dir = variant % 2 ? 1 : -1;
  return {
    object: g,
    animate: (t) => {
      inner.rotation.z = t * 0.5 * dir;
    },
  };
});

decorRegistry.register('lamp', ({ mats, theme }) => {
  const g = new THREE.Group();
  const post = mats.get(theme.palette.wall, { roughness: 0.7 });
  g.add(mesh(cylinderGeo(0.07, 0.1, 3.2, 8), post, 0, 1.6, 0));
  g.add(mesh(boxGeo(0.9, 0.08, 0.08), post, 0.35, 3.15, 0));
  const shade = mesh(coneGeo(0.32, 0.3, 12), mats.get('#2b2d42'), 0.75, 3.0, 0);
  g.add(shade);
  const bulb = mesh(sphereGeo(10), mats.get('#fff4c2', { emissive: '#ffe08a', emissiveIntensity: 2.2 }), 0.75, 2.85, 0, false);
  bulb.scale.setScalar(0.14);
  g.add(bulb);
  const glow = mesh(sphereGeo(10), mats.unlit('#ffe9a8', 0.16, true), 0.75, 2.8, 0, false);
  glow.scale.setScalar(0.55);
  g.add(glow);
  return { object: g };
});

decorRegistry.register('sign', ({ mats, theme, variant }) => {
  const texts = ['EXIT →', 'DANGER!', 'NO RUNNING', 'SHIFT 9', 'KEEP OUT', 'WET FLOOR', 'HARD HATS'];
  const g = new THREE.Group();
  const post = mats.get(theme.palette.metal, { metalness: 0.5 });
  g.add(mesh(cylinderGeo(0.05, 0.05, 2.2, 6), post, -0.6, 1.1, 0));
  g.add(mesh(cylinderGeo(0.05, 0.05, 2.2, 6), post, 0.6, 1.1, 0));
  const board = mesh(boxGeo(1.6, 0.8, 0.06), signMaterial(texts[variant % texts.length], theme.palette.accent, '#1d1d1f'), 0, 2.0, 0);
  g.add(board);
  return { object: g };
});

decorRegistry.register('warningSign', ({ mats, theme, variant }) => {
  const g = new THREE.Group();
  g.add(mesh(cylinderGeo(0.05, 0.05, 1.8, 6), mats.get(theme.palette.metal), 0, 0.9, 0));
  const tri = mesh(cylinderGeo(0.55, 0.55, 0.05, 3), mats.get(theme.palette.accent, { emissive: theme.palette.accent, emissiveIntensity: 0.2 }), 0, 2.0, 0);
  tri.rotation.set(Math.PI / 2, 0, Math.PI / 2 + Math.PI);
  g.add(tri);
  g.add(mesh(boxGeo(0.08, 0.32, 0.07), mats.get('#1d1d1f'), 0, 2.02, 0.02, false));
  void variant;
  return { object: g };
});

decorRegistry.register('arrowSign', ({ theme, variant }) => {
  const g = new THREE.Group();
  const board = mesh(boxGeo(1.8, 0.9, 0.08), signMaterial(variant ? '→ →' : '← ←', theme.palette.accent, '#1d1d1f', 0.5), 0, 0, 0);
  g.add(board);
  return { object: g };
});

decorRegistry.register('vent', ({ mats, theme }) => {
  const g = new THREE.Group();
  g.add(mesh(roundBoxGeo(1.4, 0.3, 1.4, 0.06), mats.get(theme.palette.metal, { metalness: 0.5 }), 0, 0.15, 0));
  for (let i = -2; i <= 2; i++) g.add(mesh(boxGeo(1.2, 0.05, 0.08), mats.get('#1d1d1f'), 0, 0.31, i * 0.22, false));
  return { object: g };
});

decorRegistry.register('beacon', ({ mats, theme }) => {
  const g = new THREE.Group();
  g.add(mesh(cylinderGeo(0.12, 0.16, 1.2, 8), mats.get(theme.palette.wall), 0, 0.6, 0));
  const head = new THREE.Group();
  head.position.y = 1.35;
  head.add(mesh(sphereGeo(12), mats.get(theme.palette.accent, { emissive: theme.palette.accent, emissiveIntensity: 1.6 }), 0, 0, 0, false));
  (head.children[0] as THREE.Mesh).scale.setScalar(0.2);
  const beam = new THREE.Mesh(coneGeo(0.5, 2.2, 10), mats.unlit(theme.palette.accent, 0.18, true));
  beam.rotation.z = Math.PI / 2;
  beam.position.x = 1.1;
  head.add(beam);
  g.add(head);
  return {
    object: g,
    animate: (t) => {
      head.rotation.y = t * 3;
    },
  };
});

decorRegistry.register('alarmLight', ({ mats, theme }) => {
  const g = new THREE.Group();
  const mat = mats.unique(theme.palette.danger, { emissive: theme.palette.danger, emissiveIntensity: 0.2 });
  const bulb = mesh(sphereGeo(12), mat, 0, 0, 0, false);
  bulb.scale.set(0.25, 0.18, 0.25);
  g.add(bulb);
  g.add(mesh(cylinderGeo(0.28, 0.28, 0.08, 12), mats.get('#2b2d42'), 0, -0.12, 0, false));
  return {
    object: g,
    animate: (t, world) => {
      const active = world.enemy?.isChasing || world.events.log.length > 0 && t - lastAlarm(world) < 3;
      mat.emissiveIntensity = active ? 1 + 2 * Math.max(0, Math.sin(t * 12)) : 0.2;
    },
  };
});

function lastAlarm(world: World): number {
  for (let i = world.events.log.length - 1; i >= 0 && i > world.events.log.length - 60; i--) {
    const e = world.events.log[i];
    if (e.type === 'ALARM' || e.type === 'DOOR_CLOSE' || e.type === 'CHASE_START') return e.t;
  }
  return -99;
}

decorRegistry.register('chain', ({ mats }) => {
  const g = new THREE.Group();
  const m = mats.get('#5c6378', { metalness: 0.7, roughness: 0.35 });
  for (let i = 0; i < 9; i++) {
    const l = mesh(torusGeo(0.12, 0.035), m, 0, -i * 0.2, 0, false);
    l.rotation.y = (i % 2) * (Math.PI / 2);
    g.add(l);
  }
  const ball = mesh(sphereGeo(10), m, 0, -1.9, 0);
  ball.scale.setScalar(0.18);
  g.add(ball);
  return { object: g };
});

decorRegistry.register('balcony', ({ mats, theme }) => {
  const g = new THREE.Group();
  const p = theme.palette;
  g.add(mesh(roundBoxGeo(4.8, 0.6, 4.8, 0.1), mats.get(p.platform, { roughness: 0.6 }), 0, -0.3, 0));
  const rail = mats.get(p.accent, { roughness: 0.4 });
  for (const s of [-1, 1]) {
    g.add(mesh(boxGeo(0.1, 0.1, 4.6), rail, s * 2.3, 1.0, 0, false));
    g.add(mesh(boxGeo(4.6, 0.1, 0.1), rail, 0, 1.0, s * 2.3, false));
  }
  for (const [x, z] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) g.add(mesh(cylinderGeo(0.06, 0.06, 1.0, 6), rail, x, 0.5, z, false));
  g.add(mesh(cylinderGeo(0.5, 0.7, 18, 8), mats.get(p.pillar, { roughness: 0.9 }), 0, -9.6, 0));
  return { object: g };
});

decorRegistry.register('ledge', ({ mats, theme }) => {
  const g = new THREE.Group();
  g.add(mesh(roundBoxGeo(1.6, 0.4, 2.2, 0.08), mats.get(theme.palette.platform), 0, -0.2, 0));
  return { object: g };
});

decorRegistry.register('gate', ({ mats, theme }) => {
  const g = new THREE.Group();
  const p = theme.palette;
  const frame = mats.get(p.wall, { roughness: 0.7 });
  g.add(mesh(boxGeo(0.8, 6, 1.2), frame, -4.2, 3, 0));
  g.add(mesh(boxGeo(0.8, 6, 1.2), frame, 4.2, 3, 0));
  g.add(mesh(boxGeo(9.2, 1, 1.2), frame, 0, 6.2, 0));
  const door = mats.get(p.metal, { metalness: 0.5, roughness: 0.4 });
  g.add(mesh(boxGeo(3.8, 5.4, 0.3), door, -1.95, 2.7, -0.2));
  g.add(mesh(boxGeo(3.8, 5.4, 0.3), door, 1.95, 2.7, -0.2));
  const st = mats.get(p.stripe);
  const yl = mats.get(p.accent);
  for (let i = 0; i < 8; i++) g.add(mesh(boxGeo(0.45, 0.5, 0.32), i % 2 ? st : yl, -3.6 + i * 1.02, 0.25, -0.2, false));
  g.add(mesh(boxGeo(3, 0.7, 0.1), signMaterial('NO WAY BACK', p.danger, '#ffffff', 0.4), 0, 6.2, 0.62, false));
  return { object: g };
});

decorRegistry.register('elevatorFrame', ({ mats, theme }) => {
  const g = new THREE.Group();
  const m = mats.get(theme.palette.metal, { metalness: 0.5 });
  for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) g.add(mesh(boxGeo(0.18, 9, 0.18), m, x, 1.5, z));
  g.add(mesh(boxGeo(3.6, 0.2, 3.6), m, 0, 6, 0));
  return { object: g };
});

decorRegistry.register('checkpointBeacon', ({ mats, theme }) => {
  const g = new THREE.Group();
  g.add(mesh(cylinderGeo(0.1, 0.14, 2.6, 8), mats.get(theme.palette.metal, { metalness: 0.5 }), 0, 1.3, 0));
  const mat = mats.unique('#888888', { emissive: '#ff4040', emissiveIntensity: 1.2 });
  const orb = mesh(sphereGeo(14), mat, 0, 2.75, 0, false);
  orb.scale.setScalar(0.28);
  g.add(orb);
  const flagMat = mats.unique('#ff4040', { side: THREE.DoubleSide, roughness: 0.6 });
  const flag = mesh(planeGeo(0.9, 0.55), flagMat, 0.48, 2.25, 0, false);
  g.add(flag);
  const green = new THREE.Color('#3ddc84');
  const red = new THREE.Color('#ff4040');
  return {
    object: g,
    animate: (t, world, obj) => {
      // activated when the player has reached a checkpoint at or beyond this position
      let active = false;
      for (let i = 0; i <= world.checkpointIndex; i++) {
        const cp = world.level.checkpoints[i];
        if (cp && Math.hypot(cp.x - obj.position.x, cp.z - obj.position.z) < 8) active = true;
      }
      const c = active ? green : red;
      mat.emissive.copy(c);
      flagMat.color.copy(c);
      orb.scale.setScalar(0.28 * (active ? 1 + 0.15 * Math.sin(t * 6) : 1));
      flag.rotation.y = Math.sin(t * 3) * 0.3;
    },
  };
});

decorRegistry.register('exitGate', ({ mats, theme }) => {
  const g = new THREE.Group();
  const p = theme.palette;
  const frame = mats.get(p.accent2, { roughness: 0.4, emissive: p.accent2, emissiveIntensity: 0.25 });
  g.add(mesh(roundBoxGeo(0.8, 6.5, 0.8, 0.15), frame, -4.4, 3.25, 0));
  g.add(mesh(roundBoxGeo(0.8, 6.5, 0.8, 0.15), frame, 4.4, 3.25, 0));
  g.add(mesh(roundBoxGeo(9.6, 1.2, 0.8, 0.15), frame, 0, 6.8, 0));
  g.add(mesh(boxGeo(5, 1.1, 0.12), signMaterial('EXIT', '#1fae5b', '#ffffff', 0.9), 0, 6.8, 0.47, false));
  const light = new THREE.Mesh(planeGeo(8, 6), mats.unlit('#fff8d6', 0.55, true));
  light.position.set(0, 3, -0.2);
  g.add(light);
  const beams = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(planeGeo(1.2, 14), mats.unlit('#fffbe8', 0.12, true));
    b.position.set(-3 + i * 1.5, 7, -2);
    b.rotation.z = -0.35 + i * 0.17;
    beams.add(b);
  }
  mergeRigid(beams);
  g.add(beams);
  mergeRigid(g, beams.children.slice());
  return {
    object: g,
    animate: (t) => {
      beams.rotation.y = Math.sin(t * 0.5) * 0.08;
    },
  };
});

decorRegistry.register('confettiCannon', ({ mats, theme }) => {
  const g = new THREE.Group();
  const c = mesh(cylinderGeo(0.25, 0.35, 0.9, 12), mats.get(theme.palette.accent, { roughness: 0.3 }), 0, 0.6, 0);
  c.rotation.x = -0.5;
  g.add(c);
  g.add(mesh(cylinderGeo(0.4, 0.45, 0.3, 12), mats.get('#2b2d42'), 0, 0.15, 0));
  return { object: g };
});

decorRegistry.register('bossPedestal', ({ mats, theme }) => {
  const g = new THREE.Group();
  const p = theme.palette;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(mesh(boxGeo(1.2, 0.4, 0.3), i % 2 ? mats.get(p.stripe) : mats.get(p.accent), Math.sin(a) * 2.85, -0.1, Math.cos(a) * 2.85, false).rotateY(a));
  }
  g.add(mesh(cylinderGeo(1.6, 2.2, 20, 10), mats.get(p.pillar, { roughness: 0.9 }), 0, -10.8, 0));
  return { object: g };
});

decorRegistry.register('bossBanner', ({ mats, theme }) => {
  const g = new THREE.Group();
  g.add(mesh(cylinderGeo(0.08, 0.08, 5, 6), mats.get(theme.palette.metal), 0, 2.5, 0));
  const banner = mesh(planeGeo(1.4, 2.2), signMaterial('BOSS', theme.palette.danger, '#ffffff', 0.5), 0.75, 3.6, 0, false);
  (banner.material as THREE.Material).side = THREE.DoubleSide;
  g.add(banner);
  return { object: g };
});

export function hasDecor(kind: string): boolean {
  return decorRegistry.has(kind);
}
