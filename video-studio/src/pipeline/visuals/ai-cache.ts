// Общий кэш AI-кадров — между запусками и роликами, как кэш голоса
// (voice/shared-cache.ts). Манифест папки ролика (manifest.ts) живёт в out/,
// а out/ в Actions между запусками не сохраняется: пересборка того же
// сценария генерировала все кадры заново (прогоны 34 и 35 — по 16 кадров).
// Ключ — модель, размер, seed и промпт: тот же запрос даёт тот же кадр, где бы
// его ни попросили. В Actions папку хранит actions/cache (video-studio.yml).
//   VISUALS_AI_CACHE_DIR — папка кэша; без неё кэша нет (так офлайн-тесты не пишут в
//   проект). make сам ставит .cache/visuals-ai, если папка не задана.
//   VISUALS_AI_CACHE=off — не читать и не писать.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

export interface AiFrameKey {
  model: string;
  width: number;
  height: number;
  seed: number;
  prompt: string;
}

export function aiCacheDir(env: Env): string | null {
  const mode = (env.VISUALS_AI_CACHE ?? "").trim().toLowerCase();
  if (mode === "off" || mode === "0" || mode === "none") return null;
  const dir = env.VISUALS_AI_CACHE_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

export function aiFrameHash(k: AiFrameKey): string {
  return createHash("sha256").update(JSON.stringify({ v: 1, model: k.model, width: k.width, height: k.height, seed: k.seed, prompt: k.prompt })).digest("hex");
}

const EXTS = ["jpg", "png", "webp"] as const;

export function readAiFrame(env: Env, key: AiFrameKey): Buffer | null {
  const dir = aiCacheDir(env);
  if (!dir) return null;
  const h = aiFrameHash(key);
  for (const ext of EXTS) {
    const f = path.join(dir, `${h}.${ext}`);
    try {
      if (fs.existsSync(f)) return fs.readFileSync(f);
    } catch {
      return null; // битый файл или нет прав — генерируем заново
    }
  }
  return null;
}

// Кэш — подспорье: не записался (диск, права) — кадр всё равно уже есть.
export function writeAiFrame(env: Env, key: AiFrameKey, data: Buffer, ext: string): void {
  const dir = aiCacheDir(env);
  if (!dir || !(EXTS as readonly string[]).includes(ext)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const h = aiFrameHash(key);
    fs.writeFileSync(path.join(dir, `${h}.${ext}`), data);
    fs.writeFileSync(path.join(dir, `${h}.json`), JSON.stringify({ ...key, ext, createdAt: new Date().toISOString(), run: env.GITHUB_RUN_ID ?? null }));
  } catch {
    // без кэша — просто дороже следующий запуск
  }
}
