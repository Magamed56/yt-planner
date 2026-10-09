import React, { useMemo } from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMBER } from "../fonts";
import { statCountWindow } from "../lib/cues";
import { useLayout } from "../lib/layout";
import { fitTokens, type FontSpec } from "../lib/text";
import { uiText } from "../lib/ui-text";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, type SceneProps } from "./common";

const NUMBER_FONT: FontSpec = { fontFamily: FONT_NUMBER, fontWeight: 800, lineHeight: 1, letterSpacingEm: -0.04 };
const LABEL_FONT: FontSpec = { fontFamily: FONT_BODY, fontWeight: 600, lineHeight: 1.22 };

// Число с разделителем тысяч (узкий неразрывный пробел, как принято в русском)
// и тем же количеством знаков после запятой, что и у целевого значения.
// lang — язык ролика: у английского «1,250.5», у русского «1 250,5».
export function formatNumber(v: number, decimals: number, lang?: string | null): string {
  const t = uiText(lang);
  const fixed = Math.abs(v).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, t.group);
  return `${v < 0 ? "−" : ""}${grouped}${frac ? `${t.decimal}${frac}` : ""}`;
}

// Крупная цифра: счётчик докручивается с ease-out (пока цифры бегут — лёгкое
// размытие движения) и встаёт на место вместе с голосом: вспышка-кольцо и
// искры, в звуке — удар. Заливка градиентом, для процентов — круговая шкала,
// которая заполняется синхронно с числом.
export const StatScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const stat = p.scene.stat ?? { value: 0, label: p.scene.onScreen };
  const isPercent = (stat.suffix ?? "").trim() === "%";
  const decimals = Number.isInteger(stat.value) ? 0 : Math.min(2, String(stat.value).split(".")[1]?.length ?? 1);

  // Окно счёта — по речи: цифра встаёт на место, когда диктор её договорил
  // (lib/cues.ts; там же удар и нарастание в AudioLayer).
  const win = useMemo(() => statCountWindow(p.scene, fps), [p.scene, fps]);
  const countStart = win.start;
  const countLen = Math.max(1, win.end - win.start);
  const ease = Easing.out(Easing.cubic);
  const tAt = (f: number) => interpolate(f, [countStart, countStart + countLen], [0, 1], { ...clamp, easing: ease });
  const t = tAt(frame);
  // Скорость счёта → вертикальное размытие: быстро бегущие цифры «смазаны».
  const blur = Math.min(7, (tAt(frame) - tAt(frame - 1)) * 110) * unit;
  const current = stat.value * t;
  const finalText = `${stat.prefix ?? ""}${formatNumber(stat.value, decimals, p.video.language)}${stat.suffix ?? ""}`;
  const shownText = `${stat.prefix ?? ""}${formatNumber(current, decimals, p.video.language)}${stat.suffix ?? ""}`;

  const ring = Math.round(Math.min(content.w * (shorts ? 0.9 : 0.42), content.h * (shorts ? 0.6 : 0.96)));
  const numberBox = isPercent ? { w: ring * 0.74, h: ring * 0.46 } : { w: content.w * (shorts ? 0.9 : 0.46), h: content.h * (shorts ? 0.36 : 0.6) };
  // Кегль считаем по ИТОГОВОМУ значению — пока цифры бегут, размер не прыгает.
  const numFit = useMemo(
    () => fitTokens([{ text: finalText }], NUMBER_FONT, numberBox, { maxFontSize: Math.round((shorts ? 300 : 280) * unit), maxLines: 1 }),
    [finalText, numberBox.w, numberBox.h, shorts, unit],
  );
  const countEnd = countStart + countLen;
  const appear = Math.max(0, countStart - 6);
  const pop = spring({ frame: frame - countEnd, fps, config: { damping: 9, stiffness: 180, mass: 0.6 } });
  const numScale = interpolate(spring({ frame: frame - appear, fps, config: { damping: 14, stiffness: 120 } }), [0, 1], [0.6, 1]) * (1 + 0.05 * Math.sin(pop * Math.PI));
  // Вспышка в момент, когда цифра встала: кольцо расходится, искры разлетаются.
  const burst = interpolate(frame - countEnd, [0, 16], [0, 1], clamp);
  const burstOn = frame >= countEnd && burst < 1;
  const ringIn = spring({ frame: frame - 2, fps, config: { damping: 200 }, durationInFrames: 18 });
  const r = ring / 2 - 46 * unit; // место под риски шкалы снаружи кольца
  const circ = 2 * Math.PI * r;
  const ringFill = isPercent ? Math.max(0, Math.min(1, current / 100)) : 0;
  const ticks = 60;
  const gid = `sg-${p.scene.id}`;
  const tSec = frame / fps;
  // Блик пробегает по цифре раз в 3 с после того, как счётчик докрутился:
  // длинная stat-сцена не «замирает».
  const sheenPeriod = Math.round(fps * 3);
  const sheenT = frame >= countEnd ? ((frame - countEnd) % sheenPeriod) / sheenPeriod : 1;
  const sheenX = interpolate(sheenT, [0, 0.35], [-60, 160], clamp);
  // Конец дуги — светящаяся «головка» прогресса.
  const tipA = ringFill * Math.PI * 2;

  const number = (
    <div
      style={{
        fontFamily: NUMBER_FONT.fontFamily,
        fontWeight: NUMBER_FONT.fontWeight,
        fontSize: numFit.fontSize,
        lineHeight: 1,
        letterSpacing: `${NUMBER_FONT.letterSpacingEm}em`,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        // backgroundImage, а не шорткат background: React на каждом кадре
        // переписывает только изменившееся свойство (блик меняет градиент), а
        // шорткат сбрасывает background-clip в border-box — и вместо цифры
        // рисовался градиентный прямоугольник.
        backgroundImage: `linear-gradient(105deg, rgba(255,255,255,0) ${sheenX - 18}%, rgba(255,255,255,0.85) ${sheenX}%, rgba(255,255,255,0) ${sheenX + 18}%), linear-gradient(180deg, ${p.theme.text} 8%, ${p.theme.accent} 62%, ${p.theme.accent2} 100%)`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: "transparent",
        transform: `scale(${numScale})`,
        opacity: interpolate(frame, [appear, appear + 6], [0, 1], clamp),
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
        paddingBottom: numFit.fontSize * 0.06,
      }}
    >
      {shownText}
    </div>
  );
  const burstSize = Math.max(numFit.fontSize * 1.6, isPercent ? ring * 0.9 : 0);
  const burstFx = burstOn ? (
    <svg
      width={burstSize * 2}
      height={burstSize * 2}
      viewBox={`${-burstSize} ${-burstSize} ${burstSize * 2} ${burstSize * 2}`}
      style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", overflow: "visible", pointerEvents: "none" }}
    >
      <circle r={burstSize * (0.35 + 0.6 * Easing.out(Easing.cubic)(burst))} fill="none" stroke={p.theme.accent} strokeWidth={10 * unit * (1 - burst)} opacity={0.7 * (1 - burst)} />
      {new Array(10).fill(0).map((_, i) => {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const r0 = burstSize * (0.4 + 0.5 * Easing.out(Easing.quad)(burst));
        const len = burstSize * 0.16 * (1 - burst);
        return (
          <line
            key={i}
            x1={Math.cos(a) * r0}
            y1={Math.sin(a) * r0}
            x2={Math.cos(a) * (r0 + len)}
            y2={Math.sin(a) * (r0 + len)}
            stroke={i % 2 ? p.theme.accent2 : p.theme.text}
            strokeWidth={6 * unit}
            strokeLinecap="round"
            opacity={1 - burst}
          />
        );
      })}
    </svg>
  ) : null;

  const kicker = (align: "left" | "center", w: number) => (
    <KineticText
      text={p.scene.onScreen}
      theme={p.theme}
      box={{ w, h: content.h * (shorts ? 0.14 : 0.3) }}
      font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.1, letterSpacingEm: 0.04, uppercase: true }}
      maxFontSize={Math.round((shorts ? 54 : 58) * unit)}
      minFontSize={Math.round(34 * unit)}
      maxLines={3}
      align={align}
      color={withAlpha(p.theme.text, 0.86)}
      scene={p.scene}
      start={2}
      step={3}
      entrance="fade"
      highlight="color"
      numbers={false}
    />
  );
  const label = (align: "left" | "center", w: number) => (
    <KineticText
      text={stat.label}
      theme={p.theme}
      box={{ w, h: content.h * (shorts ? 0.17 : 0.4) }}
      font={LABEL_FONT}
      maxFontSize={Math.round((shorts ? 64 : 72) * unit)}
      maxLines={3}
      align={align}
      color={withAlpha(p.theme.text, 0.8)}
      start={Math.min(countStart + 14, countEnd)}
      step={2}
      entrance="fade"
      highlight="color"
      shadow={false}
      numbers={false}
    />
  );
  const figure = (
    <div style={{ position: "relative", width: isPercent ? ring : numberBox.w, height: isPercent ? ring : numFit.fontSize * 1.15, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Свечение под цифрой */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: ring * 1.5,
          height: ring * 1.5,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(closest-side, ${withAlpha(p.theme.accent, 0.22)} 0%, ${withAlpha(p.theme.accent, 0.06)} 50%, ${withAlpha(p.theme.accent, 0)} 100%)`,
          opacity: ringIn,
        }}
      />
      {isPercent ? (
        <svg width={ring} height={ring} style={{ position: "absolute", inset: 0, transform: `rotate(-90deg) scale(${interpolate(ringIn, [0, 1], [0.85, 1])})`, opacity: ringIn }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.theme.accent} />
              <stop offset="100%" stopColor={p.theme.accent2} />
            </linearGradient>
          </defs>
          {new Array(ticks).fill(0).map((_, i) => {
            const a = (i / ticks) * Math.PI * 2;
            const r1 = r + 22 * unit;
            const r2 = r + (i % 5 === 0 ? 38 : 30) * unit;
            const lit = i / ticks < ringFill;
            return (
              <line
                key={i}
                x1={ring / 2 + Math.cos(a) * r1}
                y1={ring / 2 + Math.sin(a) * r1}
                x2={ring / 2 + Math.cos(a) * r2}
                y2={ring / 2 + Math.sin(a) * r2}
                stroke={lit ? p.theme.accent : withAlpha(p.theme.text, 0.18)}
                strokeWidth={(i % 5 === 0 ? 4 : 2.5) * unit}
                strokeLinecap="round"
              />
            );
          })}
          {/* Внутреннее пунктирное кольцо медленно вращается — фон «дышит» */}
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={r - 40 * unit}
            fill="none"
            stroke={withAlpha(p.theme.text, 0.14)}
            strokeWidth={3 * unit}
            strokeDasharray={`${2 * unit} ${16 * unit}`}
            strokeLinecap="round"
            transform={`rotate(${tSec * 9} ${ring / 2} ${ring / 2})`}
          />
          <circle cx={ring / 2} cy={ring / 2} r={r} fill="none" stroke={withAlpha(p.theme.text, 0.1)} strokeWidth={18 * unit} />
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={18 * unit}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - ringFill)}
          />
          {ringFill > 0.01 ? (
            <g>
              <circle cx={ring / 2 + Math.cos(tipA) * r} cy={ring / 2 + Math.sin(tipA) * r} r={34 * unit * (0.9 + 0.1 * Math.sin(tSec * 4))} fill={withAlpha(p.theme.accent, 0.18)} />
              <circle cx={ring / 2 + Math.cos(tipA) * r} cy={ring / 2 + Math.sin(tipA) * r} r={13 * unit} fill="#ffffff" />
            </g>
          ) : null}
        </svg>
      ) : null}
      {burstFx}
      {number}
    </div>
  );

  return (
    <SceneFrame p={p} push={0.035} dim="medium">
      {shorts ? (
        <ContentBox gap={Math.round(40 * unit)}>
          {kicker("center", content.w)}
          {figure}
          {label("center", content.w * 0.92)}
        </ContentBox>
      ) : (
        <ContentBox>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: Math.round(90 * unit) }}>
            {figure}
            <div style={{ display: "flex", flexDirection: "column", gap: Math.round(30 * unit), width: content.w * 0.44 }}>
              {kicker("left", content.w * 0.44)}
              {label("left", content.w * 0.44)}
            </div>
          </div>
        </ContentBox>
      )}
    </SceneFrame>
  );
};
