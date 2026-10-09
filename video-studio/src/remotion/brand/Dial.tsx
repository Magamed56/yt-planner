import React from "react";
import { withAlpha, type Theme } from "../theme";

// Циферблат секундомера: 60 рисок, каждая пятая длиннее, часть дуги
// «пройдена» акцентом. Фоновый мотив бренда (минута = 60 делений) —
// всегда бледный, чтобы не спорить с текстом.
export const Dial: React.FC<{
  cx: number;
  cy: number;
  r: number; // внешний радиус рисок, px
  theme: Theme;
  tick: number; // длина короткой риски, px
  width: number; // толщина риски, px
  alpha?: number;
  progress?: number; // 0..1 — сколько делений подсвечено акцентом (от 12 часов по часовой)
  ticks?: number;
}> = ({ cx, cy, r, theme, tick, width, alpha = 0.16, progress = 0, ticks = 60 }) => {
  const lit = Math.round(ticks * progress);
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
      {new Array(ticks).fill(0).map((_, i) => {
        const a = (i / ticks) * Math.PI * 2;
        const major = i % 5 === 0;
        const len = major ? tick * 2.2 : tick;
        const sx = Math.sin(a);
        const sy = -Math.cos(a);
        const on = i < lit;
        return (
          <line
            key={i}
            x1={cx + sx * r}
            y1={cy + sy * r}
            x2={cx + sx * (r - len)}
            y2={cy + sy * (r - len)}
            stroke={on ? withAlpha(theme.accent, Math.min(1, alpha * 4.5)) : withAlpha(theme.text, major ? alpha * 1.6 : alpha)}
            strokeWidth={major ? width * 1.5 : width}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};
