import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Check, CircleHelp, MessageCircle, X } from "lucide-react";
import { quizTiming, type SceneQuiz } from "../../types";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY, FONT_NUMBER } from "../fonts";
import { useLayout } from "../lib/layout";
import { uiText } from "../lib/ui-text";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";
import { StatementScene } from "./StatementScene";

// Викторина «Правда или миф?»: диктор читает утверждение (оно же крупно на
// экране) → голос стихает, кольцо отсчитывает 3…2…1 → штамп «ПРАВДА»/«МИФ»
// с коротким пояснением и вопросом зрителю. Тайминг — quizTiming() из
// types.ts, тот же, что у layoutScenes(): пауза уже заложена в длину сцены.

// Цвета вердикта — смысловые, не из темы: зелёный/красный читаются одинаково на любой палитре.
// Подписи — на языке ролика (lib/ui-text.ts).
const VERDICT = {
  truth: { color: "#2bd67b", ink: "#04210f", Icon: Check },
  myth: { color: "#ff4d5e", ink: "#ffffff", Icon: X },
} as const;

export const QuizScene: React.FC<SceneProps> = (p) => (p.scene.quiz ? <QuizBody {...p} quiz={p.scene.quiz} /> : <StatementScene {...p} />);

const QuizBody: React.FC<SceneProps & { quiz: SceneQuiz }> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useLayout();
  const voice = useVoice(p.scene);
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const t = quizTiming(p.scene);
  const verdict = VERDICT[p.quiz.answer] ?? VERDICT.myth;
  const ui = uiText(p.video.language);
  const verdictLabel = verdict === VERDICT.truth ? ui.truth : ui.myth;

  const counting = frame >= t.countdownStart && frame < t.revealAt;
  const revealed = frame >= t.revealAt;
  const left = Math.max(0, t.revealAt - frame);
  const number = Math.max(1, Math.ceil(left / fps));
  const tick = spring({ frame: counting ? (frame - t.countdownStart) % fps : 30, fps, config: { damping: 10, stiffness: 220, mass: 0.6 } });
  const remaining = counting ? left / Math.max(1, t.pauseFrames) : revealed ? 0 : 1;
  const ringIn = spring({ frame: frame - 8, fps, config: { damping: 15, stiffness: 120 } });
  const ringOut = interpolate(frame, [t.revealAt, t.revealAt + 8], [1, 0], clamp);
  const stampS = spring({ frame: frame - t.revealAt, fps, config: { damping: 11, stiffness: 170, mass: 0.7 } });
  const stampOpacity = interpolate(frame, [t.revealAt, t.revealAt + 4], [0, 1], clamp);
  const flash = interpolate(frame, [t.revealAt, t.revealAt + 3, t.revealAt + 16], [0, 0.32, 0], clamp);
  const claimDim = interpolate(frame, [t.revealAt, t.revealAt + 10], [1, verdict === VERDICT.myth ? 0.5 : 0.8], clamp);
  const strike = verdict === VERDICT.myth ? interpolate(frame, [t.revealAt + 4, t.revealAt + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) : 0;
  const pillS = spring({ frame, fps, config: { damping: 14, stiffness: 160 } });
  const questionIn = spring({ frame: frame - t.revealAt - 18, fps, config: { damping: 15, stiffness: 140 } });

  // Сетка: утверждение сверху (слева в 16:9), отсчёт/вердикт — снизу (справа).
  const pillH = Math.round((shorts ? 84 : 72) * unit);
  const gap = Math.round((shorts ? 40 : 56) * unit);
  const claimBox = shorts ? { w: content.w, h: Math.round(content.h * 0.36) } : { w: Math.round(content.w * 0.54), h: Math.round(content.h * 0.62) };
  const stageBox = shorts
    ? { w: content.w, h: Math.max(200, content.h - pillH - claimBox.h - gap * 2) }
    : { w: Math.round(content.w * 0.4), h: Math.round(content.h * 0.9) };
  const ring = Math.round(Math.min(stageBox.w * 0.62, stageBox.h * 0.78));
  const stroke = Math.max(8, Math.round(ring * 0.06));
  const r = ring / 2 - stroke;
  const circ = 2 * Math.PI * r;
  const stampFont = Math.round((shorts ? 112 : 96) * unit);
  const VIcon = verdict.Icon;
  const explBox = { w: stageBox.w, h: Math.round(stageBox.h * 0.3) };

  const pill = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14 * unit,
        height: pillH,
        padding: `0 ${30 * unit}px`,
        borderRadius: pillH / 2,
        background: p.theme.accent,
        color: p.theme.accentInk,
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize: Math.round(pillH * 0.44),
        letterSpacing: "0.04em",
        transform: `scale(${interpolate(pillS, [0, 1], [0.6, 1])})`,
        opacity: interpolate(frame, [0, 6], [0, 1], clamp),
        boxShadow: `0 ${10 * unit}px ${30 * unit}px ${withAlpha(p.theme.accent, 0.35)}`,
        whiteSpace: "nowrap",
      }}
    >
      <CircleHelp size={pillH * 0.56} color={p.theme.accentInk} strokeWidth={2.4} />
      {ui.quizTitle}
    </div>
  );

  const claim = (
    <div style={{ position: "relative", width: claimBox.w, opacity: claimDim }}>
      <KineticText
        text={p.scene.onScreen}
        theme={p.theme}
        box={claimBox}
        font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.1, letterSpacingEm: -0.02 }}
        maxFontSize={Math.round((shorts ? 104 : 92) * unit)}
        maxLines={shorts ? 5 : 5}
        align={shorts ? "center" : "left"}
        scene={p.scene}
        mode="speech"
        start={Math.max(4, voice.start - 2)}
        step={3}
        deadline={voice.start + Math.round((voice.end - voice.start) * 0.75)}
        entrance="rise"
        highlight="underline"
      />
      {strike > 0 ? (
        // Миф — утверждение зачёркивается красной чертой.
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            width: `${100 * strike}%`,
            height: Math.max(8, 12 * unit),
            borderRadius: 8 * unit,
            background: verdict.color,
            transform: "rotate(-3deg)",
            transformOrigin: "0% 50%",
            boxShadow: `0 0 ${18 * unit}px ${withAlpha(verdict.color, 0.6)}`,
          }}
        />
      ) : null}
    </div>
  );

  const stage = (
    <div style={{ position: "relative", width: stageBox.w, height: stageBox.h }}>
      {/* Отсчёт: кольцо убывает, цифры «щёлкают» раз в секунду; пока говорит диктор — знак вопроса */}
      {ringOut > 0 ? (
        <div
          style={{
            position: "absolute",
            left: (stageBox.w - ring) / 2,
            top: (stageBox.h - ring) / 2,
            width: ring,
            height: ring,
            opacity: ringOut * interpolate(ringIn, [0, 1], [0, 1]),
            transform: `scale(${interpolate(ringIn, [0, 1], [0.7, 1]) * (counting ? 1 + 0.04 * (1 - tick) : 1)})`,
          }}
        >
          <svg width={ring} height={ring} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <circle cx={ring / 2} cy={ring / 2} r={r} fill={withAlpha(p.theme.bgFrom, 0.55)} stroke={withAlpha(p.theme.text, 0.14)} strokeWidth={stroke} />
            <circle
              cx={ring / 2}
              cy={ring / 2}
              r={r}
              fill="none"
              stroke={p.theme.accent}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - remaining)}
              transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
              style={{ filter: `drop-shadow(0 0 ${12 * unit}px ${withAlpha(p.theme.accent, 0.55)})` }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT_NUMBER,
              fontWeight: 800,
              fontSize: Math.round(ring * (counting ? 0.46 : 0.4)),
              color: counting ? p.theme.text : withAlpha(p.theme.text, 0.75),
              transform: `scale(${counting ? interpolate(tick, [0, 1], [1.45, 1]) : 1 + 0.04 * Math.sin((frame / fps) * 3)})`,
              opacity: counting ? interpolate(tick, [0, 0.4], [0.2, 1], clamp) : 1,
            }}
          >
            {counting ? number : "?"}
          </div>
        </div>
      ) : null}

      {/* Вердикт: штамп с иконкой, пояснение, вопрос зрителю */}
      {revealed ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: Math.round(40 * unit),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18 * unit,
              padding: `${14 * unit}px ${38 * unit}px`,
              borderRadius: 26 * unit,
              background: verdict.color,
              color: verdict.ink,
              fontFamily: FONT_DISPLAY,
              fontWeight: 900,
              fontSize: stampFont,
              lineHeight: 1,
              letterSpacing: "0.03em",
              transform: `rotate(-4deg) scale(${interpolate(stampS, [0, 1], [1.9, 1])})`,
              opacity: stampOpacity,
              boxShadow: `0 ${16 * unit}px ${48 * unit}px ${withAlpha(verdict.color, 0.45)}, inset 0 0 0 ${6 * unit}px ${withAlpha("#ffffff", 0.18)}`,
              whiteSpace: "nowrap",
            }}
          >
            <VIcon size={stampFont * 0.9} color={verdict.ink} strokeWidth={3.2} />
            {verdictLabel}
          </div>
          <KineticText
            text={p.quiz.explanation}
            theme={p.theme}
            box={explBox}
            font={{ fontFamily: FONT_BODY, fontWeight: 700, lineHeight: 1.18 }}
            maxFontSize={Math.round((shorts ? 54 : 46) * unit)}
            maxLines={3}
            align="center"
            mode="stagger"
            start={t.revealAt + 8}
            step={2}
            entrance="fade"
            highlight="color"
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12 * unit,
              maxWidth: stageBox.w,
              fontFamily: FONT_BODY,
              fontWeight: 600,
              fontSize: Math.round((shorts ? 36 : 30) * unit),
              color: p.theme.textDim,
              opacity: interpolate(questionIn, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(questionIn, [0, 1], [16 * unit, 0])}px)`,
            }}
          >
            <MessageCircle size={Math.round((shorts ? 40 : 34) * unit)} color={p.theme.accent} strokeWidth={2.2} style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.quiz.question?.trim() || ui.quizQuestion}</span>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <SceneFrame p={p} push={0.03}>
      {shorts ? (
        <ContentBox gap={gap} justify="flex-start">
          {pill}
          {claim}
          {stage}
        </ContentBox>
      ) : (
        <ContentBox align="center">
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: Math.round(content.w * 0.06) }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap }}>
              {pill}
              {claim}
            </div>
            {stage}
          </div>
        </ContentBox>
      )}
      {flash > 0 ? <div style={{ position: "absolute", inset: 0, background: verdict.color, opacity: flash, mixBlendMode: "screen" }} /> : null}
    </SceneFrame>
  );
};
