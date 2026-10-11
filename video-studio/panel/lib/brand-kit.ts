// Бренд-кит канала другого языка (video-studio/brand/<язык>/: баннер, аватар, водяной знак,
// картинки Instagram и README) — блок «Оформление канала» на странице /lang/<язык>.
// Описание и ключевые слова живут только в README (блоки ``` под «### Описание канала» и
// «### Ключевые слова»): панель вырезает их оттуда, поэтому инструкция и кнопки «Скопировать»
// не разойдутся. Чистые функции без сети и файлов — их проверяет scripts/brand-kit-test.ts.
import { DEFAULT_LANG, normalizeLang } from "../../src/pipeline/lang";
import type { LoadFile } from "./downloads";

// Папка кита относительно video-studio (`npm run brand -- --channel=en` → brand/en/).
export const brandDir = (lang: string): string => `brand/${lang}`;

export interface KitSpec {
  path: string; // внутри brand/<язык>/, через «/»
  label: string; // подпись кнопки
  width: number;
  height: number;
  where: string; // куда загружать
}

// Что ставится в канал YouTube — в этом порядке и на странице. Имена и размеры — как рисует
// `npm run brand` (src/remotion/brand/jobs.ts); тест сверяет их с jobs.ts и самими PNG.
export const YOUTUBE_KIT: KitSpec[] = [
  { path: "banner-youtube.png", label: "Баннер", width: 2560, height: 1440, where: "баннер канала" },
  { path: "avatar-youtube.png", label: "Аватар", width: 800, height: 800, where: "фото профиля" },
  { path: "watermark-youtube.png", label: "Водяной знак", width: 150, height: 150, where: "водяной знак (Studio)" },
];

export const INSTAGRAM_KIT: KitSpec[] = [
  { path: "avatar-instagram.png", label: "Аватар Instagram", width: 1080, height: 1080, where: "фото профиля Instagram" },
  { path: "instagram-post-intro.png", label: "Пост-знакомство", width: 1080, height: 1350, where: "первый пост Instagram" },
];

// Обложки «Актуального» — по одной на рубрику канала: highlights/<рубрика>.png (1080×1920).
export const HIGHLIGHT = { width: 1080, height: 1920 };
const HIGHLIGHT_PATH = /^highlights\/([a-z0-9][a-z0-9-]{0,40})\.png$/;

// Ответ маршрута — целиком, без потока: укладываемся в лимит ответа функции Vercel (4,5 МБ).
// Самый большой файл кита — баннер, ≈ 1,2 МБ (лимит YouTube — 6 МБ).
export const BRAND_MAX_BYTES = 4 * 1024 * 1024;

export function isKitPath(path: string): boolean {
  return YOUTUBE_KIT.some((k) => k.path === path) || INSTAGRAM_KIT.some((k) => k.path === path) || HIGHLIGHT_PATH.test(path);
}

// Маршрут /api/brand/<язык>/<файл…> → путь в репозитории относительно video-studio. Только
// язык другого канала в точном написании и только файл кита — иначе null: через маршрут не
// прочитать остальной (приватный) репозиторий.
export function brandFilePath(lang: string, segments: string[]): string | null {
  if (lang === DEFAULT_LANG || normalizeLang(lang) !== lang) return null;
  const path = segments.join("/");
  return isKitPath(path) ? `${brandDir(lang)}/${path}` : null;
}

// Имя при скачивании — с языком, как у роликов («en-08a-….mp4»): русский кит зовётся так же.
export const brandDownloadName = (lang: string, path: string): string => `${lang}-${path.replace(/^highlights\//, "highlight-")}`;

// Картинка через панель: репозиторий приватный, прямые ссылки GitHub без токена не откроются.
// ?v=<sha> — у новой версии файла новый адрес, поэтому прежнюю браузер может держать неделю.
export function brandSrc(lang: string, path: string, sha: string): string {
  const v = sha ? `?v=${encodeURIComponent(sha.slice(0, 12))}` : "";
  return `/api/brand/${lang}/${path.split("/").map(encodeURIComponent).join("/")}${v}`;
}

// ---- тексты из README ----

export const README_BLOCKS = {
  description: "Описание канала",
  keywords: "Ключевые слова",
  post: "Подпись к посту-знакомству",
} as const;

export const DESCRIPTION_MAX = 1000; // поле «Описание» канала в YouTube

export interface BrandTexts {
  description: string | null;
  keywords: string | null;
  post: string | null; // подпись к посту-знакомству в Instagram
}

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;

// Текст блока ``` (или ~~~) под заголовком heading — до следующего заголовка; без рамки и
// пустых строк по краям. Нет заголовка, блока или он пустой — null.
export function readmeBlock(md: string, heading: string): string | null {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const h = lines.findIndex((l) => HEADING.exec(l)?.[1] === heading);
  if (h < 0) return null;
  for (let i = h + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i]!)) return null; // следующий раздел начался, а блока не было
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    const end = lines.findIndex((l, j) => j > i && close.test(l));
    if (end < 0) return null; // рамку не закрыли — лучше ничего, чем половина README
    return lines.slice(i + 1, end).join("\n").trim() || null;
  }
  return null;
}

export function brandTextsOf(md: string | null): BrandTexts {
  if (!md) return { description: null, keywords: null, post: null };
  const keywords = readmeBlock(md, README_BLOCKS.keywords);
  return {
    description: readmeBlock(md, README_BLOCKS.description),
    // В поле «Ключевые слова» — одна строка: перенос в README не должен склеить два слова.
    keywords: keywords ? keywords.replace(/\s*\n\s*/g, " ") : null,
    post: readmeBlock(md, README_BLOCKS.post),
  };
}

// Знаки, как их считает поле YouTube: по символам, а не по UTF-16.
export const charCount = (text: string): number => [...text].length;

// ---- кит для страницы ----

// Файл кита для FilesSaver (key, code, name, size, src, href) + подписи.
export interface BrandFile extends LoadFile {
  path: string;
  label: string;
  width: number;
  height: number;
  where: string;
}

export interface KitEntry {
  path: string; // относительно brand/<язык>/
  size: number;
  sha: string; // sha файла в git: новая версия — новый адрес картинки
}

export interface BrandKit {
  lang: string;
  youtube: BrandFile[]; // баннер, аватар, водяной знак — что есть в папке
  instagram: BrandFile[]; // аватар, обложки «Актуального», пост-знакомство
  texts: BrandTexts;
  readmeUrl: string | null; // README на GitHub — полная инструкция
}

// Кит по списку файлов папки (entries) и README. Нет ни одного файла YouTube — null: блок
// «Оформление канала» не показываем (у kk и uz кита пока нет).
export function brandKitOf(lang: string, entries: KitEntry[], readme: string | null, readmeUrl: string | null = null): BrandKit | null {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const file = (spec: KitSpec): BrandFile[] => {
    const e = byPath.get(spec.path);
    if (!e || !isKitPath(spec.path)) return [];
    const src = brandSrc(lang, spec.path, e.sha);
    return [{ ...spec, key: spec.path, code: lang, name: brandDownloadName(lang, spec.path), size: e.size, src, href: `${src}${src.includes("?") ? "&" : "?"}download=1` }];
  };
  const youtube = YOUTUBE_KIT.flatMap(file);
  if (!youtube.length) return null;
  const highlights = entries
    .map((e) => HIGHLIGHT_PATH.exec(e.path)?.[1])
    .filter((id): id is string => Boolean(id))
    .sort()
    .flatMap((id) => file({ path: `highlights/${id}.png`, label: `«Актуальное»: ${id}`, ...HIGHLIGHT, where: "обложка «Актуального»" }));
  const [avatar, post] = INSTAGRAM_KIT;
  return {
    lang,
    youtube,
    instagram: [...file(avatar!), ...highlights, ...file(post!)],
    texts: brandTextsOf(readme),
    readmeUrl,
  };
}
