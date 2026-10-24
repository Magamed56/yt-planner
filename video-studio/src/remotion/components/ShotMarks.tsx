import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShotMarks } from "../../types";
import { FONT_DISPLAY, FONT_NUMBER } from "../fonts";

// Моушен поверх кадра плана (кинорежим): подписи со стрелкой к предметам и
// крупная цифра. Рамки предметов — от проверки кадра (visuals/review.ts), в
// долях картинки. Подписи кладутся в тот же трансформ камеры, что и картинка
// (MediaLayer → overlay), поэтому едут вместе с предметом; цифра — поверх кадра.
// Всё выше зоны субтитров (≈ 66–80 % высоты) — её не перекрываем.

const YELLOW = "#FFD84D";
const INK = "#111111";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const LABEL_MAX_Y = 0.6; // ниже — субтитры
const LABEL_MIN_Y = 0.1;

export const CalloutLayer: React.FC<{ callouts: ShotMarks["callouts"]; durationInFrames: number }> = ({ callouts, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const unit = Math.min(W, H) / 1080;
  const fade = interpolate(frame, [durationInFrames - 7, durationInFrames - 1], [1, 0], clamp);
  return (
    <>
      {callouts.map((c, k) => {
        const f = frame - c.at;
        if (f < 0) return null;
        const cx = (c.box.x + c.box.w / 2) * W;
        const cy = (c.box.y + c.box.h / 2) * H;
        // Крупный предмет (человек во весь рост) — кольцо вокруг его середины, а не на полкадра.
        const rx = Math.min(W * 0.26, Math.max(70 * unit, (c.box.w * W) / 2 + 26 * unit));
        const ry = Math.min(H * 0.15, Math.max(70 * unit, (c.box.h * H) / 2 + 26 * unit));
        const draw = interpolate(f, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        const pop = spring({ frame: f - 7, fps, config: { damping: 12, stiffness: 190, mass: 0.6 } });
        const len = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) * 1.02;
        // Подпись — в сторону, где больше места; не влезает сбоку — над рамкой.
        const fontSize = 46 * unit;
        const lw = c.label.length * fontSize * 0.6 + 56 * unit;
        const lh = fontSize * 1.25 + 26 * unit;
        const right = cx < W / 2;
        let lx = right ? cx + rx + 54 * unit : cx - rx - 54 * unit - lw;
        let ly = cy - lh / 2;
        let ax = right ? cx + rx : cx - rx; // откуда идёт выноска (край рамки)
        let ay = cy;
        if (lx < 36 * unit || lx + lw > W - 36 * unit) {
          lx = Math.min(W - 36 * unit - lw, Math.max(36 * unit, cx - lw / 2));
          ly = cy - ry - 70 * unit - lh;
          ax = cx;
          ay = cy - ry;
        }
        ly = Math.min(LABEL_MAX_Y * H - lh, Math.max(LABEL_MIN_Y * H, ly));
        const bx = lx + (ax <= lx ? 0 : ax >= lx + lw ? lw : lw / 2);
        const by = ly + (ay <= ly ? 0 : ay >= ly + lh ? lh : lh / 2);
        const line = interpolate(f, [6, 14], [0, 1], clamp);
        return (
          <React.Fragment key={k}>
            <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: fade }}>
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={18 * unit} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} strokeLinecap="round" />
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={YELLOW} strokeWidth={9 * unit} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} strokeLinecap="round" />
              <line x1={ax} y1={ay} x2={ax + (bx - ax) * line} y2={ay + (by - ay) * line} stroke="rgba(0,0,0,0.45)" strokeWidth={14 * unit} strokeLinecap="round" />
              <line x1={ax} y1={ay} x2={ax + (bx - ax) * line} y2={ay + (by - ay) * line} stroke={YELLOW} strokeWidth={7 * unit} strokeLinecap="round" />
            </svg>
            <div
              style={{
                position: "absolute",
                left: lx,
                top: ly,
                height: lh,
                padding: `0 ${28 * unit}px`,
                display: "flex",
                alignItems: "center",
                borderRadius: lh / 2,
                background: "#ffffff",
                color: INK,
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                fontSize,
                whiteSpace: "nowrap",
                boxShadow: `0 ${8 * unit}px ${26 * unit}px rgba(0,0,0,0.35), inset 0 0 0 ${5 * unit}px ${YELLOW}`,
                transform: `scale(${interpolate(pop, [0, 1], [0.4, 1])})`,
                transformOrigin: ax <= lx ? "0% 50%" : ax >= lx + lw ? "100% 50%" : "50% 100%",
                opacity: Math.min(fade, interpolate(f, [6, 9], [0, 1], clamp)),
              }}
            >
              {c.label}
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

// Крупная цифра или дата: «влетает» с отскоком на словах, где её произносят.
export const StickerLayer: React.FC<{ sticker: NonNullable<ShotMarks["sticker"]>; durationInFrames: number }> = ({ sticker, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const unit = Math.min(W, H) / 1080;
  const f = frame - sticker.at;
  if (f < 0) return null;
  const pop = spring({ frame: f, fps, config: { damping: 9, stiffness: 170, mass: 0.7 } });
  const fade = interpolate(frame, [durationInFrames - 7, durationInFrames - 1], [1, 0], clamp);
  const drift = interpolate(f, [0, 90], [0, -14 * unit], clamp);
  const fontSize = (sticker.text.length > 5 ? 150 : 200) * unit;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: (sticker.place === "top" ? 0.12 : 0.4) * H,
        display: "flex",
        justifyContent: "center",
        transform: `translateY(${drift}px) rotate(${interpolate(pop, [0, 1], [-12, -4])}deg) scale(${interpolate(pop, [0, 1], [0.3, 1])})`,
        opacity: Math.min(fade, interpolate(f, [0, 3], [0, 1], clamp)),
      }}
    >
      <span
        style={{
          fontFamily: FONT_NUMBER,
          fontWeight: 900,
          fontSize,
          lineHeight: 1,
          color: YELLOW,
          WebkitTextStroke: `${12 * unit}px ${INK}`,
          paintOrder: "stroke fill",
          textShadow: `0 ${10 * unit}px ${30 * unit}px rgba(0,0,0,0.45)`,
          letterSpacing: "-0.02em",
        }}
      >
        {sticker.text}
      </span>
    </div>
  );
};
