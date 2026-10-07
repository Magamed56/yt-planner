import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Icon, IconGradientDefs } from "../components/Icon";
import { FONT_DISPLAY, FontGate } from "../fonts";
import { withAlpha } from "../theme";
import { arcPath, MARK_GEOMETRY } from "./BrandMark";
import { Wordmark } from "./atoms";
import { BRAND, pillarById } from "./data";
import { Dial } from "./Dial";

// Обложка «Актуального» Instagram 1080×1920. Инстаграм вырезает из центра
// круг (по ширине кадра или меньше — как подвинет пользователь), поэтому
// иконка и подпись — в круге ~760 px вокруг центра, фон сплошной «в край»:
// при любом кадрировании круг выглядит одинаково. Вокруг иконки — дуга «С»
// из знака канала: в ряду обложек профиль узнаётся с первого взгляда.
// Верх и низ (название и ник) видны, только если картинку выложить как сторис.

export const HIGHLIGHT_CIRCLE = 760; // диаметр зоны, куда помещается всё важное

export const Highlight: React.FC<{ pillar?: string }> = ({ pillar }) => {
  const { width, height } = useVideoConfig();
  const t = BRAND.theme;
  const p = pillarById(pillar);
  const u = width / 1080;
  const cx = width / 2;
  const cy = height / 2;
  const iconSize = 300 * u;
  const ring = HIGHLIGHT_CIRCLE * u;
  const gid = `hl-${p.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const label = p.short.toUpperCase();
  // Длинное слово чуть уменьшаем, чтобы не вылезло за дугу.
  const labelSize = Math.min(88, 640 / Math.max(5, label.length)) * u;
  const g = MARK_GEOMETRY;

  return (
    <AbsoluteFill style={{ backgroundColor: t.bgFrom }}>
      <FontGate>
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(circle at 50% 50%, ${withAlpha(t.blobA, 0.6)} 0%, ${withAlpha(t.blobA, 0.22)} 24%, ${withAlpha(t.blobA, 0)} 42%)`,
              `radial-gradient(circle at 80% 64%, ${withAlpha(t.blobB, 0.24)} 0%, ${withAlpha(t.blobB, 0)} 28%)`,
              `radial-gradient(circle at 20% 38%, ${withAlpha(t.blobC, 0.18)} 0%, ${withAlpha(t.blobC, 0)} 26%)`,
              `linear-gradient(170deg, ${t.bgFrom} 0%, ${t.bgTo} 50%, ${t.bgFrom} 100%)`,
            ].join(", "),
          }}
        />
        {/* Свечение за иконкой */}
        <div
          style={{
            position: "absolute",
            left: cx - iconSize,
            top: cy - 60 * u - iconSize,
            width: iconSize * 2,
            height: iconSize * 2,
            background: `radial-gradient(closest-side, ${withAlpha(t.accent, 0.26)} 0%, ${withAlpha(t.accent2, 0.08)} 50%, ${withAlpha(t.accent2, 0)} 100%)`,
          }}
        />
        <Dial cx={cx} cy={cy} r={ring * 0.62} theme={t} tick={12 * u} width={3 * u} alpha={0.14} />
        {/* Дуга «С» — та же геометрия, что у знака, растянутая на круг обложки */}
        <svg
          width={ring}
          height={ring}
          viewBox={`${g.cx - 50} ${g.cy - 50} 100 100`}
          style={{ position: "absolute", left: cx - ring / 2, top: cy - ring / 2, overflow: "visible", filter: `drop-shadow(0 0 ${14 * u}px ${withAlpha(t.accent, 0.35)})` }}
        >
          <defs>
            <linearGradient id={`${gid}-ring`} gradientUnits="userSpaceOnUse" x1={22} y1={16} x2={80} y2={92}>
              <stop offset="0%" stopColor={t.accent} />
              <stop offset="50%" stopColor={t.accent} />
              <stop offset="100%" stopColor={t.accent2} />
            </linearGradient>
          </defs>
          {/* Кольцо тоньше, чем в знаке: здесь оно рамка, а не буква */}
          <g transform={`translate(${g.cx} ${g.cy}) scale(${46 / g.r}) translate(${-g.cx} ${-g.cy})`}>
            <path d={arcPath()} fill="none" stroke={`url(#${gid}-ring)`} strokeWidth={4.2} strokeLinecap="round" />
          </g>
        </svg>
        <IconGradientDefs id={gid} from={t.accent} to={t.accent2} />
        <div style={{ position: "absolute", left: cx - iconSize / 2, top: cy - 60 * u - iconSize / 2, width: iconSize, height: iconSize }}>
          <Icon name={p.icon} size={iconSize} color={`url(#${gid})`} strokeWidth={2.1} style={{ filter: `drop-shadow(0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.4))` }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: cy + 140 * u,
            textAlign: "center",
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            fontSize: labelSize,
            lineHeight: 1,
            letterSpacing: "0.01em",
            color: t.text,
            textShadow: "0 4px 24px rgba(0,0,0,0.45)",
          }}
        >
          {label}
        </div>

        {/* Вне круга: видно только если выложить картинку сторис */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 170 * u, display: "flex", justifyContent: "center", opacity: 0.95 }}>
          <Wordmark fontSize={62 * u} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 170 * u,
            textAlign: "center",
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 40 * u,
            color: t.textDim,
          }}
        >
          {p.title} · {BRAND.handle}
        </div>
      </FontGate>
    </AbsoluteFill>
  );
};
