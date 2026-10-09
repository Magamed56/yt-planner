// Всё за паролем: без входа — на /login (запросы к /api — ответ 401). Автопилот (/api/cron)
// проверяет свой ключ CRON_SECRET сам. /privacy и /terms открыты всем: их проверяет Google.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "./lib/session";

export function proxy(request: NextRequest) {
  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Нужно войти в панель." }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|privacy|terms|api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
