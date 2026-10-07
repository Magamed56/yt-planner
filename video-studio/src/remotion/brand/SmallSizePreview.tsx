import React from "react";
import { AbsoluteFill } from "remotion";
import { FONT_BODY, FONT_DISPLAY, FontGate } from "../fonts";
import { AvatarArt } from "./Avatar";
import { WatermarkArt } from "./Watermark";

// Лист самопроверки avatar-preview.png: аватар в реальных размерах показа
// (страница канала, лента, комментарии, уведомления) на светлой и тёмной
// теме и водяной знак на светлом и тёмном видео. Главный вопрос — читается
// ли знак в кружке 40 px и 24 px.

const SIZES = [
  { px: 160, label: "страница канала" },
  { px: 98, label: "профиль / шапка" },
  { px: 64, label: "лента, сторис" },
  { px: 40, label: "комментарии" },
  { px: 24, label: "уведомления" },
];

const Panel: React.FC<{ dark: boolean }> = ({ dark }) => {
  const fg = dark ? "#f1f1f1" : "#0f0f0f";
  const dim = dark ? "rgba(241,241,241,0.6)" : "rgba(15,15,15,0.6)";
  return (
    <div style={{ flex: 1, background: dark ? "#0f0f0f" : "#ffffff", padding: "48px 40px", display: "flex", flexDirection: "column", gap: 44 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 30, color: fg }}>{dark ? "Тёмная тема" : "Светлая тема"}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
        {SIZES.map((s) => (
          <div key={s.px} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: s.px, height: s.px, borderRadius: "50%", overflow: "hidden" }}>
              <AvatarArt size={s.px} id={`pv-${dark ? "d" : "l"}-${s.px}`} />
            </div>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: dim, textAlign: "center", width: 110 }}>
              {s.px} px
              <br />
              {s.label}
            </div>
          </div>
        ))}
      </div>
      {/* Водяной знак в углу «кадра» — как в плеере (~60 px на 720p) */}
      <div style={{ display: "flex", gap: 28 }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              position: "relative",
              width: 330,
              height: 186,
              borderRadius: 12,
              overflow: "hidden",
              background: i === 0 ? "linear-gradient(135deg, #f6e7c8 0%, #9fc6e8 100%)" : "linear-gradient(135deg, #1b2a3a 0%, #3a2a1b 100%)",
            }}
          >
            <div style={{ position: "absolute", right: 12, bottom: 12 }}>
              <WatermarkArt size={52} id={`pv-wm-${dark ? "d" : "l"}-${i}`} />
            </div>
            <div style={{ position: "absolute", left: 14, top: 12, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: i === 0 ? "#333" : "#ddd" }}>
              водяной знак, {i === 0 ? "светлое" : "тёмное"} видео
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SmallSizePreview: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#0f0f0f" }}>
    <FontGate>
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        <Panel dark={false} />
        <Panel dark />
      </div>
    </FontGate>
  </AbsoluteFill>
);
