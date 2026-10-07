import React from "react";
import type { Theme } from "../theme";

// Знак канала: жирная «Н», у которой перекладина — нервный импульс (спайк
// потенциала действия). Только толстые формы без мелочей — знак обязан
// читаться в кружке 40 px (комментарии, уведомления) и в водяном знаке.
// Рисуем в своём viewBox 100×100: размер задаёт контейнер.

export const MARK_VIEWBOX = 100;

// Геометрия вынесена, чтобы баннер мог «продолжить» импульс за пределы знака.
export const MARK_GEOMETRY = {
  stemW: 17,
  stemTop: 16,
  stemBottom: 84,
  leftX: 17,
  rightX: 66,
  pulseY: 52,
  pulseW: 10,
};

// Перекладина: ровно → короткий взлёт → глубокий провал → возврат.
// Амплитуда умеренная: при больших зубцах «Н» начинает читаться как «N».
function pulsePath(): string {
  const g = MARK_GEOMETRY;
  const x0 = g.leftX + g.stemW / 2;
  const x1 = g.rightX + g.stemW / 2;
  const y = g.pulseY;
  return `M${x0} ${y} H41 L46.5 36 L54 67 L59 47 L61.5 ${y} H${x1}`;
}

export const BrandMark: React.FC<{
  size: number;
  theme: Theme;
  id: string; // уникален в пределах кадра — у градиента в SVG глобальный id
  color?: string; // сплошной цвет вместо градиента (водяной знак)
  glow?: number; // 0..1 — сила свечения вокруг знака
  style?: React.CSSProperties;
}> = ({ size, theme, id, color, glow = 0, style }) => {
  const g = MARK_GEOMETRY;
  const gid = `mark-grad-${id}`;
  const fill = color ?? `url(#${gid})`;
  const shadow =
    glow > 0
      ? `drop-shadow(0 0 ${size * 0.05}px rgba(255,190,60,${0.55 * glow})) drop-shadow(0 ${size * 0.03}px ${size * 0.08}px rgba(0,0,0,${0.45 * glow}))`
      : undefined;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} style={{ display: "block", overflow: "visible", filter: shadow, ...style }}>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={18} y1={12} x2={84} y2={90}>
          <stop offset="0%" stopColor={theme.accent} />
          <stop offset="55%" stopColor={theme.accent} />
          <stop offset="100%" stopColor={theme.accent2} />
        </linearGradient>
      </defs>
      <rect x={g.leftX} y={g.stemTop} width={g.stemW} height={g.stemBottom - g.stemTop} rx={g.stemW / 2} fill={fill} />
      <rect x={g.rightX} y={g.stemTop} width={g.stemW} height={g.stemBottom - g.stemTop} rx={g.stemW / 2} fill={fill} />
      <path d={pulsePath()} fill="none" stroke={fill} strokeWidth={g.pulseW} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
