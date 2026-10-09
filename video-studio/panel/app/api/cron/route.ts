// Ежедневный запуск автопилота (vercel.json → crons). Vercel присылает заголовок
// Authorization: Bearer <CRON_SECRET>; без него — 401.
import { timingSafeEqual } from "node:crypto";
import { runAutopilot } from "@/lib/autopilot";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(await runAutopilot("cron"));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
