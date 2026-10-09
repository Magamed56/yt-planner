"use server";
// Действия кнопок панели. Каждое проверяет вход само (действие сервера — это POST), коды
// роликов сверяет с планом, ключи остаются на сервере.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { channelFromJson, isoNoMs, upcomingSlots } from "../../src/pipeline/channel";
import { parsePlan, PLAN_CODE } from "../../src/pipeline/plan";
import { applyUpdate, fillItemsOf, matchVideos, planUpdates, type ChannelVideo, type FillItem, type PlannedUpdate } from "../../src/pipeline/youtube-fill";
import { requireSession } from "@/lib/auth";
import { runAutopilot } from "@/lib/autopilot";
import { assetText, dispatchWorkflow, GithubError, readFileWithSha, readJson, setVariable, writeFile } from "@/lib/github";
import { loadState, STUDIO_DIR } from "@/lib/load";
import { lockedCodes, movableIds, reorderPlan } from "@/lib/plan-order";
import { editLock, rebuildInputs, rebuildLabel, type RebuildOptions } from "@/lib/rebuild";
import { applyScriptEdit, checkScriptEdit, scriptEditOf, scriptFileText, type ScriptEdit } from "@/lib/script-edit";
import { SESSION_COOKIE } from "@/lib/session";
import { AUTOPILOT_VAR, codesLabel, KEEP_RELEASE_MAX, SCRIPT_RESERVE_MAX, type AutopilotSettings } from "@/lib/state";
import { channelVideos, setPublishAt, videoStatuses, youtubeAuth } from "@/lib/youtube";

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

// Как youtube-fill: тексты из week1-videos.json и content/videos.json, ролики канала с поиском
// (100 единиц квоты: только что загруженное видео плейлист показывает с задержкой), время —
// следующие свободные слоты после уже занятых.
async function computeFill() {
  const [channel, week1, later, planJson, videos] = await Promise.all([
    loadChannel(),
    readJson(`${STUDIO_DIR}/content/week1-videos.json`),
    readJson(`${STUDIO_DIR}/content/videos.json`),
    readJson(`${STUDIO_DIR}/content/plan.json`),
    channelVideos({ search: true }),
  ]);
  const items: FillItem[] = [];
  for (const it of [...fillItemsOf(week1), ...fillItemsOf(later)]) if (!items.some((x) => x.id === it.id)) items.push(it);
  const report = matchVideos(items, videos);
  const now = new Date();
  const taken = videos.filter((v) => v.privacyStatus === "private" && v.publishAt && Date.parse(v.publishAt) > now.getTime()).map((v) => v.publishAt!);
  const updates = planUpdates(report, { schedule: channel.schedule, mode: "slots", now, taken });
  // Ролик из плана загружен, а текстов для него нет ни в одном списке — заполнить нечем.
  const known = new Set(items.map((i) => i.id));
  const bare: FillItem[] = parsePlan(planJson)
    .items.filter((i) => !known.has(i.id))
    .map((i) => ({ id: i.id, file: i.id, durationSec: Number.NaN, title: i.title, description: "", tags: [], categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true }));
  const withoutTexts = matchVideos(bare, videos)
    .matches.filter((m) => m.video.privacyStatus === "private" && !m.video.publishAt)
    .map((m) => m.item.id);
  return { tz: channel.schedule.timezone, report, updates, withoutTexts };
}

// Свежая загрузка: приватный ролик, которому впервые ставится время выхода. Уже заполненные
// (со временем или вышедшие) — не «новые»: их тексты переписываются только по явной отметке.
const isNewUpload = (p: PlannedUpdate) => !p.skip && !p.keptPublishAt && Boolean(p.publishAt) && p.match.video.privacyStatus === "private";

export async function fillPreviewAction(): Promise<FillPreview | ActionResult> {
  return guarded(async () => {
    const { tz, report, updates } = await computeFill();
    return {
      ok: true,
      message: "",
      items: updates
        .filter((p) => !p.skip)
        .map((p) => ({
          code: p.match.item.id,
          title: p.match.item.title,
          by: p.match.by,
          videoId: p.match.video.videoId,
          needsTime: isNewUpload(p),
          whenLabel: p.publishAt ? slotLabel(p.publishAt, tz) : null,
          kept: p.keptPublishAt,
          textsChanged: p.textsChanged,
          changes: p.textsChanged ? textChanges(p.match.video, p.match.item) : [],
        })),
      upToDate: updates.filter((p) => p.skip).map((p) => p.match.item.id),
      missing: report.missing.map((i) => i.id),
      pending: report.pending.map((x) => x.item.id),
      duplicates: report.duplicates.map((d) => d.item.id),
      broken: report.broken.map((b) => b.item.id),
    };
  });
}

export interface NewUploads extends ActionResult {
  found: { code: string; title: string; whenLabel: string | null }[];
  withoutTexts: string[]; // загружены, но текстов для них нет
  pending: string[]; // YouTube ещё обрабатывает
  duplicates: string[];
}

// Кнопка «Найти новые загрузки»: что загрузили в Studio руками и какое время им достанется.
export async function findNewUploadsAction(): Promise<NewUploads | ActionResult> {
  return guarded(async () => {
    const { tz, report, updates, withoutTexts } = await computeFill();
    return {
      ok: true,
      message: "",
      found: updates.filter(isNewUpload).map((p) => ({ code: p.match.item.id, title: p.match.item.title, whenLabel: p.publishAt ? slotLabel(p.publishAt, tz) : null })),
      withoutTexts,
      pending: report.pending.map((x) => x.item.id),
      duplicates: report.duplicates.map((d) => d.item.id),
    };
  });
}

// Тексты и время — сразу из панели, тем же кодом, что youtube-fill (videos.update): результат
// за секунды, и секреты YT_* в GitHub для этого не нужны. onlyNew — только свежие загрузки.
async function applyFill(codes: string[], onlyNew: boolean): Promise<ActionResult> {
  const want = new Set(codes.map((c) => c.trim().toLowerCase()).filter((c) => PLAN_CODE.test(c)));
  if (!want.size) return fail("Отметьте ролики, которым ставить тексты и время.");
  const { tz, updates } = await computeFill();
  const todo = updates.filter((p) => want.has(p.match.item.id) && !p.skip && (!onlyNew || isNewUpload(p)));
  if (!todo.length) return fail("Заполнять нечего: ролики уже заполнены или YouTube их пока не показывает — обновите страницу.");
  const done: string[] = [];
  const problems: string[] = [];
  for (const p of todo) {
    try {
      const r = await applyUpdate({ auth: youtubeAuth }, p);
      done.push(r.publishAt ? `${p.match.item.id} → ${slotLabel(r.publishAt, tz)}` : p.match.item.id);
      if (r.warning) problems.push(`${p.match.item.id}: ${r.warning}`);
    } catch (e) {
      problems.push(`${p.match.item.id}: ${errorText(e)}`);
      // Без прав, ключа или квоты остальные тоже не пройдут — не тратим квоту.
      if (/не хватает прав|недействителен|неверные YT_CLIENT|квота/.test(errorText(e))) break;
    }
  }
  const message = [done.length ? `Готово: ${done.join(", ")}.` : "", problems.length ? `Не вышло — ${problems.join("; ")}` : ""].filter(Boolean).join(" ");
  return { ok: done.length > 0, message };
}

export async function fillNewUploadsAction(codes: string[]): Promise<ActionResult> {
  return guarded(() => applyFill(codes, true));
}

export async function fillApplyAction(codes: string[]): Promise<ActionResult> {
  return guarded(() => applyFill(codes, false));
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
    // Поля новее «days» могут не прийти от старой открытой вкладки — тогда умолчания.
    const keep = Number(settings.keepReleaseDays ?? 0);
    if (!(Number.isInteger(keep) && keep >= 0 && keep <= KEEP_RELEASE_MAX)) return fail(`Хранить видео — от 0 до ${KEEP_RELEASE_MAX} дней.`);
    const reserve = Number(settings.scriptReserve ?? 0);
    if (!(Number.isInteger(reserve) && reserve >= 0 && reserve <= SCRIPT_RESERVE_MAX)) return fail(`Запас сценариев — от 0 до ${SCRIPT_RESERVE_MAX}.`);
    const value: AutopilotSettings = { enabled: settings.enabled === true, days, retryFailed: settings.retryFailed !== false, keepReleaseDays: keep, scriptReserve: reserve };
    await setVariable(AUTOPILOT_VAR, JSON.stringify(value));
    const parts = [
      value.enabled ? `автопилот включён: ролики готовятся за ${days} дн. до выхода${reserve ? `, запас сценариев — ${reserve}` : ""}` : "автопилот выключен",
      value.retryFailed ? "упавшая сборка повторяется один раз" : "упавшие сборки не повторяются",
      keep ? `видео из релизов удаляются через ${keep} дн. после выхода` : "видео из релизов не удаляются",
    ];
    return ok(`Сохранено: ${parts.join("; ")}.`);
  });
}

export async function runAutopilotAction(): Promise<ActionResult> {
  return guarded(async () => {
    const { did, notes, errors } = await runAutopilot("manual");
    const rest = notes.length ? ` ${notes.join("; ")}.` : "";
    return { ok: errors.length === 0, message: did.length ? `Сделано: ${did.join("; ")}.${rest}` : `Ничего не запущено.${rest}` };
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

// ---- правка сценария и пересборка: только пока ролик не загружен в YouTube ----

// Строка очереди по коду — с той же проверкой YouTube и запусков, что видит панель.
async function rowFor(code: string) {
  const c = String(code ?? "").trim().toLowerCase();
  if (!PLAN_CODE.test(c)) throw new Error("Неверный код ролика — обновите страницу.");
  const state = await loadState();
  const row = state.rows.find((r) => r.code === c);
  if (!row) throw new Error(`Ролика ${c} нет в плане — обновите страницу.`);
  return { state, row };
}

export interface ScriptForEdit extends ActionResult {
  sha: string; // версия файла: сохранение не затрёт чужую правку
  edit: ScriptEdit;
}

export async function scriptForEditAction(path: string): Promise<ScriptForEdit | ActionResult> {
  return guarded(async () => {
    if (!/^scripts\/[\w.-]+\.json$/.test(path)) return fail("Неверный путь к сценарию.");
    const file = await readFileWithSha(`${STUDIO_DIR}/${path}`);
    if (!file) return fail("Сценарий не найден в ветке — обновите страницу.");
    let json: unknown;
    try {
      json = JSON.parse(file.text);
    } catch {
      return fail("Файл сценария — битый JSON: поправьте его на GitHub.");
    }
    return { ok: true, message: "", sha: file.sha, edit: scriptEditOf(json) };
  });
}

export interface ScriptSaved extends ActionResult {
  saved: boolean; // файл изменился — видео нужно собрать заново
}

export async function saveScriptAction(code: string, sha: string, edit: ScriptEdit): Promise<ScriptSaved | ActionResult> {
  return guarded(async () => {
    const { state, row } = await rowFor(code);
    const lock = editLock(row, state.youtubeError);
    if (lock) return fail(lock);
    const clean = scriptEditOf(edit); // поля от браузера приводим к строкам и спискам заново
    const problems = checkScriptEdit(clean);
    if (problems.length) return fail(`Не сохранено. ${problems.join(" ")}`);
    const path = `${STUDIO_DIR}/${row.scriptPath}`;
    const file = await readFileWithSha(path);
    if (!file) return fail("Сценарий не найден в ветке — обновите страницу.");
    if (file.sha !== sha) return fail("Сценарий успели изменить (запуск или правка на GitHub) — откройте правку заново.");
    const text = scriptFileText(applyScriptEdit(JSON.parse(file.text), clean));
    if (text === file.text.replace(/\r\n/g, "\n")) return { ok: true, message: "Изменений нет — сохранять нечего.", saved: false };
    await writeFile(path, text, sha, `video-studio: правка сценария ${row.code} из панели`);
    const next = row.stage === "script" ? "«Собрать видео»" : "«Собрать заново»";
    return { ok: true, message: `Сценарий ${row.code} сохранён в GitHub. В видео и тексты для YouTube правка попадёт после сборки — ${next}.`, saved: true };
  });
}

export async function rebuildAction(code: string, opts: RebuildOptions): Promise<ActionResult> {
  return guarded(async () => {
    const { state, row } = await rowFor(code);
    const lock = editLock(row, state.youtubeError);
    if (lock) return fail(lock);
    const o: RebuildOptions = { voice: String(opts?.voice ?? "auto"), voiceName: String(opts?.voiceName ?? ""), theme: String(opts?.theme ?? "auto"), music: opts?.music !== false };
    try {
      await dispatchWorkflow("video-studio.yml", rebuildInputs(row.code, o));
    } catch (e) {
      // Поле music появилось в workflow вместе с этой кнопкой: пока PR не слит, GitHub его не знает.
      if (e instanceof GithubError && e.status === 422 && /music/.test(e.message)) throw new Error("В workflow ветки ещё нет поля music — слейте PR с ним или соберите с музыкой.");
      throw e;
    }
    const what = row.release || row.localVideo ? "пересборка" : "сборка";
    return ok(`Запущена ${what} ${row.code}: ${rebuildLabel(o)}. ≈ 8–10 минут в GitHub Actions — новое видео появится в карточке ролика.`);
  });
}

// ---- порядок тем плана ----

// order[i] — чья тема встаёт на i-ю подвижную позицию. Позиции (код, день, слот) не двигаются:
// код — в именах файлов сценариев и видео. Подвижные темы сервер считает сам, по свежей очереди.
export async function savePlanOrderAction(order: string[], sha: string): Promise<ActionResult> {
  return guarded(async () => {
    const valid = Array.isArray(order) && order.length <= 200 && order.every((c) => typeof c === "string" && PLAN_CODE.test(c)) && typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha);
    if (!valid) return fail("Неверный запрос — обновите страницу.");
    const path = `${STUDIO_DIR}/content/plan.json`;
    const [file, state] = await Promise.all([readFileWithSha(path), loadState()]);
    if (!file) return fail("В ветке нет content/plan.json.");
    if (file.sha !== sha) return fail("План успели изменить (записался сценарий или правка на GitHub) — обновите страницу и расставьте темы заново.");
    const plan = parsePlan(JSON.parse(file.text));
    const movable = movableIds(plan, lockedCodes(state.rows));
    const next = reorderPlan(plan, movable, order);
    const moved = movable.filter((id, i) => order[i] !== id).length;
    if (!moved) return ok("Порядок не изменился.");
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, sha, "video-studio: порядок тем плана из панели");
    return ok(`Порядок сохранён: тем на новых местах — ${moved}. Коды и дни остались прежними, переехали сами темы.`);
  });
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
