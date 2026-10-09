import { connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import QueueView from "@/components/QueueView";
import { loadState } from "@/lib/load";
import type { PanelState } from "@/lib/state";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection(); // всегда свежие данные GitHub и YouTube
  const { view } = await searchParams;
  let state: PanelState;
  try {
    state = await loadState();
  } catch (e) {
    return <ErrorScreen message={e instanceof Error ? e.message : String(e)} />;
  }
  return <QueueView state={state} initialMode={view === "calendar" ? "calendar" : "list"} />;
}
