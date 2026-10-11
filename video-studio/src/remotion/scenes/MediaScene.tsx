import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { Illustration } from "../components/Illustration";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { textStartAfterChapter } from "./ChapterCard";
import { ContentBox, SceneFrame, type SceneProps } from "./common";

// Полноэкранный визуал (сток / AI-картинка) с подписью в нижней трети
// контентной зоны — над полосой субтитров. Если визуала нет (сток не нашёлся
// или ключей нет), вместо него — моушен-иллюстрация (components/Illustration).
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
        maxFontSize={Math.round((shorts ? 108 : 116) * unit)}
        maxLines={4}
        align="left"
        scene={p.scene}
        mode="stagger"
        start={textStartAfterChapter(p, 2)}
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

  // ---- Без визуала: моушен-иллюстрация вместо картинки ----
  // Многие запускают без ключей стоков, поэтому это полноценная композиция:
  // иконка прорисовывается в «медальоне» среди орбит и геометрии.
  if (shorts) {
    const textMaxH = content.h * 0.36;
    const illH = content.h - textMaxH - 40 * unit;
    return (
      <SceneFrame p={p} push={0.03}>
        <ContentBox align="flex-start" justify="center" gap={36 * unit}>
          <Illustration icon={p.scene.icon} theme={p.theme} w={content.w} h={illH} id={`m-${p.scene.id}`} />
          {lowerThird(textMaxH, content.w)}
        </ContentBox>
      </SceneFrame>
    );
  }
  const illW = content.w * 0.44;
  return (
    <SceneFrame p={p} push={0.03}>
      <ContentBox align="center">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 70 * unit }}>
          <Illustration icon={p.scene.icon} theme={p.theme} w={illW} h={content.h} id={`m-${p.scene.id}`} />
          {lowerThird(content.h * 0.62, content.w - illW - 70 * unit)}
        </div>
      </ContentBox>
    </SceneFrame>
  );
};
