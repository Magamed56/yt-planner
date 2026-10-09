import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { chapterCardFrames, type RenderScene } from "../../types";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha, type Theme } from "../theme";
import { clamp, type SceneProps } from "./common";

// Глава «Разбора»: первые CHAPTER_CARD_FRAMES кадров сцены — карточка главы
// (номер, название, полоска прогресса по главам), затем сама сцена — со своим
// нулевым кадром, будто карточки не было: её голос layoutScenes() уже сдвинул
// на длину карточки. У первой сцены ролика карточки нет (хук не задерживаем).
const FADE_FRAMES = 10; // карточка растворяется поверх начала сцены

export const ChapterWrap: React.FC<SceneProps & { Comp: React.FC<SceneProps> }> = ({ Comp, ...p }) => {
  const card = chapterCardFrames(p.scene, p.index);
  if (!card || !p.scene.chapter) return <Comp {...p} />;
  const inner: RenderScene = { ...p.scene, audioStartFrame: p.scene.audioStartFrame - card, durationInFrames: Math.max(1, p.scene.durationInFrames - card) };
  const chapters = p.video.scenes.filter((s) => s.chapter?.trim());
  const number = Math.max(1, chapters.findIndex((s) => s.id === p.scene.id) + 1);
  return (
    <AbsoluteFill>
      <Sequence from={card} name={`${p.scene.kind} после главы`}>
        <Comp {...p} scene={inner} />
      </Sequence>
      <Sequence durationInFrames={card + FADE_FRAMES} name="Карточка главы">
        <ChapterCard title={p.scene.chapter} number={number} total={chapters.length} theme={p.theme} frames={card} />
      </Sequence>
    </AbsoluteFill>
  );
};

const ChapterCard: React.FC<{ title: string; number: number; total: number; theme: Theme; frames: number }> = ({ title, number, total, theme, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const out = interpolate(frame, [frames - 2, frames + FADE_FRAMES], [1, 0], { ...clamp, easing: Easing.in(Easing.quad) });
  const labelIn = spring({ frame: frame - 2, fps, config: { damping: 16, stiffness: 140 } });
  const barIn = interpolate(frame, [10, 34], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const segGap = Math.round(10 * unit);
  const barW = Math.round(Math.min(content.w, (shorts ? 760 : 900) * unit));
  const segW = total > 0 ? (barW - segGap * (total - 1)) / total : barW;

  return (
    <AbsoluteFill style={{ opacity: out }}>
      {/* Затемнение: фон ролика просвечивает, но карточка читается как отдельный «экран» */}
      <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 45%, ${withAlpha(theme.bgTo, 0.7)} 0%, ${withAlpha(theme.bgFrom, 0.9)} 70%)` }} />
      <div
        style={{
          position: "absolute",
          left: content.x,
          top: content.y,
          width: content.w,
          height: content.h,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: shorts ? "center" : "flex-start",
          gap: Math.round(36 * unit),
        }}
      >
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 800,
            fontSize: Math.round((shorts ? 40 : 34) * unit),
            letterSpacing: "0.22em",
            color: theme.accent,
            opacity: labelIn,
            transform: `translateX(${interpolate(labelIn, [0, 1], [-40 * unit, 0])}px)`,
            whiteSpace: "nowrap",
          }}
        >
          ГЛАВА {number}
          {total > 1 ? <span style={{ color: theme.textDim }}> / {total}</span> : null}
        </div>
        <KineticText
          text={title}
          theme={theme}
          box={{ w: content.w, h: Math.round(content.h * 0.5) }}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.04, letterSpacingEm: -0.025 }}
          maxFontSize={Math.round((shorts ? 128 : 124) * unit)}
          maxLines={3}
          align={shorts ? "center" : "left"}
          mode="stagger"
          start={6}
          step={3}
          entrance="rise"
          highlight="underline"
        />
        <div style={{ display: "flex", gap: segGap, width: barW }}>
          {Array.from({ length: Math.max(1, total) }, (_, i) => (
            <div key={i} style={{ position: "relative", width: segW, height: Math.max(6, 10 * unit), borderRadius: 6 * unit, background: withAlpha(theme.text, 0.16), overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
                  transformOrigin: "0% 50%",
                  // Пройденные главы залиты сразу, текущая — заливается.
                  transform: `scaleX(${i + 1 < number ? 1 : i + 1 === number ? barIn : 0})`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
