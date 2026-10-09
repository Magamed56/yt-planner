import { after, connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import QueueView from "@/components/QueueView";
import { saveSnapshotQuietly } from "@/lib/history-store";
import { loadState } from "@/lib/load";
import type { PanelState } from "@/lib/state";
import { channelOverview } from "@/lib/youtube";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection(); // всегда свежие данные GitHub и YouTube
  const { view } = await searchParams;
  let state: PanelState;
  // Тот же проход по YouTube, что и раньше: part=statistics у channels.list квоту не добавляет,
  // а подписчики нужны для истории.
  const now = new Date();
  const listing = channelOverview();
  listing.catch(() => {}); // ошибку YouTube покажет очередь
  try {
    state = await loadState(now, listing.then((l) => l.videos));
  } catch (e) {
    return <ErrorScreen message={e instanceof Error ? e.message : String(e)} />;
  }
  // История для трендов — после ответа: страница не ждёт GitHub. Не чаще раза в 55 минут.
  if (!state.youtubeError) after(() => saveSnapshotQuietly(listing, now, state.timezone));
  return <QueueView state={state} initialMode={view === "calendar" ? "calendar" : "feed"} />;
}
