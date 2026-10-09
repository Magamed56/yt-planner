// Wikimedia Commons — реальные фотографии (история, природа, космос) через
// официальный MediaWiki API: бесплатно, без ключа. Стоковые видео красивы, но
// на «гренландскую акулу» или «шлем викинга» сток покажет просто акулу и
// костюм с рогами, а Commons — настоящий объект. Порядок источников — VISUALS;
// для рубрик с реальными объектами index.ts ставит реальные фото первыми.
//
// Без ключей Pexels/Pixabay Commons — главный источник картинок, и раньше в
// ролик шло первое случайное совпадение слова (гравюра 1720 года на «old book
// candle desk», гоночный «circuit» на «circuit board»). Теперь:
// - запрос — только предмет кадра, без стиля и признаков (relevance.ts →
//   photoQueries), до трёх запросов от точного к короткому;
// - только фото: JPEG/PNG/WebP, короткая сторона ≥ VISUALS_MIN_PHOTO_PX
//   (по умолчанию 1080), без гравюр, карт, схем, логотипов, сканов и рендеров
//   (название, категории и описание — тем же запросом API);
// - балл «по теме» (photoFit): файл ниже порога не берём — сцена останется на
//   моушен-графике, а не покажет картинку не по теме.
//
// Лицензии: только свободные (см. open-licenses.ts) и без ограничений (права
// личности, товарные знаки); автор, лицензия и страница файла уходят в
// описание ролика. Миниатюру просим у API (iiurlwidth): Commons отдаёт только
// стандартные размеры, самодельный URL с произвольной шириной получает HTTP 400.

import { getJson } from "../http";
import { extFromUrl } from "../query";
import { photoFit, photoQueries, subjectCategories, visualQuery, type VisualQuery } from "../relevance";
import { envNumber } from "../util";
import { VisualError, type Candidate, type Stage, type StageInput, type VisualProvider } from "../types";
import { allowedLicenses, authorText, authorWithLicense, bigEnough, byRelevance, fitFor, htmlToText, licenseFamily, licenseLabel, userAgent } from "./open-licenses";

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
    Record<
      | "License"
      | "LicenseShortName"
      | "Artist"
      | "Restrictions"
      | "NonFree"
      | "AttributionRequired"
      | "ImageDescription"
      | "ObjectName"
      | "Credit"
      | "Categories"
      | "DateTimeOriginal",
      MetaValue
    >
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

// Фото, а не схемы: PNG на Commons — чаще диаграммы и скриншоты, поэтому он
// берётся только с небольшим штрафом (см. rankCommonsPages).
const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Ширина миниатюры: Shorts — 1280 (портрет закрывает кадр, горизонтальное
// фото встаёт целиком по ширине), горизонтальный ролик — 1920.
const thumbWidth = (format: StageInput["ctx"]["format"]) => (format === "shorts" ? 1280 : 1920);

export const minPhotoPx = (env: StageInput["deps"]["env"]) => envNumber(env, "VISUALS_MIN_PHOTO_PX", 1080);

export function commonsSearchUrl(query: string, format: StageInput["ctx"]["format"], minShort = 1080): string {
  const px = Math.max(1, Math.round(minShort) - 1);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    // Растровые файлы (не SVG-схемы и не видео) не меньше minShort по обеим сторонам.
    gsrsearch: `${query} filetype:bitmap filew:>${px} fileh:>${px}`,
    gsrnamespace: "6",
    gsrlimit: "30",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(thumbWidth(format)),
    // Описание, категории, «Credit» и дата — чтобы отличить фото от гравюры,
    // карты или скана книги («Plate 16…») тем же запросом, без второго.
    iiextmetadatafilter:
      "License|LicenseShortName|Artist|Restrictions|NonFree|AttributionRequired|ImageDescription|ObjectName|Credit|Categories|DateTimeOriginal",
    iiextmetadatalanguage: "en",
  });
  return `${COMMONS_API}?${params}`;
}

export function rankCommonsPages(pages: CommonsPage[], query: VisualQuery | string, input: Pick<StageInput, "ctx" | "deps">): Candidate[] {
  const { ctx, deps } = input;
  const q = typeof query === "string" ? visualQuery({ visualQuery: query }) : query;
  const allowed = allowedLicenses(deps.env);
  const ua = userAgent(deps.env);
  const minShort = minPhotoPx(deps.env);
  const out: (Candidate & { score: number; order: number })[] = [];
  for (const p of pages ?? []) {
    const id = `wikimedia:${p.pageid}`;
    const ii = p.imageinfo?.[0];
    if (!ii || ctx.usedIds.has(id)) continue;
    const width = ii.width ?? 0;
    const height = ii.height ?? 0;
    const src = ii.thumburl || ii.url;
    if (!src || !PHOTO_MIME.has(ii.mime ?? "") || !width || !height || !bigEnough(width, height, ctx.format, minShort)) continue;
    const ext = extFromUrl(src, ii.mime === "image/png" ? "png" : ii.mime === "image/webp" ? "webp" : "jpg");
    if (!["jpg", "png", "webp"].includes(ext)) continue;
    const m = ii.extmetadata ?? {};
    if (m.NonFree?.value && m.NonFree.value !== "false") continue;
    // Права на изображение личности, товарный знак, госсимволика — мимо.
    if (htmlToText(m.Restrictions?.value)) continue;
    const family = licenseFamily(m.License?.value);
    if (!family || !allowed.has(family)) continue;
    const author = authorText(m.Artist?.value);
    if (!author && (family === "cc-by" || family === "cc-by-sa")) continue; // атрибуция была бы неполной
    const title = p.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
    const description = [htmlToText(m.ObjectName?.value, 200), htmlToText(m.ImageDescription?.value, 400), htmlToText(m.Credit?.value, 300)].filter(Boolean).join(" · ");
    const categories = m.Categories?.value ?? "";
    const fit = photoFit(q, { title, categories, description, author });
    if (!fit.ok) continue;
    // Крупный оригинал — обычно современный хороший снимок; PNG — чаще схема.
    const score = fit.score + (Math.min(width, height) >= 2000 ? 0.03 : 0) - (ext === "png" ? 0.1 : 0);
    out.push({
      id,
      type: "image",
      url: src,
      ext,
      width,
      height,
      fit: fitFor(width, height, ctx.format),
      headers: { "User-Agent": ua },
      credit: {
        provider: "Wikimedia Commons",
        author: authorWithLicense(author, licenseLabel(family, m.LicenseShortName?.value)),
        url: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      },
      // Судье — без служебных категорий («Pages with maps», лицензии): меньше шума и токенов.
      meta: { title, text: [description, subjectCategories(categories).replace(/\|/g, ", ")].filter(Boolean).join(" | ").slice(0, 400), score: Math.round(score * 1000) / 1000 },
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
    const { deps, ctx, scene } = input;
    const q = input.query ?? visualQuery(scene);
    const timeout = envNumber(deps.env, "VISUALS_TIMEOUT_MS", 20_000);
    const headers = { "User-Agent": userAgent(deps.env) };
    const minShort = minPhotoPx(deps.env);
    // До трёх запросов: с именем из imagePrompt → предмет целиком → два главных слова.
    let seen = 0;
    const tried: string[] = [];
    for (const text of photoQueries(q)) {
      tried.push(text);
      const data = await getJson<CommonsResponse>(deps.fetch, "Wikimedia Commons", commonsSearchUrl(text, ctx.format, minShort), { headers }, timeout);
      // Ошибку параметров MediaWiki отдаёт с HTTP 200 — без этой проверки она
      // выглядела бы как «ничего не нашлось» на каждой сцене.
      if (data.error) throw new VisualError(`Wikimedia Commons: ошибка API ${data.error.code ?? ""} — ${(data.error.info ?? "").slice(0, 160)}`.trim());
      const pages = data.query?.pages ?? [];
      seen += pages.length;
      const ranked = rankCommonsPages(pages, q, input);
      if (ranked.length) return ranked;
    }
    if (tried.length) {
      deps.log.info(
        seen > 0
          ? `[визуал] ${scene.id}: Wikimedia Commons — ${seen} файлов по «${tried.join("» / «")}», но ни одного фото по теме сцены.`
          : `[визуал] ${scene.id}: Wikimedia Commons — по «${tried.join("» / «")}» ни одного фото от ${minShort} px.`,
      );
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
