import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import * as Lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { withAlpha, type Theme } from "../theme";

// Иконка lucide по kebab-case имени из сценария ("trending-down" → TrendingDown).
// LLM иногда выдумывает имена — тогда тихо подставляем Sparkles.
const toPascal = (s: string): string =>
  s
    .trim()
    .replace(/Icon$/i, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

export function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Lucide.Sparkles;
  const lib = Lucide as unknown as Record<string, unknown>;
  const key = toPascal(name);
  for (const k of [key, `${key}Icon`]) {
    const c = lib[k] as { $$typeof?: symbol } | undefined;
    if (c && typeof c === "object" && c.$$typeof) return c as unknown as LucideIcon;
  }
  return Lucide.Sparkles;
}

// Градиент для обводки иконки. userSpaceOnUse обязателен: у прямых линий
// иконок нулевая высота bbox, и градиент в objectBoundingBox их не красит.
export const IconGradientDefs: React.FC<{ id: string; from: string; to: string }> = ({ id, from, to }) => (
  <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={2} y1={2} x2={22} y2={22}>
        <stop offset="0%" stopColor={from} />
        <stop offset="100%" stopColor={to} />
      </linearGradient>
    </defs>
  </svg>
);

export const Icon: React.FC<{
  name?: string;
  size: number;
  color: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}> = ({ name, size, color, strokeWidth = 1.75, style }) => {
  const C = resolveIcon(name);
  return <C size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth={false} style={style} />;
};

// Иконка в «стеклянном» круге со свечением и пульсирующим кольцом.
export const IconBadge: React.FC<{
  name?: string;
  size: number;
  theme: Theme;
  delay?: number;
  gradientId: string;
  shape?: "circle" | "squircle";
}> = ({ name, size, theme, delay = 0, gradientId, shape = "squircle" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;
  const enter = spring({ frame: local, fps, config: { damping: 13, stiffness: 140, mass: 0.8 } });
  const iconIn = spring({ frame: local - 5, fps, config: { damping: 11, stiffness: 160, mass: 0.6 } });
  const radius = shape === "circle" ? size / 2 : size * 0.3;
  // Кольцо-«сонар» раз в 1.6 с, начиная после появления.
  const period = Math.round(fps * 1.6);
  const pingT = local > 12 ? ((local - 12) % period) / period : 0;
  const pingScale = interpolate(pingT, [0, 1], [1, 1.55]);
  const pingOpacity = local > 12 ? interpolate(pingT, [0, 0.15, 1], [0, 0.55, 0]) : 0;
  const float = Math.sin((frame / fps) * 1.6) * size * 0.025;
  const glowPulse = 0.85 + 0.15 * Math.sin((frame / fps) * 2.2);

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        transform: `translateY(${float}px) scale(${interpolate(enter, [0, 1], [0.35, 1])}) rotate(${interpolate(enter, [0, 1], [-18, 0])}deg)`,
        opacity: interpolate(local, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}
    >
      <IconGradientDefs id={gradientId} from={theme.accent} to={theme.accent2} />
      {/* Свечение позади — radial-gradient вместо blur ради скорости */}
      <div
        style={{
          position: "absolute",
          left: -size * 0.75,
          top: -size * 0.75,
          width: size * 2.5,
          height: size * 2.5,
          opacity: glowPulse,
          background: `radial-gradient(closest-side, ${withAlpha(theme.accent, 0.32)} 0%, ${withAlpha(theme.accent, 0.1)} 45%, ${withAlpha(theme.accent, 0)} 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          border: `${Math.max(2, size * 0.012)}px solid ${withAlpha(theme.accent, 0.8)}`,
          transform: `scale(${pingScale})`,
          opacity: pingOpacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          background: `linear-gradient(145deg, ${withAlpha(theme.text, 0.16)} 0%, ${withAlpha(theme.text, 0.04)} 55%, ${withAlpha(theme.accent, 0.08)} 100%)`,
          border: `${Math.max(1.5, size * 0.008)}px solid ${withAlpha(theme.text, 0.2)}`,
          boxShadow: `0 ${size * 0.12}px ${size * 0.3}px rgba(0,0,0,0.35), inset 0 ${size * 0.02}px 0 ${withAlpha(theme.text, 0.14)}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${interpolate(iconIn, [0, 1], [0.5, 1])})`,
          opacity: interpolate(local, [4, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <Icon name={name} size={size * 0.5} color={`url(#${gradientId})`} strokeWidth={1.7} />
      </div>
    </div>
  );
};
