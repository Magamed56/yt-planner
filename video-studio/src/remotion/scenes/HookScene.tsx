import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { KineticText } from "../components/KineticText";
import { DrawnIcon, IconBadge } from "../components/Icon";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, type SceneProps } from "./common";

// Хук: в ленте Shorts «смотреть или листать» решают за 1–2 с, поэтому весь
// заголовок стоит на экране целиком уже на кадре 0 — по одному слову он
// дочитывался только к 2–4 с. Движение даёт акцент: маркер прорисовывается,
// когда диктор произносит это слово. Позади — гигантская иконка, которая
// прорисовывается штрихом: читается как задуманная иллюстрация, а не как «призрак».
export const HookScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const badge = Math.round((shorts ? 150 : 130) * unit);
  const gap = Math.round(48 * unit);
  const textBox = { w: content.w, h: content.h - badge - gap - 40 * unit };
  const art = Math.round(shorts ? content.w * 1.08 : content.h * 1.05);
  const draw = interpolate(frame, [0, 42], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const artRot = interpolate(frame, [0, p.scene.durationInFrames], [-5, 4]);
  const artScale = interpolate(frame, [0, p.scene.durationInFrames], [0.96, 1.04]);

  return (
    <SceneFrame p={p} push={0.07} dim="medium">
      <div
        style={{
          position: "absolute",
          left: content.x + content.w / 2 - art / 2,
          top: content.y + content.h * (shorts ? 0.54 : 0.5) - art / 2,
          opacity: 0.13,
          transform: `rotate(${artRot}deg) scale(${artScale})`,
        }}
      >
        <DrawnIcon name={p.scene.icon} size={art} color={withAlpha(p.theme.text, 1)} strokeWidth={0.55} progress={draw} id={`hook-${p.scene.id}`} />
      </div>
      <ContentBox gap={gap}>
        <IconBadge name={p.scene.icon} size={badge} theme={p.theme} delay={-6} gradientId={`ig-${p.scene.id}`} shape="circle" />
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={textBox}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.04, letterSpacingEm: -0.025, uppercase: true }}
          maxFontSize={Math.round((shorts ? 150 : 150) * unit)}
          maxLines={shorts ? 6 : 4}
          align="center"
          scene={p.scene}
          // Все слова «появились» до начала сцены: к кадру 0 закончились и
          // pop (6 кадров), и докрутка чисел (до 28 кадров) — на первом кадре
          // нет ни прозрачных слов, ни недокрученного «16» вместо «24».
          mode="stagger"
          start={-30}
          step={0}
          entrance="pop"
          highlight="marker"
        />
      </ContentBox>
    </SceneFrame>
  );
};
