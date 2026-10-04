/**
 * Pooled, allocation-free particle systems on InstancedMesh:
 *  - puff:  soft billboards (dust, smoke, steam)
 *  - spark: additive billboards (sparks, glows, sparkles)
 *  - chunk: lit 3D bits (debris, confetti)
 * plus an ambient field that wraps around the camera (dust/snow/embers…).
 */
import * as THREE from 'three';
import type { ParticleKind } from '../theme/ThemeDef';

export interface EmitOptions {
  speed?: number;
  spread?: number;
  /** upward bias added to velocity */
  up?: number;
  color?: string | THREE.Color;
  /** random colour palette (overrides color) */
  palette?: string[];
  size?: number;
  sizeEnd?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  /** direction bias */
  dir?: { x: number; y: number; z: number };
}

let softTex: THREE.Texture | null = null;
function softTexture(): THREE.Texture {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

const dummyQ = new THREE.Quaternion();
const dummyM = new THREE.Matrix4();
const dummyV = new THREE.Vector3();
const dummyS = new THREE.Vector3();
const dummyE = new THREE.Euler();
const tmpColor = new THREE.Color();

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private cursor = 0;
  alive = 0;

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    n: number,
    private readonly billboard: boolean,
  ) {
    this.n = n;
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const f = () => new Float32Array(n);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.life = f();
    this.max = f();
    this.s0 = f();
    this.s1 = f();
    this.grav = f();
    this.drag = f();
    this.rot = f();
    this.spin = f();
    dummyM.makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, dummyM);
  }

  emit(count: number, x: number, y: number, z: number, o: EmitOptions, rand: () => number): void {
    const speed = o.speed ?? 3;
    const spread = o.spread ?? 1;
    const life = o.life ?? 0.8;
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      const sp = speed * (0.4 + 0.6 * rand());
      let dx = Math.sin(ph) * Math.cos(th) * spread;
      let dy = Math.cos(ph) * spread;
      let dz = Math.sin(ph) * Math.sin(th) * spread;
      if (o.dir) {
        dx += o.dir.x;
        dy += o.dir.y;
        dz += o.dir.z;
      }
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = dx * sp;
      this.vy[i] = dy * sp + (o.up ?? 0);
      this.vz[i] = dz * sp;
      this.max[i] = life * (0.7 + 0.6 * rand());
      this.life[i] = this.max[i];
      this.s0[i] = (o.size ?? 0.4) * (0.7 + 0.6 * rand());
      this.s1[i] = o.sizeEnd ?? this.s0[i] * 1.8;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      this.rot[i] = rand() * Math.PI * 2;
      this.spin[i] = (rand() - 0.5) * 10;
      if (o.palette) tmpColor.set(o.palette[Math.floor(rand() * o.palette.length)]);
      else tmpColor.set((o.color as THREE.ColorRepresentation) ?? '#ffffff');
      this.mesh.instanceColor!.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, camQ: THREE.Quaternion): void {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        dummyM.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, dummyM);
        continue;
      }
      alive++;
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      const k = 1 - this.life[i] / this.max[i];
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      const fade = k < 0.1 ? k / 0.1 : 1 - Math.max(0, (k - 0.6) / 0.4);
      dummyV.set(this.px[i], this.py[i], this.pz[i]);
      if (this.billboard) {
        dummyE.set(0, 0, this.rot[i]);
        dummyQ.setFromEuler(dummyE).premultiply(camQ);
        dummyS.setScalar(size * Math.max(0.05, fade));
      } else {
        dummyE.set(this.rot[i], this.rot[i] * 0.7, 0);
        dummyQ.setFromEuler(dummyE);
        dummyS.setScalar(size * (k > 0.85 ? (1 - k) / 0.15 : 1));
      }
      dummyM.compose(dummyV, dummyQ, dummyS);
      this.mesh.setMatrixAt(i, dummyM);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    dummyM.makeScale(0, 0, 0);
    for (let i = 0; i < this.n; i++) this.mesh.setMatrixAt(i, dummyM);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Deterministic-enough cheap RNG for visuals (not part of the simulation). */
function makeRand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export class Particles {
  readonly root = new THREE.Group();
  readonly puff: ParticlePool;
  readonly spark: ParticlePool;
  readonly chunk: ParticlePool;
  private readonly rand = makeRand(12345);
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(scale = 1) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const puffMat = new THREE.MeshBasicMaterial({ map: softTexture(), transparent: true, depthWrite: false, opacity: 0.8 });
    const sparkMat = new THREE.MeshBasicMaterial({ map: softTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const chunkMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    this.puff = new ParticlePool(plane, puffMat, Math.round(500 * scale), true);
    this.spark = new ParticlePool(plane, sparkMat, Math.round(400 * scale), true);
    this.chunk = new ParticlePool(box, chunkMat, Math.round(350 * scale), false);
    this.chunk.mesh.castShadow = true;
    this.root.add(this.puff.mesh, this.spark.mesh, this.chunk.mesh);
    this.owned.push(plane, puffMat, sparkMat, box, chunkMat);
  }

  emit(kind: 'puff' | 'spark' | 'chunk', count: number, x: number, y: number, z: number, o: EmitOptions = {}): void {
    this[kind].emit(count, x, y, z, o, this.rand);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.puff.update(dt, camera.quaternion);
    this.spark.update(dt, camera.quaternion);
    this.chunk.update(dt, camera.quaternion);
  }

  get alive(): number {
    return this.puff.alive + this.spark.alive + this.chunk.alive;
  }

  clear(): void {
    this.puff.clear();
    this.spark.clear();
    this.chunk.clear();
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

/** Ambient weather/air particles that follow the camera (wrap-around box). */
export class AmbientParticles {
  readonly mesh: THREE.InstancedMesh | null = null;
  private readonly pos: Float32Array;
  private readonly seed: Float32Array;
  private readonly n: number;
  private readonly box = 36;
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(
    private readonly kind: ParticleKind,
    color: string,
    density: number,
    private readonly speed: number,
  ) {
    this.n = kind === 'none' ? 0 : Math.round(260 * density);
    this.pos = new Float32Array(this.n * 3);
    this.seed = new Float32Array(this.n);
    if (!this.n) return;
    const rand = makeRand(99);
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = (rand() - 0.5) * this.box;
      this.pos[i * 3 + 1] = (rand() - 0.5) * this.box * 0.6;
      this.pos[i * 3 + 2] = (rand() - 0.5) * this.box;
      this.seed[i] = rand() * 100;
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    const additive = kind === 'embers' || kind === 'sparkles' || kind === 'stars';
    const mat = new THREE.MeshBasicMaterial({
      map: softTexture(),
      color,
      transparent: true,
      depthWrite: false,
      opacity: kind === 'dust' ? 0.35 : 0.85,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    (this as { mesh: THREE.InstancedMesh | null }).mesh = new THREE.InstancedMesh(geo, mat, this.n);
    this.mesh!.frustumCulled = false;
    this.owned.push(geo, mat);
  }

  update(dt: number, t: number, camera: THREE.Camera): void {
    if (!this.mesh) return;
    const half = this.box / 2;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const size = this.kind === 'snow' ? 0.14 : this.kind === 'bubbles' ? 0.18 : this.kind === 'leaves' ? 0.22 : this.kind === 'embers' ? 0.12 : 0.08;
    for (let i = 0; i < this.n; i++) {
      const sd = this.seed[i];
      let vx = Math.sin(t * 0.3 + sd) * 0.3 * this.speed;
      let vy = 0;
      let vz = Math.cos(t * 0.25 + sd) * 0.3 * this.speed;
      switch (this.kind) {
        case 'snow':
          vy = -1.2 * this.speed;
          vx += Math.sin(t + sd) * 0.6;
          break;
        case 'embers':
        case 'bubbles':
          vy = 1.4 * this.speed;
          break;
        case 'leaves':
        case 'ash':
          vy = -0.8 * this.speed;
          vx += Math.sin(t * 1.3 + sd) * 1.2;
          break;
        default:
          vy = Math.sin(t * 0.5 + sd) * 0.15;
      }
      let x = this.pos[i * 3] + vx * dt;
      let y = this.pos[i * 3 + 1] + vy * dt;
      let z = this.pos[i * 3 + 2] + vz * dt;
      // wrap relative to the camera
      const rx = ((((x - cx + half) % this.box) + this.box) % this.box) - half + cx;
      const ry = ((((y - cy + half * 0.6) % (this.box * 0.6)) + this.box * 0.6) % (this.box * 0.6)) - half * 0.6 + cy;
      const rz = ((((z - cz + half) % this.box) + this.box) % this.box) - half + cz;
      x = rx;
      y = ry;
      z = rz;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      dummyV.set(x, y, z);
      const tw = this.kind === 'sparkles' || this.kind === 'stars' ? 0.5 + 0.5 * Math.sin(t * 4 + sd) : 1;
      dummyS.setScalar(size * tw);
      dummyM.compose(dummyV, camera.quaternion, dummyS);
      this.mesh.setMatrixAt(i, dummyM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.mesh?.removeFromParent();
  }
}
