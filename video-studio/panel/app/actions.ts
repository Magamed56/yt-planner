"use server";
// Действия кнопок панели. Каждое проверяет вход само (действие сервера — это POST), коды
// роликов сверяет с планом, ключи остаются на сервере.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { channelFromJson, isoNoMs, upcomingSlots } from "../../src/pipeline/channel";
import { parsePlan, PLAN_CODE } from "../../src/pipeline/plan";
import { fillItemsOf, matchVideos, planUpdates, type ChannelVideo, type FillItem } from "../../src/pipeline/youtube-fill";
import { requireSession } from "@/lib/auth";
import { runAutopilot } from "@/lib/autopilot";
import { assetText, dispatchWorkflow, readJson, setVariable } from "@/lib/github";
import { STUDIO_DIR } from "@/lib/load";
import { SESSION_COOKIE } from "@/lib/session";
import { AUTOPILOT_VAR, codesLabel, type AutopilotSettings } from "@/lib/state";
import { channelVideos, setPublishAt, videoStatuses } from "@/lib/youtube";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface MoveResult extends ActionResult {
  undo?: { videoId: string; publishAt: string }[];
}

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function guarded<T extends ActionResult>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    await requireSession();
    return await fn();
  } catch (e) {
    return fail(errorText(e));
  }
}

async function loadChannel() {
  return channelFromJson((await readJson(`${STUDIO_DIR}/channel.json`)) ?? {});
}

// Коды из плана в порядке плана; чужие и кривые отбрасываем.
async function planCodes(codes: string[]): Promise<string[]> {
  const plan = parsePlan(await readJson(`${STUDIO_DIR}/content/plan.json`));
  const want = new Set(codes.map((c) => c.trim().toLowerCase()).filter((c) => PLAN_CODE.test(c)));
  return plan.items.map((i) => i.id).filter((id) => want.has(id));
}

function slotLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// ---- запуски workflow ----

export async function draftAction(codes: string[]): Promise<ActionResult> {
  return guarded(async () => {
    const list = await planCodes(codes);
    if (!list.length) return fail("Отметьте темы из плана.");
    await dispatchWorkflow("video-studio.yml", { mode: "draft", plan: list.join(",") });
    return ok(`Запущено: сценарии ${codesLabel(list)}. Обычно 1–3 минуты на тему — следите в «Запусках».`);
  });
}

export async function videosAction(codes: string[]): Promise<ActionResult> {
  return guarded(async () => {
    const list = await planCodes(codes);
    if (!list.length) return fail("Отметьте ролики из плана.");
    await dispatchWorkflow("video-studio.yml", { mode: "batch", plan: list.join(","), upload: "release" });
    return ok(`Запущено: ${codesLabel(list)} — недостающие сценарии, затем сборка (≈ 8–10 минут на ролик). Видео появится в карточке ролика.`);
  });
}

export async function checkKeysAction(): Promise<ActionResult> {
  return guarded(async () => {
    await dispatchWorkflow("video-studio-check.yml", {});
    return ok("Запущена проверка ключей — итог в «Запусках» через минуту-две.");
  });
}

// ---- YouTube: тексты и время (как youtube-fill --dry-run, но сразу в панели) ----

export interface FillPreviewItem {
  code: string;
  title: string;
  by: string;
  videoId: string;
  needsTime: boolean; // ролику впервые ставится время выхода
  whenLabel: string | null;
  kept: boolean; // время уже стояло — не сдвигается
  textsChanged: boolean;
  changes: string[];
}

export interface FillPreview extends ActionResult {
  items: FillPreviewItem[];
  upToDate: string[];
  missing: string[];
  pending: string[];
  duplicates: string[];
  broken: string[];
}

function textChanges(v: ChannelVideo, i: FillItem): string[] {
  if (!v.description.trim()) return ["название, описание и теги — из файла"];
  const out: string[] = [];
  if (v.title.trim() !== i.title.trim()) out.push(`название: «${v.title}» → «${i.title}»`);
  const was = v.description.split("\n").map((s) => s.trim()).filter(Boolean);
  const will = i.description.split("\n").map((s) => s.trim()).filter(Boolean);
  const lines = [...was.filter((l) => !will.includes(l)).map((l) => `− ${l}`), ...will.filter((l) => !was.includes(l)).map((l) => `+ ${l}`)];
  out.push(...lines.slice(0, 8));
  if (lines.length > 8) out.push(`… и ещё строк: ${lines.length - 8}`);
  const tagsWas = new Set(v.tags);
  const tagsWill = new Set(i.tags);
  const tags = [...i.tags.filter((t) => !tagsWas.has(t)).map((t) => `+${t}`), ...v.tags.filter((t) => !tagsWill.has(t)).map((t) => `−${t}`)];
  if (tags.length) out.push(`теги: ${tags.join(", ")}`);
  if (v.categoryId !== i.categoryId) out.push(`категория: ${v.categoryId ?? "—"} → ${i.categoryId}`);
  return out;
}

export async function fillPreviewAction(): Promise<FillPreview | ActionResult> {
  return guarded(async () => {
    const [channel, week1, later, videos] = await Promise.all([
      loadChannel(),
      readJson(`${STUDIO_DIR}/content/week1-videos.json`),
      readJson(`${STUDIO_DIR}/content/videos.json`),
      // С поиском (100 единиц квоты): только что загруженное видео плейлист показывает с задержкой.
      channelVideos({ search: true }),
    ]);
    const items: FillItem[] = [];
    for (const it of [...fillItemsOf(week1), ...fillItemsOf(later)]) if (!items.some((x) => x.id === it.id)) items.push(it);
    const report = matchVideos(items, videos);
    const now = new Date();
    const taken = videos.filter((v) => v.privacyStatus === "private" && v.publishAt && Date.parse(v.publishAt) > now.getTime()).map((v) => v.publishAt!);
    const plan = planUpdates(report, { schedule: channel.schedule, mode: "slots", now, taken });
    const tz = channel.schedule.timezone;
    return {
      ok: true,
      message: "",
      items: plan
        .filter((p) => !p.skip)
        .map((p) => ({
          code: p.match.item.id,
          title: p.match.item.title,
          by: p.match.by,
          videoId: p.match.video.videoId,
          needsTime: !p.keptPublishAt && Boolean(p.publishAt),
          whenLabel: p.publishAt ? slotLabel(p.publishAt, tz) : null,
          kept: p.keptPublishAt,
          textsChanged: p.textsChanged,
          changes: p.textsChanged ? textChanges(p.match.video, p.match.item) : [],
        })),
      upToDate: plan.filter((p) => p.skip).map((p) => p.match.item.id),
      missing: report.missing.map((i) => i.id),
      pending: report.pending.map((x) => x.item.id),
      duplicates: report.duplicates.map((d) => d.item.id),
      broken: report.broken.map((b) => b.item.id),
    };
  });
}

export async function fillApplyAction(codes: string[]): Promise<ActionResult> {
  return guarded(async () => {
    const list = [...new Set(codes.map((c) => c.trim().toLowerCase()).filter((c) => PLAN_CODE.test(c)))];
    if (!list.length) return fail("Отметьте ролики, которым ставить тексты и время.");
    await dispatchWorkflow("video-studio-youtube-fill.yml", { only: list.join(","), schedule: "slots" });
    return ok(`Запущено заполнение: ${codesLabel(list)}. Через 1–2 минуты обновите страницу.`);
  });
}

// ---- перенос дня выхода ----

export async function moveVideoAction(videoId: string, targetIso: string): Promise<MoveResult | ActionResult> {
  return guarded(async () => {
    const target = Date.parse(targetIso);
    if (!/^[\w-]{6,20}$/.test(videoId) || !Number.isFinite(target)) return fail("Неверный запрос — обновите страницу.");
    const [channel, videos] = await Promise.all([loadChannel(), channelVideos()]);
    const now = Date.now();
    const perDay = Math.max(1, channel.schedule.publishTimesLocal.length);
    const slots = upcomingSlots(channel.schedule, 60 * perDay, { from: new Date(now) });
    if (!slots.some((d) => d.getTime() === target)) return fail("Это время — не слот расписания канала или уже слишком близко.");
    const me = videos.find((v) => v.videoId === videoId);
    if (!me || me.privacyStatus !== "private" || !me.publishAt || Date.parse(me.publishAt) <= now) {
      return fail("Переносить можно только приватный ролик с будущим временем выхода — обновите страницу.");
    }
    if (Date.parse(me.publishAt) === target) return fail("Ролик уже стоит на это время.");
    const sameMinute = (iso: string) => Math.floor(Date.parse(iso) / 60_000) === Math.floor(target / 60_000);
    const other = videos.find((v) => v.videoId !== videoId && v.privacyStatus === "private" && v.publishAt && sameMinute(v.publishAt));
    const statuses = await videoStatuses(other ? [videoId, other.videoId] : [videoId]);
    const moves = [{ videoId, from: me.publishAt, to: isoNoMs(new Date(target)) }];
    if (other) moves.push({ videoId: other.videoId, from: other.publishAt!, to: me.publishAt });
    const done: typeof moves = [];
    try {
      for (const m of moves) {
        const s = statuses.get(m.videoId);
        if (!s) throw new Error("YouTube не вернул ролик — обновите страницу.");
        if (!(await setPublishAt(m.videoId, s, m.to))) throw new Error("YouTube не принял новое время — поставьте его в Studio вручную.");
        done.push(m);
      }
    } catch (e) {
      // Откатываем уже сделанное: иначе два ролика встанут на одно время.
      for (const m of done.reverse()) await setPublishAt(m.videoId, statuses.get(m.videoId)!, m.from).catch(() => {});
      throw e;
    }
    const tz = channel.schedule.timezone;
    const message = other
      ? `Поменяли местами: этот ролик — на ${slotLabel(moves[0]!.to, tz)}, «${other.title}» — на ${slotLabel(me.publishAt, tz)}.`
      : `Перенесено на ${slotLabel(moves[0]!.to, tz)}.`;
    return { ok: true, message, undo: moves.map((m) => ({ videoId: m.videoId, publishAt: m.from })) };
  });
}

export async function undoMoveAction(moves: { videoId: string; publishAt: string }[]): Promise<ActionResult> {
  return guarded(async () => {
    const list = moves.filter((m) => /^[\w-]{6,20}$/.test(m.videoId) && Date.parse(m.publishAt) > Date.now() + 15 * 60_000).slice(0, 2);
    if (!list.length) return fail("Отменить уже нельзя: прежнее время прошло или вот-вот наступит.");
    const statuses = await videoStatuses(list.map((m) => m.videoId));
    for (const m of list) {
      const s = statuses.get(m.videoId);
      if (!s) throw new Error("YouTube не вернул ролик — обновите страницу.");
      await setPublishAt(m.videoId, s, m.publishAt);
    }
    return ok("Вернули прежнее время.");
  });
}

// ---- автопилот ----

export async function saveAutopilotAction(settings: AutopilotSettings): Promise<ActionResult> {
  return guarded(async () => {
    const days = Math.round(Number(settings.days));
    if (!(days >= 1 && days <= 14)) return fail("Дней вперёд — от 1 до 14.");
    await setVariable(AUTOPILOT_VAR, JSON.stringify({ enabled: settings.enabled === true, days }));
    return ok(settings.enabled ? `Автопилот включён: ролики готовятся за ${days} дн. до выхода, проверка раз в день.` : "Автопилот выключен.");
  });
}

export async function runAutopilotAction(): Promise<ActionResult> {
  return guarded(async () => {
    const last = await runAutopilot("manual");
    return ok(last.codes.length ? `Запущено: ${last.note}.` : `Ничего не запущено: ${last.note}.`);
  });
}

// ---- карточка ролика ----

export interface ScriptText extends ActionResult {
  title: string;
  scenes: { narration: string; onScreen: string }[];
}

export async function scriptTextAction(path: string): Promise<ScriptText | ActionResult> {
  return guarded(async () => {
    if (!/^scripts\/[\w.-]+\.json$/.test(path)) return fail("Неверный путь к сценарию.");
    const s = (await readJson(`${STUDIO_DIR}/${path}`)) as { title?: string; scenes?: { narration?: string; onScreen?: string }[] } | null;
    if (!s) return fail("Сценарий не найден в ветке — обновите страницу.");
    return { ok: true, message: "", title: s.title ?? "", scenes: (s.scenes ?? []).map((x) => ({ narration: x.narration ?? "", onScreen: x.onScreen ?? "" })) };
  });
}

export async function captionAction(assetId: number): Promise<(ActionResult & { text: string }) | ActionResult> {
  return guarded(async () => {
    if (!Number.isInteger(assetId) || assetId <= 0) return fail("Неверный файл.");
    return { ok: true, message: "", text: await assetText(assetId) };
  });
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
