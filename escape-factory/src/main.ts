import * as THREE from 'three';
import { RenderContext } from '@engine/render/RenderContext';
import { MaterialLibrary } from '@engine/render/materials';
import { LevelView } from '@engine/render/LevelView';
import { hazardViewsExtension } from '@engine/render/HazardViews';
import { CharacterView } from '@engine/render/CharacterView';
import { EnemyView } from '@engine/render/EnemyView';
import { GRUMBO } from '@game/enemies/grumbo';
import { World } from '@engine/sim/World';
import { FixedLoop } from '@engine/core/FixedLoop';
import { KeyboardInput } from '@engine/input/KeyboardInput';
import { emptyInput } from '@engine/input/InputState';
import { damp, dampAngle } from '@engine/core/math';
import { PIP } from '@game/characters/roster';
import { FACTORY } from '@game/themes/factory';
import { sandboxLevel } from './dev/sandboxLevel';

// Phase 2 sandbox: Pip on a hand-built test course with a simple follow camera.
const root = document.getElementById('app')!;
const rc = new RenderContext({ parent: root, preserveDrawingBuffer: true });
const theme = FACTORY;
rc.scene.background = new THREE.Color(theme.palette.skyHorizon);
rc.scene.fog = new THREE.Fog(theme.palette.fog, theme.lighting.fogNear, theme.lighting.fogFar);
const mats = new MaterialLibrary();
const level = sandboxLevel();
const world = new World({ level, character: PIP, enemy: GRUMBO, enemyTuning: { mercy: true } });
const lv = new LevelView(level, world, theme, mats, [hazardViewsExtension]);
rc.scene.add(lv.root);
const cv = new CharacterView(PIP, mats);
rc.scene.add(cv.root);
const ev = new EnemyView(GRUMBO, mats, new URLSearchParams(location.search).get('theme') ?? 'FACTORY');
rc.scene.add(ev.root);
const front = new URLSearchParams(location.search).has('front');
const modelId = new URLSearchParams(location.search).get('model');
if (modelId) {
  // dev model viewer: line up all characters + enemy
  const { ROSTER } = await import('@game/characters/roster');
  ROSTER.forEach((c, i) => {
    const v = new CharacterView(c, mats);
    v.root.position.set((i - 3) * 1.3, 0, 2);
    v.root.rotation.y = Math.PI * 0.08 * (i - 3) * -0.3;
    rc.scene.add(v.root);
  });
  cv.root.visible = false;
}
const input = new KeyboardInput();
let camYaw = 0;
input.cameraYaw = () => camYaw;
const loop = new FixedLoop();
const inp = emptyInput();
const cam = new THREE.Vector3(0, 4, -6);
let last = performance.now();
const startZ = Number(new URLSearchParams(location.search).get('z') ?? 0);
if (startZ) world.player.spawn(0, 0.1, startZ, 0);
const auto = new URLSearchParams(location.search).has('auto');
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  loop.advance(dt, () => {
    input.sample(inp);
    if (auto) {
      inp.moveZ = 1;
      inp.jumpPressed = world.tick % 40 === 0;
      inp.jump = true;
    }
    world.step(inp);
  });
  cv.update(world.player, loop.alpha, dt, world.time);
  lv.update(world, world.time, dt);
  if (world.enemy) ev.update(world.enemy, loop.alpha, dt, world.time);
  const p = cv.pos;
  camYaw = dampAngle(camYaw, world.track.yawAt(world.playerS), 4, dt);
  const dist = front ? -7 : 7;
  const tx = p.x - Math.sin(camYaw) * dist;
  const tz = p.z - Math.cos(camYaw) * dist;
  cam.set(damp(cam.x, tx, 6, dt), damp(cam.y, p.y + 3.6, 6, dt), damp(cam.z, tz, 6, dt));
  rc.camera.position.copy(cam);
  if (modelId) {
    rc.camera.position.set(0, 1.6, 7.5);
    rc.camera.lookAt(0, 0.9, 0);
    rc.focusShadows(0, 0, 0);
    rc.render();
    requestAnimationFrame(frame);
    return;
  }
  const look = front ? -4 : 4;
  rc.camera.lookAt(p.x + Math.sin(camYaw) * look, p.y + (front ? 2 : 1), p.z + Math.cos(camYaw) * look);
  rc.focusShadows(p.x, p.y, p.z);
  rc.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __booted: boolean }).__booted = true;
