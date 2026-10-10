// Ролики загрузили в YouTube Studio руками — эта команда ставит им тексты и расписание.
//   npm run youtube-fill [-- --items content/week1-videos.json,content/videos.json] [--schedule slots|none] [--schedule-start 2026-10-09] [--only 01a,01b] [--dry-run]
// Ролик узнаём по коду «01a» в имени файла (Studio кладёт имя файла и в заголовок-черновик),
// иначе — по однозначной длительности. Подробно: docs/youtube-setup.md, «Загрузили руками».
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { formatLocal, longScheduleOf, parseScheduleStart } from "../pipeline/channel";
import { loadChannel } from "../pipeline/channel-file";
import { isLongCode, normCode } from "../pipeline/codes";
import { applyUpdate, listChannelVideos, matchVideos, planUpdates, type FillItem, type ScheduleMode } from "../pipeline/youtube-fill";
import { missingYoutubeEnv, youtubeAuth, youtubeEnvHelp } from "../pipeline/youtube";
import { UserError, argsError, escapeMd, fail, ghSummary, loadEnv, rel, resolveInputPath } from "./common";

const HELP = `Тексты и расписание для роликов, загруженных в YouTube Studio руками.

  npm run youtube-fill [-- параметры]

  --items <файлы>             списки роликов через запятую (по умолчанию content/week1-videos.json
                              и content/videos.json — его пополняет workflow после рендера)
  --schedule slots|none       slots — время выхода по слотам channel.json, 2 в день (по умолчанию);
                              none — только тексты, видимость не трогать
  --schedule-start <дата>     считать слоты с этой даты: 2026-10-09 (по умолчанию — с ближайшего)
  --only 01a,01b              только эти ролики
  --dry-run                   ничего не менять, показать, что будет сделано

Нужны YT_CLIENT_ID, YT_CLIENT_SECRET и YT_REFRESH_TOKEN с правами youtube.upload и youtube.
`;

function readItems(file: string): FillItem[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { videos?: unknown } | unknown[];
  const list = (Array.isArray(raw) ? raw : (raw as { videos?: unknown }).videos) as FillItem[] | undefined;
  if (!Array.isArray(list) || !list.length) throw new UserError(`${rel(file)}: нет списка роликов (ожидается { "videos": [ … ] }).`);
  const seen = new Set<string>();
  for (const [i, v] of list.entries()) {
    const where = `${rel(file)}, ролик ${i + 1}`;
    if (!normCode(v.id)) throw new UserError(`${where}: id должен быть вида «01a» (Shorts) или «L01» («Разбор»), а не «${v.id}».`);
    if (seen.has(v.id.toLowerCase())) throw new UserError(`${where}: id «${v.id}» повторяется.`);
    seen.add(v.id.toLowerCase());
    if (!v.title?.trim() || v.title.length > 100) throw new UserError(`${where}: название пустое или длиннее 100 символов.`);
    if (typeof v.description !== "string" || Buffer.byteLength(v.description) > 5000) throw new UserError(`${where}: описание больше 5000 байт.`);
    if (!Array.isArray(v.tags)) throw new UserError(`${where}: tags должен быть списком.`);
    if (!Number.isFinite(v.durationSec)) throw new UserError(`${where}: нет durationSec.`);
    if (!/^\d+$/.test(String(v.categoryId ?? ""))) throw new UserError(`${where}: categoryId — номер категории YouTube, например "27" (Образование).`);
    if (!v.defaultLanguage?.trim()) throw new UserError(`${where}: нет defaultLanguage (например "ru").`);
    if (typeof v.containsSyntheticMedia !== "boolean") throw new UserError(`${where}: containsSyntheticMedia должен быть true или false.`);
    if (/[<>]/.test(v.title + v.description)) throw new UserError(`${where}: YouTube не принимает «<» и «>» в названии и описании.`);
  }
  return list;
}

const studio = (id: string) => `https://studio.youtube.com/video/${id}/edit`;
const WEEKDAY_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const DEFAULT_ITEMS = "content/week1-videos.json,content/videos.json";

// Несколько списков через запятую. content/videos.json появляется только после первого
// рендера в релиз — пока его нет, это не ошибка; любой другой ненайденный файл — ошибка.
function readItemLists(arg: string): { items: FillItem[]; label: string } {
  const files: string[] = [];
  for (const f of arg.split(",").map((s) => s.trim()).filter(Boolean)) {
    const found = resolveInputPath(f);
    if (found) files.push(found);
    else if (path.basename(f) !== "videos.json") throw new UserError(`Не найден файл со списком роликов: ${f}`);
  }
  if (!files.length) throw new UserError(`Не найден ни один список роликов: ${arg}`);
  const items: FillItem[] = [];
  for (const file of files) {
    for (const it of readItems(file)) {
      if (items.some((i) => i.id.toLowerCase() === it.id.toLowerCase())) throw new UserError(`${rel(file)}: ролик «${it.id}» уже есть в другом списке — оставьте его в одном.`);
      items.push(it);
    }
  }
  return { items, label: files.map(rel).join(" + ") };
}

async function main() {
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        items: { type: "string", default: DEFAULT_ITEMS },
        schedule: { type: "string", default: "slots" },
        "schedule-start": { type: "string" },
        only: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (values.help) {
    console.log(HELP);
    return;
  }
  const mode = String(values.schedule) as ScheduleMode;
  if (mode !== "slots" && mode !== "none") throw new UserError(`--schedule: «${values.schedule}» — бывает slots или none.`);
  const { items, label: itemsLabel } = readItemLists(String(values.items));
  let only: Set<string> | null = null;
  if (typeof values.only === "string" && values.only.trim()) {
    only = new Set(values.only.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    const unknown = [...only].filter((c) => !items.some((i) => i.id.toLowerCase() === c));
    if (unknown.length) throw new UserError(`--only: нет таких роликов в ${itemsLabel}: ${unknown.join(", ")}`);
  }
  const wanted = (id: string) => !only || only.has(id.toLowerCase());
  const missingEnv = missingYoutubeEnv();
  if (missingEnv.length) throw new UserError(`Не заданы ${missingEnv.join(", ")}.\n${youtubeEnvHelp()}`);

  const channel = loadChannel();
  const tz = channel.schedule.timezone;
  const start = typeof values["schedule-start"] === "string" && values["schedule-start"].trim() ? parseScheduleStart(values["schedule-start"], tz) : null;
  const dry = values["dry-run"] === true;
  const deps = { auth: youtubeAuth(), log: (m: string) => console.log(`  ${m}`) };

  const count = items.filter((i) => wanted(i.id)).length;
  console.log(`video-studio · тексты и расписание для ${count} роликов из ${itemsLabel}${dry ? " (пробный запуск, без изменений)" : ""}`);
  const videos = await listChannelVideos(deps);
  console.log(`  на канале видео: ${videos.length}`);
  // Сопоставляем со всем списком, а --only применяем к итогу.
  const full = matchVideos(items, videos);
  const report = {
    matches: full.matches.filter((m) => wanted(m.item.id)),
    missing: full.missing.filter((i) => wanted(i.id)),
    duplicates: full.duplicates.filter((d) => wanted(d.item.id)),
    broken: full.broken.filter((b) => wanted(b.item.id)),
    pending: full.pending.filter((x) => wanted(x.item.id)),
  };
  // Занятые слоты — все запланированные ролики канала, не только из этого списка.
  const now = Date.now();
  const taken = videos.filter((v) => v.privacyStatus === "private" && v.publishAt && Date.parse(v.publishAt) > now).map((v) => v.publishAt!);
  // «Разборы» (L01…) — в свои слоты (channel.json → longSlots), Shorts — в свои.
  const plan = planUpdates(report, { schedule: channel.schedule, longSchedule: longScheduleOf(channel), mode, start, taken });

  const rows: string[] = [];
  const warnings: string[] = [];
  let changed = 0;
  let failed = 0;
  for (const p of plan) {
    const { item, video, by } = p.match;
    const when = p.publishAt ? formatLocal(new Date(p.publishAt), tz) : p.privacyStatus === "public" ? "уже опубликован" : "время не задано";
    let result: string;
    if (p.skip) result = "уже заполнено";
    else if (dry) result = "будет заполнено";
    else {
      try {
        const r = await applyUpdate(deps, p);
        changed++;
        if (r.warning) warnings.push(`${item.id}: ${r.warning}`);
        result = r.warning ? "тексты ✔, время ✖" : "✔";
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`${item.id}: ${msg}`);
        result = "ошибка";
        // Без прав или ключа остальные ролики тоже не пройдут — не тратим квоту.
        if (/не хватает прав|недействителен|неверные YT_CLIENT|квота/.test(msg)) {
          console.log(`  ${item.id}  ✖ ${msg}`);
          throw new UserError(msg);
        }
      }
    }
    const kept = p.keptPublishAt ? " (было)" : "";
    console.log(`  ${item.id}  ${result.padEnd(15)} ${when}${kept}  ← нашли по ${by}: ${video.fileName ?? video.title} → ${studio(video.videoId)}`);
    rows.push(`| ${item.id} | [${escapeMd(item.title)}](${studio(video.videoId)}) | ${by} | ${escapeMd(when)}${kept} | ${result} |`);
  }
  for (const m of report.missing) {
    console.log(`  ${m.id}  не найден на канале: ${m.file}.mp4`);
    rows.push(`| ${m.id} | ${escapeMd(m.title)} | — | — | не найден |`);
  }
  for (const d of report.duplicates) {
    const links = d.videos.map((v) => studio(v.videoId));
    console.log(`  ${d.item.id}  загружен ${d.videos.length} раза — удалите лишний и запустите снова: ${links.join(" , ")}`);
    rows.push(`| ${d.item.id} | ${escapeMd(d.item.title)} | — | — | загружен ${d.videos.length} раза: ${links.map((l, i) => `[${i + 1}](${l})`).join(" ")} |`);
  }
  for (const b of report.broken) {
    console.log(`  ${b.item.id}  загрузка не удалась (${b.video.uploadStatus}) — загрузите файл заново`);
    rows.push(`| ${b.item.id} | ${escapeMd(b.item.title)} | — | — | загрузка не удалась (${b.video.uploadStatus}) |`);
  }
  for (const x of report.pending) {
    console.log(`  ${x.item.id}  ещё загружается или обрабатывается — запустите снова через 5–10 минут: ${studio(x.video.videoId)}`);
    rows.push(`| ${x.item.id} | [${escapeMd(x.item.title)}](${studio(x.video.videoId)}) | — | — | ещё загружается — запустите позже |`);
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);

  const hints: string[] = [];
  if (report.missing.length)
    hints.push(
      "Не нашли ролик: проверьте, что он загружен на этот канал, и что имя файла (или название в Studio) начинается с его кода — «01a», «01b»… " +
        "Только что загруженное видео YouTube иногда показывает через несколько минут — запустите ещё раз.",
    );
  if (mode === "slots") hints.push(`Время — по слотам channel.json (${channel.schedule.publishTimesLocal.join(", ")}, ${tz}); до выхода ролик приватный.`);
  if (mode === "slots" && plan.some((p) => isLongCode(p.match.item.id))) {
    const ls = longScheduleOf(channel);
    hints.push(`«Разборы» (L01…) — в свои слоты: ${(ls.weekdays ?? []).map((d) => WEEKDAY_RU[d]).join(", ")} в ${ls.publishTimesLocal.join(", ")}. Обложку «Разбору» ставит панель («Найти новые загрузки»); отсюда — поставьте thumbnail.png из релиза в Studio.`);
  }
  ghSummary(
    `### 📺 YouTube: тексты и расписание${dry ? " (пробный запуск)" : ""}\n\n` +
      `| № | Ролик | Нашли по | Выход | Итог |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n` +
      [...warnings.map((w) => `⚠ ${w}`), ...hints].map((h) => `- ${escapeMd(h)}`).join("\n") +
      "\n",
  );

  const found = report.matches.length;
  console.log(
    `\n${found && !failed ? "✔" : "✖"} Найдено ${found} из ${count}` +
      (dry ? "; это пробный запуск — ничего не меняли." : `; обновлено ${changed}, уже было в порядке ${plan.filter((p) => p.skip).length}${failed ? `, с ошибкой ${failed}` : ""}.`),
  );
  if (!found) throw new UserError(`Ни одного ролика из списка на канале не нашли.\n${hints[0] ?? ""}`);
  if (failed) throw new UserError(`${failed} ролик(ов) не обновились — причины выше. Запустите ещё раз: готовые пропустятся.`);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
