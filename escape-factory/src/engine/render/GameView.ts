/**
 * GameView — everything visual for one running World: theme setup, level,
 * characters, particles, backdrop, effects and camera application.
 */
import * as THREE from 'three';
import type { CharacterDef } from '../character/CharacterDef';
import type { CameraPose } from '../camera/CameraDirector';
import type { EnemyDef } from '../enemy/EnemyDef';
import type { World } from '../sim/World';
import type { ThemeDef } from '../theme/ThemeDef';
import { Backdrop } from './Backdrop';
import { CharacterView } from './CharacterView';
import { EffectsDirector } from './EffectsDirector';
import { EnemyView } from './EnemyView';
import { hazardViewsExtension } from './HazardViews';
import { LevelView, type LevelViewExtension } from './LevelView';
import type { MaterialLibrary } from './materials';
import { AmbientParticles, Particles } from './Particles';
import { propViewsExtension } from './PropViews';
import type { RenderContext } from './RenderContext';

export interface GameViewOptions {
  rc: RenderContext;
  mats: MaterialLibrary;
  world: World;
  theme: ThemeDef;
  character: CharacterDef;
  enemy: EnemyDef | null;
  extensions?: LevelViewExtension[];
}

export class GameView {
  readonly rc: RenderContext;
  readonly levelView: LevelView;
  readonly charView: CharacterView;
  readonly enemyView: EnemyView | null;
  readonly particles: Particles;
  readonly ambient: AmbientParticles;
  readonly backdrop: Backdrop;
  readonly effects: EffectsDirector;
  private readonly flashMesh: THREE.Mesh;
  private readonly flashMat: THREE.MeshBasicMaterial;
  private readonly root = new THREE.Group();
  private readonly vignette: THREE.Mesh;
  private readonly vignetteMat: THREE.MeshBasicMaterial;
  private danger = 0;
  private readonly target = new THREE.Vector3();

  constructor(o: GameViewOptions) {
    const { rc, theme, world, mats } = o;
    this.rc = rc;
    const L = theme.lighting;
    const P = theme.palette;
    rc.scene.background = new THREE.Color(P.skyHorizon);
    rc.scene.fog = new THREE.Fog(P.fog, L.fogNear, L.fogFar);
    rc.hemi.color.set(L.hemiSky);
    rc.hemi.groundColor.set(L.hemiGround);
    rc.hemi.intensity = L.hemiIntensity;
    rc.sun.color.set(L.sunColor);
    rc.sun.intensity = L.sunIntensity;
    rc.ambient.intensity = L.ambient;
    rc.ambient.color.set('#ffffff');
    rc.renderer.toneMappingExposure = L.exposure;
    rc.setSunDirection(L.sunDir[0], L.sunDir[1], L.sunDir[2]);
    this.root.name = 'game';
    rc.scene.add(this.root);
    if (!rc.camera.parent) rc.scene.add(rc.camera);

    this.backdrop = new Backdrop(world.level, theme);
    this.root.add(this.backdrop.root);
    this.levelView = new LevelView(world.level, world, theme, mats, [hazardViewsExtension, propViewsExtension, ...(o.extensions ?? [])]);
    this.root.add(this.levelView.root);
    this.charView = new CharacterView(o.character, mats);
    this.root.add(this.charView.root);
    this.enemyView = o.enemy ? new EnemyView(o.enemy, mats, theme.id) : null;
    if (this.enemyView) this.root.add(this.enemyView.root);
    const pscale = rc.quality === 'low' ? 0.5 : 1;
    this.particles = new Particles(pscale);
    this.root.add(this.particles.root);
    this.ambient = new AmbientParticles(theme.particles.kind, theme.particles.color, theme.particles.density * pscale, theme.particles.speed);
    if (this.ambient.mesh) this.root.add(this.ambient.mesh);
    this.effects = new EffectsDirector(world.events, world, this.particles, rc, theme, this.enemyView);

    this.flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), this.flashMat);
    this.flashMesh.position.z = -0.3;
    this.flashMesh.renderOrder = 999;
    this.flashMesh.frustumCulled = false;
    rc.camera.add(this.flashMesh);

    // red danger vignette that tightens as the enemy closes in
    const vc = document.createElement('canvas');
    vc.width = vc.height = 128;
    const vg = vc.getContext('2d')!;
    const grd = vg.createRadialGradient(64, 64, 30, 64, 64, 90);
    grd.addColorStop(0, 'rgba(255,0,0,0)');
    grd.addColorStop(1, 'rgba(255,20,10,1)');
    vg.fillStyle = grd;
    vg.fillRect(0, 0, 128, 128);
    const vt = new THREE.CanvasTexture(vc);
    this.vignetteMat = new THREE.MeshBasicMaterial({ map: vt, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.vignetteMat);
    this.vignette.position.z = -0.31;
    this.vignette.renderOrder = 998;
    this.vignette.frustumCulled = false;
    rc.camera.add(this.vignette);
  }

  /** Interpolated world state → visuals. `t` = simulation time for animations. */
  sync(world: World, alpha: number, dt: number, t: number): void {
    if (this.enemyView && world.enemy) this.enemyView.update(world.enemy, alpha, dt, t);
    this.charView.holdPoint = this.enemyView?.visible && world.enemy?.state === 'grab' ? this.enemyView.hand : null;
    this.charView.update(world.player, alpha, dt, t);
    const gap = world.enemy ? world.enemy.gapTo(world.playerS) : Infinity;
    const target = world.player.isAlive && gap < 9 ? Math.min(1, (9 - gap) / 7) : 0;
    this.danger += (target - this.danger) * Math.min(1, dt * 4);
    this.levelView.update(world, t, dt);
    this.effects.update(dt, t);
  }

  /** Applies a director pose (+ shake) to the camera and renders a frame. */
  render(pose: CameraPose, dt: number, t: number, draw = true): void {
    const cam = this.rc.camera;
    const sh = this.effects.shake;
    const amp = sh * sh * 0.45;
    cam.position.set(
      pose.x + amp * (Math.sin(t * 61) + Math.sin(t * 23)) * 0.5,
      pose.y + amp * Math.sin(t * 47) * 0.7,
      pose.z + amp * (Math.cos(t * 53) + Math.sin(t * 19)) * 0.5,
    );
    this.target.set(pose.tx, pose.ty, pose.tz);
    cam.lookAt(this.target);
    if (pose.roll) cam.rotateZ(pose.roll);
    if (Math.abs(cam.fov - pose.fov) > 0.01) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    this.flashMat.opacity = this.effects.flash * 0.6;
    this.flashMat.color.set(this.effects.flashColor);
    this.flashMesh.visible = this.effects.flash > 0.01;
    // size the vignette to cover the view at its distance
    const vh = 2 * Math.tan((cam.fov * Math.PI) / 360) * 0.31;
    this.vignette.scale.set(vh * cam.aspect * 1.02, vh * 1.02, 1);
    this.vignetteMat.opacity = this.danger * (0.55 + 0.1 * Math.sin(t * 9));
    this.vignette.visible = this.danger > 0.02;
    this.particles.update(dt, cam);
    this.ambient.update(dt, t, cam);
    this.backdrop.update(cam);
    if (!draw) return;
    const p = this.charView.pos;
    this.rc.focusShadows(p.x, p.y, p.z);
    this.rc.render();
  }

  stats() {
    const info = this.rc.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      particles: this.particles.alive,
      staticMeshes: this.levelView.staticMeshes,
    };
  }

  dispose(): void {
    this.effects.dispose();
    this.levelView.dispose();
    this.charView.dispose();
    this.enemyView?.dispose();
    this.particles.dispose();
    this.ambient.dispose();
    this.backdrop.dispose();
    this.rc.camera.remove(this.flashMesh);
    this.flashMesh.geometry.dispose();
    this.flashMat.dispose();
    this.rc.camera.remove(this.vignette);
    this.vignette.geometry.dispose();
    this.vignetteMat.map?.dispose();
    this.vignetteMat.dispose();
    this.root.removeFromParent();
  }
}
