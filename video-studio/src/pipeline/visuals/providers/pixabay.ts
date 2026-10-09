// Pixabay: только видео (api/videos). У эндпоинта видео НЕТ фильтра
// ориентации — проверяем сами; для Shorts запасной этап берёт и
// горизонтальный клип (композиция обрежет его по центру через objectFit:
// cover). Правила API: ответы кэшировать 24 часа, хотлинкинг запрещён —
// поэтому кэш на диске и всегда скачиваем файл к себе.

import { cachedJson, DAY_MS } from "../cache";
import { getJson } from "../http";
import { pickRendition } from "../pick";
import { stockFit } from "../relevance";
import { envNumber } from "../util";
import type { Candidate, Stage, StageInput, VisualProvider } from "../types";

interface PixabayVariant {
  url: string; // пустая строка, если такого варианта нет
  width: number;
  height: number;
  size: number; // байты
  thumbnail?: string;
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags?: string;
  duration: number;
  videos: Partial<Record<"large" | "medium" | "small" | "tiny", PixabayVariant>>;
  user_id?: number;
  user?: string;
  isAiGenerated?: boolean;
}

interface PixabayResponse {
  total?: number;
  totalHits?: number;
  hits?: PixabayHit[];
}

const MIN_CLIP_SEC = 2;

export function rankPixabayHits(hits: PixabayHit[], input: Pick<StageInput, "ctx" | "query">, crop: boolean, maxBytes: number): Candidate[] {
  const { ctx } = input;
  const out: (Candidate & { long: boolean })[] = [];
  for (const h of hits ?? []) {
    const id = `pixabay:video:${h.id}`;
    if (ctx.usedIds.has(id) || !(h.duration >= MIN_CLIP_SEC)) continue;
    // Теги клипа («cat, animal, pet») — явный промах мимо (relevance.ts).
    const fit = input.query ? stockFit(input.query, h.tags ?? "") : null;
    if (fit && !fit.ok) continue;
    const files = Object.values(h.videos ?? {})
      .filter((v): v is PixabayVariant => !!v && !!v.url && v.width > 0 && v.height > 0 && !(v.size > maxBytes))
      .map((v) => ({ url: v.url, width: v.width, height: v.height }));
    // Этап обрезки: чужая ориентация допустима, но без сильного апскейла
    // (иначе после центрального кропа картинка поплывёт).
    const best = crop ? pickRendition(files, ctx.format, { strictOrientation: false, maxUpscale: 2 }) : pickRendition(files, ctx.format);
    if (!best) continue;
    out.push({
      id,
      type: "video",
      url: best.url,
      ext: "mp4",
      durationSec: h.duration,
      width: best.width,
      height: best.height,
      credit: { provider: "Pixabay", author: h.user ?? null, url: h.pageURL ?? null },
      meta: { title: h.tags?.trim() || `Pixabay ${h.id}`, ...(fit ? { score: fit.score } : {}) },
      long: h.duration >= ctx.minDurationSec,
    });
  }
  const long = out.filter((c) => c.long);
  const short = out.filter((c) => !c.long).sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0));
  return [...long, ...short].map(({ long: _long, ...c }) => c);
}

async function search(input: StageInput, q: string): Promise<PixabayHit[]> {
  const { deps, key } = input;
  const params = new URLSearchParams({
    q: q.slice(0, 100),
    lang: "en",
    video_type: "film",
    safesearch: "true",
    order: "popular",
    per_page: "20",
    // ориентации в API видео нет — отсекаем хотя бы совсем мелкие клипы
    min_width: "720",
    min_height: "720",
  });
  const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
  const { data } = await cachedJson<PixabayResponse>(deps.cacheDir, "pixabay", `videos?${params}`, DAY_MS, deps.now, () =>
    getJson<PixabayResponse>(deps.fetch, "Pixabay", `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&${params}`, {}, timeout),
  );
  return data.hits ?? [];
}

function stage(rank: 0 | 1, crop: boolean): Stage {
  return {
    rank,
    media: "video",
    async run(input) {
      const maxBytes = envNumber(input.deps.env, "VISUALS_MAX_VIDEO_MB", 60) * 1024 * 1024;
      for (const q of input.queries.slice(0, 2)) {
        const ranked = rankPixabayHits(await search(input, q), input, crop, maxBytes);
        if (ranked.length) return ranked;
      }
      return [];
    },
  };
}

export const pixabayProvider: VisualProvider = {
  name: "pixabay",
  title: "Pixabay",
  kind: "stock",
  keyEnv: ["PIXABAY_API_KEY"],
  signup: "https://pixabay.com/api/docs/",
  // Обрезка горизонтального клипа в 9:16 — только как запасной этап Shorts.
  stages: (format) => (format === "shorts" ? [stage(0, false), stage(1, true)] : [stage(0, false)]),
};
