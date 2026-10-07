import React, { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { withAlpha, type Theme } from "../theme";

// Фон всего ролика: градиент темы + медленно плывущие мягкие пятна цвета,
// точечная сетка, «боке»-частицы, плёночное зерно и виньетка.
// ВАЖНО для скорости софтверного рендера: никаких filter: blur() на больших
// слоях — мягкость пятен даёт сам radial-gradient.

let grainUrl: string | null = null;
// Тайл зерна генерируем один раз на вкладку canvas'ом с детерминированным
// ГПСЧ — без бинарных ассетов и одинаково в Studio и рендере.
function getGrainUrl(): string {
  if (grainUrl) return grainUrl;
  try {
    const size = 160;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    const img = ctx.createImageData(size, size);
    let s = 1337;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < size * size; i++) {
      const v = Math.floor(rnd() * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = Math.floor(40 + rnd() * 70);
    }
    ctx.putImageData(img, 0, 0);
    grainUrl = c.toDataURL("image/png");
  } catch {
    grainUrl = "";
  }
  return grainUrl;
}

interface Props {
  theme: Theme;
  seed?: string;
  // Для превью/обложки: фиксированный «красивый» момент вместо анимации.
  frameOverride?: number;
  grain?: boolean;
  particles?: boolean;
}

export const Background: React.FC<Props> = ({ theme, seed = "bg", frameOverride, grain = true, particles = true }) => {
  const realFrame = useCurrentFrame();
  const frame = frameOverride ?? realFrame;
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const big = Math.max(width, height);

  const blobs = useMemo(
    () => [
      { color: theme.blobA, size: 1.25, ax: 0.18, ay: 0.22, alpha: 0.62 },
      { color: theme.blobB, size: 1.05, ax: 0.82, ay: 0.68, alpha: 0.5 },
      { color: theme.blobC, size: 0.9, ax: 0.3, ay: 0.92, alpha: 0.42 },
    ],
    [theme],
  );

  const dots = useMemo(
    () =>
      new Array(16).fill(0).map((_, i) => ({
        x: random(`${seed}-px-${i}`),
        y: random(`${seed}-py-${i}`),
        r: 3 + random(`${seed}-pr-${i}`) * 9,
        speed: 6 + random(`${seed}-ps-${i}`) * 16, // px/сек вверх
        tint: random(`${seed}-pc-${i}`) > 0.6,
      })),
    [seed],
  );

  const grainSrc = grain ? getGrainUrl() : "";
  // Зерно «дрожит» как плёнка: смещение тайла меняется каждые 2 кадра.
  const gStep = Math.floor(frame / 2);
  const gx = Math.floor(random(`g-x-${gStep}`) * 160);
  const gy = Math.floor(random(`g-y-${gStep}`) * 160);

  return (
    <AbsoluteFill style={{ background: `linear-gradient(165deg, ${theme.bgFrom} 0%, ${theme.bgTo} 58%, ${theme.bgFrom} 100%)`, overflow: "hidden" }}>
      {blobs.map((b, i) => {
        const s = big * b.size;
        const nx = noise2D(`${seed}-bx-${i}`, t * 0.07, i * 10);
        const ny = noise2D(`${seed}-by-${i}`, i * 10, t * 0.07);
        const cx = width * (b.ax + nx * 0.28);
        const cy = height * (b.ay + ny * 0.22);
        const breathe = 1 + 0.08 * noise2D(`${seed}-bs-${i}`, t * 0.12, 3);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - s / 2,
              top: cy - s / 2,
              width: s,
              height: s,
              transform: `scale(${breathe})`,
              background: `radial-gradient(closest-side, ${withAlpha(b.color, b.alpha)} 0%, ${withAlpha(b.color, b.alpha * 0.45)} 38%, ${withAlpha(b.color, 0)} 100%)`,
            }}
          />
        );
      })}
      {/* Точечная сетка — ощущение «пространства», медленный параллакс */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${withAlpha(theme.text, 0.5)} 1.4px, transparent 2.2px)`,
          backgroundSize: "54px 54px",
          backgroundPosition: `${Math.round(t * 3)}px ${Math.round(-t * 6)}px`,
          opacity: 0.075,
        }}
      />
      {particles
        ? dots.map((d, i) => {
            const y = (((d.y * height - t * d.speed) % height) + height) % height;
            const x = d.x * width + noise2D(`${seed}-pw-${i}`, t * 0.2, 0) * 40;
            const tw = 0.35 + 0.65 * Math.max(0, noise2D(`${seed}-pt-${i}`, t * 0.5, 1));
            const color = d.tint ? theme.accent : theme.text;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: x - d.r * 3,
                  top: y - d.r * 3,
                  width: d.r * 6,
                  height: d.r * 6,
                  opacity: tw * 0.55,
                  background: `radial-gradient(closest-side, ${withAlpha(color, 0.9)} 0%, ${withAlpha(color, 0.25)} 35%, ${withAlpha(color, 0)} 100%)`,
                }}
              />
            );
          })
        : null}
      {/* Виньетка: фокус в центр, края темнее */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 85% 70% at 50% 42%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.38) 80%, rgba(0,0,0,0.62) 100%)`,
        }}
      />
      {grainSrc ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url(${grainSrc})`,
            backgroundSize: "160px 160px",
            backgroundPosition: `${gx}px ${gy}px`,
            opacity: 0.06,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
