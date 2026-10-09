import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Шрифты канала из video-studio/assets/fonts (OFL, латиница + кириллица, переменная насыщенность) —
// те же, что в роликах и бренд-ките: Montserrat для заголовков, Manrope для текста.
const display = localFont({ src: "../../assets/fonts/Montserrat.woff2", weight: "100 900", variable: "--font-display", display: "swap" });
const body = localFont({ src: "../../assets/fonts/Manrope.woff2", weight: "200 800", variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Суть за минуту — панель",
  description: "Очередь роликов, календарь выхода, запуск сборки",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0D0A22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
