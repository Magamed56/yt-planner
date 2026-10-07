import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";

// Цитата / «сильная фраза»: огромные кавычки, текст проявляется вслед за
// голосом, вертикальная акцентная линия слева. Без указания автора.
export const QuoteScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const voice = useVoice(p.scene);
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const markSize = Math.round((shorts ? 360 : 300) * unit);
  const markIn = spring({ frame, fps, config: { damping: 12, stiffness: 120, mass: 0.8 } });
  const lineIn = spring({ frame: frame - 6, fps, config: { damping: 200 }, durationInFrames: 24 });
  const textW = shorts ? content.w - 48 * unit : Math.min(content.w * 0.8, 1400 * unit);

  return (
    <SceneFrame p={p} push={0.03}>
      <ContentBox align={shorts ? "flex-start" : "center"}>
        <div style={{ position: "relative", paddingLeft: 48 * unit, paddingTop: markSize * 0.42 }}>
          <div
            style={{
              position: "absolute",
              left: -10 * unit,
              top: -markSize * 0.18,
              fontFamily: FONT_DISPLAY,
              fontWeight: 900,
              fontSize: markSize,
              lineHeight: 1,
              background: `linear-gradient(160deg, ${p.theme.accent} 20%, ${p.theme.accent2} 90%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              opacity: 0.95 * interpolate(frame, [0, 6], [0, 1], clamp),
              transform: `translateY(${interpolate(markIn, [0, 1], [60 * unit, 0])}px) scale(${interpolate(markIn, [0, 1], [0.6, 1])})`,
              transformOrigin: "20% 80%",
            }}
          >
            “
          </div>
          {/* Вертикальная линия «прорастает» сверху вниз */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: markSize * 0.46,
              bottom: 8 * unit,
              width: 7 * unit,
              borderRadius: 4 * unit,
              background: `linear-gradient(180deg, ${p.theme.accent}, ${withAlpha(p.theme.accent2, 0.15)})`,
              transform: `scaleY(${lineIn})`,
              transformOrigin: "50% 0%",
            }}
          />
          <KineticText
            text={p.scene.onScreen}
            theme={p.theme}
            box={{ w: textW, h: content.h - markSize * 0.5 }}
            font={{ fontFamily: FONT_DISPLAY, fontWeight: 700, lineHeight: 1.14, letterSpacingEm: -0.015 }}
            maxFontSize={Math.round((shorts ? 104 : 96) * unit)}
            maxLines={6}
            align="left"
            scene={p.scene}
            mode="speech"
            start={voice.start}
            step={5}
            deadline={voice.start + Math.round((voice.end - voice.start) * 0.8)}
            entrance="fade"
            highlight="underline"
          />
        </div>
      </ContentBox>
    </SceneFrame>
  );
};
