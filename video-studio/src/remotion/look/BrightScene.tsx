import React, { useState } from "react";
import { AbsoluteFill, Easing, Img, Loop, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveSrc } from "../components/MediaLayer";
import { FONT_NUMBER } from "../fonts";
import type { SceneProps } from "../scenes/common";
import { Pointer } from "./Pointer";

// Подача bright: кадр сцены — на весь экран и без затемнения (только лёгкие
// градиенты под интерфейс YouTube сверху и снизу). Карточек и заголовков нет —
// текст несут субтитры по одному слову (WordCaptions). Камера: «удар» наезда на
// склейке, затем медленный наезд с дрейфом. Стрелка лежит в том же трансформе,
// что и картинка, поэтому остаётся на предмете.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const YELLOW = "#ffe14d";

function outline(px: number, color: string): string {
  const parts: string[] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    parts.push(`${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 ${color}`);
  }
  parts.push(`0 ${px * 1.6}px ${px * 3}px rgba(0,0,0,0.6)`);
  return parts.join(", ");
}

// Год и небольшие числа — без разрядов («1873»), большие — с узким пробелом.
function statText(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 10000) return String(value);
  return value.toLocaleString("ru-RU").replace(/\s/g, " ");
}

export const BrightScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const unit = width / 1080;
  const { scene } = p;
  const v = scene.visual;
  const [failed, setFailed] = useState(false);
  const dur = Math.max(1, scene.durationInFrames);

  const punch = spring({ frame, fps, config: { damping: 14, stiffness: 220, mass: 0.5 } });
  const slow = interpolate(frame, [0, dur], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const scale = 1.05 + 0.08 * (1 - punch) + 0.07 * slow;
  const dir = p.index % 2 === 0 ? 1 : -1;
  const tx = dir * interpolate(slow, [0, 1], [-1.2, 1.2]);
  const ty = interpolate(slow, [0, 1], [0.8, -0.8]);
  const camera: React.CSSProperties = { transform: `scale(${scale.toFixed(4)}) translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%)`, transformOrigin: "50% 50%" };
  const media: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const onError = () => {
    console.warn(`[визуал] не удалось загрузить ${v.type === "none" ? "" : v.src} — сцена без фона`);
    setFailed(true);
  };

  const stat = scene.kind === "stat" && scene.stat ? scene.stat : null;
  const statIn = spring({ frame: frame - 6, fps, config: { damping: 9, stiffness: 160, mass: 0.6 } });
  const statFs = Math.round(230 * unit);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: p.theme.bgFrom }}>
      <AbsoluteFill style={camera}>
        {v.type === "image" && !failed ? <Img src={resolveSrc(v.src)} style={media} onError={onError} /> : null}
        {v.type === "video" && !failed ? (
          <Loop durationInFrames={Math.max(1, Math.floor(v.durationSec * fps))}>
            <AbsoluteFill>
              <OffthreadVideo src={resolveSrc(v.src)} muted style={media} onError={onError} />
            </AbsoluteFill>
          </Loop>
        ) : null}
        {scene.pointer ? <Pointer pointer={scene.pointer} durationInFrames={dur} /> : null}
      </AbsoluteFill>
      {/* Только под интерфейс YouTube: сверху поиск и меню, снизу название и кнопки */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 13%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.5) 100%)" }} />
      {stat ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: Math.round(300 * unit) }}>
          <div
            style={{
              fontFamily: FONT_NUMBER,
              fontWeight: 900,
              fontSize: statFs,
              lineHeight: 1,
              color: YELLOW,
              textShadow: outline(statFs * 0.06, "#000"),
              transform: `scale(${interpolate(statIn, [0, 1], [0.4, 1])}) rotate(${interpolate(statIn, [0, 1], [-10, -4])}deg)`,
              opacity: interpolate(frame, [5, 8], [0, 1], clamp),
              whiteSpace: "nowrap",
            }}
          >
            {stat.prefix ?? ""}
            {statText(stat.value)}
            {stat.suffix ?? ""}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
