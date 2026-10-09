// Файл релиза через панель (маршрут /api/asset/[id]/file): какой кусок отдать и с какими
// заголовками. Safari на iPhone играет видео и даёт сохранить его в «Фото», только если ответ —
// video/mp4 с диапазонами (206); временная ссылка GitHub отдаёт octet-stream, attachment и без
// CORS. Чистые функции без импортов — их зовут и маршрут, и браузер, и scripts/ops-test.ts.

// Плееру и «Подготовить видео» — куски не больше 4 МБ: каждый ответ укладывается в лимит
// функции Vercel (4,5 МБ) и в её время, а следующий кусок браузер просит сам.
export const ASSET_CHUNK = 4 * 1024 * 1024;

export type RangePlan = { status: 200 } | { status: 206; start: number; end: number } | { status: 416 };

// Range → что отдать. Нет заголовка или он кривой — файл целиком (200); за концом файла — 416.
// chunk = 0 — без ограничения куска (скачивание файлом: менеджер загрузок докачивает сам).
export function planRange(header: string | null, size: number, chunk = ASSET_CHUNK): RangePlan {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").split(",")[0]!.trim());
  if (!m || (m[1] === "" && m[2] === "")) return { status: 200 };
  let start: number;
  let end: number;
  if (m[1] === "") {
    // «bytes=-500» — последние 500 байт
    const n = Number(m[2]);
    if (!(n > 0) || size <= 0) return { status: 416 };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] !== "" && Number(m[2]) < start) return { status: 200 };
    if (start >= size) return { status: 416 };
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return { status: 206, start, end: chunk > 0 ? Math.min(end, start + chunk - 1) : end };
}

const TYPES: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", srt: "application/x-subrip", txt: "text/plain; charset=utf-8", json: "application/json" };

// mp4 — всегда video/mp4 (у GitHub бывает octet-stream); остальное — тип файла релиза или по расширению.
export function assetType(name: string, uploaded: string | null): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (ext === "mp4") return "video/mp4";
  if (uploaded && uploaded !== "application/octet-stream") return uploaded;
  return TYPES[ext] ?? "application/octet-stream";
}

// inline — открыть в браузере (плеер), attachment — скачать файлом. Имя: ASCII в filename,
// как есть — в filename* (RFC 6266).
export function contentDisposition(name: string, download: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function assetHeaders(name: string, type: string, size: number, plan: RangePlan, download: boolean): Record<string, string> {
  // Обложки браузер держит у себя неделю: у файла релиза номер не меняется вместе с содержимым
  // (новая версия — новый номер), а лента и календарь показывают их десятками.
  const cache = type.startsWith("image/") ? "private, max-age=604800, immutable" : "private, no-store";
  const base: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache };
  if (plan.status === 416) return { ...base, "Content-Range": `bytes */${size}` };
  base["Content-Disposition"] = contentDisposition(name, download);
  if (plan.status === 206) return { ...base, "Content-Range": `bytes ${plan.start}-${plan.end}/${size}`, "Content-Length": String(plan.end - plan.start + 1) };
  return { ...base, "Content-Length": String(size) };
}

// Для браузера: «bytes 0-4194303/20000000» → { start, end, total }.
export function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec((value ?? "").trim());
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null;
}
