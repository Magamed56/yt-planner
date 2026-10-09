// Новое название ролика из панели: какие идеи показать (content/title-ideas.json) и тело
// videos.update part=snippet. Только чистые функции — их проверяет scripts/insights-test.ts.
import { cleanTitle, titleProblem, type TitleIdeasFile } from "../../src/pipeline/title-ideas";

// snippet из videos.list — то, что нужно вернуть в videos.update без изменений.
export interface ApiSnippet {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
}

// Изменяемые поля snippet, которых нет в запросе, YouTube сбрасывает (описание, теги, язык),
// а categoryId обязателен — поэтому переносим всё текущее и меняем только название.
export function titleUpdateBody(videoId: string, s: ApiSnippet, title: string): { id: string; snippet: Record<string, unknown> } {
  const t = cleanTitle(title);
  const why = titleProblem(t);
  if (why) throw new Error(`Название не подходит YouTube: ${why}.`);
  if (!s.categoryId) throw new Error("YouTube не вернул категорию ролика — название не меняю, обновите страницу.");
  const snippet: Record<string, unknown> = { title: t, categoryId: s.categoryId, description: s.description ?? "", tags: s.tags ?? [] };
  if (s.defaultLanguage) snippet.defaultLanguage = s.defaultLanguage;
  if (s.defaultAudioLanguage) snippet.defaultAudioLanguage = s.defaultAudioLanguage;
  return { id: videoId, snippet };
}

export interface TitleIdeaView {
  code: string;
  videoId: string;
  title: string; // название на YouTube сейчас
  before: string; // название, когда придумывали идеи — им можно вернуть прежнее
  ideas: string[]; // без нынешнего названия
  atLabel: string;
}

const same = (a: string, b: string) => cleanTitle(a).toLowerCase() === cleanTitle(b).toLowerCase();

// Идеи для вышедших роликов плана, придуманные не раньше maxAgeDays назад: свежие — первыми.
export function titleIdeaViews(file: TitleIdeasFile, videos: { videoId: string; code: string | null; title: string }[], now: Date, tz: string, maxAgeDays = 14): TitleIdeaView[] {
  const byCode = new Map(videos.filter((v) => v.code).map((v) => [v.code!, v]));
  const fmt = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const since = now.getTime() - maxAgeDays * 86_400_000;
  return file.items
    .filter((e) => Date.parse(e.at) >= since && byCode.has(e.code))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((e) => {
      const v = byCode.get(e.code)!;
      return { code: e.code, videoId: v.videoId, title: v.title, before: e.current, ideas: e.ideas.filter((t) => !same(t, v.title)), atLabel: fmt.format(Date.parse(e.at)) };
    });
}

// Что разрешено поставить из панели: идеи из файла и прежнее название (вернуть как было).
export function allowedTitle(file: TitleIdeasFile, code: string, title: string): string | null {
  const e = file.items.find((i) => i.code === code);
  if (!e) return null;
  const t = cleanTitle(title);
  return [...e.ideas, e.current].find((x) => x === t) ?? null;
}
