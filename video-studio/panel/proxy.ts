// Всё за паролем: без входа — на /login (запросы к /api — ответ 401). Автопилот (/api/cron)
// проверяет свой ключ CRON_SECRET сам, /api/notify — PANEL_NOTIFY_SECRET, возврат из TikTok
// (/api/tiktok/callback) — подписанный state. /privacy и /terms открыты
// всем: их проверяет Google. Манифест, иконки и sw.js тоже открыты: телефон берёт их без cookie,
// иначе панель не встанет на экран «Домой».
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
  // Открытые страницы — только ровно эти пути (не «/login-что-угодно»).
  matcher: [
    "/((?!(?:login|privacy|terms|api/cron|api/notify|api/tiktok/callback)(?:/|$)|_next/static|_next/image|favicon.ico|icon.svg|apple-icon|icons/|manifest.webmanifest|sw.js).*)",
  ],
};
