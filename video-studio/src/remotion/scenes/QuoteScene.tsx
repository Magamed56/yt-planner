import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText, useFittedTokens } from "../components/KineticText";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import type { FontSpec } from "../lib/text";
import { scheduleTokens } from "../lib/timing";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";

const QUOTE_FONT: FontSpec = { fontFamily: FONT_DISPLAY, fontWeight: 700, lineHeight: 1.14, letterSpacingEm: -0.015 };

// Цитата / «сильная фраза»: огромные кавычки, весь текст сразу виден
// приглушённым и «загорается» слово за словом вслед за голосом (экран не
// пустой, пока диктор говорит вступление), вертикальная акцентная линия
// слева; закрывающая кавычка встаёт на место после последнего слова.
export const QuoteScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const voice = useVoice(p.scene);
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const markSize = Math.round((shorts ? 380 : 320) * unit);
  const markIn = spring({ frame, fps, config: { damping: 12, stiffness: 120, mass: 0.8 } });
  const lineIn = spring({ frame: frame - 6, fps, config: { damping: 200 }, durationInFrames: 24 });
  const textW = shorts ? content.w - 48 * unit : Math.min(content.w * 0.8, 1400 * unit);
  const maxFont = Math.round((shorts ? 112 : 104) * unit);
  // Справа резервируем место под закрывающую кавычку — она встаёт после
  // последнего слова и не должна на него наезжать.
  const closeReserve = maxFont * 0.62;
  const textBox = { w: textW - closeReserve, h: content.h - markSize * 0.62 };
  const deadline = voice.start + Math.round((voice.end - voice.start) * 0.8);

  // Тот же расклад, что внутри KineticText, — чтобы знать, где кончается
  // последняя строка, и поставить туда закрывающую кавычку.
  const { tokens, fit } = useFittedTokens(p.scene.onScreen, QUOTE_FONT, textBox, maxFont, undefined, 7);
  const lastAt = useMemo(() => {
    const a = scheduleTokens(tokens, p.scene, fps, { mode: "speech", start: voice.start, step: 5, deadline });
    return a.length ? a[a.length - 1] : voice.start;
  }, [tokens, p.scene, fps, voice.start, deadline]);
  const close = spring({ frame: frame - lastAt - 6, fps, config: { damping: 13, stiffness: 150, mass: 0.7 } });
  const lastW = fit.lineWidths.length ? fit.lineWidths[fit.lineWidths.length - 1] : 0;
  const textH = fit.lines.length * fit.fontSize * QUOTE_FONT.lineHeight;
  const closeSize = fit.fontSize * 1.5;

  const gradText: React.CSSProperties = {
    fontFamily: FONT_DISPLAY,
    fontWeight: 900,
    lineHeight: 1,
    background: `linear-gradient(160deg, ${p.theme.accent} 20%, ${p.theme.accent2} 90%)`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
  };

  return (
    <SceneFrame p={p} push={0.03}>
      <ContentBox align={shorts ? "flex-start" : "center"}>
        <div style={{ position: "relative", paddingLeft: 48 * unit, paddingTop: markSize * 0.44 }}>
          <div
            style={{
              ...gradText,
              position: "absolute",
              left: -10 * unit,
              top: -markSize * 0.18,
              fontSize: markSize,
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
              top: markSize * 0.48,
              bottom: 8 * unit,
              width: 7 * unit,
              borderRadius: 4 * unit,
              background: `linear-gradient(180deg, ${p.theme.accent}, ${withAlpha(p.theme.accent2, 0.15)})`,
              transform: `scaleY(${lineIn})`,
              transformOrigin: "50% 0%",
            }}
          />
          <div style={{ position: "relative" }}>
            <KineticText
              text={p.scene.onScreen}
              theme={p.theme}
              box={textBox}
              font={QUOTE_FONT}
              maxFontSize={maxFont}
              maxLines={7}
              align="left"
              scene={p.scene}
              mode="speech"
              start={voice.start}
              step={5}
              deadline={deadline}
              entrance="karaoke"
              dim={0.2}
              highlight="underline"
            />
            {/* Закрывающая кавычка — в конце последней строки */}
            <div
              style={{
                ...gradText,
                position: "absolute",
                left: lastW + fit.fontSize * 0.1,
                top: textH - fit.fontSize * QUOTE_FONT.lineHeight * 0.92,
                fontSize: closeSize,
                opacity: interpolate(close, [0, 0.4], [0, 1], clamp),
                transform: `translateY(${interpolate(close, [0, 1], [fit.fontSize * 0.4, 0])}px) scale(${interpolate(close, [0, 1], [0.5, 1])})`,
                transformOrigin: "30% 70%",
              }}
            >
              ”
            </div>
          </div>
        </div>
      </ContentBox>
    </SceneFrame>
  );
};
