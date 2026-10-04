/**
 * Event → visual feedback. Listens to the game EventBus and drives particles,
 * camera shake, screen flashes and lighting moods. Pure presentation layer.
 */
import * as THREE from 'three';
import type { EventBus } from '../events/EventBus';
import type { World } from '../sim/World';
import type { ThemeDef } from '../theme/ThemeDef';
import type { Particles } from './Particles';
import type { RenderContext } from './RenderContext';
import type { EnemyView } from './EnemyView';

export class EffectsDirector {
  /** 0..1 camera shake amount (decays) */
  shake = 0;
  /** 0..1 white flash (decays) */
  flash = 0;
  flashColor = '#ffffff';
  private flicker = 0;
  private alarm = 0;
  private steamT = 0;
  private stepN = 0;
  private readonly offs: Array<() => void> = [];
  private readonly base = { hemi: 1, sun: 1, ambient: 0.15 };
  private readonly redTint = new THREE.Color('#ff2a2a');
  private readonly baseAmbient = new THREE.Color('#ffffff');
  shakeEnabled = true;

  constructor(
    events: EventBus,
    private readonly world: World,
    private readonly fx: Particles,
    private readonly rc: RenderContext,
    theme: ThemeDef,
    private readonly enemyView: EnemyView | null,
  ) {
    this.base.hemi = rc.hemi.intensity;
    this.base.sun = rc.sun.intensity;
    this.base.ambient = rc.ambient.intensity;
    this.baseAmbient.copy(rc.ambient.color);
    const p = theme.palette;
    this.offs.push(
      events.on('PLAYER_JUMP', (e) => {
        const q = e.payload.pos;
        fx.emit('puff', 4, q.x, q.y + 0.05, q.z, { speed: 1.2, spread: 1, up: 0.3, color: '#e9e2d0', size: 0.35, life: 0.45 });
      }),
      events.on('PLAYER_LAND', (e) => {
        const q = e.payload.pos;
        const k = Math.min(1, e.payload.fallSpeed / 16);
        fx.emit('puff', 4 + Math.round(8 * k), q.x, q.y + 0.05, q.z, { speed: 2 + 3 * k, spread: 1, dir: { x: 0, y: -0.6, z: 0 }, up: 0.6, color: '#e9e2d0', size: 0.4, life: 0.55 });
        if (k > 0.8) this.addShake(0.15);
      }),
      events.on('PLAYER_STEP', (e) => {
        const q = e.payload.pos;
        if ((this.stepN++ & 1) === 0) fx.emit('puff', 1, q.x, q.y + 0.05, q.z, { speed: 0.6, up: 0.3, color: '#ddd5c2', size: 0.22, life: 0.35 });
      }),
      events.on('OBSTACLE_BREAK', (e) => {
        const q = e.payload.pos;
        const wood = e.payload.kind === 'crate';
        fx.emit('chunk', wood ? 14 : 8, q.x, q.y + 0.4, q.z, { speed: 6, up: 4, gravity: 18, drag: 0.6, palette: wood ? ['#c98b4f', '#8a5a2b', '#e0a96d'] : [p.metal, p.floor], size: 0.18, life: 1.4 });
        fx.emit('puff', 8, q.x, q.y + 0.3, q.z, { speed: 3, up: 0.8, color: '#d8cfc0', size: 0.7, life: 0.8 });
        this.addShake(e.payload.kind === 'slam' ? 0.45 : 0.18);
      }),
      events.on('CRUSHER_SLAM', (e) => {
        const q = e.payload.pos;
        if (this.near(q, 22)) {
          fx.emit('spark', 14, q.x, q.y + 0.1, q.z, { speed: 7, up: 2, gravity: 14, color: '#ffd38a', size: 0.18, life: 0.5 });
          fx.emit('puff', 10, q.x, q.y + 0.1, q.z, { speed: 4, up: 0.3, color: '#cfc6b6', size: 0.6, life: 0.7 });
          this.addShake(this.near(q, 8) ? 0.35 : 0.12);
        }
      }),
      events.on('PLAYER_DEATH', (e) => {
        const q = e.payload.pos;
        const c = e.payload.cause;
        if (c === 'zapped') {
          fx.emit('spark', 30, q.x, q.y + 0.7, q.z, { speed: 6, up: 1, color: p.laser, size: 0.25, life: 0.6 });
          fx.emit('puff', 12, q.x, q.y + 0.7, q.z, { speed: 1.5, up: 1.5, color: '#3a3a3a', size: 0.6, life: 1.2 });
          this.flashNow('#ff5577', 0.6);
        } else if (c === 'crushed' || c === 'squashed') {
          fx.emit('spark', 16, q.x, q.y + 0.3, q.z, { speed: 5, up: 3, gravity: 10, color: '#fff3a0', size: 0.22, life: 0.9 });
          fx.emit('puff', 14, q.x, q.y + 0.2, q.z, { speed: 4, color: '#d8cfc0', size: 0.7, life: 0.8 });
          this.addShake(0.5);
        } else if (c === 'caught') {
          this.flashNow('#ff3b30', 0.45);
          this.addShake(0.6);
        }
      }),
      events.on('PLAYER_FALL', () => this.addShake(0.08)),
      events.on('PLAYER_HIT', (e) => {
        const q = e.payload.pos;
        fx.emit('spark', 12, q.x, q.y + 0.8, q.z, { speed: 5, color: '#ffffff', size: 0.2, life: 0.4 });
        this.addShake(0.3);
      }),
      events.on('COIN_COLLECT', (e) => {
        const q = e.payload.pos;
        fx.emit('spark', 8, q.x, q.y, q.z, { speed: 2.5, up: 1, color: p.coin, size: 0.25, life: 0.45 });
      }),
      events.on('CHECKPOINT_REACHED', (e) => {
        const q = e.payload.pos;
        fx.emit('spark', 30, q.x, q.y + 1, q.z, { speed: 5, up: 3, gravity: 5, color: p.checkpoint, size: 0.3, life: 1.1 });
        this.flashNow(p.checkpoint, 0.25);
      }),
      events.on('PLAYER_FINISH', (e) => {
        const q = e.payload.pos;
        for (let i = 0; i < 3; i++)
          fx.emit('chunk', 40, q.x + (i - 1) * 3, q.y + 2, q.z + 2, { speed: 8, up: 9, gravity: 9, drag: 1.4, palette: ['#ff5d8f', '#ffd23f', '#2ec4b6', '#4f9dde', '#ffffff', '#80ed99'], size: 0.12, life: 2.6 });
        this.flashNow('#ffffff', 0.5);
      }),
      events.on('ENEMY_ROAR', (e) => {
        if (this.enemyView?.visible) {
          const c = this.enemyView.chimney;
          fx.emit('puff', 14, c.x, c.y, c.z, { speed: 2.5, up: 4, color: '#f2f2f2', size: 1.0, sizeEnd: 2.4, life: 1.4 });
        }
        if (this.near(e.payload.pos, 25)) this.addShake(0.35);
      }),
      events.on('ENEMY_STEP', (e) => {
        const q = e.payload.pos;
        const b = this.world.player.body;
        const d = Math.hypot(q.x - b.x, q.z - b.z);
        if (d < 18) this.addShake(0.12 * (1 - d / 18));
        fx.emit('puff', 3, q.x, q.y + 0.1, q.z, { speed: 2, up: 0.4, color: '#d8cfc0', size: 0.8, life: 0.6 });
      }),
      events.on('ENEMY_STUMBLE', () => {
        if (!this.enemyView) return;
        const c = this.enemyView.pos;
        fx.emit('spark', 10, c.x, c.y + 4.6, c.z, { speed: 2, up: 1.5, color: '#ffe066', size: 0.35, life: 1 });
      }),
      events.on('ENEMY_RETREAT', () => {
        if (!this.enemyView) return;
        const c = this.enemyView.pos;
        fx.emit('spark', 12, c.x, c.y + 4.6, c.z, { speed: 2, up: 1.5, color: '#ffe066', size: 0.4, life: 1.2 });
        this.addShake(0.4);
      }),
      events.on('ENEMY_APPEAR', (e) => {
        const q = e.payload.pos;
        if (e.payload.mode !== 'chase') fx.emit('puff', 16, q.x, q.y + 0.4, q.z, { speed: 3, up: 1, color: '#d8cfc0', size: 1.0, life: 1 });
      }),
      events.on('DOOR_CLOSE', (e) => {
        const q = e.payload.pos;
        this.addShake(this.near(q, 15) ? 0.3 : 0.1);
      }),
      events.on('FLOOR_COLLAPSE', (e) => {
        const q = e.payload.pos;
        fx.emit('puff', 16, q.x, q.y, q.z, { speed: 4, up: 0.5, color: '#cfc6b6', size: 0.9, life: 1 });
        this.addShake(0.25);
      }),
      events.on('PLATFORM_FALL', (e) => {
        const q = e.payload.pos;
        fx.emit('puff', 6, q.x, q.y, q.z, { speed: 2, color: '#cfc6b6', size: 0.6, life: 0.7 });
      }),
      events.on('BOSS_START', () => this.addShake(0.5)),
      events.on('BOSS_END', () => this.addShake(0.6)),
      events.on('LIGHTS_FLICKER', (e) => {
        this.flicker = e.payload.duration;
      }),
      events.on('ALARM', (e) => {
        this.alarm = e.payload.duration;
      }),
      events.on('SURPRISE', (e) => {
        if (e.payload.kind === 'steamBurst') {
          const q = this.world.playerPos();
          for (const side of [-1, 1]) fx.emit('puff', 18, q.x + side * 3.5, q.y + 0.2, q.z + 4, { speed: 1, dir: { x: 0, y: 3, z: 0 }, color: '#ffffff', size: 0.9, sizeEnd: 2.2, life: 1.3 });
        }
      }),
    );
  }

  private near(q: { x: number; z: number }, r: number): boolean {
    const b = this.world.player.body;
    return Math.hypot(q.x - b.x, q.z - b.z) < r;
  }

  addShake(a: number): void {
    if (this.shakeEnabled) this.shake = Math.min(1, this.shake + a);
  }

  flashNow(color: string, a: number): void {
    this.flashColor = color;
    this.flash = Math.max(this.flash, a);
  }

  update(dt: number, t: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    // enemy chimney puffs while chasing
    const ev = this.enemyView;
    const en = this.world.enemy;
    if (ev?.visible && en) {
      this.steamT -= dt;
      if (this.steamT <= 0) {
        this.steamT = en.isChasing ? 0.18 : 0.5;
        const c = ev.chimney;
        this.fx.emit('puff', 1, c.x, c.y, c.z, { speed: 0.6, up: 2.4, color: '#eeeeee', size: 0.6, sizeEnd: 1.6, life: 1.2 });
      }
    }
    // lighting moods
    let k = 1;
    if (this.flicker > 0) {
      this.flicker -= dt;
      k = Math.sin(t * 37) > 0.2 || Math.sin(t * 13) > 0.7 ? 0.25 : 1;
    }
    this.rc.hemi.intensity = this.base.hemi * k;
    this.rc.sun.intensity = this.base.sun * (k < 1 ? 0.35 : 1);
    if (this.alarm > 0 || (en?.isFinalEscape ?? false)) {
      this.alarm = Math.max(0, this.alarm - dt);
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);
      this.rc.ambient.color.copy(this.baseAmbient).lerp(this.redTint, pulse * 0.8);
      this.rc.ambient.intensity = this.base.ambient + 0.5 * pulse;
    } else {
      this.rc.ambient.color.copy(this.baseAmbient);
      this.rc.ambient.intensity = this.base.ambient;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.rc.hemi.intensity = this.base.hemi;
    this.rc.sun.intensity = this.base.sun;
    this.rc.ambient.intensity = this.base.ambient;
    this.rc.ambient.color.copy(this.baseAmbient);
  }
}
