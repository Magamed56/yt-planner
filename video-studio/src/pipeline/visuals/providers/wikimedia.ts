// Wikimedia Commons — реальные фотографии (история, природа, космос) через
// официальный MediaWiki API: бесплатно, без ключа. Стоковые видео красивы, но
// на «гренландскую акулу» или «шлем викинга» сток покажет просто акулу и
// костюм с рогами, а Commons — настоящий объект. Порядок источников — VISUALS;
// для рубрик с реальными объектами index.ts ставит реальные фото первыми.
//
// Берём только JPEG со свободной лицензией (см. open-licenses.ts) и без
// ограничений (права личности, товарные знаки), записываем автора, лицензию и
// страницу файла — это уходит в описание ролика. Миниатюру просим у API
// (iiurlwidth): Commons отдаёт только стандартные размеры, самодельный URL
// с произвольной шириной получает HTTP 400.

import { getJson } from "../http";
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

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

interface MetaValue {
  value?: string;
}

interface CommonsImageInfo {
  url?: string;
  descriptionurl?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width?: number;
  height?: number;
  mime?: string;
  extmetadata?: Partial<
    Record<"License" | "LicenseShortName" | "Artist" | "Restrictions" | "NonFree" | "AttributionRequired" | "ImageDescription" | "Credit" | "Categories", MetaValue>
  >;
}

export interface CommonsPage {
  pageid: number;
  title: string;
  index?: number; // место в выдаче поиска (страницы приходят не по порядку)
  imageinfo?: CommonsImageInfo[];
}

interface CommonsResponse {
  query?: { pages?: CommonsPage[] };
  error?: { code?: string; info?: string };
}

// Ширина миниатюры: Shorts — 1280 (портрет закрывает кадр, горизонтальное
// фото встаёт целиком по ширине), горизонтальный ролик — 1920.
const thumbWidth = (format: StageInput["ctx"]["format"]) => (format === "shorts" ? 1280 : 1920);

export function commonsSearchUrl(query: string, format: StageInput["ctx"]["format"]): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    // Только JPEG (фото, а не схемы и сканы TIFF) и не мельче 720 px.
    gsrsearch: `${query} filemime:image/jpeg filew:>720 fileh:>720`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(thumbWidth(format)),
    // Описание, «Credit» и категории — чтобы узнать скан книги («Plate 16…»).
    iiextmetadatafilter: "License|LicenseShortName|Artist|Restrictions|NonFree|AttributionRequired|ImageDescription|Credit|Categories",
  });
  return `${COMMONS_API}?${params}`;
}

export function rankCommonsPages(pages: CommonsPage[], query: string, input: Pick<StageInput, "ctx" | "deps">): Candidate[] {
  const { ctx, deps } = input;
  const allowed = allowedLicenses(deps.env);
  const keywords = queryKeywords(query);
  const ua = userAgent(deps.env);
  const out: (Candidate & { score: number; order: number })[] = [];
  for (const p of pages ?? []) {
    const id = `wikimedia:${p.pageid}`;
    const ii = p.imageinfo?.[0];
    if (!ii || ctx.usedIds.has(id)) continue;
    const width = ii.width ?? 0;
    const height = ii.height ?? 0;
    const src = ii.thumburl || ii.url;
    if (!src || ii.mime !== "image/jpeg" || !width || !height || !bigEnough(width, height, ctx.format)) continue;
    const m = ii.extmetadata ?? {};
    if (m.NonFree?.value && m.NonFree.value !== "false") continue;
    // Права на изображение личности, товарный знак, госсимволика — мимо.
    if (htmlToText(m.Restrictions?.value)) continue;
    const family = licenseFamily(m.License?.value);
    if (!family || !allowed.has(family)) continue;
    const author = authorText(m.Artist?.value);
    if (!author && (family === "cc-by" || family === "cc-by-sa")) continue; // атрибуция была бы неполной
    const title = p.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
    const extra = { description: htmlToText(m.ImageDescription?.value, 400), credit: htmlToText(m.Credit?.value, 300), categories: m.Categories?.value ?? "" };
    if (looksLikeJunk(title, author, extra)) continue;
    const score = titleScore(title, keywords);
    if (score === 0) continue;
    out.push({
      id,
      type: "image",
      url: src,
      ext: "jpg",
      width,
      height,
      fit: fitFor(width, height, ctx.format),
      headers: { "User-Agent": ua },
      credit: {
        provider: "Wikimedia Commons",
        author: authorWithLicense(author, licenseLabel(family, m.LicenseShortName?.value)),
        url: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      },
      score,
      order: p.index ?? 0,
    });
  }
  return byRelevance(out).map(({ score: _s, order: _o, ...c }) => c);
}

const stage: Stage = {
  rank: 1,
  media: "image",
  async run(input) {
    const { deps, ctx } = input;
    const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
    const headers = { "User-Agent": userAgent(deps.env) };
    // Один-два запроса на сцену: точный и укороченный (query.ts).
    for (const q of input.queries.slice(0, 2)) {
      const data = await getJson<CommonsResponse>(deps.fetch, "Wikimedia Commons", commonsSearchUrl(q, ctx.format), { headers }, timeout);
      const ranked = rankCommonsPages(data.query?.pages ?? [], q, input);
      if (ranked.length) return ranked;
    }
    return [];
  },
};

export const wikimediaProvider: VisualProvider = {
  name: "wikimedia",
  title: "Wikimedia Commons",
  kind: "photo",
  keyEnv: [],
  signup: "https://commons.wikimedia.org",
  stages: () => [stage],
};
