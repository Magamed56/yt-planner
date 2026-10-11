import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { IconBadge } from "../components/Icon";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { textStartAfterChapter } from "./ChapterCard";
import { ContentBox, SceneFrame, clamp, type SceneProps } from "./common";

// Основная мысль: карточка-иконка + крупный текст, выровненный по левому
// краю (редакционная вёрстка выглядит дороже центровки), акцент — подчёркиванием.
export const StatementScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const badge = Math.round((shorts ? 200 : 220) * unit);
  const gap = Math.round((shorts ? 56 : 72) * unit);
  const barIn = spring({ frame: frame - 14, fps, config: { damping: 200 }, durationInFrames: 20 });

  // Слова выезжают с первого кадра перехода: с задержкой у склейки ≈ 0,3 с
  // экран почти пуст (старая сцена ушла, текст новой ещё не появился).
  // После карточки главы — ждём, пока растает её название.
  const text = (
    <KineticText
      text={p.scene.onScreen}
      theme={p.theme}
      box={shorts ? { w: content.w, h: content.h - badge - gap * 2 } : { w: content.w - badge - gap, h: content.h * 0.9 }}
      font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.08, letterSpacingEm: -0.02 }}
      maxFontSize={Math.round((shorts ? 128 : 118) * unit)}
      maxLines={shorts ? 7 : 5}
      align="left"
      scene={p.scene}
      mode="stagger"
      start={textStartAfterChapter(p, 0)}
      step={2}
      entrance="rise"
      highlight="underline"
    />
  );
  const bar = (
    <div
      style={{
        width: 140 * unit,
        height: 8 * unit,
        borderRadius: 4 * unit,
        background: `linear-gradient(90deg, ${p.theme.accent}, ${p.theme.accent2})`,
        transform: `scaleX(${barIn})`,
        transformOrigin: "0% 50%",
        opacity: interpolate(frame, [14, 18], [0, 1], clamp),
      }}
    />
  );

  return (
    <SceneFrame p={p} dim="medium">
      {shorts ? (
        <ContentBox align="flex-start" gap={gap}>
          <IconBadge name={p.scene.icon} size={badge} theme={p.theme} delay={0} gradientId={`ig-${p.scene.id}`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 40 * unit }}>
            {text}
            {bar}
          </div>
        </ContentBox>
      ) : (
        <ContentBox align="center">
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap }}>
            <IconBadge name={p.scene.icon} size={badge} theme={p.theme} delay={0} gradientId={`ig-${p.scene.id}`} />
            <div style={{ display: "flex", flexDirection: "column", gap: 36 * unit }}>
              {text}
              {bar}
            </div>
          </div>
        </ContentBox>
      )}
    </SceneFrame>
  );
};
