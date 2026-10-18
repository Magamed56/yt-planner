"use server";
// Действия кнопок панели. Каждое проверяет вход само (действие сервера — это POST), коды
// роликов сверяет с планом, ключи остаются на сервере.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { channelFromJson, isoNoMs, longScheduleOf, upcomingSlots } from "../../src/pipeline/channel";
import { isLongCode, mp4Code, normCode } from "../../src/pipeline/codes";
import { DEFAULT_LANG, LANGS, normalizeLang } from "../../src/pipeline/lang";
import { LONG_BUILD_LABEL, LONG_PLAN_FILE, parseLongPlan } from "../../src/pipeline/long-plan";
import { parsePlan, PLAN_CODE, scriptCode } from "../../src/pipeline/plan";
import { applyUpdate, fillItemsOf, matchVideos, planUpdates, setThumbnail, THUMBNAIL_MAX_BYTES, type ChannelVideo, type FillItem, type PlannedUpdate } from "../../src/pipeline/youtube-fill";
import { requireSession } from "@/lib/auth";
import { runAutopilot } from "@/lib/autopilot";
import { BOARD_VAR, boardWithLayout, boardWithMark, boardWithSticker, isSocial, SOCIAL_LABEL, type BoardWrite } from "@/lib/board";
import type { LayoutPatch, StickerOp } from "@/lib/board-state";
import { dispatchOnce } from "@/lib/dispatch";
import { buildFirstComment, commentBlocker, commentProblem, commentUrl, ctaQuestion, type OwnComment } from "@/lib/first-comment";
import { assetBytes, assetText, dispatchWorkflow, getVariable, GithubError, listReleases, readFile, readFileWithSha, readJson, rerunFailedJobs, setVariable, writeFile } from "@/lib/github";
import { parseStudioMarks, STUDIO_MARKS_VAR, studioMarksText, withStudioMark } from "@/lib/lang-plan";
import { loadState, STUDIO_DIR } from "@/lib/load";
import { canRetry, confirmStale } from "@/lib/ops";
import { autoAddToPlaylists } from "@/lib/playlist-sync";
import { editLock, rebuildInputs, rebuildLabel, type RebuildOptions } from "@/lib/rebuild";
import { releaseFillItems } from "@/lib/release-texts";
import { applyScriptEdit, checkScriptEdit, scriptEditOf, scriptFileText, type ScriptEdit } from "@/lib/script-edit";
import { SESSION_COOKIE } from "@/lib/session";
import { AUTOPILOT_VAR, codesLabel, KEEP_RELEASE_MAX, parseQueueOrder, QUEUE_ORDER_VAR, queueSort, SCRIPT_RESERVE_MAX, type AutopilotSettings } from "@/lib/state";
import { isShorts, parseUsage, usageSummary } from "@/lib/stats";
import { plural } from "@/lib/stages";
import { channelVideos, commentCheck, postComment, setPublishAt, videoStatuses, youtubeAuth } from "@/lib/youtube";

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Запуск в GitHub Actions прошёл: какие ролики «в очереди…» до появления запуска в списке.
export interface DispatchResult extends ActionResult {
  dispatched?: { codes: string[]; at: string };
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

// План «Разборов» (content/long-plan.json); нет файла — пустой.
async function readLongPlan() {
  return parseLongPlan(await readJson(`${STUDIO_DIR}/${LONG_PLAN_FILE}`));
}

// Коды из плана в порядке плана; чужие и кривые отбрасываем. «Разборы» (L01…) — из длинного
// плана, после Shorts.
async function planCodes(codes: string[]): Promise<string[]> {
  const want = new Set(codes.map((c) => normCode(c)).filter((c): c is string => Boolean(c)));
  const wantLong = [...want].some((c) => isLongCode(c));
  const [plan, longPlan] = await Promise.all([readJson(`${STUDIO_DIR}/content/plan.json`).then(parsePlan), wantLong ? readLongPlan() : { items: [] }]);
  return [...plan.items.filter((i) => PLAN_CODE.test(i.id)), ...longPlan.items].map((i) => i.id).filter((id) => want.has(id));
}

// Сколько ждать сборки: Shorts ≈ 8–10 минут, «Разбор» — 40–60.
const buildTime = (codes: string[]) => (codes.some((c) => isLongCode(c)) ? `${LONG_BUILD_LABEL} на «Разбор», ≈ 8–10 минут на Shorts` : "≈ 8–10 минут на ролик");

function slotLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

// ---- запуски workflow ----

// Платные запуски (Claude, квота голоса) — через dispatchOnce: второе нажатие по тем же
// роликам, пока первый запуск идёт или только что запущен, получает отказ, а не второй запуск.
export async function draftAction(codes: string[]): Promise<DispatchResult | ActionResult> {
  return guarded(async () => {
    const [list, channel] = await Promise.all([planCodes(codes), loadChannel()]);
    if (!list.length) return fail("Отметьте темы из плана.");
    const dispatched = await dispatchOnce("video-studio.yml", { mode: "draft", plan: list.join(",") }, "draft", list, channel.schedule.timezone);
    const longNote = list.some((c) => isLongCode(c)) ? ", «Разбор» — 3–6 минут" : "";
    return { ...ok(`Запущено: сценарии ${codesLabel(list)}. Обычно 1–3 минуты на тему${longNote} — следите в «Запусках».`), dispatched };
  });
}

export async function videosAction(codes: string[]): Promise<DispatchResult | ActionResult> {
  return guarded(async () => {
    const [list, channel] = await Promise.all([planCodes(codes), loadChannel()]);
    if (!list.length) return fail("Отметьте ролики из плана.");
    const dispatched = await dispatchOnce("video-studio.yml", { mode: "batch", plan: list.join(","), upload: "release" }, "batch", list, channel.schedule.timezone);
    return { ...ok(`Запущено: ${codesLabel(list)} — недостающие сценарии, затем сборка (${buildTime(list)}). Видео появится в карточке ролика.`), dispatched };
  });
}

// ---- повтор упавшего запуска ----

export interface RetryPreview extends ActionResult {
  attempt: number; // какая попытка будет
  confirmLabel: string;
}

// Что будет стоить повтор — перед подтверждением: озвучки заново и сколько уже потрачено
// сегодня из бесплатного лимита Gemini (content/usage.jsonl читаем только здесь, по нажатию).
export async function retryPreviewAction(runId: number): Promise<RetryPreview | ActionResult> {
  return guarded(async () => {
    const [state, usageText] = await Promise.all([loadState(), readFile(`${STUDIO_DIR}/content/usage.jsonl`).catch(() => null)]);
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return fail("Этого запуска нет в списке — обновите страницу.");
    const can = canRetry(run, state);
    if (!can.ok) return fail(`Не повторяю «${run.label}»: ${can.reason}.`);
    const parsed = usageText ? parseUsage(usageText) : null;
    const g = parsed?.records.length ? usageSummary(parsed.records, new Date(), state.timezone).gemini : null;
    const what = can.cost ? `озвучит заново ${can.cost} ${plural(can.cost, "ролик", "ролика", "роликов")}` : "перепишет сценарии (Claude)";
    return { ok: true, message: `Повтор «${run.label}» ${what}${g ? ` · Gemini сегодня ${g.today}/${g.limit}` : ""}.`, attempt: run.attempt + 1, confirmLabel: `Повторить (попытка ${run.attempt + 1})` };
  });
}

export async function retryRunAction(runId: number): Promise<ActionResult> {
  return guarded(async () => {
    const state = await loadState();
    const run = state.runs.find((r) => r.id === runId);
    if (!run) return fail("Этого запуска нет в списке — обновите страницу.");
    const can = canRetry(run, state);
    if (!can.ok) return fail(`Не повторяю «${run.label}»: ${can.reason}.`);
    await rerunFailedJobs(run.id);
    return ok(`Запущена попытка ${run.attempt + 1}: «${run.label}». Те же настройки, что в первый раз; следите в «Запусках».`);
  });
}

// ---- новые темы в план ----

const PLAN_EXTEND_MAX = 30;
const LONG_EXTEND_MAX = 12;
// long — темы «Разбора» (content/long-plan.json, workflow с long = true): их до 12 за раз.
const planCount = (n: unknown, long = false) => Math.min(long ? LONG_EXTEND_MAX : PLAN_EXTEND_MAX, Math.max(1, Math.floor(Number(n) || (long ? 6 : 10))));

// Цена — по переменной LLM_PROVIDER (как в workflow «video-studio: план тем»): Claude ищет
// источники веб-поиском (платно), Gemini — бесплатно, ссылки проверяются запросом по сети.
export async function planExtendPreviewAction(count: number, long = false): Promise<(ActionResult & { confirmLabel: string }) | ActionResult> {
  return guarded(async () => {
    const isLong = long === true;
    const n = planCount(count, isLong);
    const provider = ((await getVariable("LLM_PROVIDER").catch(() => null)) ?? "").trim().toLowerCase();
    const cost = provider === "claude" ? "платно: Claude + веб-поиск источников" : "бесплатно (Gemini), ссылки на источники проверяются";
    const what = isLong ? `${n} ${plural(n, "тему", "темы", "тем")} «Разбора» (8–12 фактов с источниками и главы)` : `${n} ${plural(n, "тему", "темы", "тем")}`;
    return { ok: true, message: `Добавить в план ${what} — ${cost}. Около ${isLong ? "10–20" : "3–5"} минут.`, confirmLabel: `Добавить ${n}` };
  });
}

export async function planExtendAction(count: number, long = false): Promise<DispatchResult | ActionResult> {
  return guarded(async () => {
    const isLong = long === true;
    const n = planCount(count, isLong);
    const channel = await loadChannel();
    await dispatchOnce("video-studio-plan.yml", isLong ? { count: String(n), long: "true" } : { count: String(n) }, "plan", [], channel.schedule.timezone);
    return ok(
      isLong
        ? `Запущено: +${n} ${plural(n, "тема", "темы", "тем")} «Разбора». Через 10–20 минут они появятся в ленте и календаре (вт/чт/сб 21:00) как «Тема».`
        : `Запущено: +${n} ${plural(n, "тема", "темы", "тем")} в план. Через 3–5 минут они появятся в ленте как «Тема».`,
    );
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
// search — искать ролики ещё и поиском YouTube (≈ 100 единиц квоты): плейлист «Загрузки»
// (≈ 5 единиц) показывает свежую загрузку не сразу. Без поиска — когда хватает плейлиста.
async function computeFill(search = true) {
  const [channel, week1, later, planJson, videos, orderRaw, longPlan] = await Promise.all([
    loadChannel(),
    readJson(`${STUDIO_DIR}/content/week1-videos.json`),
    readJson(`${STUDIO_DIR}/content/videos.json`),
    readJson(`${STUDIO_DIR}/content/plan.json`),
    channelVideos({ search }),
    getVariable(QUEUE_ORDER_VAR).catch(() => null),
    readLongPlan().catch(() => ({ items: [] })),
  ]);
  const items: FillItem[] = [];
  for (const it of [...fillItemsOf(week1), ...fillItemsOf(later)]) if (!items.some((x) => x.id === it.id)) items.push(it);
  // Ролик из плана загружен (приватный, без времени), а текстов для него нет ни в одном списке —
  // берём их из его релиза. Нет и там — заполнить нечем (withoutTexts).
  const known = new Set(items.map((i) => i.id));
  const bare: FillItem[] = [...parsePlan(planJson).items, ...longPlan.items]
    .filter((i) => !known.has(i.id))
    .map((i) => ({ id: i.id, file: i.id, durationSec: Number.NaN, title: i.title, description: "", tags: [], categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true }));
  const fresh = matchVideos(bare, videos)
    .matches.filter((m) => m.video.privacyStatus === "private" && !m.video.publishAt)
    .map((m) => m.item.id);
  const recovered = fresh.length ? releaseFillItems(await listReleases().catch(() => []), fresh) : [];
  items.push(...recovered);
  const withoutTexts = fresh.filter((c) => !recovered.some((i) => i.id === c));
  const found = matchVideos(items, videos);
  // Свободные слоты раздаются в порядке совпадений — ставим их в очередь выхода из календаря.
  const order = parseQueueOrder(orderRaw);
  const byCode = queueSort(found.matches.map((m) => ({ code: m.item.id, m })), order);
  const report = { ...found, matches: byCode.map((x) => x.m) };
  const now = new Date();
  const taken = videos.filter((v) => v.privacyStatus === "private" && v.publishAt && Date.parse(v.publishAt) > now.getTime()).map((v) => v.publishAt!);
  // «Разборы» (L01…) — в свои слоты вт/чт/сб 21:00, Shorts — в свои.
  const updates = planUpdates(report, { schedule: channel.schedule, longSchedule: longScheduleOf(channel), mode: "slots", now, taken });
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

export interface NewUpload {
  code: string;
  title: string;
  videoId: string;
  publishAt: string | null; // слот, который ролик получит (его же проверим перед записью)
  whenLabel: string | null;
  cover: string | null;
}

export interface NewUploads extends ActionResult {
  found: NewUpload[];
  withoutTexts: string[]; // загружены, но текстов для них нет
  pending: string[]; // YouTube ещё обрабатывает
  duplicates: string[];
}

// Кнопка «Найти новые загрузки»: что загрузили в Studio руками и какое время им достанется.
// Сначала — плейлист «Загрузки» (≈ 5 единиц квоты); поиск (≈ 100) — только если там нового нет.
export async function findNewUploadsAction(): Promise<NewUploads | ActionResult> {
  return guarded(async () => {
    let fill = await computeFill(false);
    if (!fill.updates.some(isNewUpload)) fill = await computeFill(true);
    const { tz, report, updates, withoutTexts } = fill;
    return {
      ok: true,
      message: "",
      found: updates.filter(isNewUpload).map((p) => ({
        code: p.match.item.id,
        title: p.match.item.title,
        videoId: p.match.video.videoId,
        publishAt: p.publishAt ?? null,
        whenLabel: p.publishAt ? slotLabel(p.publishAt, tz) : null,
        cover: p.match.video.thumbnailUrl ?? null,
      })),
      withoutTexts,
      pending: report.pending.map((x) => x.item.id),
      duplicates: report.duplicates.map((d) => d.item.id),
    };
  });
}

// Тексты и время — сразу из панели, тем же кодом, что youtube-fill (videos.update): результат
// за секунды, и секреты YT_* в GitHub для этого не нужны. onlyNew — только свежие загрузки.
// confirmed — что показали владельцу («08a → чт 12:00»): если с тех пор слот заняли или ролик
// уже заполнен, эту строку не трогаем и говорим почему — ничего не ставится дважды.
async function applyFill(codes: string[], onlyNew: boolean, confirmed: Map<string, { videoId: string; publishAt: string | null }> = new Map()): Promise<ActionResult> {
  const want = new Set(codes.map((c) => normCode(c)).filter((c): c is string => Boolean(c)));
  if (!want.size) return fail("Отметьте ролики, которым ставить тексты и время.");
  // Без поиска, если плейлист «Загрузки» уже показывает все нужные ролики (≈ 5 единиц квоты).
  let fill = await computeFill(false);
  const seen = (f: typeof fill) => [...want].every((c) => f.updates.some((p) => p.match.item.id === c));
  if (!seen(fill)) fill = await computeFill(true);
  const { tz, updates } = fill;
  const problems: string[] = [];
  const todo = updates.filter((p) => {
    const code = p.match.item.id;
    if (!want.has(code) || p.skip || (onlyNew && !isNewUpload(p))) return false;
    const c = confirmed.get(code);
    if (c && confirmStale(c, { videoId: p.match.video.videoId, publishAt: p.publishAt ?? null })) {
      problems.push(`${code}: ${c.publishAt ? `слот ${slotLabel(c.publishAt, tz)}` : "слот"} уже занят или ролик изменился — нажмите «Найти новые загрузки» ещё раз`);
      return false;
    }
    return true;
  });
  if (!todo.length) return fail(problems.length ? `Не вышло — ${problems.join("; ")}` : "Заполнять нечего: ролики уже заполнены или YouTube их пока не показывает — обновите страницу.");
  const done: string[] = [];
  const filled: { code: string; videoId: string }[] = [];
  const thumbs: string[] = [];
  let releases: Awaited<ReturnType<typeof listReleases>> | null = null;
  for (const p of todo) {
    try {
      const r = await applyUpdate({ auth: youtubeAuth }, p);
      done.push(r.publishAt ? `${p.match.item.id} → ${slotLabel(r.publishAt, tz)}` : p.match.item.id);
      filled.push({ code: p.match.item.id, videoId: p.match.video.videoId });
      if (r.warning) problems.push(`${p.match.item.id}: ${r.warning}`);
    } catch (e) {
      problems.push(`${p.match.item.id}: ${errorText(e)}`);
      // Без прав, ключа или квоты остальные тоже не пройдут — не тратим квоту.
      if (/не хватает прав|недействителен|неверные YT_CLIENT|квота/.test(errorText(e))) break;
      continue;
    }
    // «Разбор» впервые получил тексты и время — своя обложка 16:9 из релиза (thumbnails.set,
    // 50 единиц квоты). Shorts — как раньше: обложка у них — кадр из ролика.
    if (isLongCode(p.match.item.id) && isNewUpload(p)) {
      try {
        releases ??= await listReleases();
        await setThumbnail({ auth: youtubeAuth }, p.match.video.videoId, ...(await releaseThumbnail(releases, p.match.item.id)));
        thumbs.push(p.match.item.id);
      } catch (e) {
        problems.push(`${p.match.item.id}: обложка не поставлена — ${errorText(e).replace(/^YouTube:\s*/, "")}`);
      }
    }
  }
  // Свежие загрузки — в плейлисты рубрик, если это включено на «Статистике» (ошибки — только текстом).
  const playlists = onlyNew ? await autoAddToPlaylists(filled) : null;
  const message = [
    done.length ? `Готово: ${done.join(", ")}.` : "",
    thumbs.length ? `Обложка из релиза поставлена: ${thumbs.join(", ")}.` : "",
    playlists ?? "",
    problems.length ? `Не вышло — ${problems.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { ok: done.length > 0, message };
}

// Обложка «Разбора» из самого свежего релиза с его видео: thumbnail.jpg (если PNG был больше
// 2 МБ, рендер делает и его), иначе thumbnail.png.
async function releaseThumbnail(releases: Awaited<ReturnType<typeof listReleases>>, code: string): Promise<[Uint8Array, "image/png" | "image/jpeg"]> {
  const rel = releases
    .filter((r) => !r.draft && r.assets.some((a) => mp4Code(a.name) === code))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!rel) throw new Error(`релиза с ${code}-….mp4 нет — поставьте обложку в Studio вручную`);
  const jpg = rel.assets.find((a) => a.name === "thumbnail.jpg");
  const png = rel.assets.find((a) => a.name === "thumbnail.png");
  const pick = jpg ?? (png && png.size <= THUMBNAIL_MAX_BYTES ? png : null);
  if (!pick) throw new Error(png ? "thumbnail.png в релизе больше 2 МБ, а thumbnail.jpg нет — поставьте обложку в Studio вручную" : "в релизе нет thumbnail.png — поставьте обложку в Studio вручную");
  return [await assetBytes(pick.id, THUMBNAIL_MAX_BYTES), pick === jpg ? "image/jpeg" : "image/png"];
}

// Коды (карточка ролика) или строки, показанные в «Найти новые загрузки», — с проверкой слота.
export async function fillNewUploadsAction(items: (string | { code: string; videoId: string; publishAt: string | null })[]): Promise<ActionResult> {
  return guarded(() => {
    const list = Array.isArray(items) ? items : [];
    const confirmed = new Map(
      list.flatMap((x) => (typeof x === "object" && x && typeof x.code === "string" && typeof x.videoId === "string" && normCode(x.code) ? [[normCode(x.code)!, { videoId: x.videoId, publishAt: typeof x.publishAt === "string" ? x.publishAt : null }] as const] : [])),
    );
    const codes = list.map((x) => (typeof x === "string" ? x : String(x?.code ?? "")));
    return applyFill(codes, true, confirmed);
  });
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
    const me = videos.find((v) => v.videoId === videoId);
    if (!me || me.privacyStatus !== "private" || !me.publishAt || Date.parse(me.publishAt) <= now) {
      return fail("Переносить можно только приватный ролик с будущим временем выхода — обновите страницу.");
    }
    // Длинное видео («Разбор») — только в слоты «Разборов» (вт/чт/сб 21:00), Shorts — в свои.
    const long = !isShorts(me.durationSec);
    const schedule = long ? longScheduleOf(channel) : channel.schedule;
    // Те же 60 дней вперёд, что в календаре: у «Разборов» в неделе только их дни.
    const days = long ? Math.ceil((60 / 7) * (schedule.weekdays?.length || 7)) : 60;
    const slots = upcomingSlots(schedule, days * Math.max(1, schedule.publishTimesLocal.length), { from: new Date(now) });
    if (!slots.some((d) => d.getTime() === target)) {
      return fail(long ? "Это время — не слот «Разборов» (вт/чт/сб 21:00) или уже слишком близко." : "Это время — не слот расписания канала или уже слишком близко.");
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

// ---- очередь выхода роликов, которых ещё нет в расписании YouTube ----

export interface QueueResult extends ActionResult {
  undoOrder?: string[];
}

// Перетащили ролик-ориентир на место другого: меняем их местами в очереди. Сохраняется весь
// порядок ожидающих роликов — новые темы плана встанут после них.
export async function swapQueueAction(a: string, b: string): Promise<QueueResult | ActionResult> {
  return guarded(async () => {
    const { state, row: first } = await rowFor(a);
    const second = state.rows.find((r) => r.code === normCode(b));
    const waiting = state.rows.filter((r) => !r.whenExact && r.when);
    const codes = waiting.map((r) => r.code);
    if (!second || first.code === second.code || !codes.includes(first.code) || !codes.includes(second.code)) {
      return fail("Меняться местами могут только ролики без времени на YouTube — обновите страницу.");
    }
    // У «Разборов» свои слоты (вт/чт/сб 21:00): местами меняются только ролики одного потока.
    if (Boolean(first.long) !== Boolean(second.long)) {
      return fail("«Разбор» меняется местами только с другим «Разбором», Shorts — с Shorts: у них разные слоты.");
    }
    const next = codes.map((c) => (c === first.code ? second.code : c === second.code ? first.code : c));
    await setVariable(QUEUE_ORDER_VAR, JSON.stringify(next));
    return {
      ok: true,
      message: `Поменяли местами: ${first.code} — ${second.dateLabel} ${second.timeLabel}, ${second.code} — ${first.dateLabel} ${first.timeLabel} (ориентир; слот на YouTube ролик получит при «Найти новые загрузки»).`,
      undoOrder: codes,
    };
  });
}

export async function restoreQueueAction(order: string[]): Promise<ActionResult> {
  return guarded(async () => {
    const list = Array.isArray(order) ? order.filter((c) => typeof c === "string" && normCode(c) === c).slice(0, 300) : [];
    if (!list.length) return fail("Нечего возвращать — обновите страницу.");
    await setVariable(QUEUE_ORDER_VAR, JSON.stringify(list));
    return ok("Вернули прежний порядок.");
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
    // «Разборы» — по умолчанию включены (старая вкладка поле не пришлёт).
    const value: AutopilotSettings = { enabled: settings.enabled === true, days, retryFailed: settings.retryFailed !== false, keepReleaseDays: keep, scriptReserve: reserve, long: settings.long !== false };
    await setVariable(AUTOPILOT_VAR, JSON.stringify(value));
    const parts = [
      value.enabled ? `автопилот включён: ролики готовятся за ${days} дн. до выхода${reserve ? `, запас сценариев — ${reserve}` : ""}` : "автопилот выключен",
      value.long ? "«Разборы» готовятся тоже (по одному за раз)" : "«Разборы» автопилот не трогает",
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

// ---- канал другого языка: «запланирован в Studio» ----

// Время ролика уже стоит в Studio — план его больше не двигает (lib/lang-plan.ts). at — момент из
// карточки, null — снять отметку. Перечитываем переменную прямо перед записью: две вкладки сразу —
// побеждает последняя.
export async function studioMarkAction(lang: string, code: string, at: string | null): Promise<ActionResult> {
  return guarded(async () => {
    const l = normalizeLang(lang);
    const c = normCode(code);
    if (!l || l === DEFAULT_LANG || !LANGS[l] || !c) return fail("Неверный ролик — обновите страницу.");
    const ms = at === null ? null : Date.parse(at);
    if (ms !== null && !(Number.isFinite(ms) && Math.abs(ms - Date.now()) < 400 * 86_400_000)) return fail("Неверное время — обновите страницу.");
    const marks = parseStudioMarks(await getVariable(STUDIO_MARKS_VAR));
    await setVariable(STUDIO_MARKS_VAR, studioMarksText(withStudioMark(marks, l, c, ms)));
    return ok(ms === null ? `${l}-${c}: отметка снята — время снова по плану.` : `${l}-${c}: запланирован в Studio, время закреплено.`);
  });
}

// ---- «Доска»: «загрузил» в Instagram и TikTok, раскладка, стикеры — одна переменная PANEL_BOARD ----

// Перечитать PANEL_BOARD прямо перед записью и поменять только свой раздел (lib/board.ts →
// writeBoard); не помещается в 48 КБ — ошибка, ничего не пишем. Из одной вкладки действия идут по
// очереди (Next), но запросы с двух устройств могут пересечься: у API переменных GitHub нет
// If-Match, и тогда побеждает последняя запись целиком — как у PANEL_LANG_STUDIO.
async function writeBoardVar(change: (raw: string | null) => BoardWrite): Promise<string | null> {
  const r = change(await getVariable(BOARD_VAR));
  if ("error" in r) return r.error;
  await setVariable(BOARD_VAR, r.text);
  return null;
}

// Ролик выложен (или поставлен в расписание) в Instagram или TikTok: at — его время на доске,
// null — снять отметку. Код — только из плана Shorts; отметку, которую срезал бы лимит (400 на
// площадку), не пишем.
export async function boardMarkAction(platform: string, code: string, at: string | null): Promise<ActionResult> {
  return guarded(async () => {
    const c = normCode(code);
    if (!isSocial(platform) || !c || isLongCode(c)) return fail("Неверный ролик — обновите страницу.");
    if (!(await planCodes([c])).length) return fail(`Ролика ${c} нет в плане — обновите страницу.`);
    const ms = at === null ? null : Date.parse(at);
    if (ms !== null && !(Number.isFinite(ms) && Math.abs(ms - Date.now()) < 400 * 86_400_000)) return fail("Неверное время — обновите страницу.");
    const problem = await writeBoardVar((raw) => boardWithMark(raw, platform, c, ms));
    if (problem) return fail(problem);
    const where = SOCIAL_LABEL[platform];
    return ok(ms === null ? `${where}, ${c}: отметка снята.` : `${where}, ${c}: загружен.`);
  });
}

// Раскладка: новое место зоны или сдвиг карточки после перетаскивания (null — на место по датам),
// reset — «По датам» (стикеры остаются). Одно действие на конец перетаскивания.
export async function boardLayoutAction(patch: LayoutPatch): Promise<ActionResult> {
  return guarded(async () => {
    const problem = await writeBoardVar((raw) => boardWithLayout(raw, patch));
    if (problem) return fail(problem);
    return ok(patch?.reset ? "Доска снова по датам." : "Раскладка сохранена.");
  });
}

// Стикер: put — добавить или изменить (место, текст, цвет), delete — убрать. До 100 штук, текст —
// до 280 знаков.
export async function boardStickerAction(op: StickerOp): Promise<ActionResult> {
  return guarded(async () => {
    const problem = await writeBoardVar((raw) => boardWithSticker(raw, op));
    if (problem) return fail(problem);
    return ok(op?.op === "delete" ? "Стикер удалён." : "Стикер сохранён.");
  });
}

// ---- первый комментарий канала под вышедшим роликом ----

export interface FirstCommentPreview extends ActionResult {
  text: string; // черновик: вопрос из призыва сценария + 1–2 источника из плана
  existing: OwnComment | null; // комментарий канала уже есть — второй не нужен
}

export interface CommentPosted extends ActionResult {
  url: string | null;
}

const VIDEO_ID = /^[\w-]{6,20}$/;
// Только что отправленные (videoId → время): двойное нажатие не даст второй комментарий, даже
// если YouTube ещё не показывает первый в списке.
const justPosted = new Map<string, number>();
const POST_GUARD_MS = 10 * 60_000;

// Черновик: ≈ 3 единицы квоты (канал, ролик, страница комментариев) + план и сценарий из GitHub.
export async function firstCommentPreviewAction(code: string, videoId: string, scriptPath: string | null): Promise<FirstCommentPreview | ActionResult> {
  return guarded(async () => {
    const c = normCode(code) ?? "";
    if (!c || !VIDEO_ID.test(String(videoId ?? ""))) return fail("Неверный запрос — обновите страницу.");
    // «Разбор» (L01) — тема из длинного плана.
    const [planJson, check] = await Promise.all([isLongCode(c) ? readJson(`${STUDIO_DIR}/${LONG_PLAN_FILE}`) : readJson(`${STUDIO_DIR}/content/plan.json`), commentCheck(videoId)]);
    if (check.existing) return { ok: true, message: "", text: "", existing: check.existing };
    const blocked = commentBlocker(check);
    if (blocked) return fail(blocked);
    const item = (isLongCode(c) ? parseLongPlan(planJson) : parsePlan(planJson)).items.find((i) => i.id === c);
    if (!item) return fail(`Ролика ${c} нет в плане — обновите страницу.`);
    // Сценарий — из карточки (путь сверяем с кодом) или из плана; нет — вопрос по названию.
    const path = [scriptPath, item.script].find((p): p is string => typeof p === "string" && /^scripts\/[\w.-]+\.json$/.test(p) && scriptCode(p) === c);
    const script = path ? await readJson(`${STUDIO_DIR}/${path}`).catch(() => null) : null;
    return { ok: true, message: "", text: buildFirstComment({ question: ctaQuestion(script), title: item.title, facts: item.keyFacts }), existing: null };
  });
}

// Отправка: проверка заново (≈ 3 единицы) и commentThreads.insert (50 единиц).
export async function postFirstCommentAction(videoId: string, text: string): Promise<CommentPosted | ActionResult> {
  return guarded(async () => {
    if (!VIDEO_ID.test(String(videoId ?? ""))) return fail("Неверный запрос — обновите страницу.");
    const body = String(text ?? "");
    const problem = commentProblem(body);
    if (problem) return fail(problem);
    const at = justPosted.get(videoId);
    if (at && Date.now() - at < POST_GUARD_MS) return fail("Комментарий под этим роликом уже отправлен — обновите карточку через минуту.");
    const check = await commentCheck(videoId);
    const blocked = commentBlocker(check);
    if (blocked) return check.existing ? { ok: false, message: blocked, url: check.existing.url } : fail(blocked);
    justPosted.set(videoId, Date.now());
    let id: string | null;
    try {
      id = await postComment(videoId, check.channelId!, body);
    } catch (e) {
      justPosted.delete(videoId); // не дошёл — можно повторить
      throw e;
    }
    return {
      ok: true,
      message: "Комментарий опубликован. Закрепите его в приложении YouTube: ⋮ у комментария → «Закрепить» (API этого не умеет).",
      url: id ? commentUrl(videoId, id) : null,
    };
  });
}

// ---- правка сценария и пересборка: только пока ролик не загружен в YouTube ----

// Строка очереди по коду — с той же проверкой YouTube и запусков, что видит панель.
async function rowFor(code: string) {
  const c = normCode(code);
  if (!c) throw new Error("Неверный код ролика — обновите страницу.");
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

export async function rebuildAction(code: string, opts: RebuildOptions): Promise<DispatchResult | ActionResult> {
  return guarded(async () => {
    const { state, row } = await rowFor(code);
    const lock = editLock(row, state.youtubeError);
    if (lock) return fail(lock);
    const o: RebuildOptions = { voice: String(opts?.voice ?? "auto"), voiceName: String(opts?.voiceName ?? ""), theme: String(opts?.theme ?? "auto"), music: opts?.music !== false };
    let dispatched: DispatchResult["dispatched"];
    try {
      dispatched = await dispatchOnce("video-studio.yml", rebuildInputs(row.code, o), "batch", [row.code], state.timezone);
    } catch (e) {
      // Поле music появилось в workflow вместе с этой кнопкой: пока PR не слит, GitHub его не знает.
      if (e instanceof GithubError && e.status === 422 && /music/.test(e.message)) throw new Error("В workflow ветки ещё нет поля music — слейте PR с ним или соберите с музыкой.");
      throw e;
    }
    const what = row.release || row.localVideo ? "пересборка" : "сборка";
    const time = row.long ? LONG_BUILD_LABEL : "≈ 8–10 минут";
    return { ...ok(`Запущена ${what} ${row.code}: ${rebuildLabel(o)}. ${time} в GitHub Actions — новое видео появится в карточке ролика.`), dispatched };
  });
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
