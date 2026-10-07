import React from "react";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { withAlpha, type Theme } from "../theme";
import { BRAND, splitName } from "./data";

// Общие «кирпичи» бренд-картинок: словесный знак, маркер, плашка.
// Те же шрифты и акцент, что в роликах: Montserrat 900 капсом + жёлто-оранжевый
// маркер под акцентным словом, — чтобы канал узнавался по любой картинке.

export const accentGradient = (theme: Theme, angle = 100): string => `linear-gradient(${angle}deg, ${theme.accent} 0%, ${theme.accent} 40%, ${theme.accent2} 140%)`;

// Слово на «маркере» — как highlight="marker" в KineticText роликов:
// чуть повёрнутая жёлтая плашка, тёмные буквы.
export const Marker: React.FC<{ children: React.ReactNode; fontSize: number; theme?: Theme; tilt?: number; style?: React.CSSProperties }> = ({
  children,
  fontSize,
  theme = BRAND.theme,
  tilt = -1.5,
  style,
}) => (
  <span style={{ position: "relative", display: "inline-block", padding: "0 0.16em", ...style }}>
    <span
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "-0.04em",
        bottom: "-0.06em",
        borderRadius: "0.12em",
        background: accentGradient(theme),
        transform: `rotate(${tilt}deg)`,
        boxShadow: `0 ${fontSize * 0.06}px ${fontSize * 0.3}px ${withAlpha(theme.accent2, 0.35)}`,
      }}
    />
    <span style={{ position: "relative", color: theme.accentInk, textShadow: "none" }}>{children}</span>
  </span>
);

// «СУТЬ» на маркере + «ЗА МИНУТУ» белым. nowrap — название никогда не переносится;
// stacked — вторая часть строкой ниже (для узких форматов).
export const Wordmark: React.FC<{ fontSize: number; theme?: Theme; stacked?: boolean; style?: React.CSSProperties }> = ({ fontSize, theme = BRAND.theme, stacked = false, style }) => {
  const [a, b] = splitName(BRAND.name);
  return (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize,
        lineHeight: 1.04,
        letterSpacing: "-0.015em",
        whiteSpace: "nowrap",
        color: theme.text,
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "baseline",
        gap: stacked ? fontSize * 0.1 : fontSize * 0.26,
        ...style,
      }}
    >
      <Marker fontSize={fontSize} theme={theme}>
        {a}
      </Marker>
      {b ? <span style={{ textShadow: `0 0.04em 0.16em rgba(0,0,0,0.45)` }}>{b}</span> : null}
    </div>
  );
};

// Плашка-«таблетка»: filled — залита акцентом (CTA), иначе — стекло.
export const Pill: React.FC<{
  children: React.ReactNode;
  fontSize: number;
  theme?: Theme;
  filled?: boolean;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, fontSize, theme = BRAND.theme, filled = false, icon, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: fontSize * 0.45,
      padding: `${fontSize * 0.42}px ${fontSize * 0.85}px`,
      borderRadius: fontSize * 2,
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize,
      lineHeight: 1.1,
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
      color: filled ? theme.accentInk : theme.text,
      background: filled ? accentGradient(theme) : `linear-gradient(145deg, ${withAlpha(theme.text, 0.14)} 0%, ${withAlpha(theme.text, 0.05)} 100%)`,
      border: filled ? "none" : `${Math.max(1.5, fontSize * 0.05)}px solid ${withAlpha(theme.text, 0.22)}`,
      boxShadow: filled ? `0 ${fontSize * 0.25}px ${fontSize * 0.8}px ${withAlpha(theme.accent2, 0.35)}` : `0 ${fontSize * 0.25}px ${fontSize * 0.8}px rgba(0,0,0,0.3)`,
      ...style,
    }}
  >
    {icon}
    <span>{children}</span>
  </div>
);

// Иконка в «стеклянном» скруглённом квадрате — как бейдж иконки в роликах.
export const GlassTile: React.FC<{ size: number; theme?: Theme; children: React.ReactNode; style?: React.CSSProperties }> = ({ size, theme = BRAND.theme, children, style }) => (
  <div
    style={{
      width: size,
      height: size,
      flex: "none",
      borderRadius: size * 0.26,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: `linear-gradient(145deg, ${withAlpha(theme.text, 0.16)} 0%, ${withAlpha(theme.text, 0.04)} 100%)`,
      border: `${Math.max(1.5, size * 0.018)}px solid ${withAlpha(theme.text, 0.2)}`,
      boxShadow: `0 ${size * 0.12}px ${size * 0.3}px rgba(0,0,0,0.35), inset 0 ${size * 0.02}px 0 ${withAlpha(theme.text, 0.12)}`,
      ...style,
    }}
  >
    {children}
  </div>
);

export const bodyText = (fontSize: number, theme: Theme = BRAND.theme): React.CSSProperties => ({
  fontFamily: FONT_BODY,
  fontWeight: 600,
  fontSize,
  lineHeight: 1.3,
  color: theme.textDim,
});
