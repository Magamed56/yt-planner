// Идеи новых названий для роликов со слабым стартом: content/title-ideas.json пишет
// npm run title-ideas (workflow «video-studio: названия»), показывает и применяет панель.
// Общий с панелью код: без node:* и npm-пакетов, файлы не читает.

export const TITLE_MAX = 100; // предел YouTube для snippet.title
export const IDEAS_MIN = 3;
export const IDEAS_MAX = 5;
export const TITLE_IDEAS_FILE = "content/title-ideas.json";

export interface TitleIdeasEntry {
  code: string; // «08a»
  at: string; // когда придуманы (ISO)
  current: string; // название на YouTube в тот момент — им же можно вернуть прежнее
  ideas: string[];
  model: string | null; // какая модель ответила
}

export interface TitleIdeasFile {
  about: string;
  items: TitleIdeasEntry[];
}

export const TITLE_IDEAS_ABOUT =
  "Идеи новых названий для роликов со слабым стартом. Пишет npm run title-ideas (workflow «video-studio: названия»), применяет панель — экран «Статистика».";

// Модели любят кавычки вокруг названия и двойные пробелы; «<» и «>» YouTube не принимает.
export function cleanTitle(raw: string): string {
  let s = String(raw ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const quoted = /^(["«“„'])(.*)(["»”'])$/u.exec(s);
  if (quoted && !/["«»“”„]/u.test(quoted[2]!)) s = quoted[2]!.trim();
  return s;
}

// Причина, по которой YouTube название не примет; null — годится.
export function titleProblem(title: string): string | null {
  if (!title.trim()) return "пустое название";
  if (/[<>]/.test(title)) return "в названии «<» или «>»";
  if ([...title].length > TITLE_MAX) return `длиннее ${TITLE_MAX} символов (${[...title].length})`;
  return null;
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

// Чистим и отбрасываем негодные, повторы и совпадающие с нынешним названием.
export function usableIdeas(list: unknown[], current: string): string[] {
  const out: string[] = [];
  for (const x of list) {
    if (typeof x !== "string") continue;
    const t = cleanTitle(x);
    if (titleProblem(t) || sameTitle(t, current) || out.some((o) => sameTitle(o, t))) continue;
    out.push(t);
  }
  return out;
}

const CODE = /^\d{2}[a-z]$/;

// Разбор файла: битые записи пропускаем — панель покажет остальное.
export function parseTitleIdeas(raw: unknown): TitleIdeasFile {
  const items: TitleIdeasEntry[] = [];
  const list = (raw as { items?: unknown } | null)?.items;
  if (Array.isArray(list)) {
    for (const x of list) {
      if (!x || typeof x !== "object") continue;
      const j = x as Record<string, unknown>;
      const code = typeof j.code === "string" ? j.code.trim().toLowerCase() : "";
      const at = typeof j.at === "string" && Number.isFinite(Date.parse(j.at)) ? j.at : "";
      const current = typeof j.current === "string" ? cleanTitle(j.current) : "";
      if (!CODE.test(code) || !at || items.some((i) => i.code === code)) continue;
      const ideas = usableIdeas(Array.isArray(j.ideas) ? j.ideas : [], current).slice(0, IDEAS_MAX);
      if (!ideas.length) continue;
      items.push({ code, at, current, ideas, model: typeof j.model === "string" && j.model ? j.model : null });
    }
  }
  return { about: TITLE_IDEAS_ABOUT, items };
}

// Новые идеи заменяют прежние того же ролика; порядок — по коду, как в плане.
export function mergeTitleIdeas(file: TitleIdeasFile, entries: TitleIdeasEntry[]): TitleIdeasFile {
  const fresh = new Set(entries.map((e) => e.code));
  const items = [...file.items.filter((i) => !fresh.has(i.code)), ...entries].sort((a, b) => a.code.localeCompare(b.code));
  return { about: TITLE_IDEAS_ABOUT, items };
}
