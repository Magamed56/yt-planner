// Корень проекта video-studio — относительно него лежат models/, music/,
// assets/. Ищем вверх от этого файла package.json с нужным именем, чтобы
// не зависеть от того, из какой папки запущен CLI (на Windows часто «не из той»).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

export function projectRoot(): string {
  if (cached) return cached;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "video-studio") return (cached = dir);
      } catch {
        // битый package.json — ищем дальше
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return (cached = process.cwd());
}

// Путь из переменной окружения. Заданный пользователем относительный путь —
// от текущей папки (как привычно в командной строке), значение по умолчанию —
// от корня проекта.
export function envPath(name: string, fallbackRelative: string): string {
  const v = process.env[name]?.trim();
  if (v) return path.resolve(v);
  return path.join(projectRoot(), fallbackRelative);
}
