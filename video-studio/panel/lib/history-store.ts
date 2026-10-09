// Запись истории цифр канала (lib/history.ts) в переменную репозитория. Не Contents API: каждый
// коммит запускал бы деплой Vercel. Ошибка записи — только в лог: из-за неё страница не падает.
import type { ChannelListing } from "../../src/pipeline/youtube-fill";
import { cache } from "react";
import { getVariable, setVariable } from "./github";
import { HISTORY_VAR, parseHistory, recordSnapshot, serializeHistory, snapshotDue, trimHistory, type StatsHistory } from "./history";

// Прочитать историю один раз на запрос: её берут и очередь («Пульс»), и «Статистика» (тренды).
export const readHistory = cache(async (): Promise<StatsHistory> => parseHistory(await getVariable(HISTORY_VAR).catch(() => null)));

// force — ежедневный cron: точка дня нужна, даже если час ещё не прошёл.
export async function saveSnapshot(listing: ChannelListing, now: Date, timeZone: string, opts: { force?: boolean } = {}): Promise<"saved" | "fresh" | "same"> {
  // Перечитываем прямо перед записью: две вкладки сразу — побеждает последняя, потеря одной
  // точки не страшна.
  const raw = await getVariable(HISTORY_VAR);
  const before = parseHistory(raw);
  if (!opts.force && raw && !snapshotDue(before, now)) return "fresh";
  const next = serializeHistory(trimHistory(recordSnapshot(before, listing.videos, listing.channel, now, timeZone), undefined, now));
  if (next === raw) return "same";
  await setVariable(HISTORY_VAR, next);
  return "saved";
}

export async function saveSnapshotQuietly(listing: Promise<ChannelListing>, now: Date, timeZone: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    await saveSnapshot(await listing, now, timeZone, opts);
  } catch (e) {
    console.error(`История статистики не записана: ${e instanceof Error ? e.message : String(e)}`);
  }
}
