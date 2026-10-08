import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Icon, IconGradientDefs } from "../components/Icon";
import { FONT_BODY, FONT_DISPLAY, FontGate } from "../fonts";
import { withAlpha } from "../theme";
import { Marker, Pill, Wordmark } from "./atoms";
import { BrandMark } from "./BrandMark";
import { BRAND } from "./data";
import { Dial } from "./Dial";

// Первый пост-«знакомство» 1080×1350 (4:5). Сетка профиля Instagram режет
// превью до 3:4 — по ~34 px с боков, поэтому поля не меньше 72 px.
// Сверху вниз: кто мы → обещание (слоган) → о чём (рубрики) → когда.

// Слоган крупно, с маркером на «просто» (или на последнем слове первой фразы):
// «Сложное — / [просто]. / Каждый день».
function splitTagline(tagline: string): { before: string; mark: string; after: string } {
  const m = tagline.match(/^(.*?)(просто)([.!…]?)\s*(.*)$/i);
  if (m) return { before: m[1].trim(), mark: m[2] + m[3], after: m[4].trim() };
  const dot = tagline.search(/[.!?…]\s/);
  const first = dot > 0 ? tagline.slice(0, dot + 1) : tagline;
  const rest = dot > 0 ? tagline.slice(dot + 1).trim() : "";
  const words = first.split(/\s+/);
  return { before: words.slice(0, -1).join(" "), mark: words[words.length - 1] ?? "", after: rest };
}

const Headline: React.FC<{ fontSize: number }> = ({ fontSize }) => {
  const t = BRAND.theme;
  const { before, mark, after } = splitTagline(BRAND.tagline);
  return (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize,
        lineHeight: 1.1,
        letterSpacing: "-0.025em",
        textTransform: "uppercase",
        color: t.text,
        textShadow: `0 ${fontSize * 0.04}px ${fontSize * 0.2}px rgba(0,0,0,0.4)`,
      }}
    >
      {before ? <div>{before}</div> : null}
      <div style={{ margin: `${fontSize * 0.04}px 0 ${fontSize * 0.08}px` }}>
        <Marker fontSize={fontSize}>{mark}</Marker>
      </div>
      {after ? <div>{after}</div> : null}
    </div>
  );
};

export const IntroPost: React.FC = () => {
  const { width, height } = useVideoConfig();
  const t = BRAND.theme;
  const u = width / 1080;
  const pad = 80 * u;
  const chipH = 80 * u;
  const chipGap = 14 * u;

  return (
    <AbsoluteFill style={{ backgroundColor: t.bgFrom }}>
      <FontGate>
        <Background theme={t} seed="sut-intro" frameOverride={30} particles={false} />
        {/* Циферблат справа за слоганом — фоновый мотив бренда; низ круга выше
            плашек рубрик, иначе риски просвечивают сквозь «стекло» */}
        <Dial cx={width * 0.93} cy={height * 0.29} r={330 * u} theme={t} tick={14 * u} width={3.5 * u} alpha={0.15} progress={0} />
        <IconGradientDefs id="intro-icon" from={t.accent} to={t.accent2} />
        <AbsoluteFill style={{ padding: pad, display: "flex", flexDirection: "column" }}>
          {/* Шапка: знак + название */}
          <div style={{ display: "flex", alignItems: "center", gap: 20 * u }}>
            <BrandMark size={96 * u} theme={t} id="intro" glow={0.8} />
            <Wordmark fontSize={46 * u} />
            <div style={{ flex: 1 }} />
            <Pill fontSize={24 * u}>Знакомство</Pill>
          </div>

          <div style={{ marginTop: 62 * u }}>
            <Headline fontSize={100 * u} />
          </div>

          <div style={{ marginTop: 30 * u, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 35 * u, lineHeight: 1.34, color: t.textDim, maxWidth: 900 * u }}>
            Короткие ролики обо всём: одна тема —{" "}
            <span style={{ color: t.text, fontWeight: 800 }}>одна понятная суть за&nbsp;минуту</span>. Только проверяемые факты, без эзотерики и&nbsp;кликбейта.
          </div>

          {/* Рубрики канала — все из channel.json */}
          <div style={{ marginTop: 40 * u, display: "grid", gridTemplateColumns: "1fr 1fr", gap: chipGap }}>
            {BRAND.pillars.map((p) => (
              <div
                key={p.id}
                style={{
                  height: chipH,
                  display: "flex",
                  alignItems: "center",
                  gap: 16 * u,
                  padding: `0 ${22 * u}px`,
                  borderRadius: 22 * u,
                  background: `linear-gradient(145deg, ${withAlpha(t.text, 0.12)} 0%, ${withAlpha(t.text, 0.04)} 100%)`,
                  border: `${2 * u}px solid ${withAlpha(t.text, 0.16)}`,
                }}
              >
                <Icon name={p.icon} size={42 * u} color="url(#intro-icon)" strokeWidth={2.2} style={{ flex: "none" }} />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 28 * u, lineHeight: 1.1, color: t.text, whiteSpace: "nowrap" }}>{p.title}</div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          {/* Подвал: как часто выходят ролики и где искать */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 * u }}>
            <Pill fontSize={29 * u} filled icon={<Icon name="calendar-days" size={34 * u} color={t.accentInk} strokeWidth={2.6} />}>
              {BRAND.perDayText}
            </Pill>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 30 * u, color: t.text }}>{BRAND.handle}</div>
          </div>
        </AbsoluteFill>
      </FontGate>
    </AbsoluteFill>
  );
};
