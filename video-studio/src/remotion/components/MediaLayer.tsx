import React, { useState } from "react";
import { AbsoluteFill, Img, Loop, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneVisual } from "../../types";
import { withAlpha, type Theme } from "../theme";

// Пути из props — относительно publicDir; http(s)/data: — как есть.
export const resolveSrc = (src: string): string => (/^(https?:|data:|blob:)/.test(src) ? src : staticFile(src.replace(/^\/+/, "")));

// Визуал сцены на весь кадр: картинка — медленный Ken Burns, видео — по
// кругу в <Loop> (OffthreadVideo декодирует в Rust-композиторе Remotion,
// это надёжнее браузерного декодера). Сверху всегда затемнение, чтобы
// текст читался; dim="strong" для сцен, где визуал лишь фон.
export const MediaLayer: React.FC<{
  visual: SceneVisual;
  theme: Theme;
  durationInFrames: number;
  seed: number;
  dim: "strong" | "soft";
}> = ({ visual, theme, durationInFrames, seed, dim }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [failed, setFailed] = useState(false);
  if (visual.type === "none" || failed) return null;

  const dir = seed % 2 === 0 ? 1 : -1;
  const p = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], { extrapolateRight: "clamp" });
  const scale = visual.type === "image" ? interpolate(p, [0, 1], [1.08, 1.2]) : interpolate(p, [0, 1], [1.03, 1.1]);
  const tx = visual.type === "image" ? dir * interpolate(p, [0, 1], [-2.2, 2.2]) : 0;
  const ty = visual.type === "image" ? interpolate(p, [0, 1], [1.2, -1.2]) : 0;
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
  };
  const onError = () => {
    console.warn(`[визуал] не удалось загрузить ${visual.src} — сцена пойдёт без фона`);
    setFailed(true);
  };

  const strong = dim === "strong";
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: theme.bgFrom }}>
      {visual.type === "image" ? (
        <Img src={resolveSrc(visual.src)} style={style} onError={onError} />
      ) : (
        <Loop durationInFrames={Math.max(1, Math.floor(visual.durationSec * fps))}>
          <AbsoluteFill>
            <OffthreadVideo src={resolveSrc(visual.src)} muted style={style} onError={onError} />
          </AbsoluteFill>
        </Loop>
      )}
      {/* Тонировка в цвет темы связывает сток с палитрой ролика */}
      <AbsoluteFill style={{ background: withAlpha(theme.bgFrom, strong ? 0.5 : 0.18) }} />
      <AbsoluteFill
        style={{
          background: strong
            ? `linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.85) 100%)`
            : // soft: визуал виден ярко, но нижняя треть (подпись + субтитры) — на тёмной подложке
              `linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.08) 24%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.66) 58%, rgba(0,0,0,0.78) 80%, rgba(0,0,0,0.9) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse 90% 75% at 50% 45%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.5) 100%)` }}
      />
    </AbsoluteFill>
  );
};
