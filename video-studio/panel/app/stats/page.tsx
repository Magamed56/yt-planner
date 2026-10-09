import { connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import StatsView from "@/components/StatsView";
import { loadStats } from "./load";

export const metadata = { title: "Статистика — Суть за минуту" };

export default async function StatsPage() {
  await connection(); // всегда свежие цифры YouTube и GitHub
  let data: Awaited<ReturnType<typeof loadStats>>;
  try {
    data = await loadStats();
  } catch (e) {
    return <ErrorScreen message={e instanceof Error ? e.message : String(e)} />;
  }
  const { state, stats } = data;
  // В браузер — только цифры и то, что нужно меню (вся очередь здесь не нужна).
  return (
    <StatsView
      stats={stats}
      shell={{
        updated: state.updatedLabel,
        activeRuns: state.runs.filter((r) => r.active).length,
        runwayDays: state.runwayDays,
        runwayLabel: state.scheduleEndLabel,
      }}
    />
  );
}
