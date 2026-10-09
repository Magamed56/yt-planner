// Опубликовать уже собранный ролик — после того как вы его посмотрели.
//   npm run upload -- out/<slug> [--to youtube|instagram|telegram|youtube,instagram,…] [--privacy …] [--schedule | --publish-at <ISO>]
// YouTube: video.mp4, обложка и youtube.json (заголовок, описание, теги) из папки ролика.
// Instagram: video.mp4 и instagram.txt (+ instagram.json с кадром обложки).
// Telegram: video.mp4, подпись telegram.txt или instagram.txt, обложка cover.jpg.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadChannel } from "../pipeline/channel-file";
import { instagramEnvHelp, missingInstagramEnv, publishRunDir } from "../pipeline/instagram";
import type { YoutubeMeta } from "../pipeline/meta";
import { publishTelegramRunDir, telegramAlreadySent, telegramConfig } from "../pipeline/telegram";
import { PRIVACY_VALUES, missingYoutubeEnv, uploadToYoutube, youtubeEnvHelp, type Privacy } from "../pipeline/youtube";
import { UserError, argsError, fail, ghOutput, ghSummary, loadEnv, rel, resolveInputPath, writeYoutubeResult } from "./common";
import { SCHEDULE_HELP, describePublishAt, parseUploadTargets, resolvePublishAt, scheduleArgsFrom, wantsSchedule } from "./publish-options";

const HELP = `Публикация готового ролика на YouTube, в Instagram и/или в канал Telegram.

  npm run upload -- out/<папка ролика> [параметры]

  --to youtube|instagram|telegram   куда, можно несколько через запятую (по умолчанию youtube)
  --privacy private|unlisted|public видимость на YouTube (по умолчанию private)
${SCHEDULE_HELP}
  --force                      Instagram, Telegram: опубликовать, даже если ролик уже был опубликован

YouTube: нужны YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (npm run youtube-auth).
Instagram: нужны IG_USER_ID и IG_ACCESS_TOKEN (docs/instagram-setup.md).
Telegram: нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (docs/telegram-setup.md, npm run telegram-check).
Instagram и Telegram публикуются сразу: отложенной публикации в их API нет (расписание — workflow).
`;

async function main() {
  loadEnv();
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        run: { type: "string" },
        to: { type: "string", default: "youtube" },
        privacy: { type: "string", default: "private" },
        "publish-at": { type: "string" },
        schedule: { type: "boolean", default: false },
        "schedule-slot": { type: "string" },
        "schedule-start": { type: "string" },
        force: { type: "boolean", default: false },
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
  const targets = parseUploadTargets(String(values.to), "--to");
  if (!targets.size) throw new UserError(`--to: укажите youtube, instagram, telegram или несколько через запятую.`);
  const privacy = String(values.privacy) as Privacy;
  if (!PRIVACY_VALUES.includes(privacy)) throw new UserError(`--privacy: ${PRIVACY_VALUES.join(" | ")}.`);
  const schedule = scheduleArgsFrom(values);
  if (wantsSchedule(schedule) && !targets.has("youtube")) throw new UserError("Расписание (--schedule, --publish-at) работает только для YouTube — у API Instagram и ботов Telegram отложенной публикации нет.");

  const video = path.join(runDir, "video.mp4");
  if (!fs.existsSync(video)) throw new UserError(`В ${rel(runDir)} нет video.mp4 — сначала соберите ролик: npm run make -- …`);
  // Ключи проверяем заранее: не публиковать половину, если для второй половины их нет.
  if (targets.has("youtube") && missingYoutubeEnv().length) throw new UserError(`Не заданы ${missingYoutubeEnv().join(", ")}.\n${youtubeEnvHelp()}`);
  if (targets.has("instagram") && missingInstagramEnv().length) throw new UserError(`Не заданы ${missingInstagramEnv().join(", ")}.\n${instagramEnvHelp()}`);
  if (targets.has("telegram")) {
    telegramConfig(); // нет ключей или они не того вида — объяснит, что сделать
    // Уже отправлен — сказать до YouTube и Instagram, а не после них.
    const sent = values.force === true ? null : telegramAlreadySent(runDir);
    if (sent) throw new UserError(targets.size > 1 ? `${sent}\nИли уберите telegram из --to.` : sent);
  }

  if (targets.has("youtube")) {
    const metaFile = path.join(runDir, "youtube.json");
    if (!fs.existsSync(metaFile)) throw new UserError(`В ${rel(runDir)} нет youtube.json — пересоберите ролик свежей версией npm run make.`);
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as YoutubeMeta;
    // JPEG — только если он не старше PNG (иначе это остаток прошлого рендера).
    const png = path.join(runDir, "thumbnail.png");
    const jpg = path.join(runDir, "thumbnail.jpg");
    const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);
    const thumb = mtime(jpg) >= 0 && mtime(jpg) >= mtime(png) ? jpg : mtime(png) >= 0 ? png : null;
    let channel;
    try {
      channel = loadChannel();
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : String(e));
    }
    const publishAt = resolvePublishAt(schedule, channel, path.dirname(runDir));
    const when = publishAt ? `, выйдет ${describePublishAt(publishAt, channel)}` : "";
    console.log(`video-studio · загрузка на YouTube\n  «${meta.title}» (${publishAt ? "private до публикации" : privacy}${when})`);
    const r = await uploadToYoutube({ videoFile: video, thumbnailFile: thumb, meta, privacy, publishAt });
    writeYoutubeResult(runDir, r);
    console.log(`\n✔ ${r.url} (${r.privacy}${r.publishAt ? `, опубликуется ${describePublishAt(r.publishAt, channel)}` : ""})\n  редактировать: ${r.studioUrl}`);
    if (!r.publishAt && privacy !== "private" && r.privacy === "private") {
      console.log(
        "  ⚠ YouTube оставил видео приватным: загрузки из непроверенных проектов Google Cloud всегда приватные.\n" +
          "    Смените видимость вручную в YouTube Studio (или пройдите аудит API — см. README).",
      );
    }
    ghOutput({ youtube_url: r.url, youtube_id: r.videoId, youtube_publish_at: r.publishAt });
    ghSummary(
      `### ▶️ YouTube\n\n${r.url} — видимость: **${r.privacy}**${r.publishAt ? `, выйдет **${describePublishAt(r.publishAt, channel)}**` : ""}${r.thumbnailSet ? ", обложка установлена" : ""}. [Открыть в Studio](${r.studioUrl})\n`,
    );
  }

  if (targets.has("instagram")) {
    console.log(`\nvideo-studio · публикация Reels в Instagram\n  папка: ${rel(runDir)}`);
    const r = await publishRunDir(runDir, { force: values.force === true, log: (m) => console.log(`  ${m}`) });
    const link = r.permalink ?? `id ${r.mediaId}`;
    console.log(`\n✔ Instagram: ${link}${r.duplicate ? " (уже был опубликован — второй раз не постил)" : ""}`);
    ghOutput({ instagram_url: r.permalink, instagram_id: r.mediaId, instagram_duplicate: r.duplicate ? "true" : "false" });
    ghSummary(`### 📸 Instagram\n\n${link}${r.duplicate ? " — уже был опубликован, повторно не публиковали" : ""}\n`);
  }

  if (targets.has("telegram")) {
    console.log(`\nvideo-studio · ролик в канал Telegram\n  папка: ${rel(runDir)}`);
    const r = await publishTelegramRunDir(runDir, { force: values.force === true, log: (m) => console.log(`  ${m}`) });
    const link = r.url ?? `сообщение ${r.messageId} в ${r.chatTitle ?? r.chatId}`;
    console.log(`\n✔ Telegram: ${link}`);
    ghOutput({ telegram_url: r.url, telegram_message_id: r.messageId });
    ghSummary(`### ✈️ Telegram\n\n${link}${r.chatTitle ? ` — «${r.chatTitle}»` : ""}${r.withCover ? ", с обложкой" : ""}\n`);
  }
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
