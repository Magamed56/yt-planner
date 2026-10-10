// Визуал сцены (контракт — src/pipeline/contracts.ts):
//   findVisual(scene, ctx) → { visual, credit }
// Источники — VISUALS (порядок через запятую, по умолчанию
// pexels,pixabay,wikimedia,openverse,cloudflare; none — без визуала). Источник
// без ключа тихо пропускается (одно сообщение за запуск); реальные фото
// (wikimedia, openverse) ключа не требуют. Для сцен про реальные объекты
// (ctx.realFirst — рубрики VISUALS_REAL_PILLARS, или VISUALS_PREFER=real)
// реальные фото идут первыми — кроме сцен media без имени собственного в
// рубриках: там обещано живое видео, и стоки идут первыми. Файл всегда скачивается в
// ctx.publicDir/visuals/<id сцены>.<ext> — никаких ссылок на чужие серверы.
// Для одной сцены функция НИКОГДА не бросает: при неудаче — { type: "none" },
// и композиция покажет чистую моушен-графику.
//
// «По теме»: каждый источник отсеивает кандидатов правилами relevance.ts
// (слова запроса в названии/категориях, не гравюра/карта/схема/логотип), а
// при VISUALS_JUDGE=claude оставшихся ещё смотрит Claude (judge.ts, платно).
// Лучше сцена без картинки, чем картинка не по теме.

import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { Credit, VisualContext, VisualResult } from "../contracts";
import type { SceneVisual, ScriptScene } from "../../types";
import { defaultCacheDir } from "./cache";
import { downloadToFile } from "./http";
import { askJudge, JUDGE_TOP_N, JudgeError, judgeConfig } from "./judge";
import { cloudflareProvider } from "./providers/cloudflare";
import { pexelsProvider } from "./providers/pexels";
import { pixabayProvider } from "./providers/pixabay";
import { openverseProvider } from "./providers/openverse";
import { pollinationsProvider } from "./providers/pollinations";
import { wikimediaProvider } from "./providers/wikimedia";
import { buildQueries } from "./query";
import { visualQuery } from "./relevance";
import { envNumber, MB } from "./util";
import { VisualError, type Candidate, type Env, type Stage, type VisualDeps, type VisualHints, type VisualProvider } from "./types";

export const VISUAL_PROVIDERS: Record<string, VisualProvider> = {
  pexels: pexelsProvider,
  pixabay: pixabayProvider,
  wikimedia: wikimediaProvider,
  openverse: openverseProvider,
  cloudflare: cloudflareProvider,
  pollinations: pollinationsProvider,
};

export const DEFAULT_VISUALS = "pexels,pixabay,wikimedia,openverse,cloudflare";

// Рубрики канала (channel.json → pillars), где важен НАСТОЯЩИЙ объект, а не
// похожая стоковая картинка: история, природа, космос. VISUALS_REAL_PILLARS —
// свой список через запятую (none — никогда).
export const DEFAULT_REAL_PILLARS = "history,nature,space";

export function realFirstForPillar(pillar: string | null | undefined, env: Env = process.env): boolean {
  if (!pillar) return false;
  const raw = (env.VISUALS_REAL_PILLARS ?? DEFAULT_REAL_PILLARS).trim().toLowerCase();
  return raw.split(/[,;\s]+/).filter(Boolean).includes(pillar.trim().toLowerCase());
}

const NONE: VisualResult = { visual: { type: "none" }, credit: null };

// Состояние на процесс: какие сообщения уже показаны и какие источники
// выключены (кончилась квота, неверный ключ).
const noticed = new Set<string>();
const disabled = new Map<string, string>();
// Сбои связи подряд (таймаут, нет соединения) по источнику: API и скачивание
// отдельно. Недоступный или «чёрная дыра»-хост иначе стоил бы полный таймаут
// на КАЖДОЙ сцене (до ~4 мин на сцену) — после NETWORK_STRIKES подряд источник
// выключается до конца запуска. Любой успех обнуляет счётчик.
const strikes = new Map<string, number>();
const NETWORK_STRIKES = 3;

// Судья Claude (VISUALS_JUDGE=claude): расход за запуск и выключение после
// ошибки ключа/баланса или трёх сбоев подряд — дальше подбор по правилам.
const judge = { calls: 0, costUsd: 0, model: null as string | null, off: null as string | null, fails: 0 };
const JUDGE_CALLS_PER_SCENE = 4;

export function resetVisualsState(): void {
  noticed.clear();
  disabled.clear();
  strikes.clear();
  Object.assign(judge, { calls: 0, costUsd: 0, model: null, off: null, fails: 0 });
}

// Сколько стоил судья за этот запуск (make печатает в итог шага «Визуал»).
export function visualsJudgeStats(): { calls: number; costUsd: number; model: string | null } {
  return { calls: judge.calls, costUsd: Math.round(judge.costUsd * 1e6) / 1e6, model: judge.model };
}

function networkStrike(provider: VisualProvider, what: "api" | "download", e: unknown, log: VisualDeps["log"]): void {
  if (!(e instanceof VisualError) || !e.network) return;
  const key = `${provider.name}:${what}`;
  const n = (strikes.get(key) ?? 0) + 1;
  strikes.set(key, n);
  if (n >= NETWORK_STRIKES && !disabled.has(provider.name)) {
    disabled.set(provider.name, e.message);
    log.warn(`[визуал] ${provider.title}: ${n} раза подряд нет связи${what === "download" ? " при скачивании" : ""} — источник выключен до конца запуска.`);
  }
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
// realFirst — реальные фото (kind "photo") переезжают в начало плана.
export function buildPlan(
  providers: { provider: VisualProvider; key: string }[],
  format: VisualContext["format"],
  preferImages: boolean,
  realFirst = false,
): Step[] {
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
  const ordered = realFirst ? [...plan.filter((s) => s.provider.kind === "photo"), ...plan.filter((s) => s.provider.kind !== "photo")] : plan;
  return preferImages ? ordered.filter((s) => s.stage.media === "image") : ordered;
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
    await downloadToFile(deps.fetch, `${label}: скачивание`, c.url, abs, timeout, maxBytes, c.headers);
  } else {
    throw new VisualError(`${label}: у кандидата нет ни ссылки, ни данных.`);
  }
  const credit = creditText(c.credit);
  if (c.type === "video") return { type: "video", src: rel, durationSec: c.durationSec ?? 0, credit };
  return c.fit === "contain" ? { type: "image", src: rel, credit, fit: "contain" } : { type: "image", src: rel, credit };
}

// Кандидаты одного этапа → судье. null — судья выключен или не ответил
// (берём порядок правил relevance.ts), [] — «ни один не подходит», иначе —
// только выбранный им файл.
async function judged(list: Candidate[], scene: ScriptScene, ctx: VisualHints, deps: VisualDeps, tag: string, perScene: { calls: number }): Promise<Candidate[] | null> {
  const { config, problem } = judgeConfig(deps.env);
  if (problem) once(`judge:${problem}`, () => deps.log.warn(`[визуал] ${problem}`));
  if (!config || judge.off || perScene.calls >= JUDGE_CALLS_PER_SCENE) return null;
  const top = list.slice(0, JUDGE_TOP_N);
  perScene.calls++;
  try {
    const answer = await askJudge(config, scene, ctx.topic, top, deps.fetch);
    judge.calls++;
    judge.costUsd += answer.costUsd;
    judge.model = answer.model;
    judge.fails = 0;
    if (answer.verdict.kind === "none") {
      deps.log.info(`${tag}: судья Claude — ни один из ${top.length} не по теме («${top[0]?.meta?.title ?? top[0]?.id}»…).`);
      return [];
    }
    const pick = top[answer.verdict.index]!;
    if (answer.verdict.index > 0) deps.log.info(`${tag}: судья Claude выбрал №${answer.verdict.index + 1} из ${top.length} — «${pick.meta?.title ?? pick.id}».`);
    return [pick];
  } catch (e) {
    const err = e instanceof JudgeError ? e : new JudgeError((e as Error)?.message ?? String(e), false);
    judge.costUsd += err.costUsd;
    judge.fails++;
    if (err.disable || judge.fails >= NETWORK_STRIKES) {
      judge.off = err.message;
      deps.log.warn(`[визуал] Судья Claude: ${err.message} — до конца запуска подбираю по бесплатным правилам.`);
    } else {
      deps.log.warn(`${tag}: судья Claude: ${err.message} — беру лучший по правилам.`);
    }
    return null;
  }
}

export async function findVisual(scene: ScriptScene, ctx: VisualContext & VisualHints, overrides: Partial<VisualDeps> = {}): Promise<VisualResult> {
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
    // Карта и столбики (scene.map / scene.compare) рисуются композицией сами —
    // фото под ними не нужно, квоты стоков не тратим (как specialLayout в remotion/lib/cues.ts).
    if (scene.kind !== "hook" && scene.kind !== "cta" && (scene.map || (scene.compare?.items?.length ?? 0) >= 2)) return NONE;

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
    // Разобранный запрос: главные слова, предмет ролика, имена собственные — для проверки «по теме».
    const query = visualQuery(scene, { topicQueries: ctx.topicQueries });
    const prefer = (env.VISUALS_PREFER ?? "").trim().toLowerCase();
    // Сцена media обещает живое видео на весь экран, а рубрика «настоящих фото»
    // ставила Commons первым и здесь: 10a (nature) — 7 фото, 0 видео (прогон CI
    // 38020777592). Без имени собственного («tiger walking grass») сначала видео
    // стока; с именем (Greenland shark, Apollo Guidance Computer) — Commons, сток
    // такой клип без имени всё равно не берёт (stockFit). VISUALS_PREFER=real —
    // явный выбор пользователя, его не меняем.
    const liveVideo = scene.kind === "media" && query.proper.length === 0 && query.heads.length === 0;
    const realFirst = (Boolean(ctx.realFirst) && !liveVideo) || prefer === "real";
    const perScene = { calls: 0 };
    for (const step of buildPlan(ready, ctx.format, prefer === "image", realFirst)) {
      const { provider } = step;
      if (disabled.has(provider.name)) continue;
      if (provider.kind !== "ai" && queries.length === 0) continue;
      let candidates: Candidate[];
      try {
        candidates = await step.stage.run({ scene, ctx, queries, query, deps, key: step.key });
        strikes.delete(`${provider.name}:api`);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (e instanceof VisualError && e.disable) {
          disabled.set(provider.name, msg);
          deps.log.warn(`[визуал] ${msg} — ${provider.title} выключен до конца запуска.`);
        } else {
          deps.log.warn(`${tag}: ${msg}`);
          networkStrike(provider, "api", e, deps.log);
        }
        continue;
      }
      let list = candidates.filter((x) => !ctx.usedIds.has(x.id));
      if (list.length && provider.kind !== "ai") {
        const verdict = await judged(list, scene, ctx, deps, tag, perScene);
        if (verdict) list = verdict;
      }
      // Пробуем не больше двух кандидатов: битая ссылка CDN — не повод сдаваться.
      for (const c of list.slice(0, 2)) {
        if (disabled.has(provider.name)) break;
        try {
          const visual = await save(c, scene, ctx, deps, provider.title);
          strikes.delete(`${provider.name}:download`);
          ctx.usedIds.add(c.id);
          // Название файла в логе — чтобы по логу CI было видно, ЧТО попало в ролик.
          const about = c.meta?.title ? ` — «${c.meta.title.slice(0, 100)}»` : "";
          deps.log.info(`${tag}: ${c.type === "video" ? "видео" : "картинка"} — ${creditText(c.credit)}${c.type === "video" ? `, ${c.durationSec} с` : ""}${about}`);
          return { visual, credit: c.credit };
        } catch (e) {
          deps.log.warn(`${tag}: ${(e as Error)?.message ?? String(e)}`);
          networkStrike(provider, "download", e, deps.log);
        }
      }
    }
    deps.log.info(`${tag}: подходящего визуала по теме не нашлось — сцена будет на моушен-графике.`);
    return NONE;
  } catch (e) {
    // Страховка: ни одна ошибка визуала не должна ронять сборку ролика.
    deps.log.warn(`${tag}: ошибка подбора визуала: ${(e as Error)?.message ?? String(e)}`);
    return NONE;
  }
}

export { pickRendition } from "./pick";
export { buildQueries, imagePromptFor } from "./query";
export { photoFit, photoQueries, stockFit, visualQuery } from "./relevance";
