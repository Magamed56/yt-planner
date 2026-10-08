import { connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import QueueView from "@/components/QueueView";
import { loadState } from "@/lib/load";
import type { PanelState } from "@/lib/state";

export default async function QueuePage() {
  await connection(); // всегда свежие данные GitHub и YouTube
  let state: PanelState;
  try {
    state = await loadState();
  } catch (e) {
    return <ErrorScreen message={e instanceof Error ? e.message : String(e)} />;
  }
  return <QueueView state={state} />;
}
