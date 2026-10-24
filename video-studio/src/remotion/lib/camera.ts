// Движение камеры по кадру плана (кинорежим). Чистые функции без React:
// их проверяет src/dev/cinematic-test.ts — кадр не должен открывать края.
//
// Картинка лежит на весь кадр (object-fit: cover) и сдвигается CSS-трансформом
// translate(x·W, y·H) rotate(r) scale(s) от центра. Край не виден, пока
// |x| ≤ (s−1)/2 (и так же по y), — амплитуды ниже держат запас ~2 % кадра.
// Скорость на краях плана не нулевая (полу-линейная кривая): на склейке камера
// не «останавливается» — движение продолжается следующим планом.

import { noise2D } from "@remotion/noise";
import type { CameraMove } from "../../types";

export interface CameraState {
  scale: number;
  x: number; // сдвиг, доля ширины кадра
  y: number; // сдвиг, доля высоты кадра
  rotate: number; // градусы
}

// Плавный старт и финиш, но без остановки: половина — линейно, половина — smoothstep.
export function cameraEase(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 0.5 * c + 0.5 * c * c * (3 - 2 * c);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Амплитуды подняты после 30a (прогоны 34–35): при прежних (наезд 1.06 → 1.16,
// панорама ±6 %) кадр за 2,6 с менялся на 0,3 % яркости между кадрами — на
// телефоне это читалось как стоп-кадр.
// Наезд/отъезд: 1.04 ↔ 1.22 — движение видно с первой секунды.
const ZOOM = { near: 1.22, far: 1.04 } as const;
// Панорама и наклон: масштаб 1.2 даёт по 10 % кадра с каждой стороны; ход ±8,5 %.
const PAN = { scale: 1.2, travel: 0.085 } as const;
// С рук: заметное «дыхание» — сдвиг ≤ 1,8 %, поворот ≤ 0,6°, ~0,6 Гц.
const HAND = { scale: 1.12, x: 0.018, y: 0.014, rotate: 0.6, hz: 0.6 } as const;

export function cameraState(move: CameraMove, progress: number, timeSec: number, seed: string): CameraState {
  const e = cameraEase(progress);
  switch (move) {
    case "push-in":
      return { scale: lerp(ZOOM.far, ZOOM.near, e), x: 0, y: 0, rotate: 0 };
    case "pull-out":
      return { scale: lerp(ZOOM.near, ZOOM.far, e), x: 0, y: 0, rotate: 0 };
    // Камера ведёт влево — картинка уходит вправо (и наоборот).
    case "pan-left":
      return { scale: PAN.scale, x: lerp(-PAN.travel, PAN.travel, e), y: 0, rotate: 0 };
    case "pan-right":
      return { scale: PAN.scale, x: lerp(PAN.travel, -PAN.travel, e), y: 0, rotate: 0 };
    // Камера поднимается — картинка опускается.
    case "tilt-up":
      return { scale: PAN.scale, x: 0, y: lerp(-PAN.travel, PAN.travel, e), rotate: 0 };
    case "tilt-down":
      return { scale: PAN.scale, x: 0, y: lerp(PAN.travel, -PAN.travel, e), rotate: 0 };
    case "handheld": {
      const t = timeSec * HAND.hz;
      return {
        scale: HAND.scale,
        x: noise2D(`${seed}-hx`, t, 0) * HAND.x,
        y: noise2D(`${seed}-hy`, 0, t) * HAND.y,
        rotate: noise2D(`${seed}-hr`, t, t) * HAND.rotate,
      };
    }
  }
}

export function cameraTransform(s: CameraState, width: number, height: number): string {
  return `translate(${(s.x * width).toFixed(2)}px, ${(s.y * height).toFixed(2)}px) rotate(${s.rotate.toFixed(3)}deg) scale(${s.scale.toFixed(4)})`;
}

// Закрывает ли сдвинутая картинка весь кадр: углы кадра, переведённые обратно в
// систему картинки, должны лежать внутри неё.
export function coversFrame(s: CameraState, width: number, height: number): boolean {
  const r = (-s.rotate * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = s.x * width;
  const dy = s.y * height;
  for (const [cx, cy] of [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ] as const) {
    const px = cx - dx;
    const py = cy - dy;
    const ex = (px * cos - py * sin) / s.scale;
    const ey = (px * sin + py * cos) / s.scale;
    if (Math.abs(ex) > width / 2 + 1e-6 || Math.abs(ey) > height / 2 + 1e-6) return false;
  }
  return true;
}
