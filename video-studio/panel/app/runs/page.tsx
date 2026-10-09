import { connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import RunsView from "@/components/RunsView";
import { loadState } from "@/lib/load";
import type { PanelState } from "@/lib/state";

export const metadata = { title: "Запуски — Суть за минуту" };

export default async function RunsPage() {
  await connection();
  let state: PanelState;
  try {
    state = await loadState();
  } catch (e) {
    return <ErrorScreen title="Не получилось загрузить запуски" message={e instanceof Error ? e.message : String(e)} />;
  }
  return <RunsView state={state} />;
}
