// «Подключить TikTok»: на страницу входа TikTok (Login Kit). Только после входа в панель.
import { requireSession } from "@/lib/auth";
import { authorizeUrl, newState, tiktokEnvMissing } from "@/lib/tiktok";

export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return Response.redirect(new URL("/login", request.url), 302);
  }
  const missing = tiktokEnvMissing();
  if (missing.length) return Response.redirect(new URL(`/tiktok?error=${encodeURIComponent(`Не заданы ${missing.join(", ")} в Vercel.`)}`, request.url), 302);
  return Response.redirect(authorizeUrl(new URL(request.url).origin, newState()), 302);
}
