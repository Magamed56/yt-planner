import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Icon, IconGradientDefs } from "../components/Icon";
import { FONT_DISPLAY, FontGate } from "../fonts";
import { withAlpha } from "../theme";
import { Wordmark } from "./atoms";
import { BRAND, pillarById } from "./data";

// Обложка «Актуального» Instagram 1080×1920. Инстаграм вырезает из центра
// круг (по ширине кадра или меньше — как подвинет пользователь), поэтому
// иконка и подпись — в круге ~720 px вокруг центра, фон сплошной «в край»:
// при любом кадрировании круг выглядит одинаково. Верх и низ (бренд и ник)
// видны, только если картинку выложить как сторис.

export const HIGHLIGHT_CIRCLE = 720; // диаметр зоны, куда помещается всё важное

export const Highlight: React.FC<{ pillar?: string }> = ({ pillar }) => {
  const { width, height } = useVideoConfig();
  const t = BRAND.theme;
  const p = pillarById(pillar);
  const u = width / 1080;
  const cx = width / 2;
  const cy = height / 2;
  const iconSize = 330 * u;
  const gid = `hl-${p.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const label = p.short.toUpperCase();
  // Длинное слово («ВОСПРИЯТИЕ») чуть уменьшаем, чтобы не вылезло из круга.
  const labelSize = Math.min(92, 760 / Math.max(5, label.length)) * u;

  return (
    <AbsoluteFill style={{ backgroundColor: t.bgFrom }}>
      <FontGate>
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(circle at 50% 50%, ${withAlpha(t.blobA, 0.62)} 0%, ${withAlpha(t.blobA, 0.22)} 22%, ${withAlpha(t.blobA, 0)} 40%)`,
              `radial-gradient(circle at 78% 62%, ${withAlpha(t.blobB, 0.26)} 0%, ${withAlpha(t.blobB, 0)} 28%)`,
              `radial-gradient(circle at 22% 40%, ${withAlpha(t.blobC, 0.2)} 0%, ${withAlpha(t.blobC, 0)} 26%)`,
              `linear-gradient(170deg, ${t.bgFrom} 0%, ${t.bgTo} 50%, ${t.bgFrom} 100%)`,
            ].join(", "),
          }}
        />
        {/* Свечение за иконкой */}
        <div
          style={{
            position: "absolute",
            left: cx - iconSize,
            top: cy - 70 * u - iconSize,
            width: iconSize * 2,
            height: iconSize * 2,
            background: `radial-gradient(closest-side, ${withAlpha(t.accent, 0.3)} 0%, ${withAlpha(t.accent2, 0.1)} 50%, ${withAlpha(t.accent2, 0)} 100%)`,
          }}
        />
        <IconGradientDefs id={gid} from={t.accent} to={t.accent2} />
        <div style={{ position: "absolute", left: cx - iconSize / 2, top: cy - 70 * u - iconSize / 2, width: iconSize, height: iconSize }}>
          <Icon name={p.icon} size={iconSize} color={`url(#${gid})`} strokeWidth={2.1} style={{ filter: `drop-shadow(0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.4))` }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: cy + 150 * u,
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
        <div style={{ position: "absolute", left: 0, right: 0, top: 150 * u, display: "flex", justifyContent: "center", opacity: 0.9 }}>
          <Wordmark fontSize={64 * u} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 150 * u,
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
