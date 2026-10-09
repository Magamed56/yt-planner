import React from "react";
import { withAlpha, type Theme } from "../theme";

// Знак канала «Суть за минуту»: толстое кольцо-таймер, открытое справа, —
// одновременно буква «С» и секундомер (сверху «кнопка»), внутри — белая
// искра-«суть». (Точку-«головку» на конце дуги пробовали — читалась как глаз.)
// Только толстые формы: знак обязан
// читаться в кружке 40 px (комментарии) и в водяном знаке.
// Рисуем в своём viewBox 100×100: размер задаёт контейнер.

export const MARK_VIEWBOX = 100;

export const MARK_GEOMETRY = {
  cx: 50,
  cy: 54,
  r: 31, // радиус средней линии кольца
  stroke: 15,
  gapDeg: 104, // разрыв справа (по осям дуги; круглые концы съедают ~26°)
  crown: { w: 18, h: 8.5, gap: 2.2 }, // «кнопка» секундомера над кольцом
  spark: 15.5, // полуразмах искры в центре
};

const rad = (deg: number): number => (deg * Math.PI) / 180;
// Угол в привычных «математических» градусах (0° — вправо, против часовой) → точка SVG.
const pt = (deg: number, r: number) => {
  const g = MARK_GEOMETRY;
  return { x: g.cx + r * Math.cos(rad(deg)), y: g.cy - r * Math.sin(rad(deg)) };
};

// Дуга «С»: от верхнего конца разрыва через верх, лево и низ — к нижнему.
export function arcPath(): string {
  const g = MARK_GEOMETRY;
  const a0 = g.gapDeg / 2;
  const s = pt(a0, g.r);
  const e = pt(-a0, g.r);
  return `M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${g.r} ${g.r} 0 1 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

// Четырёхлучевая искра с вогнутыми сторонами.
export function sparkPath(cx: number, cy: number, r: number): string {
  const k = r * 0.17;
  return [
    `M${cx} ${cy - r}`,
    `Q${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `Q${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `Q${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `Q${cx - k} ${cy - k} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

export const BrandMark: React.FC<{
  size: number;
  theme: Theme;
  id: string; // уникален в пределах кадра — у градиента в SVG глобальный id
  color?: string; // один сплошной цвет вместо градиента и белых деталей (водяной знак)
  glow?: number; // 0..1 — сила свечения вокруг знака
  style?: React.CSSProperties;
}> = ({ size, theme, id, color, glow = 0, style }) => {
  const g = MARK_GEOMETRY;
  const gid = `mark-grad-${id}`;
  const ring = color ?? `url(#${gid})`;
  const detail = color ?? theme.text;
  const crownY = g.cy - g.r - g.stroke / 2 - g.crown.gap - g.crown.h;
  // Свечение — фильтром на всём SVG: дёшево и не режется viewBox'ом.
  const shadow =
    glow > 0
      ? `drop-shadow(0 0 ${size * 0.045}px ${withAlpha(theme.accent, 0.5 * glow)}) drop-shadow(0 ${size * 0.03}px ${size * 0.07}px rgba(0,0,0,${0.5 * glow}))`
      : undefined;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} style={{ display: "block", overflow: "visible", filter: shadow, ...style }}>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={22} y1={16} x2={80} y2={92}>
          <stop offset="0%" stopColor={theme.accent} />
          <stop offset="50%" stopColor={theme.accent} />
          <stop offset="100%" stopColor={theme.accent2} />
        </linearGradient>
      </defs>
      <rect x={g.cx - g.crown.w / 2} y={crownY} width={g.crown.w} height={g.crown.h} rx={g.crown.h / 2.4} fill={ring} />
      <path d={arcPath()} fill="none" stroke={ring} strokeWidth={g.stroke} strokeLinecap="round" />
      <path d={sparkPath(g.cx, g.cy, g.spark)} fill={detail} />
    </svg>
  );
};
