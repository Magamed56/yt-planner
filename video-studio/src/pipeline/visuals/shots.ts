// Кадры планов кинорежима (VideoScript.mode = "cinematic"): на каждый план —
// AI-картинка в общем стиле ролика. Это тот же findVisual, только источники —
// генерация из VISUALS (cloudflare, pollinations), а промпт — план + style.
// Стоки здесь не берём: фото другого автора и света ломает единый стиль.
// Повторный запуск берёт кадр из манифеста, пока не изменились итоговый промпт
// (план, крупность, герой, стиль, ориентация), формат и генераторы.

import type { VisualResult } from "../contracts";
import type { Format, SceneShot, ScriptScene, VisualStyle } from "../../types";
import { findVisual, parseVisualsList } from "./index";
import { reusableEntry, type ManifestEntry } from "./manifest";
import { imagePromptFor, shotImagePrompt, styleText } from "./query";
import type { Env, VisualDeps } from "./types";

// Имя кадра плана: s3-k2 → visuals/s3-k2.jpg (и ключ в манифесте).
export const shotId = (sceneId: string, index: number): string => `${sceneId}-k${index + 1}`;

// Псевдосцена плана для findVisual: id — имя файла, imagePrompt — промпт плана.
export function shotScene(scene: ScriptScene, shot: SceneShot, index: number): ScriptScene {
  return { id: shotId(scene.id, index), kind: "media", narration: scene.narration, onScreen: scene.onScreen, imagePrompt: shotImagePrompt(shot) };
}

const quiet = { info: () => {}, warn: () => {} };
const aiProviders = (env: Env): string => parseVisualsList(env.VISUALS, quiet).filter((p) => p.kind === "ai").map((p) => p.name).join(",");

export function shotVisualKey(scene: ScriptScene, shot: SceneShot, index: number, format: Format, env: Env, style?: string): string {
  const model = env.CLOUDFLARE_IMAGE_MODEL?.trim();
  return JSON.stringify({
    shot: 1,
    p: imagePromptFor(shotScene(scene, shot, index), format, style ?? env.VISUALS_STYLE) ?? "",
    format,
    ai: aiProviders(env),
    ...(model ? { cfm: model } : {}),
  });
}

export interface ShotVisualsInput {
  scene: ScriptScene;
  shots: SceneShot[];
  format: Format;
  publicDir: string;
  sceneIndex: number;
  usedIds: Set<string>;
  prev: Record<string, ManifestEntry>; // манифест прошлого запуска этой папки
  style?: VisualStyle;
  topic?: string;
}

export interface ShotVisualsResult {
  results: VisualResult[]; // по порядку shots; без кадра — { type: "none" }
  entries: Record<string, ManifestEntry>; // для нового манифеста
  reused: number; // взято из прошлого запуска
  searched: number; // подобрано заново (запросы к генераторам — только тут)
}

export async function findShotVisuals(input: ShotVisualsInput, overrides: Partial<VisualDeps> = {}): Promise<ShotVisualsResult> {
  const env = overrides.env ?? process.env;
  const style = styleText(input.style);
  const out: ShotVisualsResult = { results: [], entries: {}, reused: 0, searched: 0 };
  for (const [k, shot] of input.shots.entries()) {
    const id = shotId(input.scene.id, k);
    const key = shotVisualKey(input.scene, shot, k, input.format, env, style);
    const old = reusableEntry(input.prev[id], key, input.publicDir, 0);
    if (old) {
      out.results.push(old.result);
      out.entries[id] = old;
      out.reused++;
      continue;
    }
    const before = new Set(input.usedIds);
    const r = await findVisual(
      shotScene(input.scene, shot, k),
      { format: input.format, publicDir: input.publicDir, sceneIndex: input.sceneIndex, minDurationSec: 0, usedIds: input.usedIds, aiOnly: true, style, topic: input.topic },
      overrides,
    );
    out.searched++;
    out.entries[id] = { key, result: r, candidateId: [...input.usedIds].find((x) => !before.has(x)) ?? null, minDurationSec: 0 };
    out.results.push(r);
  }
  return out;
}
