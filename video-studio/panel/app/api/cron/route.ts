// Ежедневный запуск автопилота (vercel.json → crons): сборки и запас сценариев, затем повтор
// упавших запусков и уборка видео из релизов, в конце — сводка на телефон (если заданы ключи
// VAPID). Vercel присылает заголовок Authorization: Bearer <CRON_SECRET>; без него — 401.
import { timingSafeEqual } from "node:crypto";
import { runAutopilot } from "@/lib/autopilot";
import { loadState } from "@/lib/load";
import { notifyDevices, vapidSetup } from "@/lib/push";
import { dailySummary } from "@/lib/push-summary";

// Автопилот укладывается в 40 с, остальное — запас на сводку (Hobby разрешает до 300 с).
export const maxDuration = 90;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  try {
    const run = await runAutopilot("cron");
    // Сводка — и при выключенном автопилоте; без ключей VAPID не тратим запросы на очередь.
    let push: Awaited<ReturnType<typeof notifyDevices>> | null = null;
    if (vapidSetup().keys) {
      const state = run.state ?? (await loadState().catch(() => null));
      const msg = state ? dailySummary(state) : null;
      if (msg) push = await notifyDevices(msg);
    }
    // Частичный сбой (GitHub отказал в одном из действий) виден в логах Vercel как 500.
    return Response.json({ ...run.last, errors: run.errors, push }, { status: run.errors.length ? 500 : 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
