// Темы, которые смотрят (npm run topic-ideas): Claude предлагает темы массового
// интереса — известные истории, загадки, катастрофы и спасения, животные, космос,
// деньги, — а YouTube Data API меряет спрос: сколько просмотров у роликов, которые
// по этой теме уже находит поиск. Список с цифрами человек смотрит и выбирает сам;
// выбранные темы дописываются в план (--add), факты к ним найдёт research.ts перед
// сценарием.

import { z } from "zod";
import type { LlmUsage } from "../contracts";
import type { Genre } from "../plan";
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
  demand?: IdeaDemand | null; // null — спрос не измерен (нет YT_* или кончилась квота)
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
  fresh: z.boolean().optional().describe("true — тема держится на свежей новости или годовщине"),
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

## Где искать интерес
${
    webSearch
      ? `Ищи в интернете (8–12 поисков), что людям интересно прямо сейчас и всегда:
- самые читаемые статьи Википедии (ru и en) за неделю и месяц;
- популярные посты и вопросы: Reddit (r/todayilearned, r/history, r/space, r/natureisfuckinglit, r/AskScience), Пикабу, Хабр, «Яндекс Кью»;
- новости науки и открытий последних недель, громкие годовщины ближайших месяцев;
- частые вопросы людей («почему…», «что будет, если…», «правда ли…»).`
      : "Опирайся на то, что известно о популярных вопросах и историях; ссылки дай только те, в которых уверен."
  }
- interest — одно предложение: где виден интерес к теме и насколько (цифра, если есть): «Reddit r/todayilearned — 40 тыс. голосов», «Википедия — в топе просмотров недели», «открытие на прошлой неделе, о нём пишут крупные СМИ».
- interestUrl — ссылка https://… на эту страницу${webSearch ? " из результатов поиска" : ""}.
- fresh: true — если тема держится на свежей новости или годовщине (ролик нужно выпустить скоро).
- Темы — проверяемые, без слухов и непроверенных «сенсаций».

## Формат ответа
Ответь ТОЛЬКО одним JSON-объектом, без markdown и пояснений: {"items": [{"title", "format", "genre", "pillar", "query", "hook", "why", "interest", "interestUrl", "fresh"}]}.`;
}

export function buildIdeasPrompt(input: { channel: PlanChannel; shorts: number; long: number; existing: string[] }): string {
  const ch = [input.channel.name ? `Канал: «${input.channel.name}».` : "", input.channel.niche ? `Ниша: ${input.channel.niche}` : "", input.channel.audience ? `Аудитория: ${input.channel.audience}` : ""]
    .filter(Boolean)
    .join("\n");
  return `${ch}

Нужно ${input.shorts} тем для Shorts (format "shorts") и ${input.long} тем для «Разборов» (format "long") — разные рубрики, без повторов между собой.
Эти темы на канале уже были — их и близкие к ним не предлагай: ${input.existing.map((t) => `«${t}»`).join("; ")}.
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

async function ytGet(url: string, token: string, fetchImpl: FetchLike, timeoutMs: number): Promise<Loose> {
  const { signal, cleanup } = linkedAbort(timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal });
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
export async function youtubeDemand(query: string, format: IdeaFormat, deps: { token: string; fetch: FetchLike; timeoutMs?: number }): Promise<IdeaDemand> {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const p = new URLSearchParams({ part: "id", type: "video", q: query, maxResults: "20", regionCode: "RU", relevanceLanguage: "ru", order: "relevance", safeSearch: "none" });
  if (format === "shorts") p.set("videoDuration", "short");
  const found = await ytGet(`${YT}/search?${p}`, deps.token, deps.fetch, timeoutMs);
  const ids = (Array.isArray(found.items) ? found.items : []).map((x) => (isObj(x) && isObj(x.id) ? String(x.id.videoId ?? "") : "")).filter(Boolean);
  if (!ids.length) return { query, videos: 0, median: 0, max: 0, hits1m: 0, sample: [] };
  const stats = await ytGet(`${YT}/videos?${new URLSearchParams({ part: "statistics,snippet,contentDetails", id: ids.join(","), maxResults: "50" })}`, deps.token, deps.fetch, timeoutMs);
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

// Сначала свежее (новость или годовщина — у неё ещё нет роликов с просмотрами, но интерес
// виден в интернете), дальше — что смотрят больше: медиана просмотров, затем миллионники.
export function rankIdeas(ideas: TopicIdea[]): TopicIdea[] {
  const score = (i: TopicIdea) => (i.demand ? i.demand.median : -1);
  return [...ideas].sort(
    (a, b) => Number(Boolean(b.fresh)) - Number(Boolean(a.fresh)) || score(b) - score(a) || (b.demand?.hits1m ?? 0) - (a.demand?.hits1m ?? 0) || (b.demand?.max ?? 0) - (a.demand?.max ?? 0),
  );
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
  youtubeToken?: string | null; // нет — без замера спроса
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
  // С запасом: часть отсеется как повтор, а слабые по спросу человек и сам не выберет.
  const ask = { shorts: Math.ceil(input.shorts * 1.3), long: Math.ceil(input.long * 1.3) };
  const res = await generateStructured({
    chain,
    system: buildIdeasSystemPrompt(input.pillars, searchOn),
    user: buildIdeasPrompt({ channel: input.channel, ...ask, existing: input.existing }),
    schemaName: "topic_ideas",
    zodSchema: IdeasSchema,
    jsonSchema: toCompatJsonSchema(IdeasSchema),
    validate: (raw) => checkIdeas(raw, { existing: input.existing, pillars: input.pillars.map((p) => p.id) }),
    what: `${ask.shorts + ask.long} тем, которые смотрят`,
    usage,
    log,
    signal: deps.signal,
    onCall: deps.onLlmCall,
    ...(searchOn ? { webSearch: { maxUses: 12 } } : {}),
  });
  const notes = [...res.value.notes];
  const ideas = res.value.ideas;
  // Ссылка «где интерес» — из выдачи поиска или по памяти модели: человеку стоит знать разницу.
  const seen = new Set(res.sources.map(urlKey));
  for (const idea of ideas) idea.interestSeen = Boolean(idea.interestUrl) && seen.has(urlKey(idea.interestUrl));
  let quotaUnits = 0;
  if (input.youtubeToken) {
    for (const idea of ideas) {
      try {
        idea.demand = await youtubeDemand(idea.query, idea.format, { token: input.youtubeToken, fetch: fetchImpl });
        quotaUnits += 101;
        log.info(`[темы] «${idea.query}»: медиана ${fmtViews(idea.demand.median)}, максимум ${fmtViews(idea.demand.max)} (${idea.demand.videos} роликов)`);
      } catch (e) {
        idea.demand = null;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof DemandError && e.stop) {
          notes.push(`замер спроса остановлен: ${msg}`);
          break;
        }
        notes.push(`«${idea.query}»: спрос не измерен — ${msg}`);
      }
    }
  } else {
    notes.push("YT_* не заданы — спрос на YouTube не измерен, темы без цифр");
  }
  const ranked = rankIdeas(ideas);
  const pick = [...ranked.filter((i) => i.format === "shorts").slice(0, input.shorts), ...ranked.filter((i) => i.format === "long").slice(0, input.long)];
  return { ideas: rankIdeas(pick), notes, usage: usage.list(), quotaUnits };
}
