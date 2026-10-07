import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Check } from "lucide-react";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { fitTokens, parseMarkup, type FontSpec } from "../lib/text";
import { listItemFrames } from "../lib/timing";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, type SceneProps } from "./common";

const ITEM_FONT: FontSpec = { fontFamily: FONT_BODY, fontWeight: 700, lineHeight: 1.16, letterSpacingEm: -0.01 };

// Список: заголовок + пункты-карточки, каждый появляется в момент, когда
// диктор начинает его произносить. Текущий пункт подсвечен, прошлые — тише.
export const ListScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const items = (p.scene.items && p.scene.items.length > 0 ? p.scene.items : [p.scene.narration]).slice(0, 5);

  const titleH = Math.round(content.h * (shorts ? 0.26 : 0.3));
  const gap = Math.round(44 * unit);
  const rowGap = Math.round(22 * unit);
  const badge = Math.round((shorts ? 78 : 72) * unit);
  const padX = Math.round(30 * unit);
  const padY = Math.round(24 * unit);
  const rowW = shorts ? content.w : Math.min(content.w, 1300 * unit);
  const textW = rowW - padX * 2 - badge - Math.round(26 * unit);
  const perItem = (content.h - titleH - gap - rowGap * (items.length - 1)) / items.length;
  const textMaxH = Math.max(40 * unit, perItem - padY * 2);

  // Общий кегль для всех пунктов — разный размер выглядел бы неряшливо.
  // Одна строка — только если она почти не уменьшает кегль; иначе две строки
  // крупнее: пункты — главное содержание сцены, им нужен вес.
  const fitted = useMemo(() => {
    const maxFont = Math.round((shorts ? 66 : 58) * unit);
    const toks = items.map((it) => parseMarkup(it));
    const sizeFor = (lines: number) => Math.min(...toks.map((t) => fitTokens(t, ITEM_FONT, { w: textW, h: textMaxH }, { maxFontSize: maxFont, maxLines: lines }).fontSize));
    const fitsOne = (size: number) => toks.every((t) => fitTokens(t, ITEM_FONT, { w: textW, h: textMaxH }, { maxFontSize: size, minFontSize: size, maxLines: 1 }).lines.length === 1);
    const two = sizeFor(2);
    const one = sizeFor(1);
    const lines = one >= two * 0.92 && fitsOne(one) ? 1 : 2;
    const size = lines === 1 ? one : two;
    return toks.map((t) => ({ tokens: t, fit: fitTokens(t, ITEM_FONT, { w: textW, h: textMaxH }, { maxFontSize: size, minFontSize: size, maxLines: lines }) }));
  }, [items, textW, textMaxH, shorts, unit]);
  const rowMinH = Math.max(badge, ...fitted.map((f) => f.fit.lines.length * f.fit.fontSize * ITEM_FONT.lineHeight)) + padY * 2;

  const titleTokens = parseMarkup(p.scene.onScreen).length;
  const titleDone = 6 + titleTokens * 3 + 6;
  const reveal = useMemo(() => listItemFrames(items, p.scene, fps, titleDone), [items, p.scene, fps, titleDone]);
  const activeIdx = reveal.reduce((acc, f, i) => (frame >= f ? i : acc), -1);

  return (
    <SceneFrame p={p} push={0.03}>
      <ContentBox align={shorts ? "flex-start" : "center"} gap={gap}>
        <div style={{ height: titleH, display: "flex", alignItems: "flex-end", width: shorts ? "100%" : rowW }}>
          <KineticText
            text={p.scene.onScreen}
            theme={p.theme}
            box={{ w: shorts ? content.w : rowW, h: titleH }}
            font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.06, letterSpacingEm: -0.02 }}
            maxFontSize={Math.round((shorts ? 100 : 92) * unit)}
            maxLines={3}
            align="left"
            scene={p.scene}
            mode="stagger"
            start={4}
            step={3}
            entrance="rise"
            highlight="underline"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: rowGap, width: rowW }}>
          {fitted.map(({ tokens, fit }, i) => {
            const local = frame - reveal[i];
            const shown = local >= 0;
            const s = spring({ frame: local, fps, config: { damping: 15, stiffness: 150, mass: 0.7 } });
            const b = spring({ frame: local - 2, fps, config: { damping: 10, stiffness: 200, mass: 0.6 } });
            const check = interpolate(local, [5, 14], [0, 1], clamp);
            // Заготовки карточек появляются вместе с заголовком: зритель сразу
            // видит «их будет три», а пункт «зажигается», когда его произносят.
            const ghostIn = spring({ frame: frame - 8 - i * 3, fps, config: { damping: 200 }, durationInFrames: 14 });
            const active = i === activeIdx;
            const past = activeIdx > i;
            const fs = fit.fontSize;
            const lit = interpolate(local, [0, 8], [0, 1], clamp);
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: Math.round(26 * unit),
                  padding: `${padY}px ${padX}px`,
                  borderRadius: Math.round(30 * unit),
                  minHeight: rowMinH,
                  boxSizing: "border-box",
                  background: active
                    ? `linear-gradient(100deg, ${withAlpha(p.theme.accent, 0.17)} 0%, ${withAlpha(p.theme.text, 0.05)} 70%)`
                    : `linear-gradient(100deg, ${withAlpha(p.theme.text, shown ? 0.09 : 0.04)} 0%, ${withAlpha(p.theme.text, shown ? 0.03 : 0.01)} 80%)`,
                  border: `${Math.max(1.5, 2 * unit)}px ${shown ? "solid" : "dashed"} ${active ? withAlpha(p.theme.accent, 0.6) : withAlpha(p.theme.text, shown ? 0.14 : 0.16)}`,
                  boxShadow: active ? `0 ${18 * unit}px ${50 * unit}px rgba(0,0,0,0.3)` : undefined,
                  opacity: ghostIn * (past ? 0.8 : 1),
                  transform: `translateY(${interpolate(ghostIn, [0, 1], [30 * unit, 0])}px) scale(${shown ? interpolate(s, [0, 1], [0.97, 1]) : 0.97})`,
                  transformOrigin: "0% 50%",
                }}
              >
                <div style={{ position: "relative", flex: "none", width: badge, height: badge }}>
                  {/* Пустой кружок с номером — до того, как пункт прозвучал */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: badge / 2,
                      border: `${Math.max(2, 3 * unit)}px solid ${withAlpha(p.theme.text, 0.28)}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: FONT_DISPLAY,
                      fontWeight: 800,
                      fontSize: badge * 0.44,
                      color: withAlpha(p.theme.text, 0.45),
                      opacity: 1 - lit,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: badge / 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `linear-gradient(140deg, ${p.theme.accent}, ${p.theme.accent2})`,
                      boxShadow: `0 0 ${30 * unit}px ${withAlpha(p.theme.accent, active ? 0.55 : 0.25)}`,
                      transform: `scale(${shown ? b : 0})`,
                    }}
                  >
                    <Check size={badge * 0.58} color={p.theme.accentInk} strokeWidth={3.2} style={{ strokeDasharray: 24, strokeDashoffset: 24 * (1 - check) }} />
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: ITEM_FONT.fontFamily,
                    fontWeight: ITEM_FONT.fontWeight,
                    fontSize: fs,
                    lineHeight: `${fs * ITEM_FONT.lineHeight}px`,
                    letterSpacing: `${ITEM_FONT.letterSpacingEm}em`,
                    color: p.theme.text,
                    opacity: lit,
                    transform: `translateX(${interpolate(s, [0, 1], [-50 * unit, 0])}px)`,
                  }}
                >
                  {fit.lines.map((ln, li) => (
                    <div key={li} style={{ whiteSpace: "nowrap" }}>
                      {ln.map((ti, j) => (
                        <React.Fragment key={ti}>
                          {j > 0 ? " " : null}
                          {tokens[ti].runs.map((r, ri) => (
                            <span key={ri} style={r.accent ? { color: p.theme.accent } : undefined}>
                              {r.text}
                            </span>
                          ))}
                        </React.Fragment>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ContentBox>
    </SceneFrame>
  );
};
