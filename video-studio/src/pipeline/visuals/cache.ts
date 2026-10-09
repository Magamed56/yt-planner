// Простой дисковый кэш JSON-ответов. Нужен в первую очередь Pixabay: их
// правила API требуют кэшировать ответы 24 часа. Ключ API в ключ кэша не
// входит. Кэш — <project>/.cache/<namespace>/ (или VISUALS_CACHE_DIR).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DAY_MS = 24 * 60 * 60 * 1000;

// Корень проекта — ближайший вверх package.json с именем video-studio.
let root: string | null = null;
export function projectRoot(): string {
  if (root) return root;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "video-studio") return (root = dir);
      } catch {
        // битый package.json — ищем выше
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return (root = process.cwd());
}

export function defaultCacheDir(env: Record<string, string | undefined>): string {
  const v = env.VISUALS_CACHE_DIR?.trim();
  return v ? path.resolve(v) : path.join(projectRoot(), ".cache");
}

interface Entry<T> {
  savedAt: number;
  data: T;
}

export async function cachedJson<T>(
  dir: string,
  namespace: string,
  key: string,
  ttlMs: number,
  now: () => number,
  load: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  const file = path.join(dir, namespace, `${createHash("sha1").update(key).digest("hex")}.json`);
  try {
    const entry = JSON.parse(await readFile(file, "utf8")) as Entry<T>;
    if (typeof entry.savedAt === "number" && now() - entry.savedAt < ttlMs) return { data: entry.data, fromCache: true };
  } catch {
    // нет файла или он битый — грузим заново
  }
  const data = await load();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ savedAt: now(), data } satisfies Entry<T>));
  } catch {
    // кэш — не критичен (например, папка только для чтения)
  }
  return { data, fromCache: false };
}
