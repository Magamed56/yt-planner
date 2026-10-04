/**
 * Visual for the enemy: builds the EnemyDef model (+ theme costume) and plays
 * procedural animations driven by the Enemy brain (run/stomp, roar, peek, sink,
 * grab, stumble, boss slam, bonk, cheer) and its gauge-needle "mood".
 */
import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import type { Enemy } from '../enemy/Enemy';
import type { EnemyDef } from '../enemy/EnemyDef';
import { buildModel, type BuiltModel } from './ModelBuilder';
import type { MaterialLibrary } from './materials';

const UP = new THREE.Vector3(0, 1, 0);

export class EnemyView {
  readonly root = new THREE.Group();
  private readonly anim = new THREE.Group();
  private readonly model: BuiltModel;
  private phase = 0;
  readonly pos = new THREE.Vector3();
  /** world position of the chimney top (steam emitter) */
  readonly chimney = new THREE.Vector3();
  yaw = 0;
  private rise = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly def: EnemyDef,
    mats: MaterialLibrary,
    themeId: string,
  ) {
    const extra = def.themeParts?.[themeId.toUpperCase()] ?? [];
    this.model = buildModel(def.model, mats, extra);
    this.root.add(this.anim);
    this.anim.add(this.model.root);
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  update(e: Enemy, alpha: number, dt: number, time: number): void {
    const vis = e.state !== 'dormant' && e.visible > 0.001;
    this.root.visible = vis;
    if (!vis) {
      this.rise = 0;
      return;
    }
    const x = lerp(e.prevX, e.x, alpha);
    const y = lerp(e.prevY, e.y, alpha);
    const z = lerp(e.prevZ, e.z, alpha);
    let dy = e.yaw - e.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yaw = e.prevYaw + dy * alpha;
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);

    const s = this.model.slots;
    const rest = this.model.rest;
    const A = this.def.anim;
    const setRot = (name: string, rx: number, ry = 0, rz = 0) => {
      const n = s.get(name);
      const r = rest.get(name);
      if (n && r) n.rotation.set(r.rot.x + rx, r.rot.y + ry, r.rot.z + rz);
    };

    // rise from the floor / sink into it (peek & disappear effects)
    const appearing = e.state === 'peek' || e.state === 'block' || e.state === 'boss';
    if (appearing) this.rise = Math.min(1, this.rise + dt * 2.2);
    else if (e.state === 'retreat') this.rise = Math.max(0, e.visible);
    else this.rise = 1;
    const sink = e.action === 'sink' ? (1 - e.visible) * 4 : 0;
    this.anim.position.set(0, (this.rise - 1) * 3.5 - sink, 0);
    this.anim.rotation.set(0, 0, 0);
    this.anim.scale.set(1, 1, 1);

    const speedK = clamp(e.speed / 9, 0, 1.4);
    const t = e.actionTime;
    let legs = 0;
    let armL = 0;
    let armR = 0;
    let jaw = 0;
    let bodyX = 0;
    let bodyZ = 0;
    let bob = 0;

    switch (e.action) {
      case 'run': {
        this.phase += dt * (3 + e.speed * 0.7);
        legs = Math.sin(this.phase) * 0.75 * speedK;
        armL = -Math.sin(this.phase) * A.armSwing * speedK - 0.3 * speedK;
        armR = Math.sin(this.phase) * A.armSwing * speedK - 0.3 * speedK;
        bob = Math.abs(Math.sin(this.phase)) * A.stomp * speedK;
        bodyX = 0.18 * speedK;
        bodyZ = Math.sin(this.phase) * A.bodySway * speedK;
        jaw = 0.15 + Math.sin(time * 9) * 0.08;
        break;
      }
      case 'roar': {
        const k = clamp(t * 4, 0, 1);
        armL = -2.4 * k + Math.sin(time * 30) * 0.1;
        armR = -2.4 * k - Math.sin(time * 30) * 0.1;
        jaw = 0.75 * k;
        bodyX = -0.25 * k;
        this.anim.position.x += Math.sin(time * 45) * 0.04 * k;
        if (e.speed > 1) {
          this.phase += dt * (3 + e.speed * 0.7);
          legs = Math.sin(this.phase) * 0.6;
          bob = Math.abs(Math.sin(this.phase)) * A.stomp;
        }
        break;
      }
      case 'peek': {
        // curious tilt + slow wave
        bodyZ = Math.sin(time * 1.5) * 0.15;
        armR = -1.2 + Math.sin(time * 5) * 0.4;
        jaw = 0.1;
        break;
      }
      case 'grab': {
        const k = clamp(t * 5, 0, 1);
        armL = -1.5 * k;
        armR = -1.5 * k;
        bodyX = 0.3 * k;
        jaw = 0.5;
        break;
      }
      case 'stumble': {
        const k = Math.sin(clamp(t / 0.55, 0, 1) * Math.PI);
        bodyX = 0.55 * k;
        armL = -2.6 * k + Math.sin(time * 25) * 0.6;
        armR = -2.6 * k - Math.sin(time * 25) * 0.6;
        legs = Math.sin(time * 20) * 0.5;
        jaw = 0.6 * k;
        break;
      }
      case 'slam': {
        const phase = e.armPhase;
        // aim arm toward the slam target in local space
        this.tmp.set(e.armX - x, 0, e.armZ - z).applyAxisAngle(UP, -yaw);
        const side = this.tmp.x >= 0 ? 'L' : 'R';
        const up = phase === 'warn' ? -2.9 : phase === 'active' ? -0.9 : -0.4;
        if (side === 'L') armL = up;
        else armR = up;
        jaw = phase === 'active' ? 0.7 : 0.3;
        bodyX = phase === 'active' ? 0.35 : -0.1;
        if (phase === 'active') this.anim.position.y -= 0.15;
        break;
      }
      case 'bonk': {
        const k = clamp(t * 6, 0, 1);
        this.anim.scale.set(1 + 0.25 * k, 1 - 0.3 * k, 1 + 0.1 * k);
        bodyX = -0.4 * k;
        armL = -1.0;
        armR = -1.0;
        jaw = 0.4;
        break;
      }
      case 'cheer': {
        armL = -2.7 + Math.sin(time * 10) * 0.3;
        armR = -2.7 - Math.sin(time * 10) * 0.3;
        bob = Math.abs(Math.sin(time * 8)) * 0.3;
        jaw = 0.5;
        break;
      }
      case 'sink':
      case 'idle':
      default: {
        bodyZ = Math.sin(time * 1.2) * 0.03;
        jaw = 0.08;
        break;
      }
    }

    this.anim.position.y += bob;
    setRot('legL', legs);
    setRot('legR', -legs);
    setRot('armL', armL);
    setRot('armR', armR);
    setRot('jaw', jaw);
    const body = s.get('body');
    const br = rest.get('body');
    if (body && br) {
      body.rotation.set(br.rot.x + bodyX, br.rot.y, br.rot.z + bodyZ);
      body.position.set(br.pos.x, br.pos.y + Math.sin(time * 2) * 0.02, br.pos.z);
    }
    // gauge needle: calm → up-left, angry → into the red zone
    setRot('gauge', 0, 0.6 - e.mood * 1.6 + Math.sin(time * 40) * 0.05 * e.mood);

    const chim = s.get('tail');
    if (chim) chim.getWorldPosition(this.chimney).add(this.tmp.set(0, 0.6, 0));
  }
}
