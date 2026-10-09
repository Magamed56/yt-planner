import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { withAlpha } from "../theme";
import { BrandMark } from "./BrandMark";
import { BRAND } from "./data";
import { Dial } from "./Dial";

// Аватар: знак на «ночном» фоне с цветными пятнами как в роликах.
// Фон — чистый CSS от размера контейнера (не canvas от размера композиции),
// чтобы тот же аватар можно было показать уменьшенным на листе-превью.
// Всё важное — внутри вписанного круга с запасом: YouTube и Instagram режут по кругу.
export const AvatarArt: React.FC<{ size: number; id: string; dial?: boolean }> = ({ size, id, dial = true }) => {
  const t = BRAND.theme;
  const s = size;
  const mark = s * 0.74;
  return (
    <div style={{ position: "relative", width: s, height: s, overflow: "hidden", background: t.bgFrom }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            `radial-gradient(circle at 22% 16%, ${withAlpha(t.blobA, 0.8)} 0%, ${withAlpha(t.blobA, 0)} 55%)`,
            `radial-gradient(circle at 86% 86%, ${withAlpha(t.blobB, 0.45)} 0%, ${withAlpha(t.blobB, 0)} 46%)`,
            `radial-gradient(circle at 10% 94%, ${withAlpha(t.blobC, 0.4)} 0%, ${withAlpha(t.blobC, 0)} 40%)`,
            `radial-gradient(circle at 50% 50%, #261c78 0%, ${t.bgTo} 48%, ${t.bgFrom} 85%)`,
          ].join(", "),
        }}
      />
      {/* Тёплое свечение за знаком — отделяет жёлтое кольцо от фиолетового фона */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 52%, ${withAlpha(t.accent, 0.2)} 0%, ${withAlpha(t.accent2, 0.08)} 30%, ${withAlpha(t.accent2, 0)} 46%)`,
        }}
      />
      {/* Риски циферблата: на большом аватаре — глубина, на маленьком почти исчезают */}
      {dial ? <Dial cx={s / 2} cy={s * 0.5} r={s * 0.455} theme={t} tick={s * 0.014} width={Math.max(1, s * 0.004)} alpha={0.14} /> : null}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Оптическая центровка: у «С» разрыв справа, масса слева — сдвигаем чуть вправо */}
        <BrandMark size={mark} theme={t} id={id} glow={1} style={{ marginTop: s * 0.015, marginLeft: s * 0.035 }} />
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
