// Openverse (WordPress.org) — поиск по открытым фото Flickr, iNaturalist,
// музеев и т. д. через официальный API: без ключа (лимит анонимных запросов
// ≈ 20 в минуту и 200 в сутки — при 429 источник выключается до конца
// запуска). Дополняет Wikimedia Commons там, где Commons беден: природа
// (iNaturalist), повседневные сюжеты (Flickr). Commons здесь исключён — его
// берёт свой провайдер с проверкой ограничений (права личности и т. п.).

import { getJson } from "../http";
import { extFromUrl } from "../query";
import { photoFit, photoQueries, visualQuery, type VisualQuery } from "../relevance";
import { envNumber } from "../util";
import type { Candidate, Stage, StageInput, VisualProvider } from "../types";
import { allowedLicenses, authorText, authorWithLicense, bigEnough, byRelevance, fitFor, htmlToText, licenseFamily, licenseLabel, userAgent } from "./open-licenses";

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
  // Теги Flickr/iNaturalist — как категории у Commons. accuracy — у машинных
  // тегов (распознавание картинки): «illustration», «art» на обычном фото.
  tags?: { name?: string | null; accuracy?: number | null }[] | null;
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

export function rankOpenverse(results: OpenverseImage[], query: VisualQuery | string, input: Pick<StageInput, "ctx" | "deps">): Candidate[] {
  const { ctx, deps } = input;
  const q = typeof query === "string" ? visualQuery({ visualQuery: query }) : query;
  const allowed = allowedLicenses(deps.env);
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
    // Только теги автора: машинные («art», «illustration» с accuracy) ошибаются
    // и на обычных фото, а правило «не фото» поверило бы им.
    const tags = (r.tags ?? []).filter((t) => t?.accuracy == null).map((t) => t?.name ?? "").filter(Boolean).slice(0, 30).join("|");
    // Теги Flickr бывают «в нагрузку» ко всему альбому — они весят как категории, не как название.
    const fit = photoFit(q, { title, categories: tags, author });
    if (!fit.ok) continue;
    out.push({
      score: fit.score,
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
      meta: { title, text: tags.replace(/\|/g, ", "), score: fit.score },
    });
  }
  return byRelevance(out).map(({ score: _s, order: _o, ...c }) => c);
}

const stage: Stage = {
  rank: 1,
  media: "image",
  async run(input) {
    const { deps, scene } = input;
    const q = input.query ?? visualQuery(scene);
    // Без visualQuery проверке «по теме» не с чем сравнивать — все кандидаты
    // отсеялись бы, а запрос съел бы суточный лимит (≈ 200) впустую.
    if (q.terms.length === 0) return [];
    // Предмет кадра без стиля — как у Commons (relevance.ts → photoQueries).
    const text = photoQueries(q)[0];
    if (!text) return [];
    const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
    // Один запрос на сцену: у анонимного доступа суточный лимит.
    const data = await getJson<{ results?: OpenverseImage[] }>(deps.fetch, "Openverse", openverseSearchUrl(text), { headers: { "User-Agent": userAgent(deps.env) } }, timeout);
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
