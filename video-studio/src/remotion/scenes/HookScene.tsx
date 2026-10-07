import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { KineticText } from "../components/KineticText";
import { Icon, IconBadge } from "../components/Icon";
import { FONT_DISPLAY } from "../fonts";
import { useLayout } from "../lib/layout";
import { withAlpha } from "../theme";
import { ContentBox, SceneFrame, clamp, useVoice, type SceneProps } from "./common";

// Хук: первые секунды решают, досмотрят ли ролик. Огромные слова
// «впечатываются» ровно в момент произнесения, акцент — маркером,
// позади — гигантская полупрозрачная иконка для глубины.
export const HookScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const voice = useVoice(p.scene);
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const badge = Math.round((shorts ? 150 : 130) * unit);
  const gap = Math.round(48 * unit);
  const textBox = { w: content.w, h: content.h - badge - gap - 40 * unit };
  const ghost = Math.round(Math.min(content.w, content.h) * (shorts ? 1.05 : 0.9));
  const ghostRot = interpolate(frame, [0, p.scene.durationInFrames], [-8, 6]);
  const ghostIn = interpolate(frame, [0, 20], [0, 1], clamp);

  return (
    <SceneFrame p={p} push={0.07}>
      <div
        style={{
          position: "absolute",
          left: content.x + content.w / 2 - ghost / 2,
          top: content.y + content.h / 2 - ghost / 2,
          opacity: 0.07 * ghostIn,
          transform: `rotate(${ghostRot}deg) scale(${interpolate(ghostIn, [0, 1], [1.15, 1])})`,
        }}
      >
        <Icon name={p.scene.icon} size={ghost} color={withAlpha(p.theme.text, 1)} strokeWidth={1.1} />
      </div>
      <ContentBox gap={gap}>
        <IconBadge name={p.scene.icon} size={badge} theme={p.theme} delay={2} gradientId={`ig-${p.scene.id}`} shape="circle" />
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={textBox}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 900, lineHeight: 1.04, letterSpacingEm: -0.025, uppercase: true }}
          maxFontSize={Math.round((shorts ? 148 : 150) * unit)}
          maxLines={shorts ? 6 : 4}
          align="center"
          scene={p.scene}
          mode="speech"
          start={voice.start - 2}
          step={4}
          deadline={voice.start + Math.round((voice.end - voice.start) * 0.7)}
          entrance="pop"
          highlight="marker"
        />
      </ContentBox>
    </SceneFrame>
  );
};
