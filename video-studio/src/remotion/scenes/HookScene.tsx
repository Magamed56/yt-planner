import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { KineticText } from "../components/KineticText";
import { DrawnIcon, IconBadge } from "../components/Icon";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";

// Хук: первые секунды решают, досмотрят ли ролик. Кадр 0 уже не пустой
// (значок и первое слово), дальше огромные слова «впечатываются» ровно в
// момент произнесения — каждое слегка толкает блок, акцент — маркером.
// Позади — гигантская иконка, которая прорисовывается штрихом: читается как
// задуманная иллюстрация, а не как «призрак».
export const HookScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const voice = useVoice(p.scene);
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
    <SceneFrame p={p} push={0.07}>
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
          mode="speech"
          start={voice.start - 2}
          step={4}
          firstAt={-2}
          deadline={voice.start + Math.round((voice.end - voice.start) * 0.7)}
          entrance="pop"
          impact={1}
          highlight="marker"
        />
      </ContentBox>
    </SceneFrame>
  );
};
