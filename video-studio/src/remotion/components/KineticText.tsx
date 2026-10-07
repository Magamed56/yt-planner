import React, { useMemo } from "react";
import { interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderScene } from "../../types";
import { fitTokens, parseMarkup, type FontSpec, type TextToken } from "../lib/text";
import { accentFrame, scheduleTokens } from "../lib/timing";
import { withAlpha, type Theme } from "../theme";

// Кинетическая типографика: слова влетают по одному на пружине, акцентные
// (*слово*) — цветом темы с маркером/подчёркиванием, которое «прорисовывается»
// в момент, когда диктор произносит это слово. Кегль подбирается так, чтобы
// любой реалистичный onScreen (~60 символов) влез в отведённую коробку.

export type Entrance = "rise" | "pop" | "fade";
export type Highlight = "marker" | "underline" | "color";

export interface KineticTextProps {
  text: string;
  theme: Theme;
  box: { w: number; h: number };
  font: FontSpec;
  maxFontSize: number;
  minFontSize?: number;
  maxLines?: number;
  align?: "left" | "center";
  scene?: Pick<RenderScene, "audioStartFrame" | "words" | "audioDurationMs">;
  mode?: "stagger" | "speech";
  start?: number; // кадр (от начала сцены) первого слова
  step?: number; // шаг между словами в режиме stagger
  deadline?: number; // speech: всё видно не позже этого кадра
  entrance?: Entrance;
  highlight?: Highlight;
  highlightAt?: number;
  color?: string;
  shadow?: boolean;
}

export function useFittedTokens(text: string, font: FontSpec, box: { w: number; h: number }, maxFontSize: number, minFontSize?: number, maxLines?: number) {
  const tokens = useMemo(() => parseMarkup(text), [text]);
  const fit = useMemo(
    () => fitTokens(tokens, font, box, { maxFontSize, minFontSize, maxLines }),
    // font — объект-литерал у вызывающего, сравниваем по значениям
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokens, font.fontFamily, font.fontWeight, font.letterSpacingEm, font.lineHeight, font.uppercase, box.w, box.h, maxFontSize, minFontSize, maxLines],
  );
  return { tokens, fit };
}

export const KineticText: React.FC<KineticTextProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { tokens, fit } = useFittedTokens(p.text, p.font, p.box, p.maxFontSize, p.minFontSize, p.maxLines);
  const start = p.start ?? 4;
  const step = p.step ?? 3;
  const appear = useMemo(() => {
    if (!p.scene) return tokens.map((_, i) => start + i * step);
    return scheduleTokens(tokens, p.scene, fps, { mode: p.mode ?? "stagger", start, step, deadline: p.deadline });
  }, [tokens, p.scene, fps, p.mode, start, step, p.deadline]);
  const lastAppear = appear.length ? appear[appear.length - 1] : start;
  const hlAt = useMemo(() => {
    if (p.highlightAt !== undefined) return p.highlightAt;
    const fallback = lastAppear + 8;
    const spoken = p.scene ? accentFrame(tokens, p.scene, fps, fallback) : fallback;
    // Подсветка не раньше, чем слово появилось на экране.
    const tokenIdx = tokens.findIndex((t) => t.accent);
    const own = tokenIdx >= 0 ? appear[tokenIdx] + 6 : fallback;
    return Math.max(spoken, own);
  }, [p.highlightAt, p.scene, tokens, fps, appear, lastAppear]);

  const fs = fit.fontSize;
  const lh = fs * p.font.lineHeight;
  const align = p.align ?? "center";
  const color = p.color ?? p.theme.text;

  return (
    <div
      style={{
        width: Math.ceil(Math.max(...fit.lineWidths, 1)) + 2,
        fontFamily: p.font.fontFamily,
        fontWeight: p.font.fontWeight,
        fontSize: fs,
        lineHeight: `${lh}px`,
        letterSpacing: p.font.letterSpacingEm ? `${p.font.letterSpacingEm}em` : undefined,
        textTransform: p.font.uppercase ? "uppercase" : undefined,
        color,
        textAlign: align,
      }}
    >
      {fit.lines.map((line, li) => (
        <div key={li} style={{ whiteSpace: "nowrap", height: lh, perspective: fs * 8 }}>
          {line.map((ti, j) => (
            <React.Fragment key={ti}>
              {j > 0 ? " " : null}
              <Word
                token={tokens[ti]}
                appearAt={appear[ti]}
                frame={frame}
                fps={fps}
                theme={p.theme}
                entrance={p.entrance ?? "rise"}
                highlight={p.highlight ?? "underline"}
                highlightAt={hlAt}
                fontSize={fs}
                color={color}
                shadow={p.shadow !== false}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
};

const Word: React.FC<{
  token: TextToken;
  appearAt: number;
  frame: number;
  fps: number;
  theme: Theme;
  entrance: Entrance;
  highlight: Highlight;
  highlightAt: number;
  fontSize: number;
  color: string;
  shadow: boolean;
}> = ({ token, appearAt, frame, fps, theme, entrance, highlight, highlightAt, fontSize, color, shadow }) => {
  const local = frame - appearAt;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  let transform = "";
  let opacity = 1;
  let filter: string | undefined;
  if (entrance === "pop") {
    const s = spring({ frame: local, fps, config: { damping: 12, stiffness: 220, mass: 0.6 } });
    opacity = interpolate(local, [0, 3], [0, 1], clamp);
    transform = `scale(${interpolate(s, [0, 1], [1.9, 1])}) translateY(${interpolate(s, [0, 1], [-0.12, 0])}em)`;
    // Размытие только первые кадры и только на одном слове — дёшево.
    const blur = interpolate(local, [0, 7], [10, 0], clamp);
    filter = blur > 0.3 ? `blur(${blur}px)` : undefined;
  } else if (entrance === "fade") {
    const s = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 16 });
    opacity = interpolate(local, [0, 10], [0, 1], clamp);
    transform = `translateY(${interpolate(s, [0, 1], [0.22, 0])}em)`;
  } else {
    const s = spring({ frame: local, fps, config: { damping: 14, stiffness: 150, mass: 0.7 } });
    opacity = interpolate(local, [0, 5], [0, 1], clamp);
    transform = `translateY(${interpolate(s, [0, 1], [0.55, 0])}em) rotateX(${interpolate(s, [0, 1], [-75, 0])}deg)`;
  }

  const hl = token.accent ? spring({ frame: frame - highlightAt, fps, config: { damping: 18, stiffness: 160, mass: 0.6 } }) : 0;
  const baseShadow = shadow ? `0 ${fontSize * 0.04}px ${fontSize * 0.18}px rgba(0,0,0,0.38)` : undefined;

  const renderRuns = (accentColor: string) =>
    token.runs.map((r, i) => (
      <span key={i} style={r.accent ? { color: accentColor } : undefined}>
        {r.text}
      </span>
    ));

  let inner: React.ReactNode;
  if (token.accent && highlight === "marker") {
    const ink = interpolateColors(hl, [0.35, 0.75], [theme.accent, theme.accentInk]);
    inner = (
      <>
        <span
          style={{
            position: "absolute",
            left: "-0.12em",
            right: "-0.12em",
            top: "0.04em",
            bottom: "0.02em",
            borderRadius: "0.14em",
            background: `linear-gradient(100deg, ${theme.accent} 0%, ${theme.accent2} 140%)`,
            transform: `scaleX(${hl}) rotate(-1.2deg)`,
            transformOrigin: "0% 50%",
            boxShadow: hl > 0.05 ? `0 ${fontSize * 0.06}px ${fontSize * 0.3}px ${withAlpha(theme.accent, 0.35)}` : undefined,
          }}
        />
        <span style={{ position: "relative", textShadow: hl > 0.5 ? "none" : baseShadow }}>{renderRuns(ink)}</span>
      </>
    );
  } else if (token.accent && highlight === "underline") {
    inner = (
      <>
        <span style={{ position: "relative", textShadow: `0 0 ${fontSize * 0.35}px ${withAlpha(theme.accent, 0.45 * Math.min(1, hl + 0.3))}, ${baseShadow ?? "0 0 0 transparent"}` }}>
          {renderRuns(theme.accent)}
        </span>
        <span
          style={{
            position: "absolute",
            left: "0.02em",
            right: "0.02em",
            bottom: "0.02em",
            height: "0.1em",
            borderRadius: "0.05em",
            background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
            transform: `scaleX(${hl})`,
            transformOrigin: "0% 50%",
          }}
        />
      </>
    );
  } else {
    inner = <span style={{ textShadow: token.accent ? `0 0 ${fontSize * 0.35}px ${withAlpha(theme.accent, 0.4)}` : baseShadow }}>{renderRuns(token.accent ? theme.accent : color)}</span>;
  }

  return (
    <span
      style={{
        display: "inline-block",
        position: "relative",
        transform,
        transformOrigin: "50% 100%",
        opacity,
        filter,
        // Пружина акцента слегка «подпрыгивает» слово в момент произнесения.
        scale: token.accent ? String(1 + 0.06 * Math.sin(Math.min(1, Math.max(0, hl)) * Math.PI)) : undefined,
      }}
    >
      {inner}
    </span>
  );
};
