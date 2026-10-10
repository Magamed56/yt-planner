// Повторное использование визуала между запусками в одной папке ролика.
// После правки сценария (опечатка в narration) незачем заново ходить в стоки
// и генерацию: сцена, у которой не изменились запрос, промпт, тип, формат и
// настройки источников, берёт уже скачанный файл. Так не тратятся квоты
// (Pexels — 200 запросов в час, Cloudflare — суточные «нейроны»), не качаются
// заново клипы до 60 МБ, а уже просмотренные кадры не подменяются другими.
// Подобрать визуал заново — удалить out/<папка ролика>/public/visuals.

import fs from "node:fs";
import path from "node:path";
import type { VisualResult } from "../contracts";
import type { Format, ScriptScene } from "../../types";
import type { Env, VisualHints } from "./types";

export interface ManifestEntry {
  key: string; // входы подбора (см. visualKey)
  result: VisualResult;
  candidateId: string | null; // id клипа у источника — для usedIds (без повторов в ролике)
  minDurationSec: number; // сколько длилась сцена, когда клип подбирали
}

interface Manifest {
  version: 1;
  scenes: Record<string, ManifestEntry>;
}

const FILE = "manifest.json";

// Версия правил отбора (relevance.ts). Поменялась — старые подборы (до
// проверки «по теме» в них бывали гравюры и случайные совпадения слов)
// подбираются заново один раз; дальше снова берутся из манифеста.
// 3 — стоки: главный предмет сцены или половина слов сюжета (stockFit).
// 4 — причастие (wrinkled) и материал перед предметом (iron helmet) — не главный предмет.
export const PICK_RULES_VERSION = 4;

export function visualKey(scene: ScriptScene, format: Format, env: Env, hints: VisualHints = {}): string {
  const judge = (env.VISUALS_JUDGE ?? "").trim().toLowerCase();
  return JSON.stringify({
    kind: scene.kind,
    q: scene.visualQuery?.trim() ?? "",
    p: scene.imagePrompt?.trim() ?? "",
    format,
    visuals: (env.VISUALS ?? "").trim().toLowerCase(),
    prefer: (env.VISUALS_PREFER ?? "").trim().toLowerCase(),
    style: (env.VISUALS_STYLE ?? "").trim(),
    // Только когда включено — ключи старых манифестов остаются прежними.
    ...(hints.realFirst ? { real: 1 } : {}),
    rules: PICK_RULES_VERSION,
    ...(judge && judge !== "off" && judge !== "none" && judge !== "0" ? { judge, jm: (env.VISUALS_JUDGE_MODEL ?? "").trim() } : {}),
    ...((env.VISUALS_MIN_PHOTO_PX ?? "").trim() ? { px: env.VISUALS_MIN_PHOTO_PX!.trim() } : {}),
  });
}

export function readVisualsManifest(publicDir: string): Record<string, ManifestEntry> {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(publicDir, "visuals", FILE), "utf8")) as Manifest;
    return m?.version === 1 && m.scenes && typeof m.scenes === "object" ? m.scenes : {};
  } catch {
    return {}; // нет манифеста (первый запуск) или он битый — подбираем заново
  }
}

// Прошлый результат годится, если входы те же, файл на месте и клип не стал
// короче сцены из-за правки текста (раньше хватало — теперь закольцуется).
// «Без визуала» не переиспользуем: могли появиться ключи или квота.
export function reusableEntry(entry: ManifestEntry | undefined, key: string, publicDir: string, minDurationSec: number): ManifestEntry | null {
  if (!entry || entry.key !== key) return null;
  const v = entry.result?.visual;
  if (!v || v.type === "none" || typeof v.src !== "string") return null;
  if (!fs.existsSync(path.join(publicDir, ...v.src.split("/")))) return null;
  if (v.type === "video" && v.durationSec + 0.05 < minDurationSec && v.durationSec + 0.05 >= (entry.minDurationSec ?? 0)) return null;
  return entry;
}

// Новый манифест + уборка: файлы удалённых сцен и заменённого визуала
// стираем — public/ целиком копируется в бандл рендера.
export function writeVisualsManifest(publicDir: string, scenes: Record<string, ManifestEntry>): void {
  const dir = path.join(publicDir, "visuals");
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set([FILE]);
  for (const e of Object.values(scenes)) {
    const v = e.result.visual;
    if (v.type !== "none") keep.add(v.src.split("/").pop() ?? "");
  }
  for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ version: 1, scenes } satisfies Manifest, null, 1));
}
