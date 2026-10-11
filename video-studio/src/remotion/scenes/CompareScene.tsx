import React, { useMemo } from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMBER } from "../fonts";
import { compareRevealFrames } from "../lib/cues";
import { useLayout } from "../lib/layout";
import { formatNumber, isYearNumber } from "../lib/numbers";
import { fitTokens, type FontSpec } from "../lib/text";
import { withAlpha } from "../theme";
import { SceneFrame, clamp, type SceneProps } from "./common";

const LABEL_FONT: FontSpec = { fontFamily: FONT_BODY, fontWeight: 700, lineHeight: 1.15 };
const VALUE_FONT: FontSpec = { fontFamily: FONT_NUMBER, fontWeight: 800, lineHeight: 1, letterSpacingEm: -0.02 };

// Сравнение 2–4 величин: столбики вырастают по очереди, когда диктор называет
// пункт (кадры — lib/cues.ts, там же «пузырёк» в звуке), число в конце
// столбика докручивается вместе с ним. Самый большой — цветом акцента.
export const CompareScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const items = (p.scene.compare?.items ?? []).slice(0, 4);
  const suffix = p.scene.compare?.suffix ?? "";
  const max = Math.max(...items.map((it) => Math.abs(it.value)), 1e-9);
  const reveal = useMemo(() => compareRevealFrames(p.scene, fps), [p.scene, fps]);
  const decimals = (v: number) => (Number.isInteger(v) ? 0 : Math.min(2, String(v).split(".")[1]?.length ?? 1));
  // Годы («1096 г.») не докручиваем: столбик растёт, а число сразу итоговое.
  const year = items.length > 0 && items.every((it) => isYearNumber(it.value, "", suffix, p.scene.narration));

  const titleH = content.h * (shorts ? 0.26 : 0.3);
  const area = { x: content.x, y: content.y + titleH, w: shorts ? content.w : Math.min(content.w, 1500 * unit), h: content.h - titleH };
  const rowGap = Math.round((shorts ? 56 : 40) * unit);
  const rowH = Math.min((area.h - rowGap * (items.length - 1)) / items.length, (shorts ? 190 : 160) * unit);
  const barH = Math.round(rowH * 0.48);
  const labelSize = Math.round(Math.min(rowH * 0.3, (shorts ? 52 : 46) * unit));
  // Кегль чисел — один на все столбики, по самому длинному итоговому значению.
  const valueTexts = items.map((it) => `${formatNumber(it.value, decimals(it.value), p.video.language, year)}${suffix}`);
  const valueW = area.w * 0.3;
  const valueSize = useMemo(
    () => Math.min(...valueTexts.map((t) => fitTokens([{ text: t }], VALUE_FONT, { w: valueW, h: barH * 1.3 }, { maxFontSize: Math.round(barH * 0.95), maxLines: 1 }).fontSize)),
    [valueTexts.join("|"), valueW, barH],
  );
  const barMax = area.w - valueW - 24 * unit;
  const top = area.y + (area.h - (items.length * rowH + (items.length - 1) * rowGap)) / 2;

  return (
    <SceneFrame p={p} push={0.025}>
      <div style={{ position: "absolute", left: content.x, top: content.y, width: content.w, height: titleH, display: "flex", alignItems: "flex-start" }}>
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={{ w: content.w, h: titleH - 20 * unit }}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.06, letterSpacingEm: -0.02 }}
          maxFontSize={Math.round((shorts ? 100 : 96) * unit)}
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
      {items.map((it, i) => {
        const at = reveal[i] ?? 10 + i * 10;
        const local = frame - at;
        if (local < 0) return null;
        const grow = spring({ frame: local, fps, config: { damping: 18, stiffness: 110, mass: 0.8 } });
        const share = Math.max(0.03, Math.abs(it.value) / max);
        const isMax = Math.abs(it.value) === max;
        const k = year ? 1 : interpolate(local, [0, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        const shown = `${formatNumber(it.value * k, decimals(it.value), p.video.language, year)}${suffix}`;
        const y = top + i * (rowH + rowGap);
        return (
          <div key={i} style={{ position: "absolute", left: area.x, top: y, width: area.w, height: rowH, opacity: interpolate(local, [0, 5], [0, 1], clamp) }}>
            <div
              style={{
                fontFamily: LABEL_FONT.fontFamily,
                fontWeight: LABEL_FONT.fontWeight,
                fontSize: labelSize,
                lineHeight: LABEL_FONT.lineHeight,
                color: withAlpha(p.theme.text, isMax ? 1 : 0.82),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: area.w,
                transform: `translateY(${interpolate(grow, [0, 1], [14 * unit, 0])}px)`,
              }}
            >
              {it.label}
            </div>
            <div style={{ position: "absolute", left: 0, bottom: 0, height: barH, display: "flex", alignItems: "center", gap: 22 * unit }}>
              <div
                style={{
                  width: Math.max(barH * 0.6, barMax * share * grow),
                  height: barH,
                  borderRadius: barH / 2,
                  background: isMax
                    ? `linear-gradient(90deg, ${p.theme.accent2}, ${p.theme.accent})`
                    : `linear-gradient(90deg, ${withAlpha(p.theme.text, 0.25)}, ${withAlpha(p.theme.text, 0.55)})`,
                  boxShadow: isMax ? `0 0 ${36 * unit}px ${withAlpha(p.theme.accent, 0.45)}` : undefined,
                }}
              />
              <div
                style={{
                  fontFamily: VALUE_FONT.fontFamily,
                  fontWeight: VALUE_FONT.fontWeight,
                  fontSize: valueSize,
                  letterSpacing: `${VALUE_FONT.letterSpacingEm}em`,
                  color: isMax ? p.theme.accent : p.theme.text,
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {shown}
              </div>
            </div>
          </div>
        );
      })}
    </SceneFrame>
  );
};
