// Значки площадок для «Доски» — свои SVG, без пакетов и внешних картинок: YouTube (русский канал),
// флаг (английский канал), Instagram, TikTok. Цвета — фирменные цвета площадок.
"use client";
import { useId } from "react";
import type { ZoneKey } from "@/lib/board";

export function ZoneIcon({ zone, size = 22 }: { zone: ZoneKey; size?: number }) {
  // id градиента — свой у каждого значка: с общим id скрытый первый экземпляр гасил бы остальные.
  const id = `bi${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (zone === "ru")
    return (
      <svg {...common}>
        <rect x="1.5" y="5" width="21" height="14" rx="4.5" fill="#ff0033" />
        <path d="M10 9v6l5.2-3z" fill="#fff" />
      </svg>
    );
  if (zone === "en")
    return (
      <svg {...common}>
        <defs>
          <clipPath id={id}>
            <rect x="1.5" y="5" width="21" height="14" rx="3" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id})`}>
          <rect x="1.5" y="5" width="21" height="14" fill="#fff" />
          {[0, 2, 4, 6].map((i) => (
            <rect key={i} x="1.5" y={5 + i * 2} width="21" height="1.1" fill="#b22234" />
          ))}
          <rect x="1.5" y="12.4" width="21" height="1.1" fill="#b22234" />
          <rect x="1.5" y="16.4" width="21" height="1.1" fill="#b22234" />
          <rect x="1.5" y="5" width="9.5" height="7.5" fill="#3c3b6e" />
        </g>
      </svg>
    );
  if (zone === "instagram")
    return (
      <svg {...common}>
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#feda75" />
            <stop offset="0.3" stopColor="#fa7e1e" />
            <stop offset="0.6" stopColor="#d62976" />
            <stop offset="1" stopColor="#4f5bd5" />
          </linearGradient>
        </defs>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill={`url(#${id})`} />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="2" />
        <circle cx="17.2" cy="6.8" r="1.3" fill="#fff" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#111" />
      <path d="M13.6 5.5v8.4a2.6 2.6 0 1 1-2.6-2.6" fill="none" stroke="#25f4ee" strokeWidth="2.2" strokeLinecap="round" transform="translate(-0.7 -0.5)" />
      <path d="M13.6 5.5v8.4a2.6 2.6 0 1 1-2.6-2.6M13.6 5.5c.4 2 1.8 3.3 3.8 3.5" fill="none" stroke="#fe2c55" strokeWidth="2.2" strokeLinecap="round" transform="translate(0.7 0.5)" />
      <path d="M13.6 5.5v8.4a2.6 2.6 0 1 1-2.6-2.6M13.6 5.5c.4 2 1.8 3.3 3.8 3.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// Стикер: квадрат с загнутым углом и плюсом — кнопка «+ Стикер» и шапка его листа.
export function StickerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false}>
      <path d="M4 4h16v10l-6 6H4z" fill="var(--accent)" />
      <path d="M14 20v-6h6" fill="var(--accent-2)" />
      <path d="M10 8v6M7 11h6" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
