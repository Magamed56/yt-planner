// Кадры планов кинорежима (VideoScript.mode = "cinematic"): на каждый план —
// AI-картинка в общем стиле ролика. Это тот же findVisual, только источники —
// генерация из VISUALS (cloudflare), а промпт — план + style.
// Настоящая съёмка — только по просьбе сценариста: shot.footage (видео стоков) и
// shot.photo (фото Wikimedia Commons / Openverse) ищутся первыми, с проверкой «по
// теме» (судья Claude); не нашлось — кадр рисуется по prompt, как обычно.
// Повторный запуск берёт кадр из манифеста, пока не изменились итоговый промпт
// (план, крупность, герой, стиль, ориентация), запросы съёмки, формат и генераторы.

import type { VisualResult } from "../contracts";
import type { Format, SceneShot, ScriptScene, VisualStyle } from "../../types";
import { findVisual, parseVisualsList, VISUAL_PROVIDERS } from "./index";
import { reusableEntry, type ManifestEntry } from "./manifest";
import { completePrompt, imagePromptFor, shotImagePrompt, styleText } from "./query";
import type { Env, VisualDeps, VisualProvider } from "./types";

// Имя кадра плана: s3-k2 → visuals/s3-k2.jpg (и ключ в манифесте).
export const shotId = (sceneId: string, index: number): string => `${sceneId}-k${index + 1}`;

// Псевдосцена плана для findVisual: id — имя файла, imagePrompt — промпт плана
// (полный — как есть, иначе с крупностью и героем; стиль добавит генератор).
export function shotScene(scene: ScriptScene, shot: SceneShot, index: number, complete = false): ScriptScene {
  return { id: shotId(scene.id, index), kind: "media", narration: scene.narration, onScreen: scene.onScreen, imagePrompt: complete ? shot.prompt : shotImagePrompt(shot) };
}

// Псевдосцена настоящей съёмки: запрос — footage/photo плана, а narration и prompt —
// контекст судьи Claude: подходит ли видео или фото к этому месту рассказа.
export function realShotScene(scene: ScriptScene, shot: SceneShot, index: number, query: string): ScriptScene {
  return { id: shotId(scene.id, index), kind: "media", narration: scene.narration, onScreen: scene.onScreen, visualQuery: query, imagePrompt: shot.prompt };
}

// Откуда кадр плана — по префиксу id кандидата (pexels:video:…, wikimedia:…, cloudflare:…).
// Проверка кадров зрением и перегенерация — только для рисованных (kind "ai").
export function shotSource(candidateId: string | null | undefined): VisualProvider["kind"] | null {
  const name = candidateId?.split(":")[0] ?? "";
  return VISUAL_PROVIDERS[name]?.kind ?? null;
}

const quiet = { info: () => {}, warn: () => {} };
const aiProviders = (env: Env): string => parseVisualsList(env.VISUALS, quiet).filter((p) => p.kind === "ai").map((p) => p.name).join(",");

export function shotVisualKey(scene: ScriptScene, shot: SceneShot, index: number, format: Format, env: Env, style?: string, opts: { complete?: boolean; salt?: string } = {}): string {
  const model = env.CLOUDFLARE_IMAGE_MODEL?.trim();
  return JSON.stringify({
    shot: 1,
    p: (opts.complete ? completePrompt(shot.prompt) : imagePromptFor(shotScene(scene, shot, index), format, style ?? env.VISUALS_STYLE)) ?? "",
    format,
    ai: aiProviders(env),
    ...(model ? { cfm: model } : {}),
    ...(opts.salt ? { salt: opts.salt } : {}),
    // Только у планов со съёмкой: ключи прежних (рисованных) кадров не меняются.
    ...(shot.footage || shot.photo ? { real: [shot.footage ?? "", shot.photo ?? ""] } : {}),
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
  complete?: boolean; // shotPrompts "complete": промпт плана — полный, стиль не дописывается
}

export interface ShotVisualsResult {
  results: VisualResult[]; // по порядку shots; без кадра — { type: "none" }
  entries: Record<string, ManifestEntry>; // для нового манифеста
  reused: number; // взято из прошлого запуска
  searched: number; // подобрано заново (запросы к генераторам — только тут)
}

export async function findShotVisuals(input: ShotVisualsInput, overrides: Partial<VisualDeps> = {}): Promise<ShotVisualsResult> {
  const env = overrides.env ?? process.env;
  const style = input.complete ? undefined : styleText(input.style);
  const out: ShotVisualsResult = { results: [], entries: {}, reused: 0, searched: 0 };
  for (const [k, shot] of input.shots.entries()) {
    const id = shotId(input.scene.id, k);
    // Повтор кадра другого плана — картинку подставит make после всех сцен (resolveReuse).
    if (shot.reuse) {
      out.results.push({ visual: { type: "none" }, credit: null });
      continue;
    }
    const key = shotVisualKey(input.scene, shot, k, input.format, env, style, { complete: input.complete });
    const old = reusableEntry(input.prev[id], key, input.publicDir, 0);
    if (old) {
      out.results.push(old.result);
      out.entries[id] = old;
      out.reused++;
      continue;
    }
    const before = new Set(input.usedIds);
    let r: VisualResult = { visual: { type: "none" }, credit: null };
    for (const [only, query] of [["footage", shot.footage], ["photo", shot.photo]] as const) {
      if (!query) continue;
      r = await findVisual(
        realShotScene(input.scene, shot, k, query),
        // Видео короче плана крутится по кругу — просим хотя бы его длину.
        { format: input.format, publicDir: input.publicDir, sceneIndex: input.sceneIndex, minDurationSec: Math.min(6, shot.seconds ?? 3), usedIds: input.usedIds, only, topic: input.topic },
        overrides,
      );
      if (r.visual.type !== "none") break;
    }
    if (r.visual.type === "none") {
      r = await findVisual(
        shotScene(input.scene, shot, k, input.complete),
        { format: input.format, publicDir: input.publicDir, sceneIndex: input.sceneIndex, minDurationSec: 0, usedIds: input.usedIds, aiOnly: true, style, topic: input.topic, rawPrompt: input.complete },
        overrides,
      );
    }
    out.searched++;
    out.entries[id] = { key, result: r, candidateId: [...input.usedIds].find((x) => !before.has(x)) ?? null, minDurationSec: 0 };
    out.results.push(r);
  }
  return out;
}

// Новая попытка кадра после проверки: тот же план с исправленным промптом
// (fixPrompt от проверки) и другим seed. Результат — в манифест под тем же id.
export async function regenerateShot(
  input: Omit<ShotVisualsInput, "shots" | "prev"> & { shot: SceneShot; index: number; salt: string },
  overrides: Partial<VisualDeps> = {},
): Promise<{ result: VisualResult; entry: ManifestEntry }> {
  const env = overrides.env ?? process.env;
  const style = input.complete ? undefined : styleText(input.style);
  const key = shotVisualKey(input.scene, input.shot, input.index, input.format, env, style, { complete: input.complete, salt: input.salt });
  const before = new Set(input.usedIds);
  // Свой файл (s3-k2-r1.jpg): прежний кадр остаётся, пока проверка не решит, какой лучше.
  const pseudo = { ...shotScene(input.scene, input.shot, input.index, input.complete), id: `${shotId(input.scene.id, input.index)}-${input.salt}` };
  const r = await findVisual(
    pseudo,
    { format: input.format, publicDir: input.publicDir, sceneIndex: input.sceneIndex, minDurationSec: 0, usedIds: input.usedIds, aiOnly: true, style, topic: input.topic, rawPrompt: input.complete, seedSalt: input.salt },
    overrides,
  );
  return { result: r, entry: { key, result: r, candidateId: [...input.usedIds].find((x) => !before.has(x)) ?? null, minDurationSec: 0 } };
}

// Бюджет новых картинок на ролик (VISUALS_AI_MAX_FRAMES, по умолчанию 16):
// лишние планы повторяют прошлый кадр своей сцены (reuse) — квоту одного
// ролика не съесть целиком. Возвращает сценарий с правками и их число.
export function capNewFrames<T extends { id: string; shots?: SceneShot[] }>(scenes: T[], max: number): { scenes: T[]; capped: number } {
  let fresh = 0;
  let capped = 0;
  const out = scenes.map((sc) => {
    if (!sc.shots?.length) return sc;
    let lastOwn: string | null = null;
    const shots = sc.shots.map((sh, k) => {
      if (sh.reuse) return sh;
      if (fresh < max) {
        fresh++;
        lastOwn = shotId(sc.id, k);
        return sh;
      }
      if (!lastOwn) return sh; // у сцены ещё нет своего кадра — этот план всё же нужен
      capped++;
      return { ...sh, reuse: lastOwn };
    });
    return { ...sc, shots };
  });
  return { scenes: out, capped };
}

// Повторы кадров (reuse): план получает картинку того плана, на который ссылается
// (по id вида s2-k1, в т. ч. из прошлых сцен); цепочки повторов разворачиваются.
export function resolveReuse<R>(scenes: { id: string; shots?: SceneShot[] }[], results: (R[] | null)[], isEmpty: (r: R) => boolean): (R[] | null)[] {
  const byId = new Map<string, R>();
  return scenes.map((sc, i) => {
    const list = results[i];
    if (!list || !sc.shots) return list;
    const out = list.map((r, k) => {
      const ref = sc.shots![k]?.reuse;
      const got = ref ? byId.get(ref) : undefined;
      const v = got !== undefined && isEmpty(r) ? got : r;
      if (!isEmpty(v)) byId.set(shotId(sc.id, k), v);
      return v;
    });
    return out;
  });
}
