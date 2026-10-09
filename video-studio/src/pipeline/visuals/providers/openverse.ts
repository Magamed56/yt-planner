// Openverse (WordPress.org) — поиск по открытым фото Flickr, iNaturalist,
// музеев и т. д. через официальный API: без ключа (лимит анонимных запросов
// ≈ 20 в минуту и 200 в сутки — при 429 источник выключается до конца
// запуска). Дополняет Wikimedia Commons там, где Commons беден: природа
// (iNaturalist), повседневные сюжеты (Flickr). Commons здесь исключён — его
// берёт свой провайдер с проверкой ограничений (права личности и т. п.).

import { getJson } from "../http";
import { extFromUrl } from "../query";
import { envNumber } from "../util";
import type { Candidate, Stage, StageInput, VisualProvider } from "../types";
import {
  allowedLicenses,
  authorText,
  authorWithLicense,
  bigEnough,
  byRelevance,
  fitFor,
  htmlToText,
  licenseFamily,
  licenseLabel,
  looksLikeJunk,
  queryKeywords,
  titleScore,
  userAgent,
} from "./open-licenses";

export const OPENVERSE_API = "https://api.openverse.org/v1/images/";

export interface OpenverseImage {
  id: string;
  title?: string | null;
  url?: string | null; // сам файл
  foreign_landing_url?: string | null; // страница у источника — для атрибуции
  creator?: string | null;
  license?: string | null; // by | by-sa | cc0 | pdm | …
  license_version?: string | null;
  source?: string | null; // flickr | inaturalist | …
  provider?: string | null;
  filetype?: string | null;
  width?: number | null;
  height?: number | null;
  mature?: boolean;
}

const SOURCE_TITLES: Record<string, string> = {
  flickr: "Flickr",
  inaturalist: "iNaturalist",
  smithsonian: "Smithsonian",
  nasa: "NASA",
  stocksnap: "StockSnap",
  rawpixel: "rawpixel",
};

const sourceTitle = (s: string | null | undefined) => {
  const k = (s ?? "").toLowerCase();
  return SOURCE_TITLES[k] ?? (k ? k.replace(/(^|[_\s-])(\w)/g, (_m, p: string, c: string) => `${p ? " " : ""}${c.toUpperCase()}`) : "Openverse");
};

export function openverseSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    license: "by,by-sa,cc0,pdm",
    category: "photograph",
    excluded_source: "wikimedia",
    mature: "false",
    page_size: "20",
  });
  return `${OPENVERSE_API}?${params}`;
}

export function rankOpenverse(results: OpenverseImage[], query: string, input: Pick<StageInput, "ctx" | "deps">): Candidate[] {
  const { ctx, deps } = input;
  const allowed = allowedLicenses(deps.env);
  const keywords = queryKeywords(query);
  const ua = userAgent(deps.env);
  const out: (Candidate & { score: number; order: number })[] = [];
  for (const [order, r] of (results ?? []).entries()) {
    const id = `openverse:${r.id}`;
    if (!r.id || ctx.usedIds.has(id) || r.mature || !r.url) continue;
    const width = r.width ?? 0;
    const height = r.height ?? 0;
    const ext = extFromUrl(r.url, (r.filetype ?? "").toLowerCase() === "jpeg" ? "jpg" : (r.filetype ?? "").toLowerCase());
    if (ext !== "jpg" || !width || !height || !bigEnough(width, height, ctx.format)) continue;
    const family = licenseFamily(r.license);
    if (!family || !allowed.has(family)) continue;
    const author = authorText(r.creator);
    if (!author && (family === "cc-by" || family === "cc-by-sa")) continue;
    const title = htmlToText(r.title, 200);
    if (looksLikeJunk(title, author)) continue;
    const score = titleScore(title, keywords);
    if (score === 0) continue;
    out.push({
      score,
      order,
      id,
      type: "image",
      url: r.url,
      ext: "jpg",
      width,
      height,
      fit: fitFor(width, height, ctx.format),
      headers: { "User-Agent": ua },
      credit: {
        provider: sourceTitle(r.source ?? r.provider),
        author: authorWithLicense(author, licenseLabel(family, null, r.license_version)),
        url: r.foreign_landing_url ?? null,
      },
    });
  }
  return byRelevance(out).map(({ score: _s, order: _o, ...c }) => c);
}

const stage: Stage = {
  rank: 1,
  media: "image",
  async run(input) {
    const { deps } = input;
    const q = input.queries[0];
    if (!q) return [];
    const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
    // Один запрос на сцену: у анонимного доступа суточный лимит.
    const data = await getJson<{ results?: OpenverseImage[] }>(deps.fetch, "Openverse", openverseSearchUrl(q), { headers: { "User-Agent": userAgent(deps.env) } }, timeout);
    return rankOpenverse(data.results ?? [], q, input);
  },
};

export const openverseProvider: VisualProvider = {
  name: "openverse",
  title: "Openverse",
  kind: "photo",
  keyEnv: [],
  signup: "https://openverse.org",
  stages: () => [stage],
};
