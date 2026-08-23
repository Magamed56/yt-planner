import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";

export async function uploadVideoToYoutube({
  filePath,
  title,
  description,
  privacyStatus,
}: {
  filePath: string;
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
}): Promise<{ youtubeVideoId: string; videoUrl: string }> {
  // Сначала проверяем подключение YouTube — это самая частая причина сбоя
  // (ещё не подключили аккаунт), даёт понятнее ошибку, чем "файл не найден".
  const auth = await getAuthenticatedClient();

  // Файла может не быть (опечатка в пути, файл ещё не готов и т.п.) — лучше
  // понятная ошибка сразу, чем непонятный сбой внутри googleapis.
  await stat(filePath).catch(() => {
    throw new Error(`Файл не найден: ${filePath}`);
  });

  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description },
      status: { privacyStatus },
    },
    media: { body: createReadStream(filePath) },
  });

  const youtubeVideoId = res.data.id;
  if (!youtubeVideoId) throw new Error("YouTube не вернул id загруженного видео");

  return { youtubeVideoId, videoUrl: `https://youtube.com/watch?v=${youtubeVideoId}` };
}
