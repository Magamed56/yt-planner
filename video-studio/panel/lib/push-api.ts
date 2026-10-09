// Общее для маршрутов /api/push/*: проверка входа и ответы JSON { ok, message } для карточки.
import { requireSession } from "./auth";

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function reply(ok: boolean, message: string, status = ok ? 200 : 400, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

// null — вход в порядке; иначе готовый ответ 401. proxy.ts тоже не пустит без входа, но маршрут
// проверяет сам: так он защищён и при правке matcher.
export async function sessionDenied(): Promise<Response | null> {
  try {
    await requireSession();
    return null;
  } catch (e) {
    return reply(false, errorText(e), 401);
  }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const j: unknown = await request.json();
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const endpointOf = (body: Record<string, unknown>) => (typeof body.endpoint === "string" ? body.endpoint.trim() : "");
