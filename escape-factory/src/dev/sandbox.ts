/**
 * Dev sandbox (?mode=sandbox): hand-built test course or a generated level,
 * auto-runner input, forced camera modes (?cam=SIDE) and a model viewer (?model).
 */
import { GameSession } from '@engine/core/GameSession';
import type { InputSource, InputState } from '@engine/input/InputState';
import { KeyboardInput } from '@engine/input/KeyboardInput';
import { generateLevel } from '@engine/level/LevelGenerator';
import { MaterialLibrary } from '@engine/render/materials';
import { RenderContext } from '@engine/render/RenderContext';
import { CharacterView } from '@engine/render/CharacterView';
import { VIDEO_STYLE } from '@engine/camera/styles';
import type { CameraMode, DirectorStyle } from '@engine/camera/CameraDirector';
import { themes } from '@engine/theme/ThemeDef';
import { characters } from '@engine/character/CharacterRegistry';
import { registerContent } from '@game/content';
import { GRUMBO } from '@game/enemies/grumbo';
import { ROSTER } from '@game/characters/roster';
import { flatChaseLevel, sandboxLevel } from './sandboxLevel';

registerContent();
const qs = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const rc = new RenderContext({ parent: root, preserveDrawingBuffer: true });
const mats = new MaterialLibrary();
const level = qs.has('seed')
  ? generateLevel({ seed: Number(qs.get('seed')), difficulty: qs.get('difficulty') ?? 2, theme: qs.get('theme') ?? 'FACTORY', specialEvents: qs.get('events')?.split(',') ?? [] })
  : qs.has('flat')
    ? flatChaseLevel()
    : sandboxLevel();

class AutoRun implements InputSource {
  sample(out: InputState): void {
    out.moveX = 0;
    out.moveZ = 1;
    out.jump = true;
    out.jumpPressed = false;
  }
}
const cam = qs.get('cam') as CameraMode | null;
const style: DirectorStyle = cam ? { ...VIDEO_STYLE, base: [cam], chaseBase: [cam], rules: [], baseShot: [999, 999] } : VIDEO_STYLE;
const keyboard = new KeyboardInput();
const session = new GameSession({
  level,
  character: characters.get(qs.get('character') ?? 'pip'),
  enemy: GRUMBO,
  theme: themes.get(qs.get('theme') ?? level.theme),
  input: qs.has('auto') ? new AutoRun() : keyboard,
  style,
  rc,
  mats,
  world: { enemyTuning: { mercy: true } },
  portrait: qs.has('portrait'),
});
keyboard.cameraYaw = () => session.heading;
if (qs.has('portrait')) rc.setFixedSize({ width: 540, height: 960 });
if (qs.has('model')) {
  ROSTER.forEach((c, i) => {
    const v = new CharacterView(c, mats);
    v.root.position.set((i - 3) * 1.3, 0, 3);
    rc.scene.add(v.root);
  });
}
const startZ = Number(qs.get('z') ?? 0);
if (startZ) session.world.player.spawn(0, 0.1, startZ, 0);
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  session.frame(dt);
  if (qs.has('model')) {
    rc.camera.position.set(0, 1.6, 8.5);
    rc.camera.lookAt(0, 0.9, 3);
    rc.render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __session: GameSession }).__session = session;
