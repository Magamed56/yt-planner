// Слои кинорежима: что рисует сцена с планами. Чистая функция — её проверяет
// src/dev/cinematic-test.ts: только кадры планов, без затемнения и без текста
// поверх (текст на экране — одни субтитры, их рисует Video.tsx).
import type { CameraMove, RenderScene, SceneVisual } from "../../types";

export interface ShotLayer {
  from: number; // кадр начала относительно сцены
  durationInFrames: number;
  visual: SceneVisual;
  camera: CameraMove;
  dim: "none";
  motionSeed: string;
}

export const isCinematicScene = (scene: Pick<RenderScene, "shots">): boolean => (scene.shots?.length ?? 0) > 0;

export function shotLayers(scene: Pick<RenderScene, "id" | "shots">): ShotLayer[] {
  return (scene.shots ?? []).map((shot, k) => ({
    from: shot.from,
    durationInFrames: Math.max(1, shot.durationInFrames),
    visual: shot.visual,
    camera: shot.camera,
    dim: "none",
    motionSeed: `${scene.id}-${k}`,
  }));
}
