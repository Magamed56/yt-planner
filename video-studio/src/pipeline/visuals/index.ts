// Визуал сцены (контракт — src/pipeline/contracts.ts):
//   findVisual(scene, ctx) → { visual, credit }
// Источники — VISUALS (порядок через запятую, по умолчанию
// pexels,pixabay,cloudflare; none — без визуала). Источник без ключа тихо
// пропускается (одно сообщение за запуск). Файл всегда скачивается в
// ctx.publicDir/visuals/<id сцены>.<ext> — никаких ссылок на чужие серверы.
// Для одной сцены функция НИКОГДА не бросает: при неудаче — { type: "none" },
// и композиция покажет чистую моушен-графику.

import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { Credit, VisualContext, VisualResult } from "../contracts";
import type { SceneVisual, ScriptScene } from "../../types";
import { defaultCacheDir } from "./cache";
import { downloadToFile } from "./http";
import { cloudflareProvider } from "./providers/cloudflare";
import { pexelsProvider } from "./providers/pexels";
import { pixabayProvider } from "./providers/pixabay";
import { pollinationsProvider } from "./providers/pollinations";
import { buildQueries } from "./query";
import { envNumber, MB } from "./util";
import { VisualError, type Candidate, type Stage, type VisualDeps, type VisualProvider } from "./types";

export const VISUAL_PROVIDERS: Record<string, VisualProvider> = {
  pexels: pexelsProvider,
  pixabay: pixabayProvider,
  cloudflare: cloudflareProvider,
  pollinations: pollinationsProvider,
};

export const DEFAULT_VISUALS = "pexels,pixabay,cloudflare";

const NONE: VisualResult = { visual: { type: "none" }, credit: null };

// Состояние на процесс: какие сообщения уже показаны и какие источники
// выключены (кончилась квота, неверный ключ).
const noticed = new Set<string>();
const disabled = new Map<string, string>();

export function resetVisualsState(): void {
  noticed.clear();
  disabled.clear();
}

function once(key: string, fn: () => void): void {
  if (noticed.has(key)) return;
  noticed.add(key);
  fn();
}

export function parseVisualsList(raw: string | undefined, log: VisualDeps["log"]): VisualProvider[] {
  const v = (raw ?? DEFAULT_VISUALS).trim().toLowerCase() || DEFAULT_VISUALS;
  if (v === "none" || v === "off" || v === "0") return [];
  const out: VisualProvider[] = [];
  for (const name of v.split(/[,;\s]+/).filter(Boolean)) {
    if (name === "none") continue;
    const p = VISUAL_PROVIDERS[name];
    if (!p) {
      once(`unknown:${name}`, () => log.warn(`[визуал] Неизвестный источник «${name}» в VISUALS — пропускаю. Доступно: ${Object.keys(VISUAL_PROVIDERS).join(", ")}, none.`));
      continue;
    }
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

interface Step {
  provider: VisualProvider;
  stage: Stage;
  key: string;
}

// Подряд идущие стоковые источники проходим «по этапам»: сначала видео у
// всех, потом запасные варианты (фото, кроп) — живое видео лучше фото, даже
// если фото нашлось у источника, стоящего раньше. Порядок VISUALS при этом
// сохраняется, а AI-генерация остаётся там, где её поставил пользователь.
export function buildPlan(providers: { provider: VisualProvider; key: string }[], format: VisualContext["format"], preferImages: boolean): Step[] {
  const plan: Step[] = [];
  let group: { provider: VisualProvider; key: string }[] = [];
  const flush = () => {
    for (const rank of [0, 1] as const) {
      for (const g of group) for (const stage of g.provider.stages(format)) if (stage.rank === rank) plan.push({ ...g, stage });
    }
    group = [];
  };
  for (const p of providers) {
    if (p.provider.kind === "stock") {
      group.push(p);
      continue;
    }
    flush();
    for (const stage of p.provider.stages(format)) plan.push({ ...p, stage });
  }
  flush();
  return preferImages ? plan.filter((s) => s.stage.media === "image") : plan;
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_") || "scene";

function creditText(c: Credit): string {
  return c.author ? `${c.provider}: ${c.author}` : c.provider;
}

async function save(c: Candidate, scene: ScriptScene, ctx: VisualContext, deps: VisualDeps, label: string): Promise<SceneVisual> {
  const file = `${safeId(scene.id)}.${c.ext}`;
  const rel = `visuals/${file}`; // относительно publicDir, всегда с «/»
  const abs = path.join(ctx.publicDir, "visuals", file);
  if (c.data) {
    await mkdir(path.dirname(abs), { recursive: true });
    await rm(abs, { force: true });
    await writeFile(abs, c.data);
  } else if (c.url) {
    const isVideo = c.type === "video";
    const maxBytes = envNumber(deps.env, isVideo ? "VISUALS_MAX_VIDEO_MB" : "VISUALS_MAX_IMAGE_MB", isVideo ? 60 : 15) * MB;
    const timeout = envNumber(deps.env, "VISUALS_DOWNLOAD_TIMEOUT_MS", isVideo ? 120_000 : 45_000);
    await downloadToFile(deps.fetch, `${label}: скачивание`, c.url, abs, timeout, maxBytes);
  } else {
    throw new VisualError(`${label}: у кандидата нет ни ссылки, ни данных.`);
  }
  const credit = creditText(c.credit);
  return c.type === "video" ? { type: "video", src: rel, durationSec: c.durationSec ?? 0, credit } : { type: "image", src: rel, credit };
}

export async function findVisual(scene: ScriptScene, ctx: VisualContext, overrides: Partial<VisualDeps> = {}): Promise<VisualResult> {
  const env = overrides.env ?? process.env;
  const deps: VisualDeps = {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    env,
    log: overrides.log ?? { info: (m) => console.log(m), warn: (m) => console.warn(m) },
    cacheDir: overrides.cacheDir ?? defaultCacheDir(env),
    now: overrides.now ?? Date.now,
  };
  const tag = `[визуал] ${scene.id}`;
  try {
    const providers = parseVisualsList(env.VISUALS, deps.log);
    if (providers.length === 0) return NONE;

    const ready: { provider: VisualProvider; key: string }[] = [];
    for (const p of providers) {
      const missing = p.keyEnv.filter((k) => !env[k]?.trim());
      if (missing.length) {
        once(`nokey:${p.name}`, () => deps.log.info(`[визуал] ${p.title} пропущен: не задан ${missing.join(" и ")} (бесплатный ключ: ${p.signup}).`));
        continue;
      }
      if (disabled.has(p.name)) continue;
      ready.push({ provider: p, key: p.keyEnv[0] ? env[p.keyEnv[0]]!.trim() : "" });
    }
    if (ready.length === 0) return NONE;

    const queries = buildQueries(scene);
    const preferImages = (env.VISUALS_PREFER ?? "").trim().toLowerCase() === "image";
    for (const step of buildPlan(ready, ctx.format, preferImages)) {
      const { provider } = step;
      if (disabled.has(provider.name)) continue;
      if (provider.kind === "stock" && queries.length === 0) continue;
      let candidates: Candidate[];
      try {
        candidates = await step.stage.run({ scene, ctx, queries, deps, key: step.key });
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (e instanceof VisualError && e.disable) {
          disabled.set(provider.name, msg);
          deps.log.warn(`[визуал] ${msg} — ${provider.title} выключен до конца запуска.`);
        } else deps.log.warn(`${tag}: ${msg}`);
        continue;
      }
      // Пробуем не больше двух кандидатов: битая ссылка CDN — не повод сдаваться.
      for (const c of candidates.filter((x) => !ctx.usedIds.has(x.id)).slice(0, 2)) {
        try {
          const visual = await save(c, scene, ctx, deps, provider.title);
          ctx.usedIds.add(c.id);
          deps.log.info(`${tag}: ${c.type === "video" ? "видео" : "картинка"} — ${creditText(c.credit)}${c.type === "video" ? `, ${c.durationSec} с` : ""}`);
          return { visual, credit: c.credit };
        } catch (e) {
          deps.log.warn(`${tag}: ${(e as Error)?.message ?? String(e)}`);
        }
      }
    }
    deps.log.info(`${tag}: подходящего визуала не нашлось — сцена будет на моушен-графике.`);
    return NONE;
  } catch (e) {
    // Страховка: ни одна ошибка визуала не должна ронять сборку ролика.
    deps.log.warn(`${tag}: ошибка подбора визуала: ${(e as Error)?.message ?? String(e)}`);
    return NONE;
  }
}

export { pickRendition } from "./pick";
export { buildQueries, imagePromptFor } from "./query";
