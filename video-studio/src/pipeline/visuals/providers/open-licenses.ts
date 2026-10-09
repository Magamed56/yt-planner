// Общее для источников реальных фото (Wikimedia Commons, Openverse): какие
// лицензии берём, как подписываем автора и как отсеять мусор поиска.
//
// Берём только то, что можно показывать в ролике с атрибуцией: public domain,
// CC0, CC BY, CC BY-SA. NC/ND, GFDL-only и «неизвестно» — никогда.
// WIKIMEDIA_LICENSES=pd,cc0,cc-by — сузить список (например, без BY-SA).

import type { Env } from "../types";

export type OpenLicense = "pd" | "cc0" | "cc-by" | "cc-by-sa";
export const OPEN_LICENSES: OpenLicense[] = ["pd", "cc0", "cc-by", "cc-by-sa"];

// Разрешённые лицензии из окружения; неизвестные слова игнорируем.
export function allowedLicenses(env: Env): Set<OpenLicense> {
  const raw = env.WIKIMEDIA_LICENSES?.trim().toLowerCase();
  if (!raw) return new Set(OPEN_LICENSES);
  const out = new Set<OpenLicense>();
  for (const w of raw.split(/[,;\s]+/)) if ((OPEN_LICENSES as string[]).includes(w)) out.add(w as OpenLicense);
  return out.size ? out : new Set(OPEN_LICENSES);
}

// Код лицензии Commons (extmetadata.License: "cc-by-sa-4.0", "pd", "cc0") или
// Openverse ("by-sa", "pdm") → семейство. null — несвободная или непонятная.
export function licenseFamily(code: string | null | undefined): OpenLicense | null {
  const c = (code ?? "").trim().toLowerCase();
  if (!c) return null;
  if (c === "pd" || c === "pdm" || c.startsWith("pd-") || c === "public domain") return "pd";
  if (c === "cc0" || c.startsWith("cc0-") || c === "cc-zero") return "cc0";
  const body = c.replace(/^cc-/, "");
  if (/^by-sa(-|$)/.test(body)) return "cc-by-sa";
  if (/^by(-\d|$)/.test(body)) return "cc-by";
  return null;
}

// Подпись лицензии для описания ролика: «CC BY-SA 4.0», «CC0», «общественное достояние».
export function licenseLabel(family: OpenLicense, short?: string | null, version?: string | null): string {
  if (family === "pd") return "общественное достояние";
  if (family === "cc0") return "CC0";
  const s = (short ?? "").trim();
  if (/^CC BY/i.test(s)) return s.replace(/\s+/g, " ");
  const v = (version ?? "").trim();
  return `${family === "cc-by-sa" ? "CC BY-SA" : "CC BY"}${v ? ` ${v}` : ""}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// HTML из extmetadata (Artist часто — ссылка на профиль) → короткий текст.
export function htmlToText(html: string | null | undefined, max = 80): string {
  let s = (html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(credit|author|автор)\s*:\s*/i, "");
  // Шаблон {{unknown}} на Commons даёт «Unknown authorUnknown author».
  const twice = /^(.{3,}?)\s*\1$/.exec(s);
  if (twice) s = twice[1]!;
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}

// Автор как текст; «Unknown author», «Uncredited» и т. п. — это не автор (null).
const NO_AUTHOR = /^(unknown( author| photographer)?|uncredited|anonymous|anonym|unbekannt|not provided|n\/a|неизвестный автор|автор неизвестен)$/i;
export function authorText(html: string | null | undefined): string | null {
  const s = htmlToText(html);
  return s && !NO_AUTHOR.test(s) ? s : null;
}

// Атрибуция для описания: «Автор (CC BY-SA 4.0)». Без автора у CC BY/BY-SA
// атрибуция неполная — такие файлы источники отбрасывают сами.
export function authorWithLicense(author: string | null, license: string): string {
  return author ? `${author} (${license})` : `автор не указан (${license})`;
}

// Слова запроса, которые есть почти в любом заголовке или описывают лишь
// обстановку («space», «museum», «reef»), — не доказательство, что файл про
// нужный объект: иначе длинный заголовок с «planet» и «space» обгоняет
// настоящее фото Венеры.
const WEAK = new Set(
  (
    "a an the of in on at with and or for to from by into over under near old vintage new close closeup up macro view top shot photo image picture detail details dark light night day modern ancient small big large " +
    "space planet museum desert reef ocean sea sky forest field street city room lab laboratory background landscape nature animal object people person building interior exterior studio display exhibit collection"
  ).split(" "),
);

// Значимые слова запроса (латиница, ≥ 3 букв, не служебные).
export function queryKeywords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !WEAK.has(w)))];
}

// Сколько значимых слов запроса есть в заголовке файла (по основе:
// «pyramids» ≈ «pyramid»). Поиск Commons ищет и по описанию/категориям — без
// этой проверки в выдачу попадают закаты и страницы книг; 0 — файл не берём,
// а из подходящих первым идёт тот, где совпало больше слов («octopus coral
// reef»: осьминог на кораллах важнее просто кораллов).
export function titleScore(title: string, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const t = title.toLowerCase();
  return keywords.filter((w) => t.includes(w.length >= 6 ? w.slice(0, w.length - 2) : w)).length;
}

// Сначала больше совпавших слов, при равенстве — порядок выдачи поиска.
export function byRelevance<T extends { score: number; order: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.score - a.score || a.order - b.order);
}

// Не фото: сканы страниц, карты, схемы, логотипы, марки, документы.
const JUNK_TITLE =
  /\b(page|pages|pg\.?\s?\d+|p\.\s?\d+|book|bulletin|journal|catalog(ue)?|guide to|account of|maps?|diagram|chart|graph|schematic|plan of|logo|flag|coat of arms|emblem|seal of|stamp|postage|document|letter|newspaper|manuscript|codebook|poster|screenshot|icon|signature|infographic)\b/i;
const JUNK_AUTHOR = /internet archive book images|biodiversity heritage library/i;
// Скан книги выдаёт себя подписью («Plate 16», «Fig. 3», «p. 130») или категорией.
const SCAN_TEXT = /\b(?:plate|fig(?:ure)?|page)\.?\s*[0-9ivxlc]+\b|\bpp?\.\s*\d+\b/i;
const SCAN_CATEGORY = /\b(book scans?|scanned|internet archive|biodiversity heritage library|pages? from|illustrations? from)\b/i;

export function looksLikeJunk(title: string, author: string | null, extra: { description?: string; credit?: string; categories?: string } = {}): boolean {
  if (JUNK_TITLE.test(title) || (author ? JUNK_AUTHOR.test(author) : false)) return true;
  if (SCAN_TEXT.test(`${extra.description ?? ""} ${extra.credit ?? ""}`)) return true;
  return SCAN_CATEGORY.test(extra.categories ?? "");
}

// Как показывать фото в кадре: близкое по пропорциям к кадру — на весь экран
// (cover), сильно другое (горизонтальное фото в Shorts) — целиком поверх
// размытой копии (contain): у реального фото важен весь сюжет, а не полоска из
// центра. Пороги — по соотношению сторон «ширина/высота».
export function fitFor(width: number, height: number, format: "shorts" | "landscape"): "cover" | "contain" {
  const a = width / height;
  return format === "shorts" ? (a <= 0.8 ? "cover" : "contain") : a >= 1.3 ? "cover" : "contain";
}

// Хватает ли пикселей: для cover — закрыть кадр с апскейлом не больше ×1.5,
// для contain — по ширине (Shorts) или высоте (горизонтальный ролик).
export function bigEnough(width: number, height: number, format: "shorts" | "landscape"): boolean {
  const a = width / height;
  if (!(a >= 0.35 && a <= 2.4)) return false; // панорамы и «полоски» не берём
  const fit = fitFor(width, height, format);
  // Небольшой апскейл (1024 → 1080) на телефоне незаметен.
  if (format === "shorts") return fit === "cover" ? height >= 1280 && width >= 720 : width >= 1000;
  return fit === "cover" ? width >= 1280 && height >= 720 : height >= 860;
}

// Понятный User-Agent обязателен по правилам Wikimedia и Openverse. Только
// ASCII: заголовки fetch не принимают кириллицу. WIKIMEDIA_USER_AGENT — свой
// (например, с контактом владельца канала).
export function userAgent(env: Env): string {
  const own = env.WIKIMEDIA_USER_AGENT?.trim();
  if (own && /^[\x20-\x7e]+$/.test(own)) return own;
  return "video-studio/0.1 (+https://github.com/Magamed56/yt-planner; educational shorts renderer)";
}
