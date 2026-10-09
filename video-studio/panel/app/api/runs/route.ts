// Лёгкий статус запусков для автообновления: только GitHub (список запусков и шаги идущих —
// 1–4 запроса), без плана и без YouTube. Панель спрашивает раз в 20 с, пока что-то идёт, и
// перерисовывает страницу целиком, только когда запуск появился или закончился.
import { errorText, sessionDenied } from "@/lib/push-api";
import { runsWithSteps } from "@/lib/load";
import { runInfos } from "@/lib/state";

export interface LiveRuns {
  active: { id: number; kind: string; codes: string[]; progress: import("@/lib/progress").RunProgress | null }[];
  signature: string; // id идущих через запятую — изменился, значит пора обновить страницу
}

export async function GET() {
  const denied = await sessionDenied();
  if (denied) return denied;
  try {
    const { runs, steps } = await runsWithSteps();
    // Пояс не важен: подписи времени здесь не нужны, только этапы и коды.
    const active = runInfos(runs, steps, "UTC")
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, kind: r.kind, codes: r.codes, progress: r.progress ?? null }));
    const body: LiveRuns = { active, signature: active.map((r) => r.id).sort((a, b) => a - b).join(",") };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: errorText(e) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
