import { connection } from "next/server";
import CompetitorsView from "@/components/CompetitorsView";
import ErrorScreen from "@/components/ErrorScreen";
import { loadCompetitors } from "@/lib/competitors";
import { loadState } from "@/lib/load";

export const metadata = { title: "Похожие каналы — Суть за минуту" };

export default async function CompetitorsPage() {
  await connection();
  try {
    const [state, { refs, reports }] = await Promise.all([loadState(), loadCompetitors()]);
    return (
      <CompetitorsView
        shell={{ updated: state.updatedLabel, activeRuns: state.runs.filter((r) => r.active).length, runwayDays: state.runwayDays, runwayLabel: state.scheduleEndLabel }}
        refs={refs}
        reports={reports}
      />
    );
  } catch (e) {
    return <ErrorScreen message={e instanceof Error ? e.message : String(e)} />;
  }
}
