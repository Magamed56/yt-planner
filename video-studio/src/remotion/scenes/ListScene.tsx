import React, { useMemo } from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Check } from "lucide-react";
import { KineticText, useFittedTokens } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { listRevealFrames } from "../lib/cues";
import { fitTokens, parseMarkup, type FontSpec } from "../lib/text";
import { voiceFrames } from "../lib/timing";
import { withAlpha } from "../theme";
import { SceneFrame, clamp, type SceneProps } from "./common";

const ITEM_FONT: FontSpec = { fontFamily: FONT_BODY, fontWeight: 700, lineHeight: 1.16, letterSpacingEm: -0.01 };
const TITLE_FONT: FontSpec = { fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.06, letterSpacingEm: -0.02 };
const glide = Easing.bezier(0.33, 1, 0.68, 1);

// Список: сначала заголовок по центру, затем каждый пункт-карточка въезжает
// в момент, когда диктор его произносит, а вся «стопка» плавно поднимается,
// оставаясь оптически по центру. Пустых заготовок нет — экран никогда не
// выглядит недоделанным. Текущий пункт подсвечен и с номером; прозвучавшие
// приглушаются, номер в них сменяется прорисованной галочкой.
export const ListScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const items = (p.scene.items && p.scene.items.length > 0 ? p.scene.items : [p.scene.narration]).slice(0, 5);

  const gap = Math.round((shorts ? 52 : 44) * unit);
  const rowGap = Math.round((shorts ? 24 : 22) * unit);
  const badge = Math.round((shorts ? 84 : 80) * unit);
  const padX = Math.round(32 * unit);
  const padY = Math.round((shorts ? 30 : 26) * unit);
  // В горизонтальном ролике 4+ пункта раскладываем в две колонки — иначе
  // карточки получаются низкими, а текст мелким.
  const cols = !shorts && items.length >= 4 ? 2 : 1;
  const rows = Math.ceil(items.length / cols);
  const colGap = Math.round(28 * unit);
  const rowW = shorts ? content.w : Math.min(content.w, (cols === 2 ? 1560 : 1240) * unit);
  const cellW = (rowW - colGap * (cols - 1)) / cols;
  const textW = cellW - padX * 2 - badge - Math.round(28 * unit);

  const titleMax = Math.round((shorts ? 104 : 104) * unit);
  const titleBox = { w: rowW, h: content.h * (shorts ? 0.27 : 0.3) };
  const { fit: titleFit } = useFittedTokens(p.scene.onScreen, TITLE_FONT, titleBox, titleMax, undefined, 3);
  const titleH = titleFit.lines.length * titleFit.fontSize * TITLE_FONT.lineHeight;

  const perItem = (content.h - titleH - gap - rowGap * (rows - 1)) / rows;
  const textMaxH = Math.max(40 * unit, perItem - padY * 2);

  // Общий кегль для всех пунктов — разный размер выглядел бы неряшливо.
  // Одна строка — только если она почти не уменьшает кегль; иначе две строки
  // крупнее: пункты — главное содержание сцены, им нужен вес.
  const fitted = useMemo(() => {
    const maxFont = Math.round((shorts ? 76 : 68) * unit);
    const toks = items.map((it) => parseMarkup(it));
    const sizeFor = (lines: number) => Math.min(...toks.map((t) => fitTokens(t, ITEM_FONT, { w: textW, h: textMaxH }, { maxFontSize: maxFont, maxLines: lines }).fontSize));
    const fitsOne = (size: number) => toks.every((t) => fitTokens(t, ITEM_FONT, { w: textW, h: textMaxH }, { maxFontSize: size, minFontSize: size, maxLines: 1 }).lines.length === 1);
    const two = sizeFor(2);
    const one = sizeFor(1);
    // Три строки — только для длинных пунктов, когда две дают мелкий кегль.
    const three = sizeFor(3);
    let lines = one >= two * 0.92 && fitsOne(one) ? 1 : 2;
    if (lines === 2 && three >= two * 1.15) lines = 3;
    const size = lines === 1 ? one : lines === 2 ? two : three;
    return toks.map((t) => ({ tokens: t, fit: fitTokens(t, ITEM_FONT, { w: textW, h: textMaxH }, { maxFontSize: size, minFontSize: size, maxLines: lines }) }));
  }, [items, textW, textMaxH, shorts, unit]);
  const rowH = Math.max(badge, ...fitted.map((f) => f.fit.lines.length * f.fit.fontSize * ITEM_FONT.lineHeight)) + padY * 2;

  // Те же кадры берёт AudioLayer для «пузырька» — звук ровно в момент появления пункта.
  const reveal = useMemo(() => listRevealFrames(p.scene, fps), [p.scene, fps]);
  const activeIdx = reveal.reduce((acc, f, i) => (frame >= f ? i : acc), -1);
  // Последний пункт «закрывается» галочкой ближе к концу голоса.
  const voiceEnd = p.scene.audioStartFrame + voiceFrames(p.scene, fps);
  const lastDoneAt = Math.max(reveal[reveal.length - 1] + 24, voiceEnd - 6);

  // Высота «стопки» растёт по мере появления строк — блок едет вверх плавно.
  const rowGrow = (r: number) => interpolate(frame - reveal[r * cols], [0, 16], [0, 1], { ...clamp, easing: glide });
  let stackH = titleH;
  for (let r = 0; r < rows; r++) stackH += rowGrow(r) * ((r === 0 ? gap : rowGap) + rowH);
  const top = content.y + (content.h - stackH) / 2;
  const left = content.x + (content.w - rowW) / 2;

  return (
    <SceneFrame p={p} push={0.03}>
      <div style={{ position: "absolute", left, top, width: rowW }}>
        <div style={{ height: titleH, display: "flex", alignItems: "flex-start" }}>
          <KineticText
            text={p.scene.onScreen}
            theme={p.theme}
            box={titleBox}
            font={TITLE_FONT}
            maxFontSize={titleMax}
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
        {fitted.map(({ tokens, fit }, i) => {
          const local = frame - reveal[i];
          if (local < 0) return null;
          const row = Math.floor(i / cols);
          const col = i % cols;
          const s = spring({ frame: local, fps, config: { damping: 17, stiffness: 140, mass: 0.75 } });
          const b = spring({ frame: local - 3, fps, config: { damping: 11, stiffness: 210, mass: 0.6 } });
          const doneAt = i + 1 < reveal.length ? reveal[i + 1] : lastDoneAt;
          const done = interpolate(frame - doneAt, [0, 8], [0, 1], clamp);
          const active = i === activeIdx && done < 1;
          const fs = fit.fontSize;
          const y = titleH + gap + row * (rowH + rowGap);
          const x = col * (cellW + colGap);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: cellW,
                height: rowH,
                display: "flex",
                alignItems: "center",
                gap: Math.round(28 * unit),
                padding: `0 ${padX}px`,
                borderRadius: Math.round(32 * unit),
                boxSizing: "border-box",
                overflow: "hidden",
                background: `linear-gradient(100deg, ${withAlpha(active ? p.theme.accent : p.theme.text, active ? 0.16 : 0.08)} 0%, ${withAlpha(p.theme.text, 0.03)} 75%)`,
                border: `${Math.max(1.5, 2 * unit)}px solid ${active ? withAlpha(p.theme.accent, 0.55) : withAlpha(p.theme.text, 0.12)}`,
                boxShadow: active ? `0 ${18 * unit}px ${50 * unit}px rgba(0,0,0,0.32)` : `0 ${10 * unit}px ${30 * unit}px rgba(0,0,0,0.18)`,
                opacity: interpolate(local, [0, 6], [0, 1], clamp) * (1 - 0.32 * done),
                transform: `translateX(${interpolate(s, [0, 1], [90 * unit, 0])}px) scale(${interpolate(s, [0, 1], [0.94, 1])})`,
                transformOrigin: "100% 50%",
              }}
            >
              {/* Акцентная полоска слева у текущего пункта */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "18%",
                  bottom: "18%",
                  width: 6 * unit,
                  borderRadius: 3 * unit,
                  background: `linear-gradient(180deg, ${p.theme.accent}, ${p.theme.accent2})`,
                  transform: `scaleY(${active ? s : 1 - done})`,
                  opacity: active ? 1 : 1 - done,
                }}
              />
              <div
                style={{
                  position: "relative",
                  flex: "none",
                  width: badge,
                  height: badge,
                  borderRadius: badge / 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `linear-gradient(140deg, ${p.theme.accent}, ${p.theme.accent2})`,
                  boxShadow: `0 0 ${32 * unit}px ${withAlpha(p.theme.accent, active ? 0.5 : 0.18)}`,
                  transform: `scale(${b})`,
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 800,
                    fontSize: badge * 0.46,
                    lineHeight: 1,
                    color: p.theme.accentInk,
                    opacity: 1 - done,
                    transform: `scale(${1 - 0.4 * done})`,
                  }}
                >
                  {i + 1}
                </span>
                <Check
                  size={badge * 0.56}
                  color={p.theme.accentInk}
                  strokeWidth={3.2}
                  style={{ position: "absolute", strokeDasharray: 24, strokeDashoffset: 24 * (1 - done) }}
                />
              </div>
              <div
                style={{
                  fontFamily: ITEM_FONT.fontFamily,
                  fontWeight: ITEM_FONT.fontWeight,
                  fontSize: fs,
                  lineHeight: `${fs * ITEM_FONT.lineHeight}px`,
                  letterSpacing: `${ITEM_FONT.letterSpacingEm}em`,
                  color: p.theme.text,
                  transform: `translateX(${interpolate(s, [0, 1], [24 * unit, 0])}px)`,
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
    </SceneFrame>
  );
};
