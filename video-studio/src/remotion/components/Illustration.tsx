import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { DrawnIcon, IconGradientDefs } from "./Icon";
import { withAlpha, type Theme } from "../theme";

// «Иллюстрация» для сцен без визуала (нет ключей стоков, сток не нашёлся):
// осмысленная моушен-композиция вместо пустой карточки — иконка
// прорисовывается штрихом внутри «медальона», вокруг вращаются орбиты и
// HUD-дуги, по орбите бежит светящаяся точка, вокруг дрейфуют простые
// геометрические фигуры, позади — сетка точек и мягкое свечение.
// Всё на одном SVG + одном статичном canvas: дёшево в софтверном рендере.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.33, 1, 0.68, 1);

type Shape = "ring" | "plus" | "square" | "dot" | "triangle";
const SHAPES: Shape[] = ["ring", "plus", "square", "dot", "triangle", "ring", "plus", "dot"];

// Сетка точек, гаснущая к краям: рисуется один раз, дальше только сдвигается.
const DotField: React.FC<{ w: number; h: number; color: string; step: number }> = ({ w, h, color, step }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2;
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2));
        const a = Math.max(0, 1 - d) ** 1.4;
        if (a < 0.02) continue;
        ctx.fillStyle = withAlpha(color, 0.55 * a);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, maxR * 0.006), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [w, h, color, step]);
  return <canvas ref={ref} width={Math.round(w)} height={Math.round(h)} style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} />;
};

export const Illustration: React.FC<{
  icon?: string;
  theme: Theme;
  w: number;
  h: number;
  id: string;
  delay?: number;
}> = ({ icon, theme, w, h, id, delay = 0 }) => {
  const realFrame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frame = realFrame - delay;
  const t = frame / fps;
  const S = Math.min(w, h);
  const R = S * 0.42;
  const cx = w / 2;
  const cy = h / 2;
  const gid = `ill-${id}`;

  const ringDraw = interpolate(frame, [0, 26], [0, 1], { ...clamp, easing: ease });
  const medal = spring({ frame: frame - 2, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const iconDraw = interpolate(frame, [8, 44], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const dashIn = interpolate(frame, [6, 24], [0, 1], { ...clamp, easing: ease });
  const arcsIn = interpolate(frame, [14, 28], [0, 1], clamp);
  const glow = interpolate(frame, [0, 14], [0, 1], clamp) * (0.88 + 0.12 * Math.sin(t * 1.8));
  const float = Math.sin(t * 1.3) * S * 0.012;

  const shapes = useMemo(
    () =>
      SHAPES.map((kind, i) => {
        const a = (i / SHAPES.length) * Math.PI * 2 + (random(`${id}-a-${i}`) - 0.5) * 0.5 - Math.PI / 2;
        const rr = R * (1.08 + random(`${id}-r-${i}`) * 0.32);
        return {
          kind,
          x: Math.cos(a) * rr,
          y: Math.sin(a) * rr * (h > w ? 1 : 0.9),
          size: S * (0.024 + random(`${id}-s-${i}`) * 0.022),
          color: [theme.accent, theme.blobB, theme.text, theme.accent2][i % 4],
          spin: (random(`${id}-p-${i}`) - 0.5) * 60,
        };
      }),
    [id, R, S, w, h, theme],
  );

  const circ = 2 * Math.PI * R;
  const orbitA = t * 0.7 + 0.4;
  const arc = (r: number, a0: number, a1: number) => {
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    return `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]}`;
  };
  const hudRot = t * 18;
  const iconSize = R * 0.74;

  return (
    <div style={{ position: "relative", width: w, height: h }}>
      {/* Свечение — radial-gradient вместо blur ради скорости */}
      <div
        style={{
          position: "absolute",
          left: cx - R * 1.35,
          top: cy - R * 1.35,
          width: R * 2.7,
          height: R * 2.7,
          opacity: glow,
          background: `radial-gradient(closest-side, ${withAlpha(theme.accent, 0.24)} 0%, ${withAlpha(theme.blobA, 0.12)} 45%, ${withAlpha(theme.blobA, 0)} 100%)`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, opacity: 0.55 * ringDraw, transform: `translate(${Math.sin(t * 0.3) * S * 0.015}px, ${Math.cos(t * 0.25) * S * 0.012}px)` }}>
        <DotField w={w} h={h} color={theme.text} step={Math.max(18, S * 0.055)} />
      </div>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id={`${gid}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={theme.accent} />
            <stop offset="100%" stopColor={theme.accent2} />
          </linearGradient>
          <radialGradient id={`${gid}-medal`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor={withAlpha(theme.text, 0.16)} />
            <stop offset="100%" stopColor={withAlpha(theme.text, 0.03)} />
          </radialGradient>
        </defs>
        {/* Внешняя орбита прорисовывается по кругу */}
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={withAlpha(theme.text, 0.16)}
          strokeWidth={Math.max(1.5, S * 0.0035)}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - ringDraw)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* Пунктирное кольцо — медленно вращается навстречу */}
        <g transform={`rotate(${-t * 10} ${cx} ${cy})`} opacity={dashIn}>
          <circle
            cx={cx}
            cy={cy}
            r={R * 0.8 * interpolate(dashIn, [0, 1], [0.9, 1])}
            fill="none"
            stroke={withAlpha(theme.accent, 0.5)}
            strokeWidth={Math.max(2, S * 0.005)}
            strokeDasharray={`${S * 0.004} ${S * 0.022}`}
            strokeLinecap="round"
          />
        </g>
        {/* HUD-дуги */}
        <g transform={`rotate(${hudRot} ${cx} ${cy})`} opacity={arcsIn}>
          <path d={arc(R * 0.91, 0, 0.95)} fill="none" stroke={`url(#${gid}-arc)`} strokeWidth={Math.max(3, S * 0.009)} strokeLinecap="round" />
          <path d={arc(R * 0.91, Math.PI, Math.PI + 0.42)} fill="none" stroke={withAlpha(theme.accent2, 0.8)} strokeWidth={Math.max(3, S * 0.009)} strokeLinecap="round" />
        </g>
        {/* Медальон под иконкой */}
        <circle
          cx={cx}
          cy={cy + float}
          r={R * 0.6 * interpolate(medal, [0, 1], [0.6, 1])}
          fill={`url(#${gid}-medal)`}
          stroke={withAlpha(theme.text, 0.22)}
          strokeWidth={Math.max(1.5, S * 0.0035)}
          opacity={interpolate(frame, [2, 8], [0, 1], clamp)}
        />
        {/* Светящаяся точка на орбите */}
        <g opacity={ringDraw >= 1 ? 1 : 0}>
          <circle cx={cx + R * Math.cos(orbitA)} cy={cy + R * Math.sin(orbitA)} r={S * 0.04} fill={withAlpha(theme.accent, 0.16)} />
          <circle cx={cx + R * Math.cos(orbitA)} cy={cy + R * Math.sin(orbitA)} r={S * 0.014} fill={theme.accent} />
        </g>
        {/* Геометрия вокруг — по очереди «выпрыгивает» и дрейфует */}
        {shapes.map((sh, i) => {
          const pop = spring({ frame: frame - 12 - i * 3, fps, config: { damping: 12, stiffness: 170, mass: 0.6 } });
          if (pop <= 0.001) return null;
          const x = cx + sh.x + noise2D(`${id}-dx-${i}`, t * 0.25, 0) * S * 0.03;
          const y = cy + sh.y + noise2D(`${id}-dy-${i}`, 0, t * 0.25) * S * 0.03;
          const z = sh.size * pop;
          const sw = Math.max(2, S * 0.0055);
          const col = withAlpha(sh.color, 0.75);
          const tr = `translate(${x} ${y}) rotate(${sh.spin * t + i * 20})`;
          if (sh.kind === "ring") return <circle key={i} cx={x} cy={y} r={z} fill="none" stroke={col} strokeWidth={sw} />;
          if (sh.kind === "dot") return <circle key={i} cx={x} cy={y} r={z * 0.45} fill={col} />;
          if (sh.kind === "plus")
            return <path key={i} transform={tr} d={`M ${-z} 0 H ${z} M 0 ${-z} V ${z}`} stroke={col} strokeWidth={sw} strokeLinecap="round" />;
          if (sh.kind === "square") return <rect key={i} transform={tr} x={-z * 0.8} y={-z * 0.8} width={z * 1.6} height={z * 1.6} rx={z * 0.3} fill="none" stroke={col} strokeWidth={sw} />;
          return <path key={i} transform={tr} d={`M 0 ${-z} L ${z * 0.9} ${z * 0.6} L ${-z * 0.9} ${z * 0.6} Z`} fill="none" stroke={col} strokeWidth={sw} strokeLinejoin="round" />;
        })}
      </svg>
      <IconGradientDefs id={`${gid}-icon`} from={theme.text} to={theme.accent} />
      <div
        style={{
          position: "absolute",
          left: cx - iconSize / 2,
          top: cy - iconSize / 2 + float,
          transform: `scale(${interpolate(medal, [0, 1], [0.85, 1])}) rotate(${Math.sin(t * 0.9) * 2.5}deg)`,
        }}
      >
        <DrawnIcon name={icon} size={iconSize} color={`url(#${gid}-icon)`} strokeWidth={1.5} progress={iconDraw} id={gid} />
      </div>
    </div>
  );
};
