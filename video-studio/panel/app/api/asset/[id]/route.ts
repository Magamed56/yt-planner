// Скачать файл релиза (видео, обложку): редирект на временную ссылку GitHub — файл идёт
// в браузер напрямую, мимо функции Vercel (у неё лимит ответа 4,5 МБ).
import { requireSession } from "@/lib/auth";
import { assetDownloadUrl } from "@/lib/github";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
  } catch {
    return new Response("Нужно войти в панель.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response("Неверный файл.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  try {
    // Временная ссылка GitHub живёт ~5 минут — на 4 минуты браузер может переиспользовать
    // редирект (обложки в очереди не дёргают GitHub при каждой перерисовке).
    return new Response(null, { status: 302, headers: { Location: await assetDownloadUrl(Number(id)), "Cache-Control": "private, max-age=240" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
