import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { withAlpha } from "../theme";
import { BrandMark } from "./BrandMark";
import { BRAND } from "./data";

// Аватар: знак на «ночном» фоне с цветными пятнами как в роликах.
// Фон — чистый CSS от размера контейнера (не canvas от размера композиции),
// чтобы тот же аватар можно было показать уменьшенным на листе-превью.
// Всё важное — внутри вписанного круга: YouTube и Instagram режут по кругу.
export const AvatarArt: React.FC<{ size: number; id: string }> = ({ size, id }) => {
  const t = BRAND.theme;
  const s = size;
  return (
    <div style={{ position: "relative", width: s, height: s, overflow: "hidden", background: t.bgFrom }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            `radial-gradient(circle at 24% 18%, ${withAlpha(t.blobA, 0.75)} 0%, ${withAlpha(t.blobA, 0)} 52%)`,
            `radial-gradient(circle at 84% 84%, ${withAlpha(t.blobB, 0.5)} 0%, ${withAlpha(t.blobB, 0)} 46%)`,
            `radial-gradient(circle at 12% 92%, ${withAlpha(t.blobC, 0.42)} 0%, ${withAlpha(t.blobC, 0)} 40%)`,
            `radial-gradient(circle at 50% 46%, #241a6e 0%, ${t.bgTo} 46%, ${t.bgFrom} 82%)`,
          ].join(", "),
        }}
      />
      {/* Тёплое свечение за знаком — отделяет жёлтый знак от фиолетового фона */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 50%, ${withAlpha(t.accent, 0.26)} 0%, ${withAlpha(t.accent2, 0.1)} 26%, ${withAlpha(t.accent2, 0)} 42%)`,
        }}
      />
      {/* Тонкое кольцо-«орбита»: на большом аватаре даёт глубину, на маленьком исчезает */}
      <div
        style={{
          position: "absolute",
          left: s * 0.1,
          top: s * 0.1,
          width: s * 0.8,
          height: s * 0.8,
          borderRadius: "50%",
          border: `${Math.max(1, s * 0.006)}px solid ${withAlpha(t.text, 0.14)}`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BrandMark size={s * 0.6} theme={t} id={id} glow={1} />
      </div>
    </div>
  );
};

export const Avatar: React.FC = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill>
      <AvatarArt size={width} id="avatar" />
    </AbsoluteFill>
  );
};
