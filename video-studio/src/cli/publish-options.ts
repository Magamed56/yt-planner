// Общее для make.ts и upload.ts: куда публиковать (--upload/--to) и когда
// (--publish-at, --schedule, --schedule-slot, --schedule-start).
//
//   --publish-at <ISO>      точное время публикации на YouTube
//   --schedule              ближайший свободный слот из channel.json (12:00/16:00/19:00 МСК);
//                           «свободный» — не занятый роликами из соседних папок out/
//   --schedule-slot N       N-й слот подряд (1 — ближайший) — для пакета: ролик i → слот i
//   --schedule-start <дата> считать слоты от этой даты (2026-10-14 или ISO-время), а не от «сейчас»

import fs from "node:fs";
import path from "node:path";
import { formatLocal, isoNoMs, nthSlot, parseScheduleStart, upcomingSlots, type ChannelConfig } from "../pipeline/channel";
import { UserError } from "./common";

export type UploadTarget = "youtube" | "instagram" | "telegram";

export function parseUploadTargets(raw: string | undefined, flag = "--upload"): Set<UploadTarget> {
  const out = new Set<UploadTarget>();
  if (!raw) return out;
  for (const part of raw.toLowerCase().split(/[,+\s]+/).filter(Boolean)) {
    if (part === "none") continue;
    // both/all — как раньше, YouTube и Instagram: Telegram только явно (нужны свои ключи).
    if (part === "both" || part === "all") {
      out.add("youtube");
      out.add("instagram");
    } else if (part === "youtube" || part === "yt") out.add("youtube");
    else if (part === "instagram" || part === "ig" || part === "reels") out.add("instagram");
    else if (part === "telegram" || part === "tg") out.add("telegram");
    else throw new UserError(`${flag}: youtube, instagram, telegram или несколько через запятую (youtube,telegram), а не «${part}». Релизы GitHub делает workflow.`);
  }
  return out;
}

export interface ScheduleArgs {
  publishAt?: string;
  schedule?: boolean;
  scheduleSlot?: number;
  scheduleStart?: string;
}

export const SCHEDULE_HELP = `  --publish-at <ISO>           опубликовать на YouTube в это время (пример: 2026-10-10T12:00:00+03:00)
  --schedule                   в ближайший свободный слот из channel.json (сейчас 12:00, 16:00 и 19:00 по Москве)
  --schedule-slot N            в N-й слот подряд (1 — ближайший): для пакета роликов
  --schedule-start <дата>      считать слоты от даты (2026-10-14 или ISO-время), а не от текущего момента`;

export function scheduleArgsFrom(values: Record<string, string | boolean | undefined>): ScheduleArgs {
  const s = (k: string) => (typeof values[k] === "string" && (values[k] as string).trim() ? (values[k] as string).trim() : undefined);
  const out: ScheduleArgs = { publishAt: s("publish-at"), schedule: values.schedule === true, scheduleStart: s("schedule-start") };
  const slot = s("schedule-slot");
  if (slot !== undefined) {
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 1) throw new UserError(`--schedule-slot: целое число от 1, а не «${slot}».`);
    out.scheduleSlot = n;
  }
  const modes = [out.publishAt ? "--publish-at" : null, out.schedule ? "--schedule" : null, out.scheduleSlot ? "--schedule-slot" : null].filter(Boolean);
  if (modes.length > 1) throw new UserError(`Выберите что-то одно: ${modes.join(", ")}.`);
  if (out.publishAt && Number.isNaN(Date.parse(out.publishAt))) throw new UserError("--publish-at: не похоже на дату ISO 8601 (пример: 2026-10-10T12:00:00+03:00).");
  if (out.scheduleStart && !out.schedule && !out.scheduleSlot) throw new UserError("--schedule-start работает только вместе с --schedule или --schedule-slot.");
  return out;
}

export const wantsSchedule = (a: ScheduleArgs): boolean => Boolean(a.publishAt || a.schedule || a.scheduleSlot);

// Время публикации, уже назначенное роликам в соседних папках (youtube-result*.json) —
// чтобы --schedule не поставил два ролика в один слот.
export function takenSlots(outDir: string): string[] {
  const out: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(outDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(outDir, d.name));
  } catch {
    return out;
  }
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^youtube-result.*\.json$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const at = (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { publishAt?: unknown }).publishAt;
        if (typeof at === "string" && Date.parse(at) > Date.now()) out.push(at);
      } catch {
        // битый файл — пропускаем
      }
    }
  }
  return out;
}

// Итоговое время для YouTube (или null — без расписания). Считается прямо
// перед загрузкой: рендер мог идти долго, и слот «через 20 минут» уже прошёл бы.
export function resolvePublishAt(a: ScheduleArgs, channel: ChannelConfig, outDir: string, log: (m: string) => void = console.log): string | null {
  if (a.publishAt) {
    const ms = Date.parse(a.publishAt);
    if (ms <= Date.now() + 5 * 60_000) throw new UserError(`--publish-at ${a.publishAt} — это время уже прошло или наступит меньше чем через 5 минут. Укажите время позже или --schedule.`);
    return isoNoMs(new Date(ms));
  }
  if (!a.schedule && !a.scheduleSlot) return null;
  const tz = channel.schedule.timezone;
  let from = new Date();
  if (a.scheduleStart) {
    try {
      from = parseScheduleStart(a.scheduleStart, tz);
    } catch (e) {
      throw new UserError(`--schedule-start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Начало отсчёта в прошлом — нормально для пакета: workflow один раз
  // фиксирует момент старта, и номера слотов не «съезжают», пока идёт рендер.
  const now = new Date();
  let at: Date;
  if (a.scheduleSlot) {
    // Минимальный запас 30 мин считается от НАЧАЛА отсчёта: у пакета все ролики считают от одной точки.
    at = nthSlot(channel.schedule, a.scheduleSlot, { from });
    if (at.getTime() <= now.getTime() + 10 * 60_000) {
      const next = upcomingSlots(channel.schedule, 1, { from: now, taken: takenSlots(outDir) })[0]!;
      log(`  ⚠ слот №${a.scheduleSlot} (${formatLocal(at, tz)}) уже прошёл — ставлю на ближайший свободный: ${formatLocal(next, tz)}`);
      at = next;
    }
  } else {
    at = upcomingSlots(channel.schedule, 1, { from: from.getTime() > now.getTime() ? from : now, taken: takenSlots(outDir) })[0]!;
  }
  return isoNoMs(at);
}

export function describePublishAt(iso: string, channel: ChannelConfig): string {
  return formatLocal(new Date(iso), channel.schedule.timezone);
}
