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
};

export default nextConfig;
