// Манифест приложения: с ним iPhone ставит панель на экран «Домой» как отдельное приложение —
// только там iOS 16.4+ разрешает уведомления. Иконки — знак канала из brand/avatar-youtube.png.
import type { MetadataRoute } from "next";
import { CHANNEL_NAME } from "@/lib/channel-name";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${CHANNEL_NAME} — панель`,
    short_name: CHANNEL_NAME,
    description: "Очередь роликов, календарь выхода, запуски и уведомления",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0D0A22",
    theme_color: "#0D0A22",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Знак лежит в безопасном круге (80 %) — Android может обрезать иконку по своей форме.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
