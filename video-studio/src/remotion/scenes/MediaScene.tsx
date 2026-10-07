import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { KineticText } from "../components/KineticText";
import { Icon, IconGradientDefs } from "../components/Icon";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, type SceneProps } from "./common";

// Полноэкранный визуал (сток / AI-картинка) с подписью в нижней трети
// контентной зоны — над полосой субтитров. Если визуала нет (сток не нашёлся),
// вместо него — «иллюстрация»: стеклянная панель с крупной иконкой.
export const MediaScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const hasVisual = p.scene.visual.type !== "none";
  const barIn = spring({ frame: frame - 4, fps, config: { damping: 200 }, durationInFrames: 16 });

  const lowerThird = (maxH: number, maxW: number) => (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "stretch", gap: 28 * unit }}>
      <div
        style={{
          width: 9 * unit,
          borderRadius: 5 * unit,
          background: `linear-gradient(180deg, ${p.theme.accent}, ${p.theme.accent2})`,
          transform: `scaleY(${barIn})`,
          transformOrigin: "50% 100%",
          boxShadow: `0 0 ${24 * unit}px ${withAlpha(p.theme.accent, 0.6)}`,
        }}
      />
      <KineticText
        text={p.scene.onScreen}
        theme={p.theme}
        box={{ w: maxW - 40 * unit, h: maxH }}
        font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.08, letterSpacingEm: -0.02 }}
        maxFontSize={Math.round((shorts ? 100 : 92) * unit)}
        maxLines={3}
        align="left"
        scene={p.scene}
        mode="stagger"
        start={8}
        step={3}
        entrance="rise"
        highlight="marker"
      />
    </div>
  );

  if (hasVisual) {
    return (
      <SceneFrame p={p} dim="soft" push={0.02}>
        <ContentBox align="flex-start" justify="flex-end">
          {lowerThird(content.h * 0.34, shorts ? content.w : content.w * 0.7)}
        </ContentBox>
      </SceneFrame>
    );
  }

  // ---- Без визуала: панель-иллюстрация ----
  const panelW = shorts ? content.w : content.w * 0.42;
  const panelH = shorts ? content.h * 0.56 : content.h * 0.82;
  const panelIn = spring({ frame, fps, config: { damping: 15, stiffness: 110, mass: 0.9 } });
  const t = frame / fps;
  const sheen = interpolate((frame % (fps * 3)) / (fps * 3), [0, 1], [-1.2, 1.6]);
  const iconSize = Math.min(panelW, panelH) * 0.46;
  const gid = `mg-${p.scene.id}`;
  const panel = (
    <div
      style={{
        position: "relative",
        width: panelW,
        height: panelH,
        borderRadius: 48 * unit,
        overflow: "hidden",
        border: `${2 * unit}px solid ${withAlpha(p.theme.text, 0.14)}`,
        background: `radial-gradient(circle at ${30 + noise2D("mx", t * 0.2, 0) * 20}% ${30 + noise2D("my", 0, t * 0.2) * 15}%, ${withAlpha(p.theme.blobA, 0.75)} 0%, ${withAlpha(p.theme.blobA, 0)} 55%),
          radial-gradient(circle at 80% 85%, ${withAlpha(p.theme.blobB, 0.6)} 0%, ${withAlpha(p.theme.blobB, 0)} 55%),
          linear-gradient(160deg, ${p.theme.bgTo}, ${p.theme.bgFrom})`,
        boxShadow: `0 ${40 * unit}px ${90 * unit}px rgba(0,0,0,0.45)`,
        transform: `translateY(${interpolate(panelIn, [0, 1], [80 * unit, 0])}px) scale(${interpolate(panelIn, [0, 1], [0.9, 1])}) rotate(${interpolate(panelIn, [0, 1], [-3, 0])}deg)`,
        opacity: interpolate(frame, [0, 8], [0, 1], clamp),
      }}
    >
      <IconGradientDefs id={gid} from={p.theme.text} to={p.theme.accent} />
      {/* Концентрические кольца — «радар» вокруг иконки */}
      {[0.55, 0.8, 1.05].map((k, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: panelW / 2 - (iconSize * k * 1.6) / 2,
            top: panelH / 2 - (iconSize * k * 1.6) / 2,
            width: iconSize * k * 1.6,
            height: iconSize * k * 1.6,
            borderRadius: "50%",
            border: `${1.5 * unit}px solid ${withAlpha(p.theme.text, 0.16 - i * 0.04)}`,
            transform: `scale(${1 + 0.03 * Math.sin(t * 2 + i)})`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `translateY(${Math.sin(t * 1.4) * 10 * unit}px) rotate(${Math.sin(t * 0.9) * 3}deg)`,
        }}
      >
        <Icon name={p.scene.icon} size={iconSize} color={`url(#${gid})`} strokeWidth={1.4} />
      </div>
      {/* Блик, пробегающий по стеклу */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(115deg, rgba(255,255,255,0) ${(sheen - 0.2) * 100}%, rgba(255,255,255,0.12) ${sheen * 100}%, rgba(255,255,255,0) ${(sheen + 0.2) * 100}%)`,
        }}
      />
    </div>
  );

  return (
    <SceneFrame p={p} push={0.03}>
      {shorts ? (
        <ContentBox align="flex-start" justify="space-between" gap={40 * unit}>
          {panel}
          {lowerThird(content.h - panelH - 60 * unit, content.w)}
        </ContentBox>
      ) : (
        <ContentBox align="center">
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 80 * unit }}>
            {panel}
            {lowerThird(content.h * 0.6, content.w - panelW - 80 * unit)}
          </div>
        </ContentBox>
      )}
    </SceneFrame>
  );
};
