import React from "react";
import { interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ArrowDown, BellRing, Check, MessageCircle, MousePointer2 } from "lucide-react";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { uiText } from "../lib/ui-text";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";

// Призыв подписаться: курсор подлетает к кнопке, «нажимает» её (кнопка
// проседает, расходится волна, текст меняется на «Вы подписаны»), затем
// качается колокольчик. Имя канала — если задано в props.channelName.
// Следом всплывает «облачко» комментария (props.ctaComment): сначала
// «печатает…», потом текст и стрелка вниз — к полю комментариев.
export const CtaScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const voice = useVoice(p.scene);
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const dur = p.scene.durationInFrames;

  const rowIn = 14;
  const pillIn = 20;
  const pressAt = Math.round(Math.max(40, Math.min(voice.start + (voice.end - voice.start) * 0.45, dur - 45)));
  const cursorFrom = pressAt - 20;
  const bellAt = pressAt + 8;

  const pillS = spring({ frame: frame - pillIn, fps, config: { damping: 12, stiffness: 160, mass: 0.7 } });
  const press = interpolate(frame, [pressAt - 2, pressAt + 1, pressAt + 7], [1, 0.9, 1], clamp);
  const done = frame >= pressAt + 2;
  const doneP = spring({ frame: frame - pressAt - 2, fps, config: { damping: 14, stiffness: 200 } });
  const ripple = interpolate(frame, [pressAt, pressAt + 16], [0, 1], clamp);
  const cur = spring({ frame: frame - cursorFrom, fps, config: { damping: 16, stiffness: 90, mass: 0.9 } });
  const cursorOut = interpolate(frame, [pressAt + 10, pressAt + 22], [1, 0], clamp);
  // Колокольчик: затухающее покачивание.
  const bt = Math.max(0, frame - bellAt);
  const bellRot = frame >= bellAt ? Math.sin(bt * 0.9) * 22 * Math.exp(-bt / 14) : 0;
  const bellS = spring({ frame: frame - pillIn - 4, fps, config: { damping: 12, stiffness: 160 } });

  const pillH = Math.round((shorts ? 150 : 128) * unit);
  const pillFont = Math.round((shorts ? 54 : 48) * unit);
  const pillBg = interpolateColors(doneP, [0, 1], [p.theme.accent, "#2a2a33"]);
  const pillInk = interpolateColors(doneP, [0, 1], [p.theme.accentInk, "#ffffff"]);
  const name = p.video.channelName?.trim();
  const avatar = Math.round((shorts ? 120 : 100) * unit);
  const rowS = spring({ frame: frame - rowIn, fps, config: { damping: 15, stiffness: 140 } });

  const comment = p.video.ctaComment?.trim();
  const bubbleAt = Math.min(pressAt + 12, dur - 40);
  const bubbleS = spring({ frame: frame - bubbleAt, fps, config: { damping: 13, stiffness: 150, mass: 0.8 } });
  const typingUntil = bubbleAt + 12;
  const bubbleFont = Math.round((shorts ? 46 : 40) * unit);
  const arrowBob = Math.sin(Math.max(0, frame - typingUntil) * 0.28) * 12 * unit;

  return (
    <SceneFrame p={p} push={0.04}>
      <ContentBox gap={Math.round(64 * unit)}>
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={{ w: content.w, h: content.h * (comment ? 0.34 : 0.42) }}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.05, letterSpacingEm: -0.02 }}
          maxFontSize={Math.round((shorts ? 132 : 132) * unit)}
          maxLines={5}
          scene={p.scene}
          mode="stagger"
          start={3}
          step={3}
          entrance="rise"
          highlight="marker"
        />
        {name ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 26 * unit,
              opacity: interpolate(frame, [rowIn, rowIn + 6], [0, 1], clamp),
              transform: `translateY(${interpolate(rowS, [0, 1], [30 * unit, 0])}px)`,
            }}
          >
            <div
              style={{
                width: avatar,
                height: avatar,
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
                boxShadow: `0 ${12 * unit}px ${36 * unit}px rgba(0,0,0,0.4)`,
              }}
            >
              {Array.from(name)[0]?.toUpperCase()}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: Math.round(50 * unit), color: p.theme.text, maxWidth: content.w - avatar - 40 * unit, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {name}
            </div>
          </div>
        ) : null}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 30 * unit }}>
          <div style={{ position: "relative", transform: `scale(${interpolate(pillS, [0, 1], [0.4, 1]) * press})`, opacity: interpolate(frame, [pillIn, pillIn + 5], [0, 1], clamp) }}>
            {/* Волна от нажатия */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: pillH / 2,
                border: `${5 * unit}px solid ${p.theme.accent}`,
                transform: `scale(${1 + ripple * 0.12}, ${1 + ripple * 0.4})`,
                opacity: ripple > 0 && ripple < 1 ? 0.8 * (1 - ripple) : 0,
              }}
            />
            <div
              style={{
                height: pillH,
                padding: `0 ${pillH * 0.48}px`,
                borderRadius: pillH / 2,
                background: pillBg,
                color: pillInk,
                display: "flex",
                alignItems: "center",
                gap: 18 * unit,
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                fontSize: pillFont,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                boxShadow: done ? `0 ${14 * unit}px ${40 * unit}px rgba(0,0,0,0.4)` : `0 ${14 * unit}px ${50 * unit}px ${withAlpha(p.theme.accent, 0.45)}`,
                whiteSpace: "nowrap",
              }}
            >
              {done ? <Check size={pillFont * 1.1} strokeWidth={3} color={pillInk} style={{ transform: `scale(${doneP})` }} /> : null}
              {done ? uiText(p.video.language).subscribed : uiText(p.video.language).subscribe}
            </div>
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
              transform: `scale(${bellS})`,
            }}
          >
            <BellRing size={pillH * 0.5} color={done ? p.theme.accent : p.theme.text} strokeWidth={2.2} style={{ transform: `rotate(${bellRot}deg)`, transformOrigin: "50% 15%" }} />
          </div>
          {/* Курсор: подлетает справа снизу и «кликает» по кнопке */}
          <div
            style={{
              position: "absolute",
              left: "38%",
              top: "55%",
              opacity: interpolate(frame, [cursorFrom, cursorFrom + 4], [0, 1], clamp) * cursorOut,
              transform: `translate(${interpolate(cur, [0, 1], [260 * unit, 0])}px, ${interpolate(cur, [0, 1], [220 * unit, 0])}px) scale(${interpolate(frame, [pressAt - 2, pressAt + 1, pressAt + 6], [1, 0.82, 1], clamp)})`,
              filter: `drop-shadow(0 ${6 * unit}px ${10 * unit}px rgba(0,0,0,0.5))`,
            }}
          >
            <MousePointer2 size={86 * unit} color="#111" fill="#ffffff" strokeWidth={1.6} />
          </div>
        </div>
        {comment ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22 * unit,
              maxWidth: content.w,
              opacity: interpolate(frame, [bubbleAt, bubbleAt + 5], [0, 1], clamp),
              transform: `translateY(${interpolate(bubbleS, [0, 1], [40 * unit, 0])}px) scale(${interpolate(bubbleS, [0, 1], [0.85, 1])})`,
              transformOrigin: "left center",
            }}
          >
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
                boxShadow: `0 ${12 * unit}px ${36 * unit}px rgba(0,0,0,0.35)`,
                fontFamily: FONT_BODY,
                fontWeight: 800,
                fontSize: bubbleFont,
                lineHeight: 1.15,
                color: p.theme.text,
                minHeight: bubbleFont * 1.6,
              }}
            >
              <MessageCircle size={bubbleFont * 1.25} color={p.theme.accent} strokeWidth={2.4} style={{ flexShrink: 0 }} />
              {frame < typingUntil ? (
                <span style={{ display: "flex", gap: 10 * unit, padding: `0 ${8 * unit}px` }}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 14 * unit,
                        height: 14 * unit,
                        borderRadius: 7 * unit,
                        background: p.theme.text,
                        opacity: 0.35 + 0.65 * Math.max(0, Math.sin((frame - bubbleAt) * 0.6 - i * 0.9)),
                      }}
                    />
                  ))}
                </span>
              ) : (
                // Вопрос и призыв — разными строками: переносы посреди фразы на
                // узком экране Shorts читаются хуже («Пиши в / комментариях»).
                <span style={{ display: "flex", flexDirection: "column" }}>
                  {comment.split(/(?<=[?!])\s+/u).map((line, i) => (
                    <span key={i} style={{ whiteSpace: "nowrap", opacity: i === 0 ? 1 : 0.82 }}>
                      {line}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <ArrowDown size={bubbleFont * 1.4} color={p.theme.accent} strokeWidth={3} style={{ flexShrink: 0, transform: `translateY(${arrowBob}px)`, opacity: frame < typingUntil ? 0 : 1 }} />
          </div>
        ) : null}
      </ContentBox>
    </SceneFrame>
  );
};
