// Проверка релиза для карточки ролика: qc.json и description.txt → короткие факты (lib/checks.ts).
// Маршрут, а не действие сервера: действия Next.js клиент шлёт строго по одному, и пока GitHub
// отвечает, ждали бы и кнопки карточки, и обновление страницы. Обычный GET идёт параллельно,
// его можно оборвать при закрытии карточки, а браузер помнит ответ (файлы релиза не меняются:
// новая сборка — новые id).
import { requireSession } from "@/lib/auth";
import { parseCredits, parseQc, type FileFacts, type ReleaseFacts } from "@/lib/checks";
import { assetText } from "@/lib/github";

export const maxDuration = 30;

const assetId = (v: string | null) => (v && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Один файл: нет в релизе — «missing», не скачался или битый — «error» (второй файл это не ломает).
async function load<T>(id: number | null, parse: (text: string) => T | null, broken: string): Promise<FileFacts<T>> {
  if (id === null) return { state: "missing" };
  try {
    const data = parse(await assetText(id));
    return data ? { state: "ok", data } : { state: "error", message: broken };
  } catch (e) {
    return { state: "error", message: errorText(e) };
  }
}

export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return Response.json({ error: "Нужно войти в панель." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const q = new URL(request.url).searchParams;
  const [qc, credits] = await Promise.all([
    load(assetId(q.get("qc")), parseQc, "qc.json повреждён"),
    load(assetId(q.get("description")), parseCredits, "description.txt повреждён"),
  ]);
  const facts: ReleaseFacts = { qc, credits };
  // Сбой GitHub не запоминаем — следующее открытие карточки спросит заново.
  const failed = qc.state === "error" || credits.state === "error";
  return Response.json(facts, { headers: { "Cache-Control": failed ? "no-store" : "private, max-age=86400" } });
}
