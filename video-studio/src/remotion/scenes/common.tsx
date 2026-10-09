import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import type { RenderScene, VideoProps } from "../../types";
import { useLayout, type Box } from "../lib/layout";
import type { Theme } from "../theme";
import { MediaLayer, type MediaDim } from "../components/MediaLayer";

export interface SceneProps {
  scene: RenderScene;
  index: number;
  theme: Theme;
  video: VideoProps;
}

// Кадры голоса внутри сцены (относительно начала сцены).
export function useVoice(scene: RenderScene) {
  const { fps } = useVideoConfig();
  const start = scene.audioStartFrame;
  const end = start + Math.ceil((scene.audioDurationMs / 1000) * fps);
  return { start, end, fps };
}

// Медленный «наезд камеры» + еле заметный дрейф: статичный текст оживает,
// но не укачивает. Масштаб от центра контентной зоны.
export const CameraPush: React.FC<{ children: React.ReactNode; amount?: number; seed: string; durationInFrames: number }> = ({
  children,
  amount = 0.04,
  seed,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const p = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const t = frame / fps;
  const dx = noise2D(`${seed}-cx`, t * 0.25, 0) * 6 * layout.unit;
  const dy = noise2D(`${seed}-cy`, 0, t * 0.25) * 6 * layout.unit;
  const cx = layout.content.x + layout.content.w / 2;
  const cy = layout.content.y + layout.content.h / 2;
  return (
    <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) scale(${1 + amount * p})`, transformOrigin: `${cx}px ${cy}px` }}>
      {children}
    </AbsoluteFill>
  );
};

// Контентная зона сцены (безопасная, не пересекается с субтитрами).
export const ContentBox: React.FC<{
  children: React.ReactNode;
  box?: Box;
  align?: "center" | "flex-start";
  justify?: "center" | "flex-start" | "flex-end" | "space-between";
  gap?: number;
  style?: React.CSSProperties;
}> = ({ children, box, align = "center", justify = "center", gap = 0, style }) => {
  const layout = useLayout();
  const b = box ?? layout.content;
  return (
    <div
      style={{
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: justify,
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// Обёртка сцены: визуал (если есть) как приглушённый фон + наезд камеры.
export const SceneFrame: React.FC<{ p: SceneProps; children: React.ReactNode; push?: number; dim?: MediaDim }> = ({
  p,
  children,
  push,
  dim = "strong",
}) => {
  const { unit } = useLayout();
  const hasVisual = p.scene.visual.type !== "none";
  // medium: фон светлее, и контраст текста, цифр и иконок добирает мягкий
  // тёмный ореол (один фильтр на всю сцену, а не тень у каждого слова).
  const halo = hasVisual && dim === "medium" ? `drop-shadow(0 ${Math.round(4 * unit)}px ${Math.round(26 * unit)}px rgba(0,0,0,0.6))` : undefined;
  return (
    <AbsoluteFill>
      {hasVisual ? <MediaLayer visual={p.scene.visual} theme={p.theme} durationInFrames={p.scene.durationInFrames} seed={p.index} dim={dim} /> : null}
      <CameraPush seed={p.scene.id} durationInFrames={p.scene.durationInFrames} amount={push}>
        {halo ? <AbsoluteFill style={{ filter: halo }}>{children}</AbsoluteFill> : children}
      </CameraPush>
    </AbsoluteFill>
  );
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
