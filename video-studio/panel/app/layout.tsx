import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LangNavProvider } from "@/components/LangNav";
import { CHANNEL_NAME } from "@/lib/channel-name";
import { NAV_LANGS } from "@/lib/lang-channels";
import "./globals.css";

// Шрифты канала из video-studio/assets/fonts (OFL, латиница + кириллица, переменная насыщенность) —
// те же, что в роликах и бренд-ките: Montserrat для заголовков, Manrope для текста.
const display = localFont({ src: "../../assets/fonts/Montserrat.woff2", weight: "100 900", variable: "--font-display", display: "swap" });
const body = localFont({ src: "../../assets/fonts/Manrope.woff2", weight: "200 800", variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Суть за минуту — панель",
  description: "Очередь роликов, календарь выхода, запуск сборки",
  robots: { index: false, follow: false },
  // Приложение с экрана «Домой»: своё имя под иконкой и строка статуса поверх тёмной шапки.
  // iOS читает эти теги при установке — если ничего не поменялось, иконку надо добавить заново.
  appleWebApp: { capable: true, title: CHANNEL_NAME, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover — страница под вырезом и полоской «Домой»; без него env(safe-area-inset-*) в CSS равны 0
  // и нижнее меню в приложении с экрана «Домой» уходит под полоску.
  viewportFit: "cover",
  themeColor: "#0D0A22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${display.variable} ${body.variable}`}>
      <body>
        {/* Пункты меню каналов на других языках — из channels/<язык>.json, вшитых при сборке. */}
        <LangNavProvider langs={NAV_LANGS}>{children}</LangNavProvider>
      </body>
    </html>
  );
}
