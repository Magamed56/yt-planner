// Темы, которые смотрят (npm run topic-ideas): Claude предлагает темы массового
// интереса — известные истории, загадки, катастрофы и спасения, животные, космос,
// деньги. Интерес меряем по открытым данным: сколько людей в месяц читают статью
// Википедии о теме (ru и en, Wikimedia API — без ключей), а что читают больше всего
// прямо сейчас, Claude видит в списке самых читаемых статей прошлого месяца. С ключами
// YouTube — ещё и просмотры роликов, которые поиск YouTube находит по теме. Список с
// цифрами человек смотрит и выбирает сам; выбранные темы дописываются в план (--add),
// факты к ним найдёт research.ts перед сценарием.

import { z } from "zod";
import type { LlmUsage } from "../contracts";
import type { Genre } from "../plan";
import { userAgent } from "../visuals/providers/open-licenses";
import { parseIsoDuration } from "../youtube-fill";
import type { ScriptDeps } from "./generate";
import { resolveChain } from "./llm/chain";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, linkedAbort, type FetchLike, type Logger } from "./llm/types";
import { extractUrl, similarTitle, urlKey, type PlanChannel } from "./plan-gen";
import { toCompatJsonSchema } from "./schema";
import { coerceMeta, formatZodIssues, unwrap } from "./validate";

export type IdeaFormat = "shorts" | "long";

export interface IdeaDemand {
  query: string;
  videos: number; // сколько роликов вернул поиск (после отбора по длительности)
  median: number; // медиана просмотров — главный показатель спроса
  max: number;
  hits1m: number; // роликов от миллиона просмотров
  sample: { id: string; title: string; views: number }[]; // три самых просматриваемых
}

export interface TopicIdea {
  title: string;
  format: IdeaFormat;
  genre: Genre;
  pillar: string;
  query: string; // как тему ищут на YouTube по-русски — по нему мерили спрос
  hook: string;
  why: string;
  interest: string; // где в интернете виден интерес к теме и насколько
  interestUrl: string; // страница из выдачи поиска, где этот интерес виден
  interestSeen?: boolean; // ссылка была в выдаче веб-поиска (а не по памяти модели)
  fresh?: boolean; // держится на свежей новости или годовщине — выпускать скоро
  wiki?: string; // статья русской Википедии о теме — по ней меряем интерес
  wikiEn?: string; // то же в английской
  readers?: WikiReaders | null; // читателей статьи в месяц; null — не измерено
  demand?: IdeaDemand | null; // null — спрос не измерен (нет ключей YouTube или кончилась квота)
}

export interface WikiReaders {
  ru: number | null; // в среднем за 12 месяцев; null — статьи нет
  en: number | null;
}

const IdeaSchema = z.object({
  title: z.string().trim().min(1).max(100).describe("название ролика по-русски, до 60 символов"),
  format: z.enum(["shorts", "long"]).describe("shorts — 40–60 с; long — «Разбор» на 7 минут"),
  genre: z.enum(["story", "explainer"]).describe("story — история с героями и развязкой; explainer — ответ на вопрос «почему / как устроено»"),
  pillar: z.string().trim().min(1).max(40).describe("id рубрики канала"),
  query: z.string().trim().min(2).max(80).describe("как это ищут на YouTube по-русски, 2–5 слов"),
  hook: z.string().trim().min(1).max(200).describe("первая фраза-загадка, до 12 слов, без развязки"),
  why: z.string().trim().min(1).max(300).describe("почему это посмотрят, одно предложение"),
  interest: z.string().trim().min(1).max(300).describe("где в интернете виден интерес и насколько: «Reddit r/todayilearned — 40 тыс. голосов»"),
  interestUrl: z.string().trim().min(1).max(500).describe("ссылка https://… на эту страницу из результатов поиска"),
  fresh: z.boolean().optional().describe("true — тема держится на громкой свежей новости или годовщине"),
  wiki: z.string().trim().min(1).max(200).optional().describe("точное название статьи русской Википедии о теме"),
  wikiEn: z.string().trim().min(1).max(200).optional().describe("точное название статьи английской Википедии о теме"),
});

export const IdeasSchema = z.object({ items: z.array(IdeaSchema).min(1).max(60) });

export function buildIdeasSystemPrompt(pillars: { id: string; title: string }[], webSearch: boolean): string {
  return `Ты — продюсер русскоязычного научно-популярного YouTube-канала (Shorts и длинные «Разборы» на 7 минут). Подбираешь темы, которые смотрят массово, а не «умные» темы для узкого круга.

## Что люди смотрят
- Знакомое многим и с эмоцией: катастрофы и чудесные спасения, загадки и тайны (с честной разгадкой), невероятные истории реальных людей, животные с удивительными способностями, космос и глубины океана, тело человека на пределе, деньги и громкие аферы, рекорды, «что будет, если…», мифы, в которые верят все.
- Известные имена, места и события (Титаник, Чернобыль, пирамиды, Марианская впадина, Тесла, акулы) — по ним уже есть спрос в поиске. Угол — свежий: деталь или поворот, которого зритель не знает.
- Название понятно и школьнику, и взрослому; в теме есть вопрос, на который хочется узнать ответ, или история, которую хочется досмотреть.
- Не бери: термины и эффекты без известного имени или истории («эффект Баадера — Майнхоф»), политику и войны последних ста лет, религию, советы по лечению, эзотерику, жестокость.

## Формат
- shorts — одна история или один удивительный ответ за 40–60 секунд: одно событие, один герой или одно явление.
- long — большая история на 7 минут с героями, поворотами и развязкой: катастрофа и спасение, расследование, экспедиция, великая афера, загадка с разгадкой.
- genre: "story" — история с героями и развязкой; "explainer" — ответ на вопрос «почему / как устроено».
- pillar — id рубрики канала: ${pillars.map((p) => `${p.id} (${p.title})`).join(", ")}.

## Поля
- title — название ролика по-русски, до 60 символов, с ключевым словом, которое ищут, и интригой; без КАПСА, эмодзи и обмана.
- query — как это ищут на YouTube по-русски, 2–5 слов, без кавычек: «эму война австралия», «аполлон 13 авария». По нему измерят просмотры похожих роликов.
- hook — первая фраза ролика: загадка или парадокс до 12 слов, без развязки.
- why — почему это посмотрят: одно предложение (известность, эмоция, неожиданный поворот).

## Состав списка
- Не меньше двух третей — вечные темы массового интереса: известные события, люди, места, животные, загадки, катастрофы, тело, космос, деньги. Их смотрят годами.
- Свежие новости — не больше пятой части и только громкие: то, что обсуждают все, а не новость научного журнала (новый вид моллюска, уточнение тёмной энергии — мимо).

## Где виден интерес
- В запросе — самые читаемые статьи Википедии за прошлый месяц: это то, что люди ищут прямо сейчас. Подходящее каналу из этого списка бери в первую очередь (с новым углом).${
    webSearch
      ? `
- Поищи в интернете (5–10 поисков), что людям интересно: популярные посты и вопросы (Reddit r/todayilearned, r/history, r/space, r/natureisfuckinglit, r/AskScience; Пикабу; «Яндекс Кью»), подборки «самые популярные загадки / истории / катастрофы», громкие годовщины ближайших месяцев.`
      : ""
  }
- wiki — точное название статьи русской Википедии, о которой ролик («Эму-война», «Титаник»), wikiEn — то же в английской («Emu War», "Titanic"). По ним измерят, сколько людей в месяц читают о теме; нет статьи — не указывай.
- interest — одно предложение: где виден интерес и насколько (цифра, если есть): «в топе Википедии за сентябрь — 1,2 млн просмотров», «Reddit r/todayilearned — 40 тыс. голосов».
- interestUrl — ссылка https://… на эту страницу${webSearch ? " (из результатов поиска или статья Википедии)" : ""}.
- fresh: true — только если тема держится на громкой свежей новости или годовщине (ролик нужно выпустить скоро).
- Темы — проверяемые, без слухов и непроверенных «сенсаций».

## Формат ответа
Ответь ТОЛЬКО одним JSON-объектом, без markdown и пояснений: {"items": [{"title", "format", "genre", "pillar", "query", "hook", "why", "interest", "interestUrl", "fresh", "wiki", "wikiEn"}]}.`;
}

export function buildIdeasPrompt(input: { channel: PlanChannel; shorts: number; long: number; existing: string[]; top?: { ru: WikiTop[]; en: WikiTop[]; month: string } }): string {
  const ch = [input.channel.name ? `Канал: «${input.channel.name}».` : "", input.channel.niche ? `Ниша: ${input.channel.niche}` : "", input.channel.audience ? `Аудитория: ${input.channel.audience}` : ""]
    .filter(Boolean)
    .join("\n");
  const list = (items: WikiTop[]) => items.map((t) => `${t.title} — ${fmtViews(t.views)}`).join("; ");
  const top = input.top && (input.top.ru.length || input.top.en.length)
    ? `\n\nСамые читаемые статьи Википедии за ${input.top.month} (что люди ищут сейчас; большая часть — не для канала, бери только подходящее):${input.top.ru.length ? `\nРусская: ${list(input.top.ru)}` : ""}${input.top.en.length ? `\nАнглийская: ${list(input.top.en)}` : ""}`
    : "";
  return `${ch}

Нужно ${input.shorts} тем для Shorts (format "shorts") и ${input.long} тем для «Разборов» (format "long") — разные рубрики, без повторов между собой.
Эти темы на канале уже были — их и близкие к ним не предлагай: ${input.existing.map((t) => `«${t}»`).join("; ")}.${top}
Ответ — {"items": [...]}.`;
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

// Повторы уже снятого и друг друга выбрасываем сами; ремонт — только если годных нет.
export function checkIdeas(raw: unknown, ctx: { existing: string[]; pillars: string[] }): Verdict<{ ideas: TopicIdea[]; notes: string[] }> {
  const top = Array.isArray(raw) ? { items: raw } : unwrap(raw, "items");
  if (!isObj(top) || !Array.isArray(top.items)) return { ok: false, problems: ['ожидался JSON-объект {"items": [...]}'], warnings: [] };
  const notes: string[] = [];
  const ideas: TopicIdea[] = [];
  const seen = [...ctx.existing];
  for (const it of top.items) {
    if (!isObj(it)) continue;
    const o = coerceMeta(it);
    for (const f of ["title", "query", "hook", "why", "pillar", "format", "genre"]) if (typeof o[f] === "string") o[f] = (o[f] as string).replace(/\s+/g, " ").trim();
    if (typeof o.format === "string") o.format = /long|разбор|длин/i.test(o.format) ? "long" : "shorts";
    if (typeof o.genre === "string") o.genre = /story|истор/i.test(o.genre) ? "story" : "explainer";
    if (typeof o.query === "string") o.query = o.query.replace(/["«»]/g, "").toLowerCase();
    if (typeof o.interestUrl === "string") o.interestUrl = extractUrl(o.interestUrl) ?? "";
    if (typeof o.fresh === "string") o.fresh = /^(true|да|yes|1)$/i.test(o.fresh);
    for (const f of ["wiki", "wikiEn"]) {
      // «https://ru.wikipedia.org/wiki/Эму-война» и «Эму-война» — одно и то же.
      if (typeof o[f] === "string") o[f] = decodeURIComponent((o[f] as string).replace(/^https?:\/\/[a-z-]+\.(?:m\.)?wikipedia\.org\/wiki\//i, "")).replace(/_/g, " ").trim() || undefined;
      if (o[f] === undefined || o[f] === null || o[f] === "") delete o[f];
    }
    const parsed = IdeaSchema.safeParse(o);
    if (!parsed.success) {
      notes.push(`тема «${String(o.title ?? "?").slice(0, 60)}» пропущена: ${formatZodIssues(parsed.error, o, "items").slice(0, 2).join("; ")}`);
      continue;
    }
    const idea = parsed.data;
    const dup = seen.find((t) => similarTitle(t, idea.title));
    if (dup) {
      notes.push(`«${idea.title}» похожа на «${dup}» — пропущена`);
      continue;
    }
    if (ctx.pillars.length && !ctx.pillars.includes(idea.pillar)) idea.pillar = ctx.pillars[0]!;
    seen.push(idea.title);
    ideas.push(idea);
  }
  if (!ideas.length) return { ok: false, problems: notes.length ? notes.slice(0, 10) : ["ни одной годной темы"], warnings: [] };
  return { ok: true, value: { ideas, notes }, warnings: [] };
}

// ---- Спрос на YouTube ----

const YT = "https://www.googleapis.com/youtube/v3";
const SHORT_MAX_SEC = 180;

export class DemandError extends Error {
  readonly stop: boolean; // квота кончилась или нет прав — дальше не меряем
  constructor(message: string, stop: boolean) {
    super(message);
    this.name = "DemandError";
    this.stop = stop;
  }
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

// Доступ к Data API: OAuth-токен канала (YT_*) или простой ключ API (YOUTUBE_API_KEY).
export type YoutubeAccess = { token: string } | { key: string };

async function ytGet(url: string, access: YoutubeAccess, fetchImpl: FetchLike, timeoutMs: number): Promise<Loose> {
  const { signal, cleanup } = linkedAbort(timeoutMs);
  try {
    const res = await fetchImpl("key" in access ? `${url}&key=${encodeURIComponent(access.key)}` : url, { headers: "token" in access ? { authorization: `Bearer ${access.token}` } : {}, signal });
    const body = await res.text();
    if (!res.ok) {
      const stop = res.status === 401 || /quotaExceeded|dailyLimitExceeded|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body);
      throw new DemandError(`YouTube ${res.status}: ${body.replace(/\s+/g, " ").slice(0, 200)}`, stop || res.status === 403);
    }
    return JSON.parse(body) as Loose;
  } finally {
    cleanup();
  }
}

// Просмотры роликов, которые YouTube находит по запросу темы (регион RU, русский язык).
// Shorts сравниваем с короткими роликами, «Разборы» — с роликами длиннее 3 минут.
// ≈ 101 единица квоты на тему (search.list — 100, videos.list — 1).
export async function youtubeDemand(query: string, format: IdeaFormat, deps: { access: YoutubeAccess; fetch: FetchLike; timeoutMs?: number }): Promise<IdeaDemand> {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const p = new URLSearchParams({ part: "id", type: "video", q: query, maxResults: "20", regionCode: "RU", relevanceLanguage: "ru", order: "relevance", safeSearch: "none" });
  if (format === "shorts") p.set("videoDuration", "short");
  const found = await ytGet(`${YT}/search?${p}`, deps.access, deps.fetch, timeoutMs);
  const ids = (Array.isArray(found.items) ? found.items : []).map((x) => (isObj(x) && isObj(x.id) ? String(x.id.videoId ?? "") : "")).filter(Boolean);
  if (!ids.length) return { query, videos: 0, median: 0, max: 0, hits1m: 0, sample: [] };
  const stats = await ytGet(`${YT}/videos?${new URLSearchParams({ part: "statistics,snippet,contentDetails", id: ids.join(","), maxResults: "50" })}`, deps.access, deps.fetch, timeoutMs);
  const list = (Array.isArray(stats.items) ? stats.items : []).filter(isObj).map((v) => {
    const st = isObj(v.statistics) ? v.statistics : {};
    const sn = isObj(v.snippet) ? v.snippet : {};
    const cd = isObj(v.contentDetails) ? v.contentDetails : {};
    return { id: String(v.id ?? ""), title: String(sn.title ?? ""), views: Number(st.viewCount ?? 0) || 0, sec: parseIsoDuration(typeof cd.duration === "string" ? cd.duration : null) };
  });
  const fit = list.filter((v) => (format === "shorts" ? v.sec === null || v.sec <= SHORT_MAX_SEC : v.sec === null || v.sec > SHORT_MAX_SEC));
  const views = fit.map((v) => v.views);
  return {
    query,
    videos: fit.length,
    median: median(views),
    max: views.length ? Math.max(...views) : 0,
    hits1m: views.filter((v) => v >= 1_000_000).length,
    sample: [...fit].sort((a, b) => b.views - a.views).slice(0, 3).map(({ id, title, views: n }) => ({ id, title, views: n })),
  };
}

// ---- Интерес в Википедии (Wikimedia REST API, без ключей) ----

const WIKIMEDIA = "https://wikimedia.org/api/rest_v1/metrics/pageviews";

export interface WikiTop {
  title: string;
  views: number;
}

// 429 у Wikimedia — частый ответ на серию запросов подряд: ждём (Retry-After или 2, 4, 8 с)
// и повторяем, а не бросаем замер остальных тем.
async function wikiJson(url: string, deps: { fetch: FetchLike; env?: Record<string, string | undefined>; timeoutMs?: number; waitMs?: (ms: number) => Promise<void> }): Promise<Loose | null> {
  const wait = deps.waitMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    const { signal, cleanup } = linkedAbort(deps.timeoutMs ?? 15_000);
    try {
      const res = await deps.fetch(url, { headers: { "user-agent": userAgent(deps.env ?? process.env), accept: "application/json" }, signal });
      if (res.status === 404) return null;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const after = Number(res.headers.get("retry-after"));
        await wait(Number.isFinite(after) && after > 0 ? Math.min(30, after) * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`Wikimedia ${res.status}`);
      return (await res.json()) as Loose;
    } finally {
      cleanup();
    }
  }
}

const ym = (d: Date) => ({ y: d.getUTCFullYear(), m: String(d.getUTCMonth() + 1).padStart(2, "0") });
// Последний полный месяц: данные за текущий ещё неполные.
export const lastFullMonth = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

// Служебные страницы и порталы — не темы.
const NOT_TOPIC = /^(Заглавная страница|Main Page|Special:|Служебная:|Википедия:|Wikipedia:|Портал:|Portal:|Файл:|File:|Шаблон:|Template:|Категория:|Category:|-$)/;

// Самые читаемые статьи месяца (топ Википедии): что люди ищут прямо сейчас.
export async function wikiTop(lang: "ru" | "en", month: Date, limit: number, deps: { fetch: FetchLike; env?: Record<string, string | undefined>; waitMs?: (ms: number) => Promise<void> }): Promise<WikiTop[]> {
  const { y, m } = ym(month);
  const data = await wikiJson(`${WIKIMEDIA}/top/${lang}.wikipedia/all-access/${y}/${m}/all-days`, deps);
  const first = data && Array.isArray(data.items) && isObj(data.items[0]) ? data.items[0] : null;
  const articles = first && Array.isArray(first.articles) ? first.articles.filter(isObj) : [];
  return articles
    .map((a) => ({ title: String(a.article ?? "").replace(/_/g, " "), views: Number(a.views ?? 0) || 0 }))
    .filter((a) => a.title && !NOT_TOPIC.test(a.title))
    .slice(0, limit);
}

// Читателей статьи в месяц — в среднем за 12 полных месяцев; редирект («Эму война» →
// «Эму-война») разворачиваем: у самого редиректа просмотров почти нет. null — статьи нет.
export async function wikiMonthlyReaders(lang: "ru" | "en", title: string, now: Date, deps: { fetch: FetchLike; env?: Record<string, string | undefined>; waitMs?: (ms: number) => Promise<void> }): Promise<number | null> {
  const q = new URLSearchParams({ action: "query", format: "json", redirects: "1", titles: title });
  const page = await wikiJson(`https://${lang}.wikipedia.org/w/api.php?${q}`, deps);
  const pages = page && isObj(page.query) && isObj(page.query.pages) ? Object.values(page.query.pages).filter(isObj) : [];
  const found = pages.find((p) => p.missing === undefined && typeof p.title === "string");
  if (!found) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // последний день прошлого месяца
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const day = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}00`;
  const article = encodeURIComponent(String(found.title).replace(/ /g, "_"));
  const views = await wikiJson(`${WIKIMEDIA}/per-article/${lang}.wikipedia/all-access/user/${article}/monthly/${day(start)}/${day(end)}`, deps);
  const items = views && Array.isArray(views.items) ? views.items.filter(isObj) : [];
  if (!items.length) return 0;
  return Math.round(items.reduce((a, it) => a + (Number(it.views ?? 0) || 0), 0) / items.length);
}

// Интерес к теме одним числом: русская Википедия — наш зритель, английская — мировой
// интерес (впятеро «дешевле»: у неё и аудитория в разы больше).
export const readersScore = (r: WikiReaders | null | undefined): number => (r ? (r.ru ?? 0) + Math.round((r.en ?? 0) / 5) : -1);

// Порядок: сначала то, о чём больше читают, затем — что больше смотрят на YouTube.
export function rankIdeas(ideas: TopicIdea[]): TopicIdea[] {
  const yt = (i: TopicIdea) => (i.demand ? i.demand.median : -1);
  return [...ideas].sort((a, b) => readersScore(b.readers) - readersScore(a.readers) || yt(b) - yt(a) || (b.demand?.hits1m ?? 0) - (a.demand?.hits1m ?? 0));
}

// «1,2 млн», «450 тыс.», «980».
export function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(".", ",")} млн`;
  if (n >= 1000) return `${Math.round(n / 1000)} тыс.`;
  return String(n);
}

// ---- Точка входа ----

export interface IdeasInput {
  channel: PlanChannel;
  pillars: { id: string; title: string }[];
  shorts: number;
  long: number;
  existing: string[]; // названия тем плана и роликов канала — не повторять
  youtube?: YoutubeAccess | null; // нет — без замера просмотров YouTube
  now?: Date;
}

export interface IdeasResult {
  ideas: TopicIdea[];
  notes: string[];
  usage: LlmUsage[];
  quotaUnits: number;
}

export async function generateTopicIdeas(input: IdeasInput, deps: ScriptDeps = {}): Promise<IdeasResult> {
  const env = deps.env ?? process.env;
  const log: Logger = deps.log ?? consoleLogger;
  const fetchImpl: FetchLike = deps.fetch ?? ((i, init) => fetch(i, init));
  const chain = resolveChain({ env, fetch: fetchImpl, anthropic: deps.anthropic, log });
  if (!chain.length) throw new Error("Нет ни одной доступной LLM: задайте ANTHROPIC_API_KEY (с веб-поиском) или GEMINI_API_KEY.");
  const searchOn = chain[0]!.provider === "claude" && !/^(0|off|false|no)$/i.test((env.PLAN_WEB_SEARCH ?? "").trim());
  const usage = new UsageBook();
  const now = input.now ?? new Date();
  const notes: string[] = [];
  const wikiDeps = { fetch: fetchImpl, env };
  // Что читают прямо сейчас — подсказка Claude (без сети или при сбое — без неё).
  const month = lastFullMonth(now);
  const top = { ru: [] as WikiTop[], en: [] as WikiTop[], month: `${ym(month).m}.${ym(month).y}` };
  try {
    [top.ru, top.en] = await Promise.all([wikiTop("ru", month, 300, wikiDeps), wikiTop("en", month, 150, wikiDeps)]);
  } catch (e) {
    notes.push(`топ Википедии не получен (${e instanceof Error ? e.message : String(e)}) — темы без него`);
  }
  // С запасом: часть отсеется как повтор, а слабые по интересу человек и сам не выберет.
  const ask = { shorts: Math.ceil(input.shorts * 1.4), long: Math.ceil(input.long * 1.5) };
  const res = await generateStructured({
    chain,
    system: buildIdeasSystemPrompt(input.pillars, searchOn),
    user: buildIdeasPrompt({ channel: input.channel, ...ask, existing: input.existing, top }),
    schemaName: "topic_ideas",
    zodSchema: IdeasSchema,
    jsonSchema: toCompatJsonSchema(IdeasSchema),
    validate: (raw) => checkIdeas(raw, { existing: input.existing, pillars: input.pillars.map((p) => p.id) }),
    what: `${ask.shorts + ask.long} тем, которые смотрят`,
    usage,
    log,
    signal: deps.signal,
    onCall: deps.onLlmCall,
    ...(searchOn ? { webSearch: { maxUses: 10 } } : {}),
  });
  notes.push(...res.value.notes);
  const ideas = res.value.ideas;
  // Ссылка «где интерес» — из выдачи поиска или по памяти модели: человеку стоит знать разницу.
  const seen = new Set(res.sources.map(urlKey));
  for (const idea of ideas) idea.interestSeen = Boolean(idea.interestUrl) && (seen.has(urlKey(idea.interestUrl)) || /wikipedia\.org\/wiki\//.test(idea.interestUrl));
  // Читатели Википедии — у каждой темы, запросы по одному (открытый API без квот, но с
  // ограничением частоты); сбой одной темы не мешает остальным.
  let wikiFails = 0;
  for (const idea of ideas) {
    if (wikiFails >= 3 || (!idea.wiki && !idea.wikiEn)) continue;
    try {
      const ru = idea.wiki ? await wikiMonthlyReaders("ru", idea.wiki, now, wikiDeps) : null;
      const en = idea.wikiEn ? await wikiMonthlyReaders("en", idea.wikiEn, now, wikiDeps) : null;
      idea.readers = { ru, en };
      wikiFails = 0;
    } catch (e) {
      wikiFails++;
      notes.push(`«${idea.title}»: читатели Википедии не измерены (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  let quotaUnits = 0;
  if (input.youtube) {
    for (const idea of ideas) {
      try {
        idea.demand = await youtubeDemand(idea.query, idea.format, { access: input.youtube, fetch: fetchImpl });
        quotaUnits += 101;
        log.info(`[темы] «${idea.query}»: медиана ${fmtViews(idea.demand.median)}, максимум ${fmtViews(idea.demand.max)} (${idea.demand.videos} роликов)`);
      } catch (e) {
        idea.demand = null;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof DemandError && e.stop) {
          notes.push(`замер просмотров YouTube остановлен: ${msg}`);
          break;
        }
        notes.push(`«${idea.query}»: просмотры YouTube не измерены — ${msg}`);
      }
    }
  }
  const ranked = rankIdeas(ideas);
  const pick = [...ranked.filter((i) => i.format === "shorts").slice(0, input.shorts), ...ranked.filter((i) => i.format === "long").slice(0, input.long)];
  return { ideas: rankIdeas(pick), notes, usage: usage.list(), quotaUnits };
}
