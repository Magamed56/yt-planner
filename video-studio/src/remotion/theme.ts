import type { ThemeName } from "../types";

// Палитры ролика. bg* — градиент фона, blob* — цвета «живых» пятен поверх
// него, accent — акцентные слова, иконки, счётчики; accent2 — второй акцент
// для градиентных заливок.
export interface Theme {
  bgFrom: string;
  bgTo: string;
  blobA: string;
  blobB: string;
  blobC: string;
  text: string;
  textDim: string;
  accent: string;
  accent2: string;
  accentInk: string; // цвет текста ПОВЕРХ заливки accent
  captionBg: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  midnight: {
    bgFrom: "#070816",
    bgTo: "#141238",
    blobA: "#5b3cff",
    blobB: "#00c2ff",
    blobC: "#ff3d8b",
    text: "#ffffff",
    textDim: "rgba(255,255,255,0.72)",
    accent: "#ffd23f",
    accent2: "#ff7a3d",
    accentInk: "#0b0b1a",
    captionBg: "rgba(8,8,24,0.55)",
  },
  sunset: {
    bgFrom: "#1a0612",
    bgTo: "#3a0d1f",
    blobA: "#ff5e3a",
    blobB: "#ffb347",
    blobC: "#c13584",
    text: "#fff7f0",
    textDim: "rgba(255,247,240,0.75)",
    accent: "#ffe066",
    accent2: "#ff5e3a",
    accentInk: "#1a0612",
    captionBg: "rgba(26,6,18,0.55)",
  },
  emerald: {
    bgFrom: "#03130f",
    bgTo: "#08291f",
    blobA: "#00d084",
    blobB: "#00a3ff",
    blobC: "#b4ff39",
    text: "#f2fff9",
    textDim: "rgba(242,255,249,0.74)",
    accent: "#b4ff39",
    accent2: "#00d084",
    accentInk: "#03130f",
    captionBg: "rgba(3,19,15,0.55)",
  },
  mono: {
    bgFrom: "#0a0a0a",
    bgTo: "#1c1c1c",
    blobA: "#3a3a3a",
    blobB: "#5a5a5a",
    blobC: "#2a2a2a",
    text: "#ffffff",
    textDim: "rgba(255,255,255,0.7)",
    accent: "#ff2e2e",
    accent2: "#ff8a00",
    accentInk: "#ffffff",
    captionBg: "rgba(0,0,0,0.55)",
  },
};

// Неизвестное имя темы (опечатка в JSON) не должно ронять рендер.
export function getTheme(name: ThemeName | string | undefined): Theme {
  return THEMES[(name ?? "midnight") as ThemeName] ?? THEMES.midnight;
}

// "#rrggbb" / "#rgb" + прозрачность → rgba(). Цвета палитры храним в hex,
// а полупрозрачные варианты (свечения, подложки) считаем на лету.
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const n = parseInt(hex.slice(0, 6), 16);
    if (!Number.isNaN(n)) return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map((p) => p.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}
