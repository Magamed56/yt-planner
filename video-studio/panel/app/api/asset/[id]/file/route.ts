// Файл релиза потоком через панель — для плеера в карточке и «Сохранить в Фото» на iPhone.
// Временная ссылка GitHub отдаёт octet-stream + attachment и без CORS: Safari такое видео не
// играет, а скрипт страницы не может его прочитать. Здесь тот же файл байт в байт, но video/mp4
// и с диапазонами (206). Тело — поток, не буфер: у функции Vercel лимит 4,5 МБ на обычный ответ.
import { requireSession } from "@/lib/auth";
import { ASSET_CHUNK, assetHeaders, assetType, planRange, type RangePlan } from "@/lib/asset-range";
import { assetDownloadUrl, assetInfo } from "@/lib/github";

export const maxDuration = 60;

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

// Ссылка хранилища живёт ~5 минут: плеер просит файл кусками, и за каждым куском в API GitHub
// не ходим — имя, размер и ссылку помним 4 минуты.
type Cached = { name: string; size: number; type: string; url: string; until: number };
const cache = new Map<number, Cached>();

async function asset(id: number, fresh: boolean): Promise<Cached> {
  const hit = cache.get(id);
  if (!fresh && hit && hit.until > Date.now()) return hit;
  const [info, url] = await Promise.all([assetInfo(id), assetDownloadUrl(id)]);
  const entry = { name: info.name, size: info.size, type: assetType(info.name, info.contentType), url, until: Date.now() + 4 * 60_000 };
  cache.set(id, entry);
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return entry;
}

// Без токена GitHub: ссылка уже подписана. Таймаут — чуть меньше лимита функции.
function storage(url: string, plan: RangePlan): Promise<Response> {
  return fetch(url, {
    headers: plan.status === 206 ? { Range: `bytes=${plan.start}-${plan.end}` } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
  } catch {
    return text(401, "Нужно войти в панель.");
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return text(400, "Неверный файл.");
  // ?download=1 — скачать файлом; без ограничения куска: менеджер загрузок докачивает сам.
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    let a = await asset(Number(id), false);
    const plan = planRange(request.headers.get("range"), a.size, download ? 0 : ASSET_CHUNK);
    const headers = assetHeaders(a.name, a.type, a.size, plan, download);
    if (plan.status === 416) return new Response(null, { status: 416, headers });
    let up = await storage(a.url, plan);
    if (up.status === 401 || up.status === 403 || up.status === 404) {
      // Ссылка истекла раньше, чем мы думали, — берём новую.
      await up.body?.cancel().catch(() => {});
      a = await asset(Number(id), true);
      up = await storage(a.url, plan);
    }
    if (up.status !== plan.status || !up.body) {
      await up.body?.cancel().catch(() => {});
      return text(502, `GitHub не отдал файл (HTTP ${up.status}) — попробуйте ещё раз.`);
    }
    return new Response(up.body, { status: plan.status, headers });
  } catch (e) {
    return text(502, e instanceof Error ? e.message : String(e));
  }
}
