// description.txt релизов с пустым текстом релиза — для страницы English и «Доски». Файл по
// номеру не меняется — помним его; не прочитался — название из релиза, копирование описания скрыто.
// Только для сервера (токен GitHub).
import { assetText } from "./github";
import { withFileTexts, type LangVideo } from "./lang-videos";

const fileTexts = new Map<number, string>();

async function readTexts(ids: number[]): Promise<Map<number, string>> {
  if (fileTexts.size > 200) fileTexts.clear();
  await Promise.all(
    ids.filter((id) => !fileTexts.has(id)).map((id) =>
      assetText(id)
        .then((t) => void fileTexts.set(id, t))
        .catch(() => {}),
    ),
  );
  return fileTexts;
}

// Ролики без текстов в теле релиза — тексты из description.txt (не больше limit за заход).
export async function withReleaseTexts<T extends LangVideo>(videos: T[], limit = 12): Promise<T[]> {
  const missing = videos.filter((v) => !v.texts && v.description).slice(0, limit);
  if (!missing.length) return videos;
  return withFileTexts(videos, await readTexts(missing.map((v) => v.description!.id))) as T[];
}
