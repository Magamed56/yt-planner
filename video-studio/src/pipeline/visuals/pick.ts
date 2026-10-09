// Выбор файла нужного размера. Правило: берём самый лёгкий вариант, который
// закрывает кадр (object-fit: cover) БЕЗ апскейла, но не больше ~1080p — 4K
// долго качать и тяжело декодировать на CPU (GitHub Actions, слабый ПК).
// Если ни один вариант ≤1080p не закрывает кадр — самый крупный из ≤1080p
// (минимальный апскейл); если все крупнее — самый маленький из них.

import { FORMAT_SIZE, type Format } from "../../types";

export interface Rendition {
  url: string;
  width: number;
  height: number;
  fps?: number | null;
}

// Запас 5%: файлы бывают 1088×1920 или 1080×1922.
const CAP_SLACK = 1.05;

export function isOrientationOk(r: { width: number; height: number }, format: Format): boolean {
  return format === "shorts" ? r.height > r.width : r.width > r.height;
}

export function upscaleFactor(r: { width: number; height: number }, format: Format): number {
  const t = FORMAT_SIZE[format];
  return Math.max(t.width / r.width, t.height / r.height); // ≤ 1 — апскейла нет
}

export function pickRendition<T extends Rendition>(
  files: T[],
  format: Format,
  opts: { strictOrientation?: boolean; maxUpscale?: number } = {},
): T | undefined {
  const t = FORMAT_SIZE[format];
  const strict = opts.strictOrientation ?? true;
  const ok = files.filter(
    (f) =>
      !!f.url &&
      f.width > 0 &&
      f.height > 0 &&
      (f.fps == null || f.fps <= 61) &&
      (!strict || isOrientationOk(f, format)) &&
      (opts.maxUpscale === undefined || upscaleFactor(f, format) <= opts.maxUpscale),
  );
  if (ok.length === 0) return undefined;
  const area = (f: T) => f.width * f.height;
  const shortSide = Math.min(t.width, t.height) * CAP_SLACK;
  const longSide = Math.max(t.width, t.height) * CAP_SLACK;
  const withinCap = ok.filter((f) => Math.min(f.width, f.height) <= shortSide && Math.max(f.width, f.height) <= longSide);
  if (withinCap.length > 0) {
    const covering = withinCap.filter((f) => upscaleFactor(f, format) <= 1.0001);
    if (covering.length > 0) return [...covering].sort((a, b) => area(a) - area(b))[0];
    return [...withinCap].sort((a, b) => upscaleFactor(a, format) - upscaleFactor(b, format))[0];
  }
  return [...ok].sort((a, b) => area(a) - area(b))[0];
}
