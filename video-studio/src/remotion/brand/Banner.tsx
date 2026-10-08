import React from "react";
import { AbsoluteFill, random, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { Icon, IconGradientDefs } from "../components/Icon";
import { FONT_BODY, FONT_DISPLAY, FontGate } from "../fonts";
import { withAlpha } from "../theme";
import { GlassTile, Pill, Wordmark } from "./atoms";
import { BrandMark, sparkPath } from "./BrandMark";
import { BRAND } from "./data";
import { Dial } from "./Dial";

// Баннер YouTube 2560×1440. Телевизор показывает всё изображение, компьютер —
// полосу 2560×423 по центру, планшет — 1855×423, телефон — 1546×423.
// Поэтому весь текст и знак — строго в центральной зоне 1546×423, иконки
// рубрик — в боковых «крыльях» полосы (видны на компьютере, на телефоне
// обрезаются без потерь), а за пределами полосы только атмосфера.

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
  const cx = width / 2;
  const cy = height / 2;
  // Иконки рубрик: по 4 на «крыло» сеткой 2×2. Крыло целиком снаружи зоны
  // планшета (1855): на планшете его нет совсем, а не обрезанная половина плитки.
  const tile = 108 * u;
  const tileGap = 28 * u;
  const tabletX = (width - 1855 * u) / 2;
  const wingCx = [tabletX / 2, width - tabletX / 2];
  const half = Math.ceil(BRAND.pillars.length / 2);
  const wings = [BRAND.pillars.slice(0, half), BRAND.pillars.slice(half)];

  return (
    <AbsoluteFill style={{ backgroundColor: t.bgFrom }}>
      <FontGate>
        <Background theme={t} seed="sut-banner" frameOverride={18} particles={false} />
        {/* Горизонтальная световая полоса — фокус на ту часть, что видна на компьютере */}
        <AbsoluteFill
          style={{
            background: [
              `radial-gradient(ellipse 48% 22% at 50% 50%, ${withAlpha(t.blobA, 0.45)} 0%, ${withAlpha(t.blobA, 0)} 100%)`,
              `radial-gradient(ellipse 16% 22% at ${(safe.x + markSize / 2) / width * 100}% 50%, ${withAlpha(t.accent, 0.16)} 0%, ${withAlpha(t.accent, 0)} 100%)`,
            ].join(", "),
          }}
        />
        {/* Циферблат вокруг всего содержимого: видно целиком на ТВ, на компьютере — «скобки» по бокам */}
        <Dial cx={cx} cy={cy} r={880 * u} theme={t} tick={22 * u} width={4 * u} alpha={0.17} progress={0} />
        <Dial cx={cx} cy={cy} r={1180 * u} theme={t} tick={14 * u} width={3 * u} alpha={0.08} ticks={120} />
        <Sparkles width={width} height={height} band={safe} u={u} />
        <div
          style={{
            position: "absolute",
            left: cx - 960 * u,
            top: cy - 960 * u,
            width: 1920 * u,
            height: 1920 * u,
            borderRadius: "50%",
            border: `${3 * u}px solid ${withAlpha(t.text, 0.06)}`,
          }}
        />

        {/* Крылья полосы: иконки рубрик */}
        <IconGradientDefs id="banner-icon" from={t.accent} to={t.accent2} />
        {wings.map((list, w) => (
          <div
            key={w}
            style={{
              position: "absolute",
              left: wingCx[w] - (tile * 2 + tileGap) / 2,
              top: cy - (tile * 2 + tileGap) / 2,
              width: tile * 2 + tileGap,
              display: "flex",
              flexWrap: "wrap",
              gap: tileGap,
            }}
          >
            {list.map((p) => (
              <GlassTile key={p.id} size={tile}>
                <Icon name={p.icon} size={tile * 0.52} color="url(#banner-icon)" strokeWidth={2.1} />
              </GlassTile>
            ))}
          </div>
        ))}

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
            gap: 56 * u,
          }}
        >
          <BrandMark size={markSize} theme={t} id="banner" glow={1} style={{ flex: "none" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 24 * u }}>
            <Wordmark fontSize={106 * u} />
            <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 52 * u, lineHeight: 1.15, color: t.text, opacity: 0.94, whiteSpace: "nowrap", marginTop: 6 * u }}>
              {BRAND.tagline}
            </div>
            <Pill fontSize={36 * u} filled icon={<Icon name="calendar-days" size={40 * u} color={t.accentInk} strokeWidth={2.6} />} style={{ marginTop: 8 * u }}>
              {BRAND.schedule}
            </Pill>
          </div>
        </div>

        {guides ? <BannerGuides /> : null}
      </FontGate>
    </AbsoluteFill>
  );
};

// Россыпь бледных искр (та же искра, что в знаке) — только вне полосы
// 423 px: атмосфера для ТВ, которая не мешает тексту на остальных экранах.
const Sparkles: React.FC<{ width: number; height: number; band: { y: number; h: number }; u: number }> = ({ width, height, band, u }) => {
  const t = BRAND.theme;
  const items: { x: number; y: number; r: number; a: number; warm: boolean }[] = [];
  for (let i = 0; items.length < 26 && i < 400; i++) {
    const x = random(`sp-x-${i}`) * width;
    const y = random(`sp-y-${i}`) * height;
    if (y > band.y - 60 * u && y < band.y + band.h + 60 * u) continue;
    if (items.some((o) => Math.hypot(o.x - x, o.y - y) < 230 * u)) continue;
    items.push({ x, y, r: (9 + random(`sp-r-${i}`) * 22) * u, a: 0.12 + random(`sp-a-${i}`) * 0.3, warm: random(`sp-w-${i}`) < 0.35 });
  }
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
      {items.map((o, i) => (
        <path key={i} d={sparkPath(o.x, o.y, o.r)} fill={o.warm ? t.accent : t.text} opacity={o.a} />
      ))}
    </svg>
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
