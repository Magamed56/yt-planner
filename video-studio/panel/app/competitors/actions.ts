"use server";
// Список похожих каналов — переменная репозитория PANEL_COMPETITORS. Отдельный файл действий,
// чтобы не смешивать с действиями очереди (app/actions.ts).
import { requireSession } from "@/lib/auth";
import { COMPETITORS_VAR, MAX_COMPETITORS, channelRef, parseCompetitors } from "@/lib/competitors";
import { getVariable, setVariable } from "@/lib/github";

export interface CompetitorsResult {
  ok: boolean;
  message: string;
}

async function guarded(fn: () => Promise<string>): Promise<CompetitorsResult> {
  try {
    await requireSession();
    return { ok: true, message: await fn() };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function addCompetitorAction(input: string): Promise<CompetitorsResult> {
  return guarded(async () => {
    const ref = channelRef(input);
    if (!ref) throw new Error("Не понял канал: вставьте @handle или ссылку вида youtube.com/@handle.");
    const list = parseCompetitors(await getVariable(COMPETITORS_VAR));
    if (list.some((r) => r.toLowerCase() === ref.toLowerCase())) return `${ref} уже в списке.`;
    if (list.length >= MAX_COMPETITORS) throw new Error(`Не больше ${MAX_COMPETITORS} каналов — уберите лишний.`);
    await setVariable(COMPETITORS_VAR, JSON.stringify([...list, ref]));
    return `Добавил ${ref}.`;
  });
}

export async function removeCompetitorAction(ref: string): Promise<CompetitorsResult> {
  return guarded(async () => {
    const list = parseCompetitors(await getVariable(COMPETITORS_VAR));
    await setVariable(COMPETITORS_VAR, JSON.stringify(list.filter((r) => r.toLowerCase() !== ref.toLowerCase())));
    return `Убрал ${ref}.`;
  });
}
