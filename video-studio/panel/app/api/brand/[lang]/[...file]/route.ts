// Картинка бренд-кита канала другого языка (video-studio/brand/<язык>/…) через панель:
// репозиторий приватный — прямой ссылкой GitHub браузер её не откроет, а токен остаётся здесь.
// Тот же файл байт в байт: превью на /lang/<язык>, «Сохранить в Фото» на iPhone (FilesSaver
// берёт его целиком — ответ 200 на любой Range) и ?download=1 — файлом с языком в имени.
import { contentDisposition } from "@/lib/asset-range";
import { requireSession } from "@/lib/auth";
import { BRAND_MAX_BYTES, brandDownloadName, brandFilePath } from "@/lib/brand-kit";
import { readFileBytes } from "@/lib/github";
import { STUDIO_DIR } from "@/lib/load";

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ lang: string; file: string[] }> }) {
  try {
    await requireSession();
  } catch {
    return text(401, "Нужно войти в панель.");
  }
  const { lang, file } = await params;
  const path = brandFilePath(lang, file);
  if (!path) return text(404, "Такого файла в бренд-ките нет.");
  const query = new URL(request.url).searchParams;
  try {
    const bytes = await readFileBytes(`${STUDIO_DIR}/${path}`, BRAND_MAX_BYTES);
    if (!bytes) return text(404, `Файла ${path} нет в ветке — перерисуйте кит (npm run brand -- --channel=${lang}) и закоммитьте.`);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": contentDisposition(brandDownloadName(lang, file.join("/")), query.get("download") === "1"),
        // ?v=<sha> — адрес меняется вместе с файлом: такую картинку браузер держит неделю.
        "Cache-Control": query.get("v") ? "private, max-age=604800, immutable" : "private, max-age=300",
      },
    });
  } catch (e) {
    return text(502, e instanceof Error ? e.message : String(e));
  }
}
