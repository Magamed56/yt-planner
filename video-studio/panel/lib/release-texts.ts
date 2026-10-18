// Тексты для YouTube из релиза ролика — когда в content/videos.json записи нет. Тело релиза —
// его description.txt (workflow создаёт релиз с --notes-file), там название, описание и теги.
// Так бывает, если пакет собирали в другой ветке: релиз есть, а коммит с текстами до
// GITHUB_BRANCH не дошёл. Чистая функция — её проверяет scripts/release-texts-test.ts.
import { mp4Code } from "../../src/pipeline/codes";
import type { FillItem } from "../../src/pipeline/youtube-fill";
import type { GhRelease } from "./github";
import { parseStudioTexts } from "./lang-videos";

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};

// Самый свежий релиз на код — как в очереди (state.ts → releasesByCode): по времени публикации.
// Его тело без наших заголовков (правили на GitHub) — кода в ответе нет, старый релиз не берём:
// его видео могло быть другим.
export function releaseFillItems(releases: GhRelease[], codes: string[]): FillItem[] {
  const want = new Set(codes);
  const best = new Map<string, { at: number; release: GhRelease; file: string }>();
  for (const r of releases) {
    if (r.draft) continue;
    const mp4 = r.assets.find((a) => mp4Code(a.name));
    const code = mp4 ? mp4Code(mp4.name) : null;
    if (!mp4 || !code || !want.has(code)) continue;
    const at = ms(r.published_at ?? r.created_at);
    const prev = best.get(code);
    if (prev && prev.at >= at) continue;
    best.set(code, { at, release: r, file: mp4.name.replace(/\.mp4$/i, "") });
  }
  const out: FillItem[] = [];
  for (const [code, { release, file }] of best) {
    const texts = parseStudioTexts(release.body);
    if (!texts?.description) continue;
    // Категория, язык и отметка ИИ — как у всех роликов в content/videos.json.
    out.push({ id: code, file, durationSec: Number.NaN, ...texts, categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true });
  }
  return out;
}
