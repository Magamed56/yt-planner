// Ежедневный запуск автопилота (vercel.json → crons): сборки и запас сценариев, затем повтор
// упавших запусков и уборка видео из релизов, в конце — сводка на телефон (если заданы ключи
// VAPID). Vercel присылает заголовок Authorization: Bearer <CRON_SECRET>; без него — 401.
import { timingSafeEqual } from "node:crypto";
import { runAutopilot } from "@/lib/autopilot";
import { saveSnapshotQuietly } from "@/lib/history-store";
import { loadState } from "@/lib/load";
import { notifyDevices, vapidSetup } from "@/lib/push";
import { dailySummary } from "@/lib/push-summary";
import { channelOverview } from "@/lib/youtube";

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
      const summary = state ? dailySummary(state) : null;
      // Что автопилот запустил — первой строкой (только если что-то запущено).
      const auto = run.did.length ? `Автопилот: ${run.did.join("; ")}` : "";
      const msg = summary ? (auto ? { ...summary, body: `${auto} · ${summary.body}` } : summary) : auto ? { title: "Автопилот запустил сборку", body: auto, url: "/runs", tag: "daily" } : null;
      if (msg) push = await notifyDevices(msg);
    }
    // Точка истории цифр канала на каждый день — даже если панель неделю не открывали.
    await saveSnapshotQuietly(channelOverview(), new Date(), run.state?.timezone ?? "Europe/Moscow", { force: true });
    // Частичный сбой (GitHub отказал в одном из действий) виден в логах Vercel как 500.
    return Response.json({ ...run.last, errors: run.errors, push }, { status: run.errors.length ? 500 : 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
