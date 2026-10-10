// Собранный ролик → content/videos.json: название, описание и теги, которые youtube-fill
// поставит ему, когда его загрузят в YouTube Studio руками (как week1-videos.json для недели 1).
// Зовёт workflow после рендера в релиз:
//   npx tsx src/cli/videos-list.ts out/<slug> --code 08a --file 08a-<slug> --duration 57.3
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { YoutubeMeta } from "../pipeline/meta";
import { normCode } from "../pipeline/codes";
import { fillItemsOf, upsertFillItem, type FillItem } from "../pipeline/youtube-fill";
import { ROOT, UserError, argsError, fail, rel, resolveInputPath, writeJson } from "./common";

const HELP = `Добавить собранный ролик в список текстов для youtube-fill.

  npx tsx src/cli/videos-list.ts <папка ролика> --code 08a --file 08a-<имя> --duration 57.3 [--list content/videos.json]
  («Разбор» по длинному плану: --code L01 --file L01-<имя>)

--file — имя файла видео без .mp4, с которым ролик загрузят в Studio (по коду в нём его найдёт youtube-fill).
`;

const ABOUT =
  "Тексты для роликов, загруженных в YouTube Studio вручную (с недели 2; неделя 1 — week1-videos.json). " +
  "Пополняет workflow после рендера в релиз, читает npm run youtube-fill; порядок — по коду, он же порядок слотов.";

function main() {
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        code: { type: "string" },
        file: { type: "string" },
        duration: { type: "string" },
        list: { type: "string", default: "content/videos.json" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    return;
  }
  const runDir = positionals[0] ? resolveInputPath(positionals[0]) : null;
  if (!runDir) throw new UserError(`Не найдена папка ролика: ${positionals[0] ?? "(не указана)"}\n\n${HELP}`);
  // Shorts — «08a», «Разбор» по длинному плану — «L01».
  const code = normCode(values.code);
  if (!code) throw new UserError(`--code: код ролика вида «08a» или «L01», а не «${values.code ?? ""}».`);
  const file = String(values.file ?? "").trim().replace(/\.mp4$/i, "");
  if (!file.toLowerCase().startsWith(`${code.toLowerCase()}-`)) throw new UserError(`--file должен начинаться с кода «${code}-»: по нему youtube-fill узнаёт ролик в Studio.`);
  const durationSec = Number(values.duration);
  if (!(durationSec > 0)) throw new UserError("--duration: длительность ролика в секундах.");
  const metaFile = path.join(runDir, "youtube.json");
  if (!fs.existsSync(metaFile)) throw new UserError(`В ${rel(runDir)} нет youtube.json — его пишет npm run make.`);
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as YoutubeMeta;

  const listFile = path.isAbsolute(String(values.list)) ? String(values.list) : path.join(ROOT, String(values.list));
  const raw: unknown = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : null;
  const item: FillItem = {
    id: code,
    file,
    durationSec: Math.round(durationSec * 100) / 100,
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    categoryId: meta.categoryId,
    defaultLanguage: meta.defaultLanguage,
    containsSyntheticMedia: meta.containsSyntheticMedia,
  };
  const videos = upsertFillItem(fillItemsOf(raw), item);
  const about = raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { about?: unknown }).about === "string" ? (raw as { about: string }).about : ABOUT;
  writeJson(listFile, { about, videos });
  console.log(`✔ ${code} «${meta.title}» → ${rel(listFile)} (роликов в списке: ${videos.length})`);
}

try {
  main();
} catch (e) {
  fail(e);
}
