// Pexels: сначала видео (videos/search), затем фото (v1/search). Бесплатный
// ключ, коммерческое использование без обязательной атрибуции. Заголовок
// авторизации — сам ключ, без «Bearer». Лимит по умолчанию 200 запросов/час.

import { envNumber } from "../util";
import { getJson } from "../http";
import { pickRendition } from "../pick";
import { extFromUrl } from "../query";
import { slugText, stockFit } from "../relevance";
import type { Candidate, Stage, StageInput, VisualProvider } from "../types";

interface PexelsVideoFile {
  id: number;
  quality: string | null; // uhd | hd | sd | hls
  file_type: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  duration: number;
  user?: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  src: Partial<Record<"original" | "large2x" | "large" | "medium" | "small" | "portrait" | "landscape" | "tiny", string>>;
}

const API = "https://api.pexels.com";
const MIN_CLIP_SEC = 2;

function orientation(format: StageInput["ctx"]["format"]): string {
  return format === "shorts" ? "portrait" : "landscape";
}

export function rankPexelsVideos(videos: PexelsVideo[], input: Pick<StageInput, "ctx" | "query">): Candidate[] {
  const { ctx } = input;
  const out: (Candidate & { long: boolean })[] = [];
  for (const v of videos ?? []) {
    const id = `pexels:video:${v.id}`;
    if (ctx.usedIds.has(id) || !(v.duration >= MIN_CLIP_SEC)) continue;
    // Описания у видео Pexels нет — только адрес страницы с сюжетом
    // (/video/a-cat-sniffing-a-cake-855029/); явный промах мимо (relevance.ts).
    const about = slugText(v.url);
    const fit = input.query ? stockFit(input.query, about) : null;
    if (fit && !fit.ok) continue;
    const files = (v.video_files ?? [])
      .filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.link)
      .map((f) => ({ url: f.link, width: f.width as number, height: f.height as number, fps: f.fps }));
    const best = pickRendition(files, ctx.format);
    if (!best) continue;
    out.push({
      id,
      type: "video",
      url: best.url,
      ext: "mp4",
      durationSec: v.duration,
      width: best.width,
      height: best.height,
      credit: { provider: "Pexels", author: v.user?.name ?? null, url: v.url ?? null },
      meta: { title: about || `Pexels ${v.id}`, ...(fit ? { score: fit.score } : {}) },
      long: v.duration >= ctx.minDurationSec,
    });
  }
  // Клипы не короче сцены — вперёд (в порядке релевантности Pexels), короткие
  // — после, от длинных к коротким: композиция их зациклит.
  const long = out.filter((c) => c.long);
  const short = out.filter((c) => !c.long).sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0));
  return [...long, ...short].map(({ long: _l, ...c }) => c);
}

// У ссылок src.* есть параметры w/h (fit=crop) — подставляем точный размер
// кадра, чтобы получить готовый кроп без апскейла.
export function sizedPexelsUrl(url: string, w: number, h: number): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("w") && !u.searchParams.has("h")) return url;
    u.searchParams.set("w", String(w));
    u.searchParams.set("h", String(h));
    u.searchParams.set("fit", "crop");
    return u.toString();
  } catch {
    return url;
  }
}

export function rankPexelsPhotos(photos: PexelsPhoto[], input: Pick<StageInput, "ctx" | "query">): Candidate[] {
  const { ctx } = input;
  const shorts = ctx.format === "shorts";
  const out: Candidate[] = [];
  for (const p of photos ?? []) {
    const id = `pexels:photo:${p.id}`;
    if (ctx.usedIds.has(id)) continue;
    const about = p.alt?.trim() || slugText(p.url);
    const fit = input.query ? stockFit(input.query, about) : null;
    if (fit && !fit.ok) continue;
    const crop = shorts ? p.src?.portrait : p.src?.landscape;
    const url = crop ? sizedPexelsUrl(crop, shorts ? 1080 : 1920, shorts ? 1920 : 1080) : p.src?.large2x ?? p.src?.original;
    if (!url) continue;
    out.push({
      id,
      type: "image",
      url,
      ext: extFromUrl(url, "jpg"),
      width: p.width,
      height: p.height,
      credit: { provider: "Pexels", author: p.photographer ?? null, url: p.url ?? null },
      meta: { title: about || `Pexels ${p.id}`, ...(fit ? { score: fit.score } : {}) },
    });
  }
  return out;
}

const videoStage: Stage = {
  rank: 0,
  media: "video",
  async run(input) {
    const { deps, key, ctx } = input;
    const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
    for (const q of input.queries.slice(0, 2)) {
      const params = new URLSearchParams({ query: q, orientation: orientation(ctx.format), size: "medium", per_page: "15", locale: "en-US" });
      const data = await getJson<{ videos?: PexelsVideo[] }>(deps.fetch, "Pexels (видео)", `${API}/videos/search?${params}`, { headers: { Authorization: key } }, timeout);
      const ranked = rankPexelsVideos(data.videos ?? [], input);
      if (ranked.length) return ranked;
    }
    return [];
  },
};

const photoStage: Stage = {
  rank: 1,
  media: "image",
  async run(input) {
    const { deps, key, ctx } = input;
    const q = input.queries[0];
    if (!q) return [];
    const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
    const params = new URLSearchParams({ query: q, orientation: orientation(ctx.format), per_page: "15", locale: "en-US" });
    const data = await getJson<{ photos?: PexelsPhoto[] }>(deps.fetch, "Pexels (фото)", `${API}/v1/search?${params}`, { headers: { Authorization: key } }, timeout);
    return rankPexelsPhotos(data.photos ?? [], input);
  },
};

export const pexelsProvider: VisualProvider = {
  name: "pexels",
  title: "Pexels",
  kind: "stock",
  keyEnv: ["PEXELS_API_KEY"],
  signup: "https://www.pexels.com/api/",
  stages: () => [videoStage, photoStage],
};
