import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticText } from "../components/KineticText";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { MAP_FLY, mapLandFrame } from "../lib/cues";
import { useLayout } from "../lib/layout";
import { formatLatLon, isLand, landSpans } from "../map/geo";
import { withAlpha } from "../theme";
import { clamp, type SceneProps } from "./common";

// Сцена «место на карте»: точечная карта мира (Natural Earth 110m, без тайлов
// и сети), камера пролетает от всего мира к месту, метка падает и пульсирует,
// рядом — подпись и координаты. Точки — постоянного экранного размера: при
// приближении сетка «пересобирается», грубый контур 1:110m так и не виден.

// Сколько градусов долготы помещается по ширине кадра на каждом приближении.
const SPAN: Record<"world" | "region" | "city", number> = { world: 360, region: 44, city: 9 };
const ease = Easing.inOut(Easing.cubic);

export const MapScene: React.FC<SceneProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = useLayout();
  const { content, unit } = layout;
  const shorts = layout.format === "shorts";
  const map = p.scene.map!;
  const zoom = map.zoom ?? "region";
  const lat1 = Math.max(-80, Math.min(80, map.lat));
  const lon1 = map.lon;

  // Камера: масштаб (пикселей на градус) по логарифму, центр — линейно.
  const t = zoom === "world" ? 1 : interpolate(frame, [MAP_FLY.start, MAP_FLY.start + MAP_FLY.length], [0, 1], { ...clamp, easing: ease });
  const k0 = width / SPAN.world;
  const k1 = width / SPAN[zoom];
  const k = k0 * Math.pow(k1 / k0, t);
  const cLat = interpolate(t, [0, 1], [zoom === "world" ? lat1 * 0.5 : lat1 * 0.35, zoom === "world" ? lat1 * 0.5 : lat1]);
  const cLon = lon1;
  // Местная равнопромежуточная проекция: по горизонтали × cos(широты) — у
  // Петербурга материки не «расплющены».
  const cosF = interpolate(t, [0, 1], [1, Math.cos((lat1 * Math.PI) / 180)]);
  // Куда на экране встаёт место: чуть ниже центра контентной зоны (сверху заголовок).
  const anchorX = width / 2;
  const anchorY = shorts ? content.y + content.h * 0.6 : content.y + content.h * 0.62;
  const toX = (lon: number) => anchorX + (lon - cLon) * k * cosF;
  const toY = (lat: number) => anchorY - (lat - cLat) * k;

  const markerX = toX(lon1);
  const markerY = toY(lat1);
  const step = Math.round(15 * unit);
  const dot = Math.max(3, Math.round(5.5 * unit));
  // Яркие точки — только вокруг метки (на виде всего мира круг шире).
  const near = Math.min(width, height) * interpolate(t, [0, 1], [0.3, 0.2]);

  // Точки суши — двумя путями (тусклые и яркие у метки): один SVG-элемент
  // вместо тысяч кружков; нулевой отрезок с круглым концом рисует точку.
  const { dim, bright } = useMemo(() => {
    let dimD = "";
    let brightD = "";
    for (let y = step / 2; y < height; y += step) {
      const lat = cLat + (anchorY - y) / k;
      if (lat > 84 || lat < -60) continue; // Антарктида и Арктика — только шум
      const spans = landSpans(lat);
      if (spans.length === 0) continue;
      for (let x = step / 2; x < width; x += step) {
        const lon = cLon + (x - anchorX) / (k * cosF);
        if (!isLand(spans, lon)) continue;
        const seg = `M${x.toFixed(1)} ${y.toFixed(1)}h0`;
        if (Math.hypot(x - markerX, y - markerY) < near) brightD += seg;
        else dimD += seg;
      }
    }
    return { dim: dimD, bright: brightD };
  }, [step, height, width, cLat, cLon, k, cosF, anchorX, anchorY, markerX, markerY, near]);

  const appear = interpolate(frame, [0, 8], [0, 1], clamp);
  const land = mapLandFrame(p.scene);
  const drop = spring({ frame: frame - land, fps, config: { damping: 11, stiffness: 170, mass: 0.7 } });
  const labelIn = spring({ frame: frame - land - 4, fps, config: { damping: 15, stiffness: 140 } });
  const pulse = (phase: number) => {
    const local = frame - land - phase;
    if (local < 0) return null;
    const c = (local % 36) / 36;
    return { r: (18 + 120 * Easing.out(Easing.quad)(c)) * unit, o: 0.55 * (1 - c) };
  };
  const rings = [0, 12, 24].map(pulse);
  const chipFont = Math.round((shorts ? 54 : 48) * unit);
  const coordFont = Math.round((shorts ? 30 : 28) * unit);
  // Подпись — над меткой; если метка у верха контента (или в горизонтальном
  // ролике, где сверху заголовок) — под ней.
  const labelAbove = shorts && markerY - content.y > 260 * unit;

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: appear }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <path d={dim} stroke={withAlpha(p.theme.text, 0.2)} strokeWidth={dot} strokeLinecap="round" fill="none" />
          <path d={bright} stroke={withAlpha(p.theme.accent, 0.75)} strokeWidth={dot * 1.15} strokeLinecap="round" fill="none" />
        </svg>
        {/* Виньетка: точки гаснут к краям кадра, взгляд — на метку */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 70% 55% at ${(markerX / width) * 100}% ${(markerY / height) * 100}%, rgba(0,0,0,0) 40%, ${withAlpha(p.theme.bgFrom, 0.75)} 100%)`,
          }}
        />
      </AbsoluteFill>
      {/* Метка: пульсирующие кольца + точка с белой обводкой, «падает» сверху */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {rings.map((r, i) => (r ? <circle key={i} cx={markerX} cy={markerY} r={r.r} fill="none" stroke={p.theme.accent} strokeWidth={4 * unit} opacity={r.o} /> : null))}
        <g transform={`translate(${markerX} ${markerY - (1 - drop) * 140 * unit}) scale(${Math.max(0, drop)})`} opacity={frame >= land ? 1 : 0}>
          <circle r={34 * unit} fill={withAlpha(p.theme.accent, 0.25)} />
          <circle r={16 * unit} fill={p.theme.accent} stroke="#ffffff" strokeWidth={5 * unit} />
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          left: markerX,
          top: labelAbove ? markerY - 64 * unit : markerY + 64 * unit,
          transform: `translate(-50%, ${labelAbove ? "-100%" : "0"}) scale(${interpolate(labelIn, [0, 1], [0.8, 1])})`,
          opacity: interpolate(labelIn, [0, 0.5], [0, 1], clamp),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10 * unit,
          maxWidth: content.w,
        }}
      >
        <div
          style={{
            padding: `${14 * unit}px ${30 * unit}px`,
            borderRadius: 999,
            background: `linear-gradient(100deg, ${p.theme.accent}, ${p.theme.accent2})`,
            color: p.theme.accentInk,
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: chipFont,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            boxShadow: `0 ${12 * unit}px ${40 * unit}px ${withAlpha(p.theme.accent, 0.35)}`,
          }}
        >
          {map.label}
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 700,
            fontSize: coordFont,
            color: withAlpha(p.theme.text, 0.85),
            whiteSpace: "nowrap",
            letterSpacing: "0.02em",
            padding: `${4 * unit}px ${14 * unit}px`,
            borderRadius: 999,
            background: withAlpha(p.theme.bgFrom, 0.7),
          }}
        >
          {formatLatLon(map.lat, map.lon)}
        </div>
      </div>
      <div style={{ position: "absolute", left: content.x, top: content.y, width: content.w }}>
        <KineticText
          text={p.scene.onScreen}
          theme={p.theme}
          box={{ w: content.w, h: content.h * (shorts ? 0.24 : 0.28) }}
          font={{ fontFamily: FONT_DISPLAY, fontWeight: 800, lineHeight: 1.08, letterSpacingEm: -0.02 }}
          maxFontSize={Math.round((shorts ? 96 : 92) * unit)}
          maxLines={3}
          align="left"
          scene={p.scene}
          mode="stagger"
          start={4}
          step={3}
          entrance="rise"
          highlight="underline"
        />
      </div>
    </AbsoluteFill>
  );
};
