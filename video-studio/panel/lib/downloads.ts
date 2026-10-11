// Какие файлы релизов скачать и как их назвать: видео, вертикальная обложка (Reels, TikTok),
// обложка YouTube — у одного ролика или сразу у нескольких. Чистые функции без DOM и сети: их
// зовут и браузер (карточка ролика, «Скачать выбранные»), и scripts/files-test.ts.
import type { ReleaseInfo } from "./state";

export type FileKind = "video" | "cover" | "thumb";

export const FILE_KINDS: FileKind[] = ["video", "cover", "thumb"];

export const KIND_LABEL: Record<FileKind, string> = {
  video: "Видео",
  cover: "Обложка 9:16 — Reels, TikTok",
  thumb: "Обложка YouTube 16:9",
};

export interface SaveItem {
  code: string;
  release: Pick<ReleaseInfo, "mp4" | "cover" | "thumb">;
}

export interface SaveFile {
  key: string;
  code: string;
  kind: FileKind;
  assetId: number;
  name: string; // имя на диске и в «Фото»: с кодом ролика
  size: number;
}

// «cover.jpg» → «08a-cover.jpg»: у каждого релиза обложки называются одинаково, и пачка
// скачанных файлов иначе станет «cover (1).jpg», «cover (2).jpg». Видео уже с кодом.
export function downloadName(code: string, assetName: string): string {
  return assetName.toLowerCase().startsWith(`${code.toLowerCase()}-`) ? assetName : `${code}-${assetName}`;
}

const extOf = (name: string) => /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase() ?? "";

// Имя из адреса (?name=) — только безопасное (латиница, цифры, «_.-») и с тем же расширением,
// что у файла релиза; иначе — имя файла релиза.
export function safeDownloadName(requested: string | null, actual: string): string {
  if (!requested || requested.length > 150 || !/^\w[\w.-]*$/.test(requested)) return actual;
  return extOf(requested) === extOf(actual) ? requested : actual;
}

export function filesOf(items: SaveItem[], kinds: FileKind[]): SaveFile[] {
  const out: SaveFile[] = [];
  for (const it of items) {
    for (const kind of FILE_KINDS) {
      if (!kinds.includes(kind)) continue;
      const a = kind === "video" ? it.release.mp4 : kind === "cover" ? it.release.cover : it.release.thumb;
      if (a) out.push({ key: `${it.code}-${kind}`, code: it.code, kind, assetId: a.id, name: downloadName(it.code, a.name), size: a.size });
    }
  }
  return out;
}

// Сколько файлов каждого вида есть у выбранных роликов (у старых релизов обложек может не быть).
export function kindTotals(items: SaveItem[]): Record<FileKind, { count: number; size: number }> {
  const out = Object.fromEntries(FILE_KINDS.map((k) => [k, { count: 0, size: 0 }])) as Record<FileKind, { count: number; size: number }>;
  for (const f of filesOf(items, FILE_KINDS)) {
    out[f.kind].count += 1;
    out[f.kind].size += f.size;
  }
  return out;
}

// Ссылка «скачать файлом». Видео — редирект на временную ссылку GitHub (большой файл идёт мимо
// функции Vercel, имя и так с кодом); обложки — через панель, чтобы встало имя с кодом.
export function fileHref(f: Pick<SaveFile, "assetId" | "kind" | "name">): string {
  return f.kind === "video" ? `/api/asset/${f.assetId}` : `/api/asset/${f.assetId}/file?download=1&name=${encodeURIComponent(f.name)}`;
}

// Размер на кнопке и в прогрессе: меньше мегабайта — в КБ (водяной знак — 17 КБ, а не «0,0 МБ»).
// unit — по какому числу выбрать единицу: прогресс идёт в единицах всего файла («0,4 из 25,0 МБ»,
// а не «0 КБ из 25,0 МБ»). Граница — по округлённым КБ: «1024 КБ» не бывает, это уже «1,0 МБ».
export function sizeLabel(bytes: number, unit = bytes): string {
  if (Math.round(unit / 1024) < 1024) return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} МБ`;
}

// Что FilesSaver скачивает на самом деле: src — байты через панель (для меню «Поделиться» на
// телефоне; кусками с Range или целиком), href — ссылка «скачать файлом». Так через тот же
// FilesSaver идут и файлы релизов, и картинки бренд-кита канала (lib/brand-kit.ts).
export interface LoadFile {
  key: string;
  code: string; // файлы с одним code не разрываются между частями «Поделиться»
  name: string;
  size: number;
  src: string;
  href: string;
}

export const loadFileOf = (f: SaveFile): LoadFile => ({ key: f.key, code: f.code, name: f.name, size: f.size, src: `/api/asset/${f.assetId}/file`, href: fileHref(f) });

// Пакет для меню «Поделиться» на телефоне: столько файлов сразу держать в памяти и отдавать
// одним меню рискованно, поэтому — частями. Файлы одного ролика стараются не разрывать; ролик
// больше лимита идёт отдельной частью (по файлу, если и так не помещается).
export function shareGroups<T extends { code: string; size: number }>(files: T[], maxFiles: number, maxBytes: number): T[][] {
  const groups: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    bytes = 0;
  };
  const byCode: T[][] = [];
  for (const f of files) {
    const last = byCode.at(-1);
    if (last && last[0]!.code === f.code) last.push(f);
    else byCode.push([f]);
  }
  for (const set of byCode) {
    const size = set.reduce((s, f) => s + f.size, 0);
    if (cur.length && (cur.length + set.length > maxFiles || bytes + size > maxBytes)) flush();
    if (set.length <= maxFiles && size <= maxBytes) {
      cur.push(...set);
      bytes += size;
      continue;
    }
    for (const f of set) {
      if (cur.length && (cur.length + 1 > maxFiles || bytes + f.size > maxBytes)) flush();
      cur.push(f);
      bytes += f.size;
    }
  }
  flush();
  return groups;
}
