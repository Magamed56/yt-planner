import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { withAlpha, type Theme } from "../theme";

// Тонкая полоска прогресса по самому верху кадра — зритель видит, что ролик
// короткий, и досматривает (удержание в Shorts).
export const ProgressBar: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, height } = useVideoConfig();
  const h = Math.max(6, Math.round(height * 0.0042));
  const p = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], { extrapolateRight: "clamp" });
  const appear = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: appear }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, background: withAlpha(theme.text, 0.12) }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: h,
          width: `${p * 100}%`,
          background: `linear-gradient(90deg, ${theme.accent2}, ${theme.accent})`,
          boxShadow: `0 0 ${h * 2.5}px ${withAlpha(theme.accent, 0.7)}`,
          borderTopRightRadius: h / 2,
          borderBottomRightRadius: h / 2,
        }}
      />
    </AbsoluteFill>
  );
};
