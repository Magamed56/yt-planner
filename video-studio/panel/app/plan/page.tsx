import { connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import PlanView, { type PlanPosition, type PlanTopic } from "@/components/PlanView";
import { readFileWithSha } from "@/lib/github";
import { loadState, STUDIO_DIR } from "@/lib/load";
import { lockedCodes, movableIds } from "@/lib/plan-order";
import type { PanelState } from "@/lib/state";
import { STAGE_LABEL } from "@/lib/stages";
import { parsePlan } from "../../../src/pipeline/plan";

export const metadata = { title: "План — Суть за минуту" };

// Порядок тем: план из ветки (с sha — сохранение не затрёт чужую правку) + очередь панели
// (что уже со сценарием, видео или в работе — такие темы стоят на месте).
export default async function PlanPage() {
  await connection();
  let state: PanelState;
  let sha: string;
  let positions: PlanPosition[];
  let topics: Record<string, PlanTopic>;
  let movable: string[];
  try {
    const [s, file] = await Promise.all([loadState(), readFileWithSha(`${STUDIO_DIR}/content/plan.json`)]);
    if (!file) throw new Error(`В ветке нет ${STUDIO_DIR}/content/plan.json.`);
    const plan = parsePlan(JSON.parse(file.text));
    state = s;
    sha = file.sha;
    movable = movableIds(plan, lockedCodes(s.rows));
    const pillar = new Map((plan.pillars ?? []).map((p) => [p.id, p.title]));
    const rows = new Map(s.rows.map((r) => [r.code, r]));
    const free = new Set(movable);
    topics = Object.fromEntries(plan.items.map((it) => [it.id, { title: it.title, hook: it.hook, pillarId: it.pillar, pillar: pillar.get(it.pillar) ?? it.pillar }]));
    // Вышедшие — уже история: показываем то, что впереди.
    positions = plan.items
      .filter((it) => rows.get(it.id)?.stage !== "published")
      .map((it) => {
        const r = rows.get(it.id);
        const lock = free.has(it.id) ? null : r?.running ? `в работе: ${r.running}` : r && r.stage !== "topic" ? STAGE_LABEL[r.stage] : "есть сценарий";
        return { id: it.id, when: r?.dateLabel ? `${r.dateLabel} ${r.timeLabel}` : `день ${it.day}, ${it.slot}`, exact: Boolean(r?.whenExact), lock };
      });
  } catch (e) {
    return <ErrorScreen message={e instanceof Error ? e.message : String(e)} />;
  }
  // key = sha: после сохранения план новый — порядок на экране начинается заново.
  return <PlanView key={sha} state={state} sha={sha} positions={positions} topics={topics} movable={movable} />;
}
