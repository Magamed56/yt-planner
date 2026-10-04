import * as THREE from 'three';
import { RenderContext } from '@engine/render/RenderContext';
import { MaterialLibrary } from '@engine/render/materials';
import { LevelView } from '@engine/render/LevelView';
import { CharacterView } from '@engine/render/CharacterView';
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
const world = new World({ level, character: PIP });
const lv = new LevelView(level, world, theme, mats);
rc.scene.add(lv.root);
const cv = new CharacterView(PIP, mats);
rc.scene.add(cv.root);
const input = new KeyboardInput();
let camYaw = 0;
input.cameraYaw = () => camYaw;
const loop = new FixedLoop();
const inp = emptyInput();
const cam = new THREE.Vector3(0, 4, -6);
let last = performance.now();
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
  const p = cv.pos;
  camYaw = dampAngle(camYaw, world.track.yawAt(world.playerS), 4, dt);
  const tx = p.x - Math.sin(camYaw) * 7;
  const tz = p.z - Math.cos(camYaw) * 7;
  cam.set(damp(cam.x, tx, 6, dt), damp(cam.y, p.y + 3.6, 6, dt), damp(cam.z, tz, 6, dt));
  rc.camera.position.copy(cam);
  rc.camera.lookAt(p.x + Math.sin(camYaw) * 4, p.y + 1, p.z + Math.cos(camYaw) * 4);
  rc.focusShadows(p.x, p.y, p.z);
  rc.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __booted: boolean }).__booted = true;
