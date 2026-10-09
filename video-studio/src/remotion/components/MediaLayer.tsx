import React, { useState } from "react";
import { AbsoluteFill, Img, Loop, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneVisual } from "../../types";
import { useLayout } from "../lib/layout";
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
  // Реальное фото другой ориентации (горизонтальное в Shorts) на сцене, где
  // визуал — главный, показываем целиком «карточкой» поверх своей размытой
  // копии: обрезка по центру потеряла бы сам объект (пирамиду, шлем, акулу).
  if (visual.type === "image" && visual.fit === "contain" && !strong) {
    return <ContainedImage src={resolveSrc(visual.src)} theme={theme} p={p} dir={dir} onError={onError} />;
  }
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

// Фото целиком: размытая копия на весь кадр + карточка с мягким наездом.
// Размер карточки — по самой картинке (max-width/max-height у <img>), так что
// скругление и тень всегда облегают фото, каких бы пропорций оно ни было.
const ContainedImage: React.FC<{ src: string; theme: Theme; p: number; dir: number; onError: () => void }> = ({ src, theme, p, dir, onError }) => {
  const layout = useLayout();
  const { width, content, safe, unit } = layout;
  const shorts = layout.format === "shorts";
  // Shorts: карточка в верхних двух третях контентной зоны (ниже — подпись сцены);
  // горизонтальный ролик: справа, слева остаётся место под подпись.
  const area = shorts
    ? { x: 0, y: content.y, w: width, h: content.h * 0.64 }
    : { x: width * 0.5, y: safe.y, w: safe.x + safe.w - width * 0.5, h: content.h };
  const maxW = shorts ? width * 0.88 : area.w;
  const radius = Math.round(28 * unit);
  const zoom = interpolate(p, [0, 1], [1.02, 1.1]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: theme.bgFrom }}>
      <Img
        src={src}
        onError={onError}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: `blur(${Math.round(40 * unit)}px) saturate(1.15)`, transform: `scale(${1.25 + 0.05 * p})` }}
      />
      <AbsoluteFill style={{ background: withAlpha(theme.bgFrom, 0.45) }} />
      <div style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            display: "inline-block",
            overflow: "hidden",
            borderRadius: radius,
            border: `${Math.max(2, 3 * unit)}px solid ${withAlpha(theme.text, 0.18)}`,
            boxShadow: `0 ${30 * unit}px ${80 * unit}px rgba(0,0,0,0.55)`,
            lineHeight: 0,
          }}
        >
          <Img
            src={src}
            onError={onError}
            style={{ display: "block", maxWidth: maxW, maxHeight: area.h, width: "auto", height: "auto", transform: `scale(${zoom}) translateX(${dir * interpolate(p, [0, 1], [-1, 1])}%)` }}
          />
        </div>
      </div>
      {/* Низ кадра — на тёмной подложке: там подпись сцены и субтитры */}
      <AbsoluteFill
        style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.85) 100%)` }}
      />
    </AbsoluteFill>
  );
};
