/**
 * Visual representation of the player: builds the character's ModelSpec and
 * animates it procedurally from simulation state (run cycle, squash & stretch,
 * air pose, comedic deaths, victory dance).
 */
import * as THREE from 'three';
import type { CharacterDef } from '../character/CharacterDef';
import { clamp, damp, lerp } from '../core/math';
import type { Player } from '../sim/Player';
import { disposeUnshared } from './geometry';
import { buildModel, type BuiltModel } from './ModelBuilder';
import type { MaterialLibrary } from './materials';

export class CharacterView {
  readonly root = Object.assign(new THREE.Group(), { name: 'character' });
  /** animation layer (squash, bob, lean) between root and model */
  private readonly anim = new THREE.Group();
  private model: BuiltModel;
  private runPhase = 0;
  private squash = 0;
  private squashV = 0;
  private blinkT = 2;
  private lastState = '';
  private deathSpin = 0;
  private tint = 0;
  private tintMats: THREE.MeshStandardMaterial[] = [];
  private tintBase: THREE.Color[] = [];
  /** rendered world position (interpolated) — the camera reads it */
  readonly pos = new THREE.Vector3();
  yaw = 0;

  constructor(
    private def: CharacterDef,
    private readonly mats: MaterialLibrary,
  ) {
    this.model = buildModel(def.model, mats);
    this.root.add(this.anim);
    this.anim.add(this.model.root);
    this.prepareTint();
  }

  /** Swap character at runtime (Character System). */
  setCharacter(def: CharacterDef): void {
    this.anim.remove(this.model.root);
    for (const m of this.tintMats) m.dispose();
    disposeUnshared(this.model.root);
    this.def = def;
    this.model = buildModel(def.model, this.mats);
    this.anim.add(this.model.root);
    this.prepareTint();
  }

  private prepareTint(): void {
    // per-instance materials so zap/flash tint doesn't affect shared materials
    this.tintMats = [];
    this.tintBase = [];
    for (const m of this.model.meshes) {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      m.material = mat;
      this.tintMats.push(mat);
      this.tintBase.push(mat.emissive.clone());
    }
  }

  /** when set (caught by the enemy) the character dangles from this world point */
  holdPoint: THREE.Vector3 | null = null;
  private holdK = 0;

  update(p: Player, alpha: number, dt: number, time: number): void {
    const b = p.body;
    let x = lerp(p.prevX, b.x, alpha);
    let y = lerp(p.prevY, b.y, alpha);
    let z = lerp(p.prevZ, b.z, alpha);
    if (p.state === 'caught' && this.holdPoint) {
      this.holdK = Math.min(1, this.holdK + dt * 4);
      x = lerp(x, this.holdPoint.x, this.holdK);
      y = lerp(y, this.holdPoint.y - 1.2, this.holdK);
      z = lerp(z, this.holdPoint.z, this.holdK);
    } else this.holdK = 0;
    this.pos.set(x, y, z);
    const yaw = p.prevYaw + wrap(p.yaw - p.prevYaw) * alpha;
    this.yaw = yaw;
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);

    const s = this.model.slots;
    const rest = this.model.rest;
    const A = this.def.anim;
    const speedK = clamp(p.speed / 8, 0, 1.2);
    const state = p.state;
    if (state !== this.lastState) {
      if (state === 'dead' || state === 'caught') this.deathSpin = 0;
      this.lastState = state;
    }

    // ---- squash & stretch spring (driven by landing impact and vertical speed)
    let targetSquash = 0;
    if (state === 'air') targetSquash = clamp(b.vy / 14, -0.6, 1) * A.squash;
    if (p.landImpact > 0) targetSquash = -p.landImpact * A.squash * 1.6;
    this.squashV += (targetSquash - this.squash) * 240 * dt;
    this.squashV *= Math.exp(-14 * dt);
    this.squash += this.squashV * dt;
    const sy = 1 + this.squash;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    const body = this.anim;
    body.scale.set(sxz, sy, sxz);
    body.position.y = 0;
    body.rotation.set(0, 0, 0);

    // ---- run cycle
    if (b.grounded && p.speed > 0.4) this.runPhase += dt * (6 + p.speed * 1.35);
    const ph = this.runPhase;
    const swing = Math.sin(ph) * A.legSwing * speedK;
    const grounded = b.grounded;

    const setRot = (name: string, rx: number, ry = 0, rz = 0) => {
      const n = s.get(name);
      const r = rest.get(name);
      if (n && r) n.rotation.set(r.rot.x + rx, r.rot.y + ry, r.rot.z + rz);
    };

    if (state === 'dead' || state === 'caught') {
      this.deathSpin += dt;
      const k = clamp(this.deathSpin * 3, 0, 1);
      if (state === 'caught') {
        // flail while being held
        setRot('legL', Math.sin(time * 22) * 0.9);
        setRot('legR', -Math.sin(time * 22) * 0.9);
        setRot('armL', -2.6 + Math.sin(time * 18) * 0.4, 0, 0.3);
        setRot('armR', -2.6 - Math.sin(time * 18) * 0.4, 0, -0.3);
        body.position.y = 0.6 * k;
      } else {
        // comedic flatten / spin
        body.scale.set(1 + 0.6 * k, Math.max(0.15, 1 - 0.85 * k), 1 + 0.6 * k);
        body.rotation.y = this.deathSpin * 6;
        setRot('armL', 0, 0, 1.4 * k);
        setRot('armR', 0, 0, -1.4 * k);
      }
      this.tint = damp(this.tint, 1, 8, dt);
    } else if (state === 'finished') {
      // victory dance: hop + wave
      setRot('armL', -2.8 + Math.sin(time * 14) * 0.3, 0, 0.2);
      setRot('armR', -2.8 - Math.sin(time * 14) * 0.3, 0, -0.2);
      setRot('legL', 0);
      setRot('legR', 0);
      body.rotation.y = Math.sin(time * 6) * 0.4;
      this.tint = damp(this.tint, 0, 8, dt);
    } else if (!grounded) {
      // air pose: tuck legs, arms up; flail when falling fast
      const falling = b.vy < -10;
      const fl = falling ? Math.sin(time * 26) * 0.7 : 0;
      setRot('legL', -0.6 + fl, 0, 0);
      setRot('legR', 0.3 - fl, 0, 0);
      setRot('armL', -2.2 + fl, 0, 0.35);
      setRot('armR', -2.2 - fl, 0, -0.35);
      body.rotation.x = clamp(-b.vy * 0.015, -0.25, 0.25);
      this.tint = damp(this.tint, 0, 8, dt);
    } else {
      setRot('legL', swing);
      setRot('legR', -swing);
      setRot('armL', -swing * (A.armSwing / Math.max(0.01, A.legSwing)), 0, 0.12);
      setRot('armR', swing * (A.armSwing / Math.max(0.01, A.legSwing)), 0, -0.12);
      const bob = Math.abs(Math.sin(ph)) * A.bob * speedK;
      body.position.y = bob;
      body.rotation.x = A.lean * speedK;
      body.rotation.z = Math.sin(ph) * A.waddle * speedK;
      if (p.speed < 0.4) {
        // idle breathing
        body.scale.y *= 1 + Math.sin(time * 2.5) * 0.015;
      }
      this.tint = damp(this.tint, 0, 8, dt);
    }
    if (state === 'stunned') body.rotation.z = Math.sin(time * 30) * 0.25;

    // ---- head bob / tail wag / blink
    const head = s.get('head');
    const hr = rest.get('head');
    if (head && hr) head.rotation.set(hr.rot.x + (grounded ? Math.sin(ph * 2) * 0.05 * speedK : -0.1), hr.rot.y, hr.rot.z);
    const tail = s.get('tail');
    const tr = rest.get('tail');
    if (tail && tr) tail.rotation.set(tr.rot.x, tr.rot.y + Math.sin(time * 9) * 0.5, tr.rot.z);
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12;
    if (this.blinkT < 0) this.blinkT = 2 + ((time * 7.31) % 3);
    for (const name of ['eyeL', 'eyeR']) {
      const e = s.get(name);
      const er = rest.get(name);
      if (e && er) e.scale.set(er.scale.x, blink ? er.scale.y * 0.1 : er.scale.y, er.scale.z);
    }

    // ---- invulnerability blink & death tint
    const inv = p.invulnerable > 0 && Math.floor(time * 12) % 2 === 0;
    this.root.visible = !inv;
    // death tint darkens (soot) — restore base emissive otherwise
    for (let i = 0; i < this.tintMats.length; i++) {
      const m = this.tintMats[i];
      if (this.tint > 0.01) m.color.copy((m.userData.base ??= m.color.clone()) as THREE.Color).multiplyScalar(1 - 0.75 * this.tint);
      else if (m.userData.base) m.color.copy(m.userData.base as THREE.Color);
      m.emissive.copy(this.tintBase[i]);
    }
  }

  dispose(): void {
    for (const m of this.tintMats) m.dispose();
    disposeUnshared(this.model.root);
    this.root.removeFromParent();
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
