// Уведомление на все подписанные устройства — для машин: шаг workflow «видео готово» и т. п.
// Вход — заголовок Authorization: Bearer <PANEL_NOTIFY_SECRET> (подходит и CRON_SECRET);
// proxy.ts пропускает этот путь без cookie. Тело: { "title": "…", "body": "…", "url": "/" }.
import { createHash, timingSafeEqual } from "node:crypto";
import { messageFromInput, notifyDevices } from "@/lib/push";

export const maxDuration = 30;

function authorized(header: string | null): boolean {
  // Сравниваем отпечатки одной длины: время ответа не выдаёт ни ключ, ни его длину.
  const got = createHash("sha256").update(header ?? "").digest();
  let ok = false;
  for (const name of ["PANEL_NOTIFY_SECRET", "CRON_SECRET"]) {
    const secret = process.env[name]?.trim();
    if (secret && timingSafeEqual(got, createHash("sha256").update(`Bearer ${secret}`).digest())) ok = true;
  }
  return ok;
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  let input: unknown = null;
  try {
    input = await request.json();
  } catch {
    // не JSON — ниже ответим 400
  }
  const msg = messageFromInput(input);
  if (!msg) return Response.json({ ok: false, message: "Нужен JSON { title, body, url }: title обязателен." }, { status: 400 });
  // Сутки: телефон мог быть выключен, а «видео готово» нужно и вечером.
  const report = await notifyDevices(msg, { ttl: 24 * 3600 });
  return Response.json({ ok: !report.problem && report.failed === 0, ...report }, { status: report.problem ? 503 : 200 });
}
