import path from "node:path";
import type { NextConfig } from "next";

// Панель берёт общий код video-studio (../src/pipeline: поиск роликов как у youtube-fill,
// слоты расписания, план) — поэтому корень для Turbopack и трассировки файлов — папка
// video-studio, а не panel. В общем коде только встроенные модули Node, без npm-пакетов.
const studioRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: { root: studioRoot },
  outputFileTracingRoot: studioRoot,
  poweredByHeader: false,
  // Вкладки, открытые за последние 60 с, при возврате показываются сразу из памяти браузера, без
  // нового похода в GitHub и YouTube; после любого действия страница обновляется (router.refresh).
  experimental: { staleTimes: { dynamic: 60, static: 300 } },
  // «План» убран — порядок выхода теперь в календаре; старые ссылки и значки ведут туда.
  async redirects() {
    return [{ source: "/plan", destination: "/?view=calendar", permanent: false }];
  },
};

export default nextConfig;
