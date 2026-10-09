import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { useLayout } from "../lib/layout";
import { withAlpha, type Theme } from "../theme";
import { Wordmark } from "./atoms";
import { BrandMark } from "./BrandMark";

// Бренд-заставка ≤ 0,5 с ПОВЕРХ начала хука, а не перед ним: в Shorts хук
// должен звучать с первой секунды. Знак канала с названием «вспыхивает» в
// верхнем углу (над контентом, где хук текст не ставит), по кадру проходит
// световой блик в цвет акцента, к 15-му кадру всё исчезает. В звуке — «искра»
// (sfx.sting). Выключается channel.json → brandIntro: false или BRAND_INTRO=off.
export const STING_FRAMES = 15;

export const BrandSting: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = useLayout();
  const { unit, safe } = layout;
  if (frame >= STING_FRAMES) return null;

  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 220, mass: 0.6 } });
  const out = interpolate(frame, [9, STING_FRAMES - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const sweep = interpolate(frame, [0, 12], [-0.45, 1.25], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const mark = Math.round(66 * unit);
  const font = Math.round(32 * unit);
  // Над контентной зоной: в Shorts — сразу под верхней панелью YouTube.
  const top = layout.format === "shorts" ? Math.round(height * 0.09) : safe.y;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Световой блик по диагонали — «экран» поверх, текст хука остаётся читаемым */}
      <AbsoluteFill
        style={{
          mixBlendMode: "screen",
          opacity: 0.55 * (1 - out),
          background: `linear-gradient(115deg, rgba(0,0,0,0) ${(sweep - 0.18) * 100}%, ${withAlpha(theme.accent, 0.42)} ${sweep * 100}%, rgba(0,0,0,0) ${(sweep + 0.18) * 100}%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: safe.x,
          top,
          display: "flex",
          alignItems: "center",
          gap: 16 * unit,
          padding: `${10 * unit}px ${22 * unit}px ${10 * unit}px ${12 * unit}px`,
          borderRadius: 999,
          background: withAlpha(theme.bgFrom, 0.55),
          border: `${Math.max(1.5, 2 * unit)}px solid ${withAlpha(theme.text, 0.18)}`,
          boxShadow: `0 ${10 * unit}px ${36 * unit}px rgba(0,0,0,0.35)`,
          transform: `translateY(${-24 * unit * out}px) scale(${interpolate(pop, [0, 1], [0.7, 1])})`,
          transformOrigin: "0% 50%",
          opacity: Math.min(1, pop * 1.4) * (1 - out),
          maxWidth: width - safe.x * 2,
        }}
      >
        <BrandMark size={mark} theme={theme} id="sting" glow={0.6} style={{ transform: `rotate(${interpolate(frame, [0, STING_FRAMES], [-40, 0])}deg)` }} />
        <Wordmark fontSize={font} theme={theme} />
      </div>
    </AbsoluteFill>
  );
};
