import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ArrowDown, Bell, MessageCircle } from "lucide-react";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { uiText } from "../lib/ui-text";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, type SceneProps } from "./common";

// Финал: главное — вопрос зрителю (onScreen), под ним спокойная плашка канала
// с кнопкой подписки и облачко «Пиши в комментариях». Раньше здесь курсор
// нажимал «Подписаться → Вы подписаны» с волной и колокольчиком — на этой
// сценке зрители и уходили, поэтому теперь плашка статична: только мягкое
// проявление без движения, чтобы не «выскакивать» на склейке сцен.
// Имя канала — если задано в props.channelName, облачко — props.ctaComment.
export const CtaScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";

  const fadeIn = interpolate(frame, [6, 16], [0, 1], clamp);
  const pillH = Math.round((shorts ? 130 : 112) * unit);
  const pillFont = Math.round((shorts ? 48 : 42) * unit);
  const name = p.video.channelName?.trim();
  const avatar = Math.round((shorts ? 120 : 100) * unit);
  const comment = p.video.ctaComment?.trim();
  const bubbleFont = Math.round((shorts ? 46 : 40) * unit);

  return (
    <SceneFrame p={p} push={0.04}>
      <ContentBox gap={Math.round(64 * unit)}>
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={{ w: content.w, h: content.h * (comment ? 0.38 : 0.46) }}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.05, letterSpacingEm: -0.02 }}
          maxFontSize={Math.round(132 * unit)}
          maxLines={5}
          scene={p.scene}
          mode="stagger"
          start={3}
          step={3}
          entrance="rise"
          highlight="marker"
        />
        {/* Плашка канала: аватар, имя и кнопка — как карточка канала в YouTube */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 30 * unit,
            maxWidth: content.w,
            padding: `${34 * unit}px ${44 * unit}px`,
            borderRadius: 48 * unit,
            background: withAlpha(p.theme.text, 0.08),
            border: `${2 * unit}px solid ${withAlpha(p.theme.text, 0.18)}`,
            boxShadow: `0 ${14 * unit}px ${44 * unit}px rgba(0,0,0,0.35)`,
            opacity: fadeIn,
          }}
        >
          {name ? (
            <div style={{ display: "flex", alignItems: "center", gap: 26 * unit, maxWidth: "100%" }}>
              <div
                style={{
                  width: avatar,
                  height: avatar,
                  flexShrink: 0,
                  borderRadius: avatar / 2,
                  background: `linear-gradient(140deg, ${p.theme.blobA}, ${p.theme.blobC})`,
                  border: `${4 * unit}px solid ${withAlpha(p.theme.text, 0.9)}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 900,
                  fontSize: avatar * 0.46,
                  color: "#fff",
                }}
              >
                {Array.from(name)[0]?.toUpperCase()}
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: Math.round(50 * unit), color: p.theme.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {name}
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 24 * unit }}>
            <div
              style={{
                height: pillH,
                padding: `0 ${pillH * 0.48}px`,
                borderRadius: pillH / 2,
                background: p.theme.accent,
                color: p.theme.accentInk,
                display: "flex",
                alignItems: "center",
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                fontSize: pillFont,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {uiText(p.video.language).subscribe}
            </div>
            <div
              style={{
                width: pillH,
                height: pillH,
                borderRadius: pillH / 2,
                background: withAlpha(p.theme.text, 0.1),
                border: `${2 * unit}px solid ${withAlpha(p.theme.text, 0.22)}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Bell size={pillH * 0.48} color={p.theme.text} strokeWidth={2.2} />
            </div>
          </div>
        </div>
        {comment ? (
          <div style={{ display: "flex", alignItems: "center", gap: 22 * unit, maxWidth: content.w, opacity: fadeIn }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18 * unit,
                padding: `${22 * unit}px ${34 * unit}px`,
                // Острый нижний левый угол — «хвостик» облачка сообщения.
                borderRadius: `${44 * unit}px ${44 * unit}px ${44 * unit}px ${10 * unit}px`,
                background: withAlpha(p.theme.text, 0.12),
                border: `${2 * unit}px solid ${withAlpha(p.theme.text, 0.26)}`,
                fontFamily: FONT_BODY,
                fontWeight: 800,
                fontSize: bubbleFont,
                lineHeight: 1.15,
                color: p.theme.text,
              }}
            >
              <MessageCircle size={bubbleFont * 1.25} color={p.theme.accent} strokeWidth={2.4} style={{ flexShrink: 0 }} />
              {/* Вопрос и призыв — разными строками: переносы посреди фразы на
                  узком экране Shorts читаются хуже («Пиши в / комментариях»). */}
              <span style={{ display: "flex", flexDirection: "column" }}>
                {comment.split(/(?<=[?!])\s+/u).map((line, i) => (
                  <span key={i} style={{ whiteSpace: "nowrap", opacity: i === 0 ? 1 : 0.82 }}>
                    {line}
                  </span>
                ))}
              </span>
            </div>
            <ArrowDown size={bubbleFont * 1.4} color={p.theme.accent} strokeWidth={3} style={{ flexShrink: 0 }} />
          </div>
        ) : null}
      </ContentBox>
    </SceneFrame>
  );
};
