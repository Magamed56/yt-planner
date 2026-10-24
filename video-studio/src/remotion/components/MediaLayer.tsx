import React, { useState } from "react";
import { AbsoluteFill, Img, Loop, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CameraMove, SceneVisual } from "../../types";
import { cameraState, cameraTransform } from "../lib/camera";
import { useLayout } from "../lib/layout";
import { withAlpha, type Theme } from "../theme";

// Пути из props — относительно publicDir; http(s)/data: — как есть.
export const resolveSrc = (src: string): string => (/^(https?:|data:|blob:)/.test(src) ? src : staticFile(src.replace(/^\/+/, "")));

// Насколько приглушить визуал под текстом:
// strong — визуал лишь фон под карточками и мелким текстом (список, цитата, призыв…);
// medium — визуал виден ярко, крупный текст поверх всей контентной зоны (хук,
//          утверждение, цифра): ровная подложка под текстом, контраст добирает
//          тень-ореол у содержимого сцены (SceneFrame);
// soft   — визуал главный, подпись в нижней трети (media).
// none   — кинорежим: кадр без тонировки и затемнения (субтитры читаются по
//          своей обводке), текста поверх нет.
export type MediaDim = "strong" | "medium" | "soft" | "none";

// Визуал сцены на весь кадр: картинка — медленный Ken Burns, видео — по
// кругу в <Loop> (OffthreadVideo декодирует в Rust-композиторе Remotion,
// это надёжнее браузерного декодера). Сверху всегда затемнение, чтобы
// текст читался.
export const MediaLayer: React.FC<{
  visual: SceneVisual;
  theme: Theme;
  durationInFrames: number;
  seed: number;
  dim: MediaDim;
  camera?: CameraMove; // кинорежим: движение камеры плана вместо Ken Burns
  motionSeed?: string; // зерно «дыхания» с рук — своё у каждого плана
}> = ({ visual, theme, durationInFrames, seed, dim, camera, motionSeed }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
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
    transform: camera ? cameraTransform(cameraState(camera, p, frame / fps, motionSeed ?? String(seed)), width, height) : `scale(${scale}) translate(${tx}%, ${ty}%)`,
  };
  const onError = () => {
    console.warn(`[визуал] не удалось загрузить ${visual.src} — сцена пойдёт без фона`);
    setFailed(true);
  };

  // Реальное фото другой ориентации (горизонтальное в Shorts) на сцене, где
  // визуал — главный, показываем целиком «карточкой» поверх своей размытой
  // копии: обрезка по центру потеряла бы сам объект (пирамиду, шлем, акулу).
  // При medium карточка встала бы под крупный текст — там фото на весь кадр.
  if (visual.type === "image" && visual.fit === "contain" && (dim === "soft" || dim === "none")) {
    return <ContainedImage src={resolveSrc(visual.src)} theme={theme} p={p} dir={dir} onError={onError} />;
  }
  const shade = dim === "none" ? null : DIM_SHADE[dim];
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
      {shade ? (
        <>
          {/* Тонировка в цвет темы связывает сток с палитрой ролика */}
          <AbsoluteFill style={{ background: withAlpha(theme.bgFrom, shade.tint) }} />
          <AbsoluteFill style={{ background: shade.gradient }} />
          <AbsoluteFill
            style={{ background: `radial-gradient(ellipse 90% 75% at 50% 45%, rgba(0,0,0,0) 50%, rgba(0,0,0,${shade.vignette}) 100%)` }}
          />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

const DIM_SHADE: Record<Exclude<MediaDim, "none">, { tint: number; gradient: string; vignette: number }> = {
  strong: {
    tint: 0.5,
    gradient: `linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.85) 100%)`,
    vignette: 0.5,
  },
  // Под контентной зоной (12–66 % высоты в Shorts) — ровно ≈ ×0,5 яркости:
  // белый текст с ореолом читается даже на белом небе, а кадр остаётся живым.
  // Ниже темнее — субтитры и интерфейс YouTube.
  medium: {
    tint: 0.2,
    gradient: `linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.3) 12%, rgba(0,0,0,0.35) 24%, rgba(0,0,0,0.36) 60%, rgba(0,0,0,0.6) 72%, rgba(0,0,0,0.86) 100%)`,
    vignette: 0.38,
  },
  // Визуал виден ярко, но нижняя треть (подпись + субтитры) — на тёмной подложке.
  soft: {
    tint: 0.18,
    gradient: `linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.08) 24%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.66) 58%, rgba(0,0,0,0.78) 80%, rgba(0,0,0,0.9) 100%)`,
    vignette: 0.5,
  },
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
