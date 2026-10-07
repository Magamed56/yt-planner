// Загрузить уже собранный ролик на YouTube — после того как вы его посмотрели.
//   npm run upload -- out/<slug> [--privacy private|unlisted|public] [--publish-at 2026-10-10T09:00:00Z]
// Берёт video.mp4, обложку и youtube.json (заголовок, описание, теги) из папки ролика.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { YoutubeMeta } from "../pipeline/meta";
import { PRIVACY_VALUES, uploadToYoutube, type Privacy } from "../pipeline/youtube";
import { UserError, argsError, fail, ghOutput, ghSummary, loadEnv, rel, resolveInputPath, writeJson } from "./common";

const HELP = `Загрузка готового ролика на YouTube.

  npm run upload -- out/<папка ролика> [--privacy private|unlisted|public] [--publish-at <ISO-время>]

Нужны YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (см. npm run youtube-auth).
`;

async function main() {
  loadEnv();
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        run: { type: "string" },
        privacy: { type: "string", default: "private" },
        "publish-at": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const runArg = (typeof values.run === "string" ? values.run : positionals[0])?.trim();
  if (!runArg) throw new UserError(`Укажите папку ролика.\n\n${HELP}`);
  const runDir = resolveInputPath(runArg);
  if (!runDir || !fs.statSync(runDir).isDirectory()) throw new UserError(`Папка ролика не найдена: ${runArg}`);
  const privacy = String(values.privacy) as Privacy;
  if (!PRIVACY_VALUES.includes(privacy)) throw new UserError(`--privacy: ${PRIVACY_VALUES.join(" | ")}.`);
  const publishAt = typeof values["publish-at"] === "string" ? values["publish-at"] : null;
  if (publishAt && Number.isNaN(Date.parse(publishAt))) throw new UserError(`--publish-at: не похоже на дату ISO 8601 (пример: 2026-10-10T09:00:00+06:00).`);

  const video = path.join(runDir, "video.mp4");
  const metaFile = path.join(runDir, "youtube.json");
  if (!fs.existsSync(video)) throw new UserError(`В ${rel(runDir)} нет video.mp4 — сначала соберите ролик: npm run make -- …`);
  if (!fs.existsSync(metaFile)) throw new UserError(`В ${rel(runDir)} нет youtube.json — пересоберите ролик свежей версией npm run make.`);
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as YoutubeMeta;
  const thumb = ["thumbnail.jpg", "thumbnail.png"].map((f) => path.join(runDir, f)).find((f) => fs.existsSync(f)) ?? null;

  console.log(`video-studio · загрузка на YouTube\n  «${meta.title}» (${privacy}${publishAt ? `, публикация ${publishAt}` : ""})`);
  const r = await uploadToYoutube({ videoFile: video, thumbnailFile: thumb, meta, privacy, publishAt });
  writeJson(path.join(runDir, "youtube-result.json"), r);
  console.log(`\n✔ ${r.url} (${r.privacy})\n  редактировать: ${r.studioUrl}`);
  if (privacy !== "private" && r.privacy === "private") {
    console.log(
      "  ⚠ YouTube оставил видео приватным: загрузки из непроверенных проектов Google Cloud всегда приватные.\n" +
        "    Смените видимость вручную в YouTube Studio (или пройдите аудит API — см. README).",
    );
  }
  ghOutput({ youtube_url: r.url, youtube_id: r.videoId });
  ghSummary(`### ▶️ YouTube\n\n${r.url} — видимость: **${r.privacy}**${r.thumbnailSet ? ", обложка установлена" : ""}. [Открыть в Studio](${r.studioUrl})\n`);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
