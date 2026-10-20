import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ScenePointer } from "../../types";

// Красная стрелка с белой обводкой (подача bright): влетает к предмету и «тычет» в
// него, как в роликах «смотри, что это». Рисуется в координатах кадра до наезда
// камеры — BrightScene кладёт её в тот же трансформ, что и картинку.

const RED = "#ff2a1f";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Хвост — по диагонали к центру кадра (стрелка не уходит за край); у центра — снизу слева.
function tailDirection(x: number, y: number): { dx: number; dy: number } {
  const sx = x > 0.5 ? 1 : -1;
  const sy = y > 0.42 ? 1 : -1;
  // Хвост смотрит туда, где больше места: к центру по горизонтали, вниз — если предмет вверху.
  return { dx: -sx * Math.SQRT1_2, dy: -sy * Math.SQRT1_2 };
}

export const Pointer: React.FC<{ pointer: ScenePointer; durationInFrames: number; start?: number }> = ({ pointer, durationInFrames, start = 5 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 1080;
  const X = pointer.x * width;
  const Y = pointer.y * height;
  const f = frame - start;
  const enter = spring({ frame: f, fps, config: { damping: 11, stiffness: 170, mass: 0.6 } });
  const fade = interpolate(frame, [durationInFrames - 8, durationInFrames - 2], [1, 0], clamp);
  if (f < 0) return null;

  if (pointer.shape === "circle") {
    const r = (pointer.r ?? 0.12) * width;
    const draw = interpolate(f, [0, 12], [0, 1], clamp);
    const len = 2 * Math.PI * r * 1.1;
    return (
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, opacity: fade, overflow: "visible" }}>
        <ellipse cx={X} cy={Y} rx={r * 1.1} ry={r} fill="none" stroke="#fff" strokeWidth={30 * unit} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} strokeLinecap="round" transform={`rotate(-8 ${X} ${Y})`} />
        <ellipse cx={X} cy={Y} rx={r * 1.1} ry={r} fill="none" stroke={RED} strokeWidth={18 * unit} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} strokeLinecap="round" transform={`rotate(-8 ${X} ${Y})`} />
      </svg>
    );
  }

  const { dx, dy } = tailDirection(pointer.x, pointer.y);
  // Стрелка нарисована остриём в (0,0) вдоль +x; поворачиваем от хвоста к острию.
  const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
  const L = 330 * unit; // длина
  const H = 120 * unit; // длина наконечника
  const W = 150 * unit; // ширина наконечника
  const T = 52 * unit; // толщина древка
  const pts = [
    [0, 0],
    [-H, -W / 2],
    [-H * 0.86, -T / 2],
    [-L, -T * 0.42],
    [-L, T * 0.42],
    [-H * 0.86, T / 2],
    [-H, W / 2],
  ]
    .map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`)
    .join(" ");
  // Влёт со стороны хвоста + «тычок» в предмет ~1,6 раза в секунду.
  const fly = (1 - enter) * L * 0.7;
  const poke = Math.sin((f / fps) * Math.PI * 2 * 1.6) * 16 * unit * Math.min(1, enter);
  const back = fly + Math.max(0, poke) + 10 * unit; // острие чуть не доходит до предмета
  const scale = interpolate(enter, [0, 1], [0.55, 1]);
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, opacity: fade, overflow: "visible" }}>
      <g transform={`translate(${X.toFixed(1)} ${Y.toFixed(1)}) rotate(${angle.toFixed(2)}) translate(${(-back).toFixed(1)} 0) scale(${scale.toFixed(3)})`}>
        <polygon points={pts} fill="rgba(0,0,0,0.35)" transform={`translate(${6 * unit} ${10 * unit})`} />
        <polygon points={pts} fill={RED} stroke="#fff" strokeWidth={12 * unit} strokeLinejoin="round" paintOrder="stroke" />
      </g>
    </svg>
  );
};
