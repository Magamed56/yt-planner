import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { VideoProps } from "../types";
import { Background } from "./components/Background";
import { Icon, IconGradientDefs } from "./components/Icon";
import { KineticText } from "./components/KineticText";
import { FONT_DISPLAY, FONT_NUMBER, FontGate } from "./fonts";
import { stripMarkup } from "./lib/text";
import { formatNumber } from "./scenes/StatScene";
import { getTheme, withAlpha } from "./theme";

// Обложка 1280×720: 3–6 слов огромным шрифтом с акцентом из хука, крупная
// иконка со свечением и, если в ролике есть цифра, — «плашка» с ней.
// Мелкий текст на обложке не читается в ленте, поэтому только крупное.
export const Thumbnail: React.FC<VideoProps & Record<string, unknown>> = (props) => {
  const { width, height } = useVideoConfig();
  const theme = getTheme(props.theme);
  const u = height / 720;
  const hook = props.scenes.find((s) => s.kind === "hook") ?? props.scenes[0];
  const hookText = hook?.onScreen ?? "";
  // Хук короткий и с *акцентом* — берём его; иначе заголовок ролика.
  const text = hookText && stripMarkup(hookText).length <= 48 ? hookText : props.title;
  const statScene = props.scenes.find((s) => s.kind === "stat" && s.stat);
  const stat = statScene?.stat;
  const statText = stat ? `${stat.prefix ?? ""}${formatNumber(stat.value, Number.isInteger(stat.value) ? 0 : 1)}${stat.suffix ?? ""}` : null;
  const icon = hook?.icon ?? statScene?.icon;
  const textW = width * 0.57;
  const iconSize = Math.round(320 * u);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bgFrom }}>
      <FontGate>
        <Background theme={theme} seed={props.title} frameOverride={45} particles={false} />
        {/* Дополнительная подсветка справа — за иконкой */}
        <AbsoluteFill style={{ background: `radial-gradient(circle at 76% 50%, ${withAlpha(theme.accent, 0.2)} 0%, ${withAlpha(theme.accent, 0)} 38%)` }} />
        <div style={{ position: "absolute", left: 64 * u, top: 0, bottom: 0, width: textW, display: "flex", alignItems: "center" }}>
          <KineticText
            text={text}
            theme={theme}
            box={{ w: textW, h: height * 0.8 }}
            font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.02, letterSpacingEm: -0.03, uppercase: true }}
            maxFontSize={Math.round(118 * u)}
            maxLines={4}
            align="left"
            start={-300}
            step={0}
            highlightAt={-200}
            entrance="rise"
            highlight="marker"
          />
        </div>
        <div style={{ position: "absolute", left: width * 0.775 - iconSize / 2, top: height * 0.47 - iconSize / 2, width: iconSize, height: iconSize }}>
          {/* Свечение и кольца — обложка должна «светиться» в ленте */}
          <div
            style={{
              position: "absolute",
              left: -iconSize * 0.6,
              top: -iconSize * 0.6,
              width: iconSize * 2.2,
              height: iconSize * 2.2,
              background: `radial-gradient(closest-side, ${withAlpha(theme.accent, 0.45)} 0%, ${withAlpha(theme.accent2, 0.16)} 45%, ${withAlpha(theme.accent2, 0)} 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `radial-gradient(circle at 35% 30%, ${withAlpha(theme.text, 0.22)} 0%, ${withAlpha(theme.blobA, 0.35)} 45%, ${withAlpha(theme.bgFrom, 0.85)} 100%)`,
              border: `${5 * u}px solid ${withAlpha(theme.accent, 0.9)}`,
              boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.5), 0 0 ${50 * u}px ${withAlpha(theme.accent, 0.45)}`,
            }}
          />
          <div style={{ position: "absolute", inset: -iconSize * 0.09, borderRadius: "50%", border: `${2 * u}px solid ${withAlpha(theme.text, 0.25)}` }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconGradientDefs id="thumb-icon" from={theme.text} to={theme.accent} />
            <Icon name={icon} size={iconSize * 0.56} color="url(#thumb-icon)" strokeWidth={2} />
          </div>
          {statText ? (
            <div
              style={{
                position: "absolute",
                right: -iconSize * 0.16,
                bottom: -iconSize * 0.14,
                padding: `${8 * u}px ${24 * u}px`,
                borderRadius: 22 * u,
                background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`,
                color: theme.accentInk,
                fontFamily: FONT_NUMBER,
                fontWeight: 800,
                fontSize: Math.round(78 * u),
                lineHeight: 1.1,
                letterSpacing: "-0.04em",
                transform: "rotate(-7deg)",
                boxShadow: `0 ${16 * u}px ${40 * u}px rgba(0,0,0,0.45)`,
                whiteSpace: "nowrap",
              }}
            >
              {statText}
            </div>
          ) : null}
        </div>
      </FontGate>
    </AbsoluteFill>
  );
};
