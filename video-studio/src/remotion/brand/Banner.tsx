import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Icon } from "../components/Icon";
import { FONT_BODY, FONT_DISPLAY, FontGate } from "../fonts";
import { withAlpha } from "../theme";
import { Pill, Wordmark } from "./atoms";
import { BrandMark } from "./BrandMark";
import { BRAND } from "./data";
import { NeuralField } from "./NeuralField";

// Баннер YouTube 2560×1440. Телевизор показывает всё изображение, компьютер —
// полосу 2560×423 по центру, планшет — 1855×423, телефон — 1546×423.
// Поэтому весь текст и знак — строго в центральной зоне 1546×423, а за её
// пределами только атмосфера: свечение и «нейросеть».

// Зоны показа баннера при исходнике 2560×1440 (по справке YouTube).
export const BANNER_ZONES = [
  { id: "tv", w: 2560, h: 1440, label: "ТВ: видно всё изображение 2560×1440" },
  { id: "desktop", w: 2560, h: 423, label: "Компьютер (макс.): 2560×423" },
  { id: "tablet", w: 1855, h: 423, label: "Планшет: 1855×423" },
  { id: "safe", w: 1546, h: 423, label: "Безопасная зона — телефон и все устройства: 1546×423" },
] as const;

const SAFE = { w: 1546, h: 423 };

export const Banner: React.FC<{ guides?: boolean }> = ({ guides = false }) => {
  const { width, height } = useVideoConfig();
  const t = BRAND.theme;
  // Масштаб от эталонных 2560×1440 — если кто-то зарегистрирует баннер другого размера.
  const u = width / 2560;
  const safe = { w: SAFE.w * u, h: SAFE.h * u, x: (width - SAFE.w * u) / 2, y: (height - SAFE.h * u) / 2 };
  const markSize = 300 * u;

  return (
    <AbsoluteFill style={{ backgroundColor: t.bgFrom }}>
      <FontGate>
        <Background theme={t} seed="neurofakt-banner" frameOverride={18} particles={false} />
        {/* Горизонтальная световая полоса — фокус на ту часть, что видна на компьютере */}
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(ellipse 46% 26% at 50% 50%, ${withAlpha(t.blobA, 0.42)} 0%, ${withAlpha(t.blobA, 0)} 100%)`,
              `radial-gradient(ellipse 22% 16% at 31% 50%, ${withAlpha(t.accent, 0.16)} 0%, ${withAlpha(t.accent, 0)} 100%)`,
            ].join(", "),
          }}
        />
        <NeuralField
          width={width}
          height={height}
          theme={t}
          seed="banner-net"
          cell={150 * u}
          lineWidth={2.2 * u}
          nodeSize={5 * u}
          clear={{ cx: width / 2, cy: height / 2, rx: safe.w * 0.52, ry: safe.h * 0.62, feather: 0.55 }}
        />

        {/* Содержимое — в безопасной зоне */}
        <div
          style={{
            position: "absolute",
            left: safe.x,
            top: safe.y,
            width: safe.w,
            height: safe.h,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 64 * u,
          }}
        >
          <div style={{ position: "relative", width: markSize, height: markSize, flex: "none" }}>
            <div
              style={{
                position: "absolute",
                inset: -markSize * 0.35,
                background: `radial-gradient(closest-side, ${withAlpha(t.accent, 0.3)} 0%, ${withAlpha(t.accent2, 0.1)} 50%, ${withAlpha(t.accent2, 0)} 100%)`,
              }}
            />
            <BrandMark size={markSize} theme={t} id="banner" glow={1} style={{ position: "relative" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 26 * u }}>
            <Wordmark fontSize={150 * u} />
            <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 58 * u, lineHeight: 1.15, color: t.text, opacity: 0.92, whiteSpace: "nowrap" }}>
              {BRAND.tagline}
            </div>
            <Pill fontSize={40 * u} filled icon={<Icon name="clock" size={44 * u} color={t.accentInk} strokeWidth={2.6} />} style={{ marginTop: 10 * u }}>
              {BRAND.schedule}
            </Pill>
          </div>
        </div>

        {guides ? <BannerGuides /> : null}
      </FontGate>
    </AbsoluteFill>
  );
};

// Разметка зон для самопроверки (banner-safe-preview.png): что видно где.
const BannerGuides: React.FC = () => {
  const { width, height } = useVideoConfig();
  const u = width / 2560;
  const colors: Record<string, string> = { tv: "#ffffff", desktop: "#00c2ff", tablet: "#b48cff", safe: BRAND.theme.accent };
  const stripH = 423 * u;
  const stripY = (height - stripH) / 2;
  return (
    <AbsoluteFill>
      {/* Затемняем то, что видно только на ТВ */}
      <div style={{ position: "absolute", left: 0, top: 0, width, height: stripY, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "absolute", left: 0, top: stripY + stripH, width, height: height - stripY - stripH, background: "rgba(0,0,0,0.5)" }} />
      {BANNER_ZONES.map((z, i) => {
        const w = z.w * u;
        const h = z.h * u;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        const c = colors[z.id];
        const inset = z.id === "tv" ? 6 * u : 0;
        return (
          <React.Fragment key={z.id}>
            <div
              style={{
                position: "absolute",
                left: x + inset,
                top: y + inset,
                width: w - inset * 2,
                height: h - inset * 2,
                border: `${(z.id === "safe" ? 6 : 4) * u}px dashed ${c}`,
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x + inset + 16 * u,
                // Подписи полос — над полосой (ступеньками), ТВ — в углу кадра
                top: z.id === "tv" ? inset + 16 * u : y - (4 - i) * 64 * u,
                padding: `${8 * u}px ${18 * u}px`,
                borderRadius: 10 * u,
                background: "rgba(0,0,0,0.75)",
                color: c,
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 30 * u,
                whiteSpace: "nowrap",
              }}
            >
              {z.label}
            </div>
          </React.Fragment>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 60 * u,
          textAlign: "center",
          color: "rgba(255,255,255,0.85)",
          fontFamily: FONT_BODY,
          fontWeight: 600,
          fontSize: 34 * u,
        }}
      >
        Превью для проверки. Загружать в YouTube нужно banner-youtube.png (без разметки).
      </div>
    </AbsoluteFill>
  );
};
