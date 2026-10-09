import { after, connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import StatsView from "@/components/StatsView";
import { saveSnapshotQuietly } from "@/lib/history-store";
import { loadStats } from "./load";

export const metadata = { title: "Статистика — Суть за минуту" };

export default async function StatsPage() {
  await connection(); // всегда свежие цифры YouTube и GitHub
  let data: Awaited<ReturnType<typeof loadStats>>;
  try {
    data = await loadStats();
  } catch (e) {
    return <ErrorScreen title="Не получилось загрузить статистику" message={e instanceof Error ? e.message : String(e)} />;
  }
  const { state, stats, extras, listing, now } = data;
  // Снимок для истории трендов — после ответа и не чаще раза в 55 минут (как на главной).
  if (!state.youtubeError) after(() => saveSnapshotQuietly(listing, now, state.timezone));
  // В браузер — только цифры и то, что нужно меню (вся очередь здесь не нужна).
  return (
    <StatsView
      stats={stats}
      extras={extras}
      shell={{
        updated: state.updatedLabel,
        generatedAt: state.generatedAt,
        activeRuns: state.runs.filter((r) => r.active).length,
        runwayDays: state.runwayDays,
        runwayLabel: state.runwayLabel,
      }}
    />
  );
}
