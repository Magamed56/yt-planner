import React from "react";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { withAlpha, type Theme } from "../theme";
import { BRAND, splitName } from "./data";

// Общие «кирпичи» бренд-картинок: словесный знак, градиентный текст, плашка.
// Те же шрифты и акцент, что в роликах: Montserrat 900 капсом + жёлто-оранжевый
// градиент маркера, — чтобы канал узнавался по любой картинке.

export const gradientText = (theme: Theme, angle = 100): React.CSSProperties => ({
  background: `linear-gradient(${angle}deg, ${theme.accent} 0%, ${theme.accent} 35%, ${theme.accent2} 100%)`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  // text-shadow поверх clip-текста грязнит градиент — тень даём фильтром
  filter: `drop-shadow(0 0.04em 0.12em ${withAlpha(theme.accent2, 0.35)})`,
});

// «НЕЙРО» белым + «ФАКТ» градиентом. letter-spacing чуть отрицательный, как
// в заголовках роликов; nowrap — название никогда не переносится.
export const Wordmark: React.FC<{ fontSize: number; theme?: Theme; style?: React.CSSProperties }> = ({ fontSize, theme = BRAND.theme, style }) => {
  const [a, b] = splitName(BRAND.name);
  return (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        whiteSpace: "nowrap",
        color: theme.text,
        ...style,
      }}
    >
      <span style={{ textShadow: `0 0.04em 0.16em rgba(0,0,0,0.45)` }}>{a}</span>
      <span style={gradientText(theme)}>{b}</span>
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
      background: filled
        ? `linear-gradient(100deg, ${theme.accent} 0%, ${theme.accent2} 130%)`
        : `linear-gradient(145deg, ${withAlpha(theme.text, 0.14)} 0%, ${withAlpha(theme.text, 0.05)} 100%)`,
      border: filled ? "none" : `${Math.max(1.5, fontSize * 0.05)}px solid ${withAlpha(theme.text, 0.22)}`,
      boxShadow: filled ? `0 ${fontSize * 0.25}px ${fontSize * 0.8}px ${withAlpha(theme.accent2, 0.35)}` : `0 ${fontSize * 0.25}px ${fontSize * 0.8}px rgba(0,0,0,0.3)`,
      ...style,
    }}
  >
    {icon}
    <span>{children}</span>
  </div>
);

export const bodyText = (fontSize: number, theme: Theme = BRAND.theme): React.CSSProperties => ({
  fontFamily: FONT_BODY,
  fontWeight: 600,
  fontSize,
  lineHeight: 1.3,
  color: theme.textDim,
});
