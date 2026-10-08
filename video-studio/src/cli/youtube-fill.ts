// Ролики загрузили в YouTube Studio руками — эта команда ставит им тексты и расписание.
//   npm run youtube-fill [-- --items content/week1-videos.json] [--schedule slots|none] [--schedule-start 2026-10-09] [--only 01a,01b] [--dry-run]
// Ролик узнаём по коду «01a» в имени файла (Studio кладёт имя файла и в заголовок-черновик),
// иначе — по однозначной длительности. Подробно: docs/youtube-setup.md, «Загрузили руками».
import fs from "node:fs";
import { parseArgs } from "node:util";
import { formatLocal, loadChannel, parseScheduleStart } from "../pipeline/channel";
import { applyUpdate, listChannelVideos, matchVideos, planUpdates, type FillItem, type ScheduleMode } from "../pipeline/youtube-fill";
import { missingYoutubeEnv, youtubeAuth, youtubeEnvHelp } from "../pipeline/youtube";
import { UserError, argsError, escapeMd, fail, ghSummary, loadEnv, rel, resolveInputPath } from "./common";

const HELP = `Тексты и расписание для роликов, загруженных в YouTube Studio руками.

  npm run youtube-fill [-- параметры]

  --items <файл>              список роликов (по умолчанию content/week1-videos.json)
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
    if (!/^\d{2}[a-z]$/i.test(v.id ?? "")) throw new UserError(`${where}: id должен быть вида «01a», а не «${v.id}».`);
    if (seen.has(v.id.toLowerCase())) throw new UserError(`${where}: id «${v.id}» повторяется.`);
    seen.add(v.id.toLowerCase());
    if (!v.title?.trim() || v.title.length > 100) throw new UserError(`${where}: название пустое или длиннее 100 символов.`);
    if (typeof v.description !== "string" || Buffer.byteLength(v.description) > 5000) throw new UserError(`${where}: описание больше 5000 байт.`);
    if (!Array.isArray(v.tags)) throw new UserError(`${where}: tags должен быть списком.`);
    if (!Number.isFinite(v.durationSec)) throw new UserError(`${where}: нет durationSec.`);
  }
  return list;
}

const studio = (id: string) => `https://studio.youtube.com/video/${id}/edit`;

async function main() {
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        items: { type: "string", default: "content/week1-videos.json" },
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
  const itemsFile = resolveInputPath(String(values.items));
  if (!itemsFile) throw new UserError(`Не найден файл со списком роликов: ${values.items}`);
  let items = readItems(itemsFile);
  if (typeof values.only === "string" && values.only.trim()) {
    const only = new Set(values.only.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    const unknown = [...only].filter((c) => !items.some((i) => i.id.toLowerCase() === c));
    if (unknown.length) throw new UserError(`--only: нет таких роликов в ${rel(itemsFile)}: ${unknown.join(", ")}`);
    items = items.filter((i) => only.has(i.id.toLowerCase()));
  }
  const missingEnv = missingYoutubeEnv();
  if (missingEnv.length) throw new UserError(`Не заданы ${missingEnv.join(", ")}.\n${youtubeEnvHelp()}`);

  const channel = loadChannel();
  const tz = channel.schedule.timezone;
  const start = typeof values["schedule-start"] === "string" && values["schedule-start"].trim() ? parseScheduleStart(values["schedule-start"], tz) : null;
  const dry = values["dry-run"] === true;
  const deps = { auth: youtubeAuth(), log: (m: string) => console.log(`  ${m}`) };

  console.log(`video-studio · тексты и расписание для ${items.length} роликов из ${rel(itemsFile)}${dry ? " (пробный запуск, без изменений)" : ""}`);
  const videos = await listChannelVideos(deps);
  console.log(`  на канале видео: ${videos.length}`);
  const report = matchVideos(items, videos);
  const plan = planUpdates(report, { schedule: channel.schedule, mode, start });

  const rows: string[] = [];
  const warnings: string[] = [];
  let changed = 0;
  for (const p of plan) {
    const { item, video, by } = p.match;
    const when = p.publishAt ? formatLocal(new Date(p.publishAt), tz) : p.privacyStatus === "public" ? "уже опубликован" : "время не задано";
    let result: string;
    if (p.skip) result = "уже заполнено";
    else if (dry) result = "будет заполнено";
    else {
      const r = await applyUpdate(deps, p);
      changed++;
      if (r.warning) warnings.push(`${item.id}: ${r.warning}`);
      result = r.warning ? "тексты ✔, время ✖" : "✔";
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
  for (const w of warnings) console.log(`  ⚠ ${w}`);

  const hints: string[] = [];
  if (report.missing.length)
    hints.push(
      "Не нашли ролик: проверьте, что он загружен на этот канал, и что имя файла (или название в Studio) начинается с его кода — «01a», «01b»… " +
        "Только что загруженное видео YouTube иногда показывает через несколько минут — запустите ещё раз.",
    );
  if (mode === "slots") hints.push(`Время — по слотам channel.json (${channel.schedule.publishTimesLocal.join(", ")}, ${tz}); до выхода ролик приватный.`);
  ghSummary(
    `### 📺 YouTube: тексты и расписание${dry ? " (пробный запуск)" : ""}\n\n` +
      `| № | Ролик | Нашли по | Выход | Итог |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n` +
      [...warnings.map((w) => `⚠ ${w}`), ...hints].map((h) => `- ${escapeMd(h)}`).join("\n") +
      "\n",
  );

  const found = report.matches.length;
  console.log(
    `\n${found ? "✔" : "✖"} Найдено ${found} из ${items.length}` +
      (dry ? "; это пробный запуск — ничего не меняли." : `; обновлено ${changed}, уже было в порядке ${plan.filter((p) => p.skip).length}.`),
  );
  if (!found) throw new UserError(`Ни одного ролика из списка на канале не нашли.\n${hints[0] ?? ""}`);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
