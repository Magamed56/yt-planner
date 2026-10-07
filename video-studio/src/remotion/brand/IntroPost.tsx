import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Icon, IconGradientDefs } from "../components/Icon";
import { FONT_BODY, FONT_DISPLAY, FontGate } from "../fonts";
import { withAlpha } from "../theme";
import { Pill, Wordmark } from "./atoms";
import { BrandMark } from "./BrandMark";
import { BRAND } from "./data";

// Первый пост-«знакомство» 1080×1350 (4:5). Сетка профиля Instagram режет
// превью до 3:4 — по ~34 px с боков, поэтому поля не меньше 72 px.
// Сверху вниз: кто мы → обещание (слоган) → что будет (рубрики) → когда.

// Слоган с маркером на «твой мозг», как акцентные слова в роликах.
const Headline: React.FC<{ fontSize: number }> = ({ fontSize }) => {
  const t = BRAND.theme;
  // «Как работает твой мозг — за минуту» → три строки; маркер — на середине.
  const m = BRAND.tagline.match(/^(.*?)(тво[йёе]\s+мозг)(.*)$/i);
  const before = m ? m[1].trim() : BRAND.tagline;
  const mark = m ? m[2] : "";
  const after = m ? m[3].trim() : "";
  return (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize,
        lineHeight: 1.08,
        letterSpacing: "-0.025em",
        textTransform: "uppercase",
        color: t.text,
        textShadow: `0 ${fontSize * 0.04}px ${fontSize * 0.2}px rgba(0,0,0,0.4)`,
      }}
    >
      <div>{before}</div>
      {mark ? (
        <div style={{ margin: `${fontSize * 0.06}px 0 ${fontSize * 0.08}px` }}>
          <span style={{ position: "relative", display: "inline-block", padding: `0 ${fontSize * 0.14}em` }}>
            <span
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "0.02em",
                bottom: "-0.02em",
                borderRadius: "0.14em",
                background: `linear-gradient(100deg, ${t.accent} 0%, ${t.accent2} 140%)`,
                transform: "rotate(-1.2deg)",
                boxShadow: `0 ${fontSize * 0.08}px ${fontSize * 0.4}px ${withAlpha(t.accent, 0.35)}`,
              }}
            />
            <span style={{ position: "relative", color: t.accentInk, textShadow: "none" }}>{mark}</span>
          </span>
        </div>
      ) : null}
      {after ? <div>{after}</div> : null}
    </div>
  );
};

export const IntroPost: React.FC = () => {
  const { width } = useVideoConfig();
  const t = BRAND.theme;
  const u = width / 1080;
  const pad = 84 * u;
  const pillars = BRAND.pillars.slice(0, 7);
  const chipH = 92 * u;
  const chipGap = 18 * u;

  return (
    <AbsoluteFill style={{ backgroundColor: t.bgFrom }}>
      <FontGate>
        <Background theme={t} seed="neurofakt-intro" frameOverride={30} particles={false} />
        <IconGradientDefs id="intro-icon" from={t.accent} to={t.accent2} />
        <AbsoluteFill style={{ padding: pad, display: "flex", flexDirection: "column" }}>
          {/* Шапка: знак + название */}
          <div style={{ display: "flex", alignItems: "center", gap: 22 * u }}>
            <BrandMark size={86 * u} theme={t} id="intro" glow={0.8} />
            <Wordmark fontSize={58 * u} />
            <div style={{ flex: 1 }} />
            <Pill fontSize={26 * u}>Знакомство</Pill>
          </div>

          <div style={{ marginTop: 64 * u }}>
            <Headline fontSize={100 * u} />
          </div>

          <div style={{ marginTop: 36 * u, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 38 * u, lineHeight: 1.32, color: t.textDim, maxWidth: 880 * u }}>
            Каждый день — <span style={{ color: t.text, fontWeight: 800 }}>один факт о&nbsp;мозге</span> из научных исследований. Коротко, понятно, без эзотерики
            и&nbsp;кликбейта.
          </div>

          {/* Рубрики: 7 плашек + 8-я — призыв подписаться */}
          <div style={{ marginTop: 52 * u, display: "grid", gridTemplateColumns: "1fr 1fr", gap: chipGap }}>
            {pillars.map((p) => (
              <div
                key={p.id}
                style={{
                  height: chipH,
                  display: "flex",
                  alignItems: "center",
                  gap: 18 * u,
                  padding: `0 ${22 * u}px`,
                  borderRadius: 24 * u,
                  background: `linear-gradient(145deg, ${withAlpha(t.text, 0.12)} 0%, ${withAlpha(t.text, 0.04)} 100%)`,
                  border: `${2 * u}px solid ${withAlpha(t.text, 0.16)}`,
                }}
              >
                <Icon name={p.icon} size={46 * u} color="url(#intro-icon)" strokeWidth={2.2} style={{ flex: "none" }} />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 29 * u, lineHeight: 1.1, color: t.text }}>{p.title}</div>
              </div>
            ))}
            <div
              style={{
                height: chipH,
                display: "flex",
                alignItems: "center",
                gap: 16 * u,
                padding: `0 ${22 * u}px`,
                borderRadius: 24 * u,
                background: `linear-gradient(100deg, ${t.accent} 0%, ${t.accent2} 130%)`,
                boxShadow: `0 ${10 * u}px ${36 * u}px ${withAlpha(t.accent2, 0.35)}`,
              }}
            >
              <Icon name="bell-ring" size={46 * u} color={t.accentInk} strokeWidth={2.4} style={{ flex: "none" }} />
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 30 * u, lineHeight: 1.1, color: t.accentInk }}>Подпишись</div>
            </div>
          </div>

          <div style={{ flex: 1 }} />
          {/* Подвал: когда выходят ролики и где искать */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 * u, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 32 * u, color: t.text }}>
              <Icon name="clock" size={38 * u} color={t.accent} strokeWidth={2.4} />
              Каждый день в {BRAND.time}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 32 * u, color: t.textDim }}>{BRAND.handle}</div>
          </div>
        </AbsoluteFill>
      </FontGate>
    </AbsoluteFill>
  );
};
