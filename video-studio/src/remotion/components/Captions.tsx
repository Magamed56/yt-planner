import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import { measureText } from "@remotion/layout-utils";
import type { TimelineCaption } from "../../types";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { fitTokens, type FontSpec } from "../lib/text";
import { type Theme } from "../theme";

// Субтитры в стиле TikTok: страницы по ~1 c речи, текущее слово — цветом
// акцента с быстрым «поп»-масштабом. Полоса субтитров (lib/layout.ts) не
// пересекается с зоной основного текста сцены и обходит интерфейс YouTube.

const COMBINE_MS = 1000;
const HOLD_AFTER_MS = 450; // страница висит чуть после последнего слова, но не через всю паузу
const BREAK_ON_SILENCE_MS = 300; // пауза между предложениями — новая страница
const WORD_PAD_EM = 0.05; // поля слова: «поп»-масштаб активного слова не наезжает на соседей (амплитуда ниже ограничена промежутком)

const CAPTION_FONT: FontSpec = { fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.18, letterSpacingEm: -0.01 };

// Обводка набором теней без размытия (дёшево) + мягкая тень для глубины.
function outline(px: number, color: string): string {
  const parts: string[] = [];
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    parts.push(`${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 ${color}`);
  }
  parts.push(`0 ${px * 2}px ${px * 4}px rgba(0,0,0,0.55)`);
  return parts.join(", ");
}

export const Captions: React.FC<{ captions: TimelineCaption[]; theme: Theme }> = ({ captions, theme }) => {
  const { fps } = useVideoConfig();
  const pages = useMemo(() => {
    if (captions.length === 0) return [];
    // Гарантируем ведущий пробел у всех слов кроме первого — по нему
    // createTikTokStyleCaptions режет страницы.
    const prepared: Caption[] = captions.map((c, i) => ({
      ...c,
      text: i === 0 ? c.text.trimStart() : c.text.startsWith(" ") ? c.text : ` ${c.text}`,
    }));
    return createTikTokStyleCaptions({ captions: prepared, combineTokensWithinMilliseconds: COMBINE_MS, breakOnSilenceAfterMilliseconds: BREAK_ON_SILENCE_MS }).pages;
  }, [captions]);

  return (
    <>
      {pages.map((page, i) => {
        const from = Math.round((page.startMs / 1000) * fps);
        const lastTo = page.tokens.length ? page.tokens[page.tokens.length - 1].toMs : page.startMs + page.durationMs;
        const nextStart = i + 1 < pages.length ? pages[i + 1].startMs : Number.POSITIVE_INFINITY;
        const endMs = Math.min(nextStart, lastTo + HOLD_AFTER_MS);
        const dur = Math.max(1, Math.round((endMs / 1000) * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none" name={`Субтитры ${i + 1}`}>
            <CaptionPage page={page} theme={theme} durationInFrames={dur} />
          </Sequence>
        );
      })}
    </>
  );
};

const CaptionPage: React.FC<{ page: TikTokPage; theme: Theme; durationInFrames: number }> = ({ page, theme, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const c = layout.captions;
  const nowMs = page.startMs + (frame / fps) * 1000;

  const tokens = useMemo(() => page.tokens.map((t) => ({ ...t, text: t.text.trim() })), [page]);
  const fit = useMemo(
    () => fitTokens(tokens, CAPTION_FONT, { w: c.maxWidth, h: c.fontSize * CAPTION_FONT.lineHeight * c.maxLines }, { maxFontSize: c.fontSize, minFontSize: c.fontSize * 0.6, maxLines: c.maxLines, extraEm: WORD_PAD_EM * 2, sentenceBreaks: false, scoring: false }),
    [tokens, c.maxWidth, c.fontSize, c.maxLines],
  );
  const fs = fit.fontSize;
  // Амплитуда «попа» ограничена шириной промежутка: длинное слово растёт
  // меньше, чтобы не наехать на соседей.
  const amps = useMemo(() => {
    const m = (text: string) =>
      measureText({ text, fontFamily: CAPTION_FONT.fontFamily, fontSize: fs, fontWeight: CAPTION_FONT.fontWeight, letterSpacing: `${(CAPTION_FONT.letterSpacingEm ?? 0) * fs}px` }).width;
    const gap = Math.max(1, m("a a") - m("aa")) + 2 * WORD_PAD_EM * fs;
    return tokens.map((t) => Math.min(0.1, (0.9 * gap) / Math.max(1, m(t.text))));
  }, [tokens, fs]);
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 260, mass: 0.5 } });
  const exit = interpolate(frame, [durationInFrames - 3, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ol = outline(Math.max(3, fs * 0.065), "rgba(0,0,0,0.92)");

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: c.centerX - c.maxWidth / 2,
          width: c.maxWidth,
          top: c.centerY,
          transform: `translateY(-50%) translateY(${interpolate(enter, [0, 1], [fs * 0.25, 0])}px) scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
          opacity: Math.min(interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" }), exit),
          fontFamily: CAPTION_FONT.fontFamily,
          fontWeight: CAPTION_FONT.fontWeight,
          fontSize: fs,
          letterSpacing: `${CAPTION_FONT.letterSpacingEm}em`,
          lineHeight: `${fs * CAPTION_FONT.lineHeight}px`,
          textAlign: "center",
          color: theme.text,
        }}
      >
        {fit.lines.map((line, li) => (
          <div key={li} style={{ whiteSpace: "nowrap" }}>
            {line.map((ti, j) => {
              const t = tokens[ti];
              const active = nowMs >= t.fromMs && nowMs < t.toMs;
              const since = ((nowMs - t.fromMs) / 1000) * fps;
              // «Поп» без перелёта: быстро до пика за 3 кадра и чуть назад —
              // масштаб никогда не превышает рассчитанную амплитуду.
              const pop = active ? interpolate(since, [0, 3, 8], [0, 1, 0.7], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
              const spoken = nowMs >= t.toMs;
              return (
                <React.Fragment key={ti}>
                  {j > 0 ? " " : null}
                  <span
                    style={{
                      display: "inline-block",
                      margin: `0 ${WORD_PAD_EM}em`,
                      transform: `scale(${1 + amps[ti] * pop})`,
                      transformOrigin: "50% 60%",
                      color: active ? theme.accent : theme.text,
                      opacity: active || spoken ? 1 : 0.88,
                      textShadow: ol,
                    }}
                  >
                    {t.text}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
