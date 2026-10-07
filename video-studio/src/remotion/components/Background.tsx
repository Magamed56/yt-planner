import React, { useLayoutEffect, useMemo, useRef } from "react";
import { AbsoluteFill, Easing, random, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { withAlpha, type Theme } from "../theme";

// Фон всего ролика: градиент темы + медленно плывущие мягкие пятна цвета,
// «боке»-частицы, плёночное зерно и виньетка.
//
// Почему canvas в 1/3 разрешения: в софтверном рендере Chromium (CI без GPU,
// слабый ПК) CSS-фон из больших radial-gradient + полноэкранного зерна стоил
// ~110 мс на кадр 1080×1920 — больше, чем вся остальная сцена. Фон состоит
// только из мягких переходов, поэтому рисуем его на маленьком canvas и
// растягиваем: на глаз разницы нет, а кадр дешевле в разы. Никаких
// filter: blur() — мягкость даёт сам градиент.

const SCALE = 1 / 3;

let grainTile: HTMLCanvasElement | null = null;
// Тайл шума генерируем один раз на вкладку детерминированным ГПСЧ —
// без бинарных ассетов и одинаково в Studio и рендере.
function getGrainTile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  try {
    const size = 96;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(size, size);
    let s = 1337;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < size * size; i++) {
      const v = rnd() > 0.5 ? 255 : 0;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = Math.floor(rnd() * 255);
    }
    ctx.putImageData(img, 0, 0);
    grainTile = c;
  } catch {
    grainTile = null;
  }
  return grainTile;
}

interface Props {
  theme: Theme;
  seed?: string;
  // Для обложки: фиксированный «красивый» момент вместо анимации.
  frameOverride?: number;
  grain?: boolean;
  particles?: boolean;
  // Кадры склеек: на каждой «камера» плавно смещается по фону — пятна и
  // частицы переезжают, и каждая сцена получает свою композицию фона.
  cuts?: number[];
  cutFrames?: number;
}

const panEase = Easing.inOut(Easing.cubic);
export function panAt(frame: number, cuts: number[], dur: number): number {
  let p = 0;
  for (const c of cuts) {
    if (frame >= c + dur) p += 1;
    else if (frame > c) p += panEase((frame - c) / dur);
  }
  return p;
}

export const Background: React.FC<Props> = ({ theme, seed = "bg", frameOverride, grain = true, particles = true, cuts, cutFrames = 20 }) => {
  const realFrame = useCurrentFrame();
  const frame = frameOverride ?? realFrame;
  const { width, height, fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = Math.max(2, Math.round(width * SCALE));
  const ch = Math.max(2, Math.round(height * SCALE));

  const blobs = useMemo(
    () => [
      { color: theme.blobA, size: 0.62, ax: 0.18, ay: 0.22, alpha: 0.62 },
      { color: theme.blobB, size: 0.52, ax: 0.82, ay: 0.68, alpha: 0.5 },
      { color: theme.blobC, size: 0.45, ax: 0.3, ay: 0.92, alpha: 0.42 },
    ],
    [theme],
  );
  const dots = useMemo(
    () =>
      new Array(18).fill(0).map((_, i) => ({
        x: random(`${seed}-px-${i}`),
        y: random(`${seed}-py-${i}`),
        r: 3 + random(`${seed}-pr-${i}`) * 9,
        speed: 6 + random(`${seed}-ps-${i}`) * 16, // px/сек вверх (в пикселях кадра)
        tint: random(`${seed}-pc-${i}`) > 0.6,
      })),
    [seed],
  );

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const t = frame / fps;
    const big = Math.max(cw, ch);
    const pan = cuts && cuts.length ? panAt(frame, cuts, cutFrames) : 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // 1. Базовый градиент (≈165°)
    const g = ctx.createLinearGradient(cw * 0.37, 0, cw * 0.63, ch);
    g.addColorStop(0, theme.bgFrom);
    g.addColorStop(0.58, theme.bgTo);
    g.addColorStop(1, theme.bgFrom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    // 2. Пятна цвета. "screen" смешивает их как свет — пересечения светятся,
    // а не грязнят друг друга.
    ctx.globalCompositeOperation = "screen";
    blobs.forEach((b, i) => {
      const nx = noise2D(`${seed}-bx-${i}`, t * 0.07, i * 10);
      const ny = noise2D(`${seed}-by-${i}`, i * 10, t * 0.07);
      const cx = cw * (b.ax + nx * 0.28 + 0.2 * Math.sin(pan * 2.1 + i * 1.7));
      const cy = ch * (b.ay + ny * 0.22 + 0.14 * Math.cos(pan * 1.6 + i * 2.3));
      const r = big * b.size * (1 + 0.08 * noise2D(`${seed}-bs-${i}`, t * 0.12, 3));
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, withAlpha(b.color, b.alpha));
      rg.addColorStop(0.38, withAlpha(b.color, b.alpha * 0.45));
      rg.addColorStop(1, withAlpha(b.color, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, cw, ch);
    });

    // 3. «Боке»-частицы: медленно всплывают, при склейке — параллакс.
    if (particles) {
      dots.forEach((d, i) => {
        const yPx = (((d.y * height - t * d.speed - pan * 260 * (0.6 + d.r / 12)) % height) + height) % height;
        const xPx = d.x * width + noise2D(`${seed}-pw-${i}`, t * 0.2, 0) * 40;
        const tw = 0.35 + 0.65 * Math.max(0, noise2D(`${seed}-pt-${i}`, t * 0.5, 1));
        const x = xPx * SCALE;
        const y = yPx * SCALE;
        const r = d.r * 3 * SCALE;
        const color = d.tint ? theme.accent : theme.text;
        const pg = ctx.createRadialGradient(x, y, 0, x, y, r);
        pg.addColorStop(0, withAlpha(color, 0.9 * tw * 0.55));
        pg.addColorStop(0.35, withAlpha(color, 0.25 * tw * 0.55));
        pg.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = pg;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }

    // 4. Виньетка: фокус в центр, края темнее.
    ctx.globalCompositeOperation = "source-over";
    const vx = cw / 2;
    const vy = ch * 0.42;
    const vr = Math.hypot(cw, ch) * 0.62;
    const vg = ctx.createRadialGradient(vx, vy, vr * 0.42, vx, vy, vr);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.65, "rgba(0,0,0,0.36)");
    vg.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cw, ch);

    // 5. Зерно-дизеринг: ломает «ступеньки» тёмных градиентов после сжатия.
    // Неподвижное: «дрожащее» зерно удваивало битрейт (7.6 против 3.6 МБ на
    // 5 с), а YouTube всё равно размазывает его при перекодировании.
    const tile = grain ? getGrainTile() : null;
    if (tile) {
      const ox = Math.floor(random(`g-x-${seed}`) * tile.width);
      const oy = Math.floor(random(`g-y-${seed}`) * tile.height);
      const pattern = ctx.createPattern(tile, "repeat");
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = 0.04;
        ctx.translate(-ox, -oy);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, cw + ox, ch + oy);
        ctx.restore();
      }
    }
  }, [frame, fps, cw, ch, width, height, theme, blobs, dots, seed, particles, grain, cuts, cutFrames]);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bgFrom }}>
      <canvas ref={ref} width={cw} height={ch} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
