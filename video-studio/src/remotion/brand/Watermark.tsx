import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { withAlpha } from "../theme";
import { BrandMark } from "./BrandMark";
import { BRAND } from "./data";

// Водяной знак YouTube 150×150, прозрачный фон. Плеер показывает его ~40–60 px
// в правом нижнем углу, при наведении YouTube сам добавляет кнопку «Подписаться».
// Поэтому никакого текста: залитый акцентом круг + тёмный знак + белый «плюс»
// (подписка). Тёмная окантовка — чтобы знак не терялся на светлом видео.
export const WatermarkArt: React.FC<{ size: number; id: string }> = ({ size, id }) => {
  const t = BRAND.theme;
  const s = size;
  const disc = s * 0.86;
  const badge = s * 0.34;
  return (
    <div style={{ position: "relative", width: s, height: s }}>
      <div
        style={{
          position: "absolute",
          left: (s - disc) / 2 - s * 0.04,
          top: (s - disc) / 2 - s * 0.04,
          width: disc,
          height: disc,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${t.accent} 0%, ${t.accent} 45%, ${t.accent2} 100%)`,
          boxShadow: `0 0 0 ${s * 0.02}px ${withAlpha(t.accentInk, 0.55)}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BrandMark size={disc * 0.66} theme={t} id={id} color={t.accentInk} />
      </div>
      <div
        style={{
          position: "absolute",
          right: s * 0.015,
          bottom: s * 0.015,
          width: badge,
          height: badge,
          borderRadius: "50%",
          background: t.text,
          boxShadow: `0 0 0 ${s * 0.025}px ${t.accentInk}`,
        }}
      >
        <svg width={badge} height={badge} viewBox="0 0 24 24" style={{ display: "block" }}>
          <path d="M12 6.5v11M6.5 12h11" stroke={t.accentInk} strokeWidth={3.4} strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
};

export const Watermark: React.FC = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill>
      <WatermarkArt size={width} id="wm" />
    </AbsoluteFill>
  );
};
