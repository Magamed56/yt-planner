// Первый комментарий канала под вышедшим роликом: вопрос по теме (из призыва сценария) и 1–2
// источника из фактов плана — зрителю есть что обсудить и где проверить. Только чистые функции:
// запросы — lib/youtube.ts, кнопка — карточка ролика, проверки — scripts/analytics-test.ts.

export const COMMENT_MAX = 10_000; // предел YouTube для текста комментария
const SOURCE_MAX = 180; // одна ссылка на источник — не простыня
const FALLBACK_QUESTION = "А ты знал об этом раньше?";

const clean = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();

// Первая фраза с «?»: «А тебе нравится свой голос на записи? Напиши в комментариях…» → вопрос.
function firstQuestion(text: string): string | null {
  for (const part of clean(text).split(/(?<=[.!?…])\s+/)) if (/\?$/.test(part) && part.length > 3) return part;
  return null;
}

// Вопрос из призыва (сцена cta) сценария; в речи его нет — из надписи на экране.
export function ctaQuestion(script: unknown): string | null {
  const scenes = (script as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(scenes)) return null;
  for (const s of [...scenes].reverse() as { kind?: unknown; narration?: unknown; onScreen?: unknown }[]) {
    if (s?.kind !== "cta") continue;
    for (const text of [s.narration, s.onScreen]) {
      const q = typeof text === "string" ? firstQuestion(text) : null;
      if (q) return q;
    }
  }
  return null;
}

// Длинную запись режем по слову, а не посреди.
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const space = s.lastIndexOf(" ", max - 1);
  return `${s.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`;
}

// Не источник для зрителя: ссылка назад («… (см. выше)», «Pörschmann 2000», «Coe & Coe 1996» — только
// фамилии и год, без названия работы), продолжение предыдущей записи («In: …») и расчёт («Арифметика»).
const notASource = (s: string) =>
  s.length < 4 || /см\.?\s*выше|see above/i.test(s) || /^[\p{L}'’&\s-]{2,30}\s\d{4}$/u.test(s) || /^(in|в):\s/i.test(s) || /^(арифметика|расч[её]т|оценка)(?!\p{L})/iu.test(s);

// Источники фактов по одному на строку (в плане в одном поле их бывает несколько через «;»).
// Сначала первый источник каждого факта, потом остальные: так разнообразнее.
export function commentSources(facts: { source?: string }[], max = 2): string[] {
  const groups = facts.map((f) =>
    (typeof f?.source === "string" ? f.source : "")
      .split(/;\s+/)
      .map(clean)
      .filter((s) => !notASource(s)),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; out.length < max && groups.some((g) => g.length > round); round++) {
    for (const g of groups) {
      const s = g[round];
      if (!s || out.length >= max || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      out.push(cut(s, SOURCE_MAX));
    }
  }
  return out;
}

export function buildFirstComment(input: { question: string | null; title: string; facts: { source?: string }[] }): string {
  const title = clean(input.title);
  const question = input.question ? clean(input.question) : /\?$/.test(title) ? title : FALLBACK_QUESTION;
  const sources = commentSources(input.facts);
  const list = sources.length ? `${sources.length === 1 ? "Источник" : "Источники"}:\n${sources.map((s) => `• ${s}`).join("\n")}` : "";
  return [question, list].filter(Boolean).join("\n\n");
}

// Перед отправкой: тот же текст, что в поле, — без пустого и без лишнего.
export function commentProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Комментарий пустой — впишите текст.";
  if (t.length > COMMENT_MAX) return `Комментарий длиннее ${COMMENT_MAX.toLocaleString("ru-RU")} символов — сократите.`;
  return null;
}

// ---- проверка «уже есть»: верхние комментарии под роликом (commentThreads.list) ----

export interface OwnComment {
  id: string;
  text: string;
  url: string;
}

export const commentUrl = (videoId: string, commentId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;

type ApiThread = {
  id?: string;
  snippet?: { topLevelComment?: { id?: string; snippet?: { authorChannelId?: { value?: string }; textOriginal?: string; textDisplay?: string } } };
};

// Верхний комментарий самого канала на странице ответа (ответы в ветках не считаем — это не «первый»).
export function ownTopLevelComment(page: unknown, channelId: string, videoId: string): OwnComment | null {
  const items = (page as { items?: unknown } | null)?.items;
  if (!channelId || !Array.isArray(items)) return null;
  for (const t of items as ApiThread[]) {
    const top = t?.snippet?.topLevelComment;
    if (top?.snippet?.authorChannelId?.value !== channelId) continue;
    const id = top.id ?? t.id ?? "";
    return { id, text: top.snippet.textOriginal ?? top.snippet.textDisplay ?? "", url: id ? commentUrl(videoId, id) : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` };
  }
  return null;
}

export interface VideoBrief {
  videoId: string;
  channelId: string;
  privacyStatus: string;
}

// Можно ли отправлять: ролик наш, вышел, своего комментария ещё нет. null — можно.
export function commentBlocker(c: { channelId: string | null; video: VideoBrief | null; existing: OwnComment | null }): string | null {
  if (!c.channelId) return "У аккаунта ключа YouTube нет канала — получите ключ заново: npm run youtube-auth.";
  if (!c.video || c.video.channelId !== c.channelId) return "Ролик не найден на канале — обновите страницу.";
  if (c.video.privacyStatus !== "public") return "Ролик ещё не вышел — первый комментарий можно оставить после выхода.";
  if (c.existing) return "Комментарий канала под роликом уже есть — второй не отправляю.";
  return null;
}

// Тело commentThreads.insert: новый верхний комментарий под видео.
export function commentThreadBody(videoId: string, channelId: string, text: string): Record<string, unknown> {
  return { snippet: { channelId, videoId, topLevelComment: { snippet: { textOriginal: text.trim() } } } };
}
