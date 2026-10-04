/**
 * Visual builders for every hazard kind. Each view evaluates the same pure
 * hazard functions as the simulation at render time, so visuals and danger
 * are always in sync (telegraphs included).
 */
import * as THREE from 'three';
import type { HazardPiece } from '../level/types';
import type { HazardSpec } from '../obstacle/hazardTypes';
import { crusherState, fallerState, laserState, rollerForEach, slamLaneState, spinnerAngle } from '../obstacle/hazardEval';
import type { World } from '../sim/World';
import type { ThemeDef } from '../theme/ThemeDef';
import { boxGeo, cylinderGeo, discGeo, roundBoxGeo, sphereGeo, torusGeo } from './geometry';
import type { LevelViewContext, LevelViewExtension, ViewPart } from './LevelView';
import type { MaterialLibrary } from './materials';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpA = { x: 0, y: 0, z: 0 };
const tmpB = { x: 0, y: 0, z: 0 };

function localTime(world: World, spec: HazardSpec, t: number): number | null {
  return world.hazards.localTime(spec, t);
}

/** Builds a falling-object mesh in the theme's style. */
export function fallerMesh(style: string, size: number, mats: MaterialLibrary, theme: ThemeDef): THREE.Object3D {
  const g = new THREE.Group();
  const p = theme.palette;
  switch (style) {
    case 'barrel': {
      const m = new THREE.Mesh(cylinderGeo(size * 0.45, size * 0.45, size), mats.get(p.pipe, { roughness: 0.5, metalness: 0.3 }));
      g.add(m);
      for (const y of [-0.3, 0.3]) {
        const r = new THREE.Mesh(torusGeo(size * 0.46, 0.04), mats.get(p.metal, { metalness: 0.6 }));
        r.rotation.x = Math.PI / 2;
        r.position.y = y * size;
        g.add(r);
      }
      break;
    }
    case 'snowball': {
      const m = new THREE.Mesh(sphereGeo(16), mats.get('#f4fbff', { roughness: 0.9 }));
      m.scale.setScalar(size * 0.55);
      g.add(m);
      break;
    }
    case 'present': {
      g.add(new THREE.Mesh(roundBoxGeo(size, size, size, 0.06), mats.get(p.danger, { roughness: 0.5 })));
      g.add(new THREE.Mesh(boxGeo(size * 1.02, size * 1.02, size * 0.2), mats.get(p.accent, { roughness: 0.4 })));
      g.add(new THREE.Mesh(boxGeo(size * 0.2, size * 1.02, size * 1.02), mats.get(p.accent, { roughness: 0.4 })));
      break;
    }
    case 'candy': {
      const m = new THREE.Mesh(sphereGeo(16), mats.get('#ff5d8f', { roughness: 0.3 }));
      m.scale.set(size * 0.6, size * 0.45, size * 0.45);
      g.add(m);
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(cylinderGeo(0.01, size * 0.3, size * 0.3), mats.get('#ffe066', { roughness: 0.4 }));
        c.rotation.z = (s * Math.PI) / 2;
        c.position.x = s * size * 0.68;
        g.add(c);
      }
      break;
    }
    case 'rock':
    case 'meteor': {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(size * 0.55, 0), mats.get(style === 'meteor' ? '#5a4a42' : '#6b5d55', { roughness: 0.95, flat: true, emissive: style === 'meteor' ? '#ff5400' : undefined, emissiveIntensity: 0.6 }));
      g.add(m);
      break;
    }
    case 'pumpkin': {
      const m = new THREE.Mesh(sphereGeo(16), mats.get('#f77f00', { roughness: 0.6 }));
      m.scale.set(size * 0.55, size * 0.45, size * 0.55);
      g.add(m);
      break;
    }
    case 'shell': {
      const m = new THREE.Mesh(new THREE.ConeGeometry(size * 0.5, size * 0.9, 7), mats.get('#ffb4a2', { roughness: 0.5 }));
      g.add(m);
      break;
    }
    case 'crate':
    default: {
      g.add(new THREE.Mesh(roundBoxGeo(size, size, size, 0.05), mats.get('#c98b4f', { roughness: 0.8 })));
      const band = mats.get('#8a5a2b', { roughness: 0.8 });
      g.add(new THREE.Mesh(boxGeo(size * 1.02, size * 0.14, size * 1.02), band));
      const x = new THREE.Mesh(boxGeo(size * 0.12, size * 1.25, size * 1.03), band);
      x.rotation.x = Math.PI / 4;
      g.add(x);
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

function telegraphDisc(mats: MaterialLibrary, color: string, r: number): THREE.Mesh {
  const m = new THREE.Mesh(discGeo(r), mats.unlit(color, 0.55));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------------------

function spinnerView(h: Extract<HazardSpec, { kind: 'spinner' }>, ctx: LevelViewContext): ViewPart {
  const { mats, theme, root } = ctx;
  const p = theme.palette;
  const g = new THREE.Group();
  g.position.set(h.x, h.y, h.z);
  const hub = new THREE.Mesh(cylinderGeo(0.35, 0.45, h.y - (h.y - 0.6) + 0.6), mats.get(p.metal, { metalness: 0.6, roughness: 0.3 }));
  hub.position.y = -0.3;
  hub.castShadow = true;
  g.add(hub);
  const cap = new THREE.Mesh(sphereGeo(16), mats.get(p.danger, { roughness: 0.3, emissive: p.danger, emissiveIntensity: 0.3 }));
  cap.scale.setScalar(0.3);
  cap.position.y = 0.15;
  g.add(cap);
  const arms = new THREE.Group();
  g.add(arms);
  const armMat = mats.get(p.hazard, { roughness: 0.4 });
  const stripe = mats.get(p.stripe, { roughness: 0.5 });
  for (let i = 0; i < h.arms; i++) {
    const arm = new THREE.Group();
    const len = h.radius - 0.3;
    const bar = new THREE.Mesh(roundBoxGeo(h.thick * 2, h.thick * 2, len, h.thick * 0.6), armMat);
    bar.position.z = 0.3 + len / 2;
    bar.castShadow = true;
    arm.add(bar);
    for (let k = 1; k < len / 0.7; k++) {
      const st = new THREE.Mesh(boxGeo(h.thick * 2.05, h.thick * 2.05, 0.18), stripe);
      st.position.z = 0.3 + k * 0.7;
      arm.add(st);
    }
    const tip = new THREE.Mesh(sphereGeo(10), mats.get(p.accent, { emissive: p.accent, emissiveIntensity: 0.6 }));
    tip.scale.setScalar(h.thick * 1.4);
    tip.position.z = h.radius;
    arm.add(tip);
    arm.rotation.y = (i * Math.PI * 2) / h.arms;
    arms.add(arm);
  }
  root.add(g);
  return {
    update(world, t) {
      const lt = localTime(world, h, t) ?? 0;
      arms.rotation.y = spinnerAngle(h, lt);
    },
  };
}

function crusherView(h: Extract<HazardSpec, { kind: 'crusher' }>, ctx: LevelViewContext): ViewPart {
  const { mats, theme, root } = ctx;
  const p = theme.palette;
  const w = h.maxX - h.minX;
  const d = h.maxZ - h.minZ;
  const cx = (h.minX + h.maxX) / 2;
  const cz = (h.minZ + h.maxZ) / 2;
  const g = new THREE.Group();
  root.add(g);
  // housing above
  const housing = new THREE.Mesh(roundBoxGeo(w + 0.4, 1.0, d + 0.4, 0.1), mats.get(p.wall, { roughness: 0.7 }));
  housing.position.set(cx, h.topY + 2.4, cz);
  housing.castShadow = true;
  g.add(housing);
  const rod = new THREE.Mesh(cylinderGeo(0.18, 0.18, 1), mats.get(p.metal, { metalness: 0.8, roughness: 0.25 }));
  rod.castShadow = true;
  g.add(rod);
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(roundBoxGeo(w, 1.6, d, 0.08), mats.get(p.hazard, { roughness: 0.45, metalness: 0.2 }));
  headMesh.position.y = 0.8;
  headMesh.castShadow = true;
  head.add(headMesh);
  const stripeMat = mats.get(p.stripe, { roughness: 0.6 });
  const n = Math.max(2, Math.round(Math.max(w, d) / 0.6));
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n - 0.5;
    const st = new THREE.Mesh(boxGeo(w >= d ? 0.22 : w + 0.02, 0.34, w >= d ? d + 0.02 : 0.22), stripeMat);
    st.position.set(w >= d ? k * w : 0, 0.2, w >= d ? 0 : k * d);
    head.add(st);
  }
  const lamp = new THREE.Mesh(sphereGeo(10), mats.unique(p.danger, { emissive: p.danger, emissiveIntensity: 0.2 }));
  lamp.scale.setScalar(0.18);
  lamp.position.set(0, 1.7, 0);
  head.add(lamp);
  g.add(head);
  const shadow = telegraphDisc(mats, '#000000', Math.max(w, d) * 0.62);
  shadow.position.set(cx, h.floorY + 0.03, cz);
  g.add(shadow);
  const lampMat = lamp.material as THREE.MeshStandardMaterial;
  return {
    update(world, t) {
      const lt = localTime(world, h, t) ?? 0;
      const st = crusherState(h, lt);
      head.position.set(cx, st.bottom, cz);
      const top = h.topY + 2.4;
      const rodLen = Math.max(0.1, top - (st.bottom + 1.6));
      rod.scale.set(1, rodLen, 1);
      rod.position.set(cx, st.bottom + 1.6 + rodLen / 2, cz);
      const danger = st.phase === 'warn' || st.phase === 'slam' || st.phase === 'hold';
      lampMat.emissiveIntensity = danger ? 2.5 : 0.2;
      const k = 1 - (st.bottom - h.floorY) / Math.max(0.01, h.topY - h.floorY);
      shadow.scale.setScalar(0.5 + 0.5 * k);
      (shadow.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.4 * k;
    },
    dispose() {
      lampMat.dispose();
    },
  };
}

function laserView(h: Extract<HazardSpec, { kind: 'laser' }>, ctx: LevelViewContext): ViewPart {
  const { mats, theme, root } = ctx;
  const p = theme.palette;
  const g = new THREE.Group();
  root.add(g);
  const postMat = mats.get(p.metal, { metalness: 0.6, roughness: 0.3 });
  const posts = [0, 1].map(() => {
    const post = new THREE.Group();
    const base = new THREE.Mesh(roundBoxGeo(0.35, 0.35, 0.35, 0.06), postMat);
    base.castShadow = true;
    post.add(base);
    const eye = new THREE.Mesh(sphereGeo(10), mats.get(p.laser, { emissive: p.laser, emissiveIntensity: 1.5 }));
    eye.scale.setScalar(0.12);
    post.add(eye);
    g.add(post);
    return post;
  });
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.laser), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.laser), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(cylinderGeo(1, 1, 1, 8), beamMat);
  const glow = new THREE.Mesh(cylinderGeo(1, 1, 1, 8), glowMat);
  g.add(beam, glow);
  return {
    update(world, t) {
      const lt = localTime(world, h, t) ?? 0;
      const st = laserState(h, lt, tmpA, tmpB);
      posts[0].position.set(tmpA.x, tmpA.y, tmpA.z);
      posts[1].position.set(tmpB.x, tmpB.y, tmpB.z);
      const len = Math.hypot(tmpB.x - tmpA.x, tmpB.y - tmpA.y, tmpB.z - tmpA.z);
      const show = st.on || st.warn > 0;
      beam.visible = glow.visible = show;
      if (!show) return;
      const r = st.on ? h.radius * 0.6 : 0.015 + 0.02 * st.warn;
      tmpV.set(tmpB.x - tmpA.x, tmpB.y - tmpA.y, tmpB.z - tmpA.z).normalize();
      for (const m of [beam, glow]) {
        m.position.set((tmpA.x + tmpB.x) / 2, (tmpA.y + tmpB.y) / 2, (tmpA.z + tmpB.z) / 2);
        m.quaternion.setFromUnitVectors(UP, tmpV);
      }
      beam.scale.set(r, len, r);
      glow.scale.set(r * 3.5, len, r * 3.5);
      beamMat.opacity = st.on ? 0.95 : 0.35 + 0.4 * Math.sin(t * 40) * st.warn;
      glowMat.opacity = st.on ? 0.25 + 0.1 * Math.sin(t * 50) : 0.05;
    },
    dispose() {
      beamMat.dispose();
      glowMat.dispose();
    },
  };
}

function fallerView(h: Extract<HazardSpec, { kind: 'faller' }>, ctx: LevelViewContext): ViewPart {
  const { mats, theme, root } = ctx;
  const obj = fallerMesh(theme.special.fallerStyle, h.size, mats, theme);
  root.add(obj);
  const shadow = telegraphDisc(mats, theme.palette.danger, h.size * 0.75);
  shadow.position.set(h.x, h.floorY + 0.04, h.z);
  root.add(shadow);
  const ring = new THREE.Mesh(torusGeo(h.size * 0.8, 0.04), mats.unlit(theme.palette.danger, 0.9));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(h.x, h.floorY + 0.05, h.z);
  root.add(ring);
  return {
    update(world, t) {
      const lt = localTime(world, h, t);
      if (lt === null) {
        obj.visible = shadow.visible = ring.visible = false;
        return;
      }
      const st = fallerState(h, lt);
      obj.visible = st.phase === 'drop' || st.phase === 'warn' || st.phase === 'rest';
      obj.position.set(h.x, st.y + h.size / 2, h.z);
      obj.rotation.set(0, lt * 0.5, st.phase === 'rest' ? 0.2 : 0);
      obj.scale.setScalar(st.phase === 'rest' ? 1.05 : 1);
      shadow.visible = ring.visible = st.phase === 'warn' || st.phase === 'drop';
      const k = st.phase === 'warn' ? st.warn : 1;
      shadow.scale.setScalar(0.3 + 0.7 * k);
      ring.scale.setScalar(1.6 - 0.6 * k);
      if (st.phase === 'warn') obj.position.y = h.topY + h.size / 2 + Math.sin(t * 35) * 0.04 * k;
    },
  };
}

function zoneView(h: Extract<HazardSpec, { kind: 'zone' }>, ctx: LevelViewContext): ViewPart {
  const { theme, root } = ctx;
  const style = h.style || theme.special.zoneStyle;
  const colors: Record<string, [string, string]> = {
    acid: ['#7cff4f', '#1f7a1f'],
    lava: ['#ff7b00', '#ff2a00'],
    void: ['#1b1030', '#4b2a80'],
    water: ['#3fb6ff', '#0b4f8a'],
    electric: ['#7df9ff', '#2b59ff'],
  };
  const [c1, c2] = colors[style] ?? colors.acid;
  const mat = new THREE.MeshStandardMaterial({ color: c2, emissive: new THREE.Color(c1), emissiveIntensity: 0.8, roughness: 0.3 });
  const w = h.maxX - h.minX;
  const d = h.maxZ - h.minZ;
  const m = new THREE.Mesh(boxGeo(w, 0.2, d), mat);
  m.position.set((h.minX + h.maxX) / 2, h.maxY - 0.15, (h.minZ + h.maxZ) / 2);
  root.add(m);
  return {
    update(_w, t) {
      mat.emissiveIntensity = 0.65 + 0.35 * Math.sin(t * 3 + h.minX);
    },
    dispose() {
      mat.dispose();
    },
  };
}

function slamView(h: Extract<HazardSpec, { kind: 'slam' }>, ctx: LevelViewContext): ViewPart {
  const { theme, root, mats } = ctx;
  const lanes = h.lanes.map((l) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.palette.danger), transparent: true, opacity: 0, depthWrite: false });
    const m = new THREE.Mesh(boxGeo(l.maxX - l.minX, 0.04, l.maxZ - l.minZ), mat);
    m.position.set((l.minX + l.maxX) / 2, h.floorY + 0.04, (l.minZ + l.maxZ) / 2);
    m.renderOrder = 2;
    root.add(m);
    const ring = new THREE.Mesh(torusGeo(1, 0.08), mats.unlit('#ffffff', 0.8, true));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(m.position);
    ring.visible = false;
    root.add(ring);
    return { m, mat, ring };
  });
  return {
    update(world, t) {
      const lt = localTime(world, h, t);
      for (let i = 0; i < lanes.length; i++) {
        const L = lanes[i];
        if (lt === null) {
          L.mat.opacity = 0;
          L.ring.visible = false;
          continue;
        }
        const st = slamLaneState(h, i, lt);
        if (st.phase === 'warn') {
          L.mat.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (10 + st.k * 30)));
          L.ring.visible = false;
        } else if (st.phase === 'active') {
          L.mat.opacity = 0.8 * (1 - st.k);
          L.ring.visible = true;
          L.ring.scale.setScalar(0.5 + st.k * 4);
        } else {
          L.mat.opacity = 0;
          L.ring.visible = false;
        }
      }
    },
    dispose() {
      for (const L of lanes) L.mat.dispose();
    },
  };
}

function rollerView(h: Extract<HazardSpec, { kind: 'roller' }>, ctx: LevelViewContext): ViewPart {
  const { theme, root, mats } = ctx;
  const POOL = 8;
  const meshes: THREE.Object3D[] = [];
  const yaw = Math.atan2(h.vx, h.vz);
  for (let i = 0; i < POOL; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(cylinderGeo(h.radius, h.radius, h.radius * 1.8, 16), mats.get(theme.palette.pipe, { roughness: 0.45, metalness: 0.3 }));
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    g.add(body);
    const band = new THREE.Mesh(torusGeo(h.radius * 1.01, 0.05), mats.get(theme.palette.stripe));
    band.rotation.y = Math.PI / 2;
    g.add(band);
    g.visible = false;
    root.add(g);
    meshes.push(g);
  }
  return {
    update(world, t) {
      const lt = localTime(world, h, t);
      let i = 0;
      if (lt !== null) {
        rollerForEach(h, lt, (x, y, z, roll) => {
          if (i >= POOL) return;
          const m = meshes[i++];
          m.visible = true;
          m.position.set(x, y, z);
          m.rotation.set(0, yaw, 0);
          m.children[0].rotation.set(roll, 0, Math.PI / 2);
        });
      }
      for (; i < POOL; i++) meshes[i].visible = false;
    },
  };
}

export function buildHazardView(piece: HazardPiece, ctx: LevelViewContext): ViewPart | null {
  const h = piece.hazard;
  switch (h.kind) {
    case 'spinner':
      return spinnerView(h, ctx);
    case 'crusher':
      return crusherView(h, ctx);
    case 'laser':
      return laserView(h, ctx);
    case 'faller':
      return fallerView(h, ctx);
    case 'zone':
      return zoneView(h, ctx);
    case 'slam':
      return slamView(h, ctx);
    case 'roller':
      return rollerView(h, ctx);
  }
}

/** LevelView extension that adds all hazard visuals. */
export const hazardViewsExtension: LevelViewExtension = {
  build(ctx) {
    const parts: ViewPart[] = [];
    for (const p of ctx.level.pieces) {
      if (p.type !== 'hazard') continue;
      const v = buildHazardView(p, ctx);
      if (v) parts.push(v);
    }
    return parts;
  },
};
