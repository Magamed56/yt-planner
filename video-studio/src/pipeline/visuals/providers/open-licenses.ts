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

// Сначала выше балл «по теме» (relevance.ts), при равенстве — порядок выдачи поиска.
export function byRelevance<T extends { score: number; order: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.score - a.score || a.order - b.order);
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
// minShort — ещё и короткая сторона оригинала не меньше (Commons: 1080 —
// мелкие файлы там почти всегда старые сканы и плохие снимки).
export function bigEnough(width: number, height: number, format: "shorts" | "landscape", minShort = 0): boolean {
  const a = width / height;
  if (!(a >= 0.35 && a <= 2.4)) return false; // панорамы и «полоски» не берём
  if (Math.min(width, height) < minShort) return false;
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
