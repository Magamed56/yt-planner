// Слои кинорежима: что рисует сцена с планами. Чистая функция — её проверяет
// src/dev/cinematic-test.ts: только кадры планов, без затемнения и без текста
// поверх (текст на экране — одни субтитры, их рисует Video.tsx).
import type { CameraMove, RenderScene, RenderShot, SceneVisual, ShotMarks } from "../../types";

export interface ShotLayer {
  from: number; // кадр начала относительно сцены
  durationInFrames: number;
  visual: SceneVisual;
  camera: CameraMove;
  dim: "none";
  motionSeed: string;
  marks?: ShotMarks; // подписи и цифра поверх кадра (components/ShotMarks.tsx)
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
    ...(shot.marks ? { marks: shot.marks } : {}),
  }));
}

// Карточка главы «Разбора» (ChapterWrap) занимает начало сцены, а планы размечены от
// начала всей сцены: внутри сдвигаем их на длину карточки — план целиком под карточкой
// выпадает, первый видимый обрезается спереди (подписи и цифра — вместе с ним).
export function shotsAfterCard(shots: RenderShot[], card: number): RenderShot[] {
  return shots
    .map((s) => ({ ...s, from: s.from - card }))
    .filter((s) => s.from + s.durationInFrames > 0)
    .map((s) => {
      if (s.from >= 0) return s;
      const cut = -s.from;
      const marks = s.marks
        ? { callouts: s.marks.callouts.map((c) => ({ ...c, at: Math.max(0, c.at - cut) })), sticker: s.marks.sticker ? { ...s.marks.sticker, at: Math.max(0, s.marks.sticker.at - cut) } : null }
        : undefined;
      return { ...s, from: 0, durationInFrames: s.durationInFrames - cut, ...(marks ? { marks } : {}) };
    });
}
