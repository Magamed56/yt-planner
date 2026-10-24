// Материал к теме до сценария: Claude с веб-поиском находит конкретные факты и живые
// эпизоды (кто, что сделал и сказал, чем кончилось) — у каждого ссылка на источник, —
// линию рассказа и жанр (история — около минуты, объяснение — 40–45 с). Без этого у
// сценариста было 2–3 факта из плана, и ролик выходил перечнем фактов, обрывавшимся на
// вопросе зрителю. Тема плана получает материал один раз (поле researched в plan.json).

import { z } from "zod";
import type { LlmUsage } from "../contracts";
import { planNotes, type Genre, type PlanFact } from "../plan";
import type { ScriptDeps } from "./generate";
import { resolveChain } from "./llm/chain";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, envNumber, type FetchLike, type Logger } from "./llm/types";
import { checkUrl, extractUrl, similarTitle, urlKey } from "./plan-gen";
import { toCompatJsonSchema } from "./schema";
import { formatZodIssues, unwrap } from "./validate";

// Сколько пунктов материала нужно всего (вместе с фактами плана).
export const RESEARCH_FACTS = { shorts: { min: 6, max: 9 }, long: { min: 10, max: 14 } } as const;

const FactSchema = z.object({
  claim: z.string().trim().min(1).max(600).describe("факт или эпизод по-русски, 1–2 предложения, с конкретикой"),
  source: z.string().trim().min(1).max(500).describe("прямая ссылка https://… из результатов поиска"),
});

export const ResearchSchema = z.object({
  genre: z.enum(["story", "explainer"]).describe("story — история с героями и развязкой; explainer — объяснение явления"),
  story: z.string().trim().min(1).max(1200).describe("линия рассказа: загадка → завязка → развитие → поворот → развязка, 2–4 предложения"),
  facts: z.array(FactSchema).min(1).max(16),
});

export interface ResearchInput {
  topic: string;
  hook?: string;
  angle?: string;
  facts?: PlanFact[]; // уже проверенные (план) — их не ищем заново и не повторяем
  long?: boolean; // «Разбор» на 7 минут: материала нужно больше
}

export interface ResearchResult {
  genre: Genre;
  story: string;
  facts: PlanFact[]; // факты плана + найденные, без повторов
  added: number;
  notes: string[];
  usage: LlmUsage[];
}

export const researchEnabled = (env: Record<string, string | undefined>): boolean => !/^(0|off|false|no)$/i.test((env.SCRIPT_RESEARCH ?? "").trim());

export function buildResearchSystemPrompt(long: boolean): string {
  return `Ты — исследователь русскоязычного научно-популярного YouTube-канала. До того как сценарист напишет ${long ? "«Разбор» на 7 минут" : "короткий ролик"}, ты собираешь материал по теме: проверенные факты и живые эпизоды с источниками.

## Что найти
- Материал, из которого складывается рассказ от начала до конца: предыстория и завязка, герои (имя, кто такой, чего хотел), ключевые эпизоды по порядку, поворот, развязка и что было потом.
- Лучшее — конкретика, которую можно увидеть и пересказать: кто, где, когда, что сделал и сказал; точные числа; реальные реплики и цитаты (слово в слово по источнику, с автором); странные и смешные детали.
- Интересные истории вокруг темы тоже годятся: курьёзы, судьбы людей и животных, споры учёных. Известную легенду или байку можно дать как легенду — прямо так и напиши («по легенде…») и добавь, что известно на самом деле.
- Каждый пункт — 1–2 предложения по-русски, без оценок и воды; пункты не повторяют друг друга и уже известные факты.

## Источники
- source у каждого пункта — ОДНА прямая ссылка https://… из результатов веб-поиска на страницу, где это написано: Википедия (ru или en), научная статья, сайт музея, архива, научной организации или крупного СМИ. Пункт без источника не пиши вовсе.
- Не выдумывай и не округляй: число, дата, имя и цитата — ровно как в источнике.
- Без эзотерики, лженауки и советов по лечению.

## Жанр и линия рассказа
- genre: "story" — у темы есть история с героями, событиями и развязкой; "explainer" — это объяснение явления или механизма.
- story — линия рассказа в 2–4 предложениях: загадка для начала (без ответа) → завязка → развитие → поворот → развязка. Только по найденному материалу.

## Формат ответа
Ответь ТОЛЬКО одним JSON-объектом, без markdown и пояснений: {"genre", "story", "facts": [{"claim", "source"}]}.`;
}

export function buildResearchPrompt(input: ResearchInput, need: number): string {
  const known = (input.facts ?? []).map((f, i) => `${i + 1}. ${f.claim}`);
  return [
    `Тема ролика: «${input.topic.trim()}»`,
    input.hook?.trim() ? `Идея хука: «${input.hook.trim()}»` : "",
    input.angle?.trim() ? `Угол подачи: ${input.angle.trim()}` : "",
    known.length ? `Уже известные факты (проверены — НЕ повторяй их и их перефразы):\n${known.join("\n")}` : "",
    `Найди ${need} новых пунктов материала. Ответ — {"genre", "story", "facts": [...]}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

// Пункт без ссылки или повтор известного выбрасываем сами; ремонт — только если годного
// материала меньше minNew (тогда сценарий почти не получил бы нового).
export function checkResearch(raw: unknown, ctx: { known: PlanFact[]; minNew: number }): Verdict<{ genre: Genre; story: string; facts: PlanFact[]; notes: string[] }> {
  const top = unwrap(raw, "facts");
  if (!isObj(top)) return { ok: false, problems: ['ожидался JSON-объект {"genre", "story", "facts": [...]}'], warnings: [] };
  const o: Loose = { ...top };
  if (typeof o.genre === "string") o.genre = /story|истор/i.test(o.genre) ? "story" : "explainer";
  if (typeof o.story === "string") o.story = o.story.replace(/\s+/g, " ").trim();
  if (Array.isArray(o.facts)) o.facts = o.facts.filter(isObj).map((f) => ({ claim: String(f.claim ?? "").replace(/\s+/g, " ").trim(), source: String(f.source ?? f.url ?? "").trim() }));
  const parsed = ResearchSchema.safeParse(o);
  if (!parsed.success) return { ok: false, problems: formatZodIssues(parsed.error, o, "facts"), warnings: [] };
  const notes: string[] = [];
  const facts: PlanFact[] = [];
  const claims = ctx.known.map((f) => f.claim);
  for (const f of parsed.data.facts) {
    const url = extractUrl(f.source);
    if (!url) {
      notes.push(`пункт без ссылки на источник выброшен («${f.claim.slice(0, 60)}…»)`);
      continue;
    }
    const dup = claims.find((c) => similarTitle(c, f.claim));
    if (dup) {
      notes.push(`пункт повторяет известный факт — выброшен («${f.claim.slice(0, 60)}…»)`);
      continue;
    }
    claims.push(f.claim);
    facts.push({ claim: f.claim, source: url });
  }
  if (facts.length < ctx.minNew) {
    return { ok: false, problems: [`новых пунктов с источниками ${facts.length}, нужно минимум ${ctx.minNew}: у каждого — ссылка https://… из результатов поиска, без повторов известного`, ...notes.slice(0, 5)], warnings: [] };
  }
  return { ok: true, value: { genre: parsed.data.genre, story: parsed.data.story, facts, notes }, warnings: [] };
}

// Материал для сценария по теме вне плана (--topic): те же правила, что у планNotes.
export function researchNotes(r: Pick<ResearchResult, "facts" | "story">, opts: { strict?: boolean } = {}): string {
  return planNotes({ hook: "", angle: "", keyFacts: r.facts, story: r.story }, opts);
}

// null — искать нечем (нет Claude: веб-поиск серверный, только у него) или поиск не удался:
// сценарий тогда пишется по фактам плана, как раньше.
export async function researchTopic(input: ResearchInput, deps: ScriptDeps = {}): Promise<ResearchResult | null> {
  const env = deps.env ?? process.env;
  const log: Logger = deps.log ?? consoleLogger;
  const fetchImpl: FetchLike = deps.fetch ?? ((i, init) => fetch(i, init));
  const chain = resolveChain({ env, fetch: fetchImpl, anthropic: deps.anthropic, log }).filter((t) => t.provider === "claude");
  if (!chain.length) {
    log.info("[материал] поиск в интернете — только с Claude (ANTHROPIC_API_KEY): пишу по фактам плана");
    return null;
  }
  const limits = input.long ? RESEARCH_FACTS.long : RESEARCH_FACTS.shorts;
  const known = input.facts ?? [];
  const need = Math.max(3, limits.max - known.length);
  // Ремонт — только если нового почти нет: недобор до цели не повод платить за второй заход.
  const minNew = 2;
  const usage = new UsageBook();
  try {
    const res = await generateStructured({
      chain,
      system: buildResearchSystemPrompt(Boolean(input.long)),
      user: buildResearchPrompt(input, need),
      schemaName: "topic_research",
      zodSchema: ResearchSchema,
      jsonSchema: toCompatJsonSchema(ResearchSchema),
      validate: (raw) => checkResearch(raw, { known, minNew }),
      what: `материал к теме «${input.topic}»`,
      usage,
      log,
      signal: deps.signal,
      onCall: deps.onLlmCall,
      webSearch: { maxUses: input.long ? 10 : 6 },
    });
    const notes = [...res.value.notes];
    // Ссылки не из выдачи поиска проверяем по сети: 404 или нет такого сайта — пункт выбрасываем.
    const seen = new Set(res.sources.map(urlKey));
    const timeoutMs = envNumber(env, "PLAN_URL_TIMEOUT_MS", 8000);
    const checkOn = !/^(0|off|false|no)$/i.test((env.PLAN_CHECK_URLS ?? "").trim());
    const fresh: PlanFact[] = [];
    for (const f of res.value.facts) {
      if (checkOn && !seen.has(urlKey(f.source)) && (await checkUrl(f.source, fetchImpl, timeoutMs)) === "dead") {
        notes.push(`ссылка не открывается — пункт выброшен: ${f.source}`);
        continue;
      }
      fresh.push(f);
    }
    const facts = [...known, ...fresh].slice(0, limits.max + known.length);
    if (facts.length < limits.min) notes.push(`материала ${facts.length} пунктов из желаемых ${limits.min} — сценарий выйдет плотнее, но короче истории`);
    const cost = usage.list().reduce((a, u) => a + u.costUsd, 0);
    log.info(`[материал] «${input.topic}»: +${fresh.length} пунктов (всего ${facts.length}), жанр — ${res.value.genre === "story" ? "история" : "объяснение"}, $${cost.toFixed(4)}`);
    for (const n of notes) log.info(`[материал] замечание: ${n}`);
    return { genre: res.value.genre, story: res.value.story, facts, added: fresh.length, notes, usage: usage.list() };
  } catch (e) {
    log.warn(`[материал] поиск не удался (${e instanceof Error ? e.message.split("\n")[0] : String(e)}) — пишу по фактам плана`);
    return null;
  }
}
