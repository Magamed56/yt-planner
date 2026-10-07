import { createContext, useContext } from "react";
import type { Format } from "../../types";

// Безопасные зоны кадра. В Shorts поверх видео лежит интерфейс YouTube:
// сверху ~8% (поиск, меню), справа ~12% (лайк/коммент/поделиться),
// снизу ~18% (название, автор, музыка). Основной текст и субтитры
// держим в разных непересекающихся полосах, чтобы не наезжали друг на друга.
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneLayout {
  format: Format;
  width: number;
  height: number;
  content: Box; // где живёт главный текст сцены
  safe: Box; // общая безопасная зона (для фоновых декоративных элементов)
  captions: { centerX: number; centerY: number; maxWidth: number; fontSize: number; maxLines: number };
  unit: number; // 1 «дизайнерский пиксель» относительно короткой стороны 1080
}

export function computeLayout(format: Format, width: number, height: number, showCaptions: boolean): SceneLayout {
  const unit = Math.min(width, height) / 1080;
  if (format === "shorts") {
    const left = Math.round(width * 0.085);
    const right = Math.round(width * 0.12);
    const top = Math.round(height * 0.085);
    const bottomUi = Math.round(height * 0.18);
    const safe: Box = { x: left, y: top, w: width - left - right, h: height - top - bottomUi };
    // Субтитры — полоса над нижним интерфейсом; контент заканчивается выше неё.
    const captionsCenterY = Math.round(height * 0.728);
    const contentBottom = showCaptions ? Math.round(height * 0.652) : height - bottomUi - Math.round(40 * unit);
    return {
      format,
      width,
      height,
      unit,
      safe,
      content: { x: left, y: top + Math.round(20 * unit), w: safe.w, h: contentBottom - top - Math.round(20 * unit) },
      captions: { centerX: left + safe.w / 2, centerY: captionsCenterY, maxWidth: safe.w - 20 * unit, fontSize: Math.round(70 * unit), maxLines: 2 },
    };
  }
  // Горизонтальный ролик: интерфейса поверх нет, субтитры в нижней трети.
  const sideX = Math.round(width * 0.07);
  const top = Math.round(height * 0.09);
  const bottom = Math.round(height * 0.06);
  const safe: Box = { x: sideX, y: top, w: width - 2 * sideX, h: height - top - bottom };
  const contentBottom = showCaptions ? Math.round(height * 0.74) : height - bottom - Math.round(30 * unit);
  return {
    format,
    width,
    height,
    unit,
    safe,
    content: { x: sideX, y: top, w: safe.w, h: contentBottom - top },
    captions: { centerX: width / 2, centerY: Math.round(height * 0.855), maxWidth: Math.round(width * 0.72), fontSize: Math.round(56 * unit), maxLines: 2 },
  };
}

export const LayoutContext = createContext<SceneLayout>(computeLayout("shorts", 1080, 1920, true));
export const useLayout = (): SceneLayout => useContext(LayoutContext);
