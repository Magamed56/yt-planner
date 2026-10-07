import React from "react";
import { interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BellRing, Check, MousePointer2 } from "lucide-react";
import { KineticText } from "../components/KineticText";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";

// Призыв подписаться: курсор подлетает к кнопке, «нажимает» её (кнопка
// проседает, расходится волна, текст меняется на «Вы подписаны»), затем
// качается колокольчик. Имя канала — если задано в props.channelName.
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

  const pillH = Math.round((shorts ? 132 : 124) * unit);
  const pillFont = Math.round((shorts ? 50 : 46) * unit);
  const pillBg = interpolateColors(doneP, [0, 1], [p.theme.accent, "#2a2a33"]);
  const pillInk = interpolateColors(doneP, [0, 1], [p.theme.accentInk, "#ffffff"]);
  const name = p.video.channelName?.trim();
  const avatar = Math.round((shorts ? 120 : 100) * unit);
  const rowS = spring({ frame: frame - rowIn, fps, config: { damping: 15, stiffness: 140 } });

  return (
    <SceneFrame p={p} push={0.04}>
      <ContentBox gap={Math.round(64 * unit)}>
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={{ w: content.w, h: content.h * 0.36 }}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.05, letterSpacingEm: -0.02 }}
          maxFontSize={Math.round((shorts ? 124 : 132) * unit)}
          maxLines={4}
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
              {done ? "Вы подписаны" : "Подписаться"}
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
      </ContentBox>
    </SceneFrame>
  );
};
