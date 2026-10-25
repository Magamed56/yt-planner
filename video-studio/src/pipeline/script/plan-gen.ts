// Новые темы плана через LLM: npm run plan-extend (N тем подряд) и
// npm run plan-sequel (продолжение «Часть 2»). Формат — как в content/plan.json:
// хук, угол и факты, у КАЖДОГО факта — реальная ссылка на источник.
// Источники: с Claude — серверный веб-поиск (ссылки из выдачи), с бесплатными
// моделями — ссылки «по памяти», поэтому каждая проверяется запросом по сети:
// 404/410 или несуществующий домен — факт выбрасывается.

import { z } from "zod";
import type { LlmUsage } from "../contracts";
import { normCode } from "../codes";
import { LONG_CHAPTERS_MAX, LONG_FACTS, LONG_MIN_FACTS } from "../long-plan";
import type { ContentPlan, PlanFact, PlanItem, PlanPosition } from "../plan";
import { sequelTitle } from "../plan";
import { coveredPromptBlock, findRepeats, indexCovered, stems, type CoveredEntry } from "./covered";
import type { ScriptDeps } from "./generate";
import { resolveChain } from "./llm/chain";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, envNumber, linkedAbort, type FetchLike, type Logger } from "./llm/types";
import { toCompatJsonSchema } from "./schema";
import { coerceMeta, countWords, formatZodIssues, unwrap } from "./validate";

export const MIN_FACTS = 2;
const TITLE_SOFT = 70;

const FactSchema = z.object({
  claim: z.string().trim().min(1).max(500).describe("проверяемый факт с конкретикой"),
  source: z.string().trim().min(1).max(500).describe("прямая ссылка https://… на страницу с этим фактом"),
});

const PlanTopicsSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().optional().describe("код темы из запроса, например 31a"),
        title: z.string().trim().min(1).max(100).describe("название ролика по-русски, до 70 символов"),
        hook: z.string().trim().min(1).max(200).describe("первая фраза ролика, до 12 слов"),
        angle: z.string().trim().min(1).max(700).describe("угол подачи и развязка, 1–2 предложения"),
        keyFacts: z.array(FactSchema).min(1).max(6),
      }),
    )
    .min(1)
    .max(40),
});

// «Разбор» (~7 минут, content/long-plan.json): больше фактов и набросок глав.
const LongTopicsSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().optional().describe("код темы из запроса, например L04"),
        title: z.string().trim().min(1).max(100).describe("название ролика по-русски, до 70 символов"),
        hook: z.string().trim().min(1).max(200).describe("первая фраза ролика, до 15 слов"),
        angle: z.string().trim().min(1).max(900).describe("угол подачи, линия рассказа и развязка, 2–3 предложения"),
        keyFacts: z.array(FactSchema).min(1).max(LONG_FACTS.max + 2),
        chapters: z.array(z.string().trim().min(1).max(80)).max(LONG_CHAPTERS_MAX).optional().describe("4–6 коротких названий глав по порядку"),
      }),
    )
    .min(1)
    .max(12),
});

type TopicsSchema = typeof PlanTopicsSchema | typeof LongTopicsSchema;
const schemaFor = (long: boolean): TopicsSchema => (long ? LongTopicsSchema : PlanTopicsSchema);

export interface PlanTopic {
  title: string;
  hook: string;
  angle: string;
  keyFacts: PlanFact[];
  chapters?: string[]; // только «Разбор»
}

// ---- Ссылки ----

const URL_RE = /https?:\/\/[^\s<>"'«»]+/i;

// Первая ссылка из строки источника, без хвостовой пунктуации.
export function extractUrl(source: string): string | null {
  const m = URL_RE.exec(source);
  if (!m) return null;
  let url = m[0].replace(/[.,;:!?]+$/, "");
  // скобка в конце — от «(источник: https://…)», а не часть адреса Википедии «…_(film)»
  if (url.endsWith(")") && !url.includes("(")) url = url.slice(0, -1);
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const urlKey = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "").replace(/^(\w+)\.m\./, "$1.")}${decodeURI(x.pathname).replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

export type UrlStatus = "ok" | "dead" | "unknown";

// HEAD, а если сайт его не любит (403/405/429/5xx) — GET без чтения тела.
// «Мёртвая» ссылка — только явные 404/410 или несуществующий домен: блокировку
// ботов (403) и таймаут за выдумку не считаем.
export async function checkUrl(url: string, fetchImpl: FetchLike, timeoutMs = 8000): Promise<UrlStatus> {
  const headers = { "user-agent": "Mozilla/5.0 (compatible; video-studio-plan-check/1.0)", accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
  const once = async (method: "HEAD" | "GET"): Promise<number | "dns" | "error"> => {
    const { signal, cleanup } = linkedAbort(timeoutMs);
    try {
      const res = await fetchImpl(url, { method, headers, redirect: "follow", signal });
      try {
        await res.body?.cancel();
      } catch {
        // тело не нужно
      }
      return res.status;
    } catch (e) {
      const code = (e as { cause?: { code?: string } })?.cause?.code ?? "";
      return /ENOTFOUND|EAI_NONAME/.test(code) ? "dns" : "error";
    } finally {
      cleanup();
    }
  };
  const verdict = (s: number | "dns" | "error"): UrlStatus | null => {
    if (s === "dns") return "dead";
    if (s === "error") return null;
    if (s >= 200 && s < 400) return "ok";
    if (s === 404 || s === 410) return "dead";
    return null;
  };
  const head = verdict(await once("HEAD"));
  if (head === "ok") return "ok";
  const get = verdict(await once("GET"));
  return get ?? head ?? "unknown";
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

// ---- Промпты ----

export interface PlanChannel {
  name?: string | null;
  niche?: string | null;
  audience?: string | null;
}

export function buildPlanSystemPrompt(webSearch: boolean, long = false): string {
  const intro = long
    ? "Ты — редактор и фактчекер русскоязычного научно-популярного канала. Подбираешь темы для «Разборов» — горизонтальных роликов YouTube на ~7 минут с главами — и проверенные факты к ним с источниками."
    : "Ты — редактор и фактчекер русскоязычного научно-популярного канала коротких роликов (YouTube Shorts, ~40–45 секунд). Придумываешь темы и подбираешь к ним проверенные факты с источниками.";
  const scope = long
    ? `- Тема «Разбора» — вопрос с историей, механизмом или спором внутри: материала на 7 минут и 4–6 глав (как это устроено, как узнали, что из этого следует, частые заблуждения). Не тема на минуту и не пересказ учебника целиком.
- keyFacts — ${LONG_FACTS.min}–${LONG_FACTS.max} фактов на тему: проверяемые, с конкретикой (кто, когда, сколько, как устроено), разные — на всю длину ролика.
- chapters — 4–6 коротких названий глав по порядку рассказа (до 5 слов, без нумерации).
- У истории должна быть развязка: в конце зритель узнаёт, чем всё кончилось и почему. Загадки без ответа («никто не знает, почему», как исчезновение Агаты Кристи в 1926 году), личная жизнь и скандалы знаменитостей — не бери.`
    : `- Тема — один конкретный вопрос или удивительный факт, который можно раскрыть за минуту; не пересказ целой области.
- keyFacts — 2–4 факта на тему: проверяемые, с конкретикой (кто, когда, сколько, как устроено).`;
  const format = long ? '{"items": [{"code", "title", "hook", "angle", "keyFacts": [{"claim", "source"}], "chapters": ["…"]}]}' : '{"items": [{"code", "title", "hook", "angle", "keyFacts": [{"claim", "source"}]}]}';
  return `${intro}

## Правила
${scope}
- source у каждого факта — ОДНА прямая ссылка https://… на страницу, где этот факт написан: Википедия (ru или en), научная статья (doi.org, pubmed, nature.com, science.org…), сайт научной организации, музея или крупного СМИ. Факт без ссылки не пиши вовсе.${
    webSearch
      ? "\n- Источники ищи веб-поиском и бери ссылки из его результатов; факт, для которого источник не нашёлся, не пиши."
      : "\n- Не выдумывай адреса: каждую ссылку проверят запросом по сети, несуществующая выбрасывается вместе с фактом. Не уверен в точном адресе — дай статью Википедии по теме, где этот факт есть."
  }
- Без эзотерики, лженауки, медицинских обещаний «лечит», политики и кликбейтной лжи.
- title — до 70 символов, по-русски, с главным поисковым запросом, без КАПСА и эмодзи; hook — первая фраза ролика, до 12 слов, без «Привет», «Сегодня», «Знаете ли вы»; angle — угол подачи и развязка в 1–2 предложениях.
- Не повторяй темы и факты, которые уже есть на канале (список в запросе).

## Формат ответа
Ответь ТОЛЬКО одним JSON-объектом, без markdown и пояснений: ${format}.`;
}

function channelLine(ch: PlanChannel): string {
  return [
    ch.name ? `Канал: «${ch.name}».` : "",
    ch.niche ? `Ниша: ${ch.niche}` : "",
    ch.audience ? `Аудитория: ${ch.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const pillarTitle = (pillars: { id: string; title: string }[], id: string) => pillars.find((p) => p.id === id)?.title ?? id;

export function buildExtendPrompt(input: {
  channel: PlanChannel;
  positions: (PlanPosition & { pillar: string })[];
  pillars: { id: string; title: string }[];
  plan: ContentPlan;
  covered: CoveredEntry[];
  alsoTitles?: string[]; // принятые в прошлом заходе — их тоже не повторять
  long?: boolean; // темы «Разбора» (content/long-plan.json)
  extraTitles?: string[]; // «Разбор»: темы Shorts — их «Разборы» не берут
}): string {
  const wanted = input.positions.map((p) => `- ${p.id} — рубрика «${pillarTitle(input.pillars, p.pillar)}»`).join("\n");
  // Темы плана + ролики не из плана (написанные по --topic); факты сверит проверка ответа.
  const titles = [...new Set([...input.plan.items.map((i) => i.title), ...(input.extraTitles ?? []), ...input.covered.map((e) => e.title), ...(input.alsoTitles ?? [])])].map((t) => `«${t}»`).join("; ");
  return `${channelLine(input.channel)}

Нужно ${input.positions.length} новых ${input.long ? "тем для «Разборов» (~7 минут, 16:9, с главами; таких тем не должно быть среди Shorts канала)" : "тем"} — по одной на каждый код, рубрика задана:
${wanted}

Темы, которые уже есть на канале или в плане, — их и близкие к ним не повторяй: ${titles}

Ответ — {"items": [...]} в том же порядке, у каждой темы поле code — её код из списка выше.`;
}

export function buildSequelPrompt(input: { channel: PlanChannel; base: PlanItem; position: PlanPosition; pillars: { id: string; title: string }[]; covered: CoveredEntry[] }): string {
  const b = input.base;
  const facts = b.keyFacts.map((f, i) => `${i + 1}. ${f.claim}`).join("\n");
  return `${channelLine(input.channel)}

Нужно продолжение ролика ${b.id} «${b.title}» — «Часть 2» (код ${input.position.id}, рубрика «${pillarTitle(input.pillars, b.pillar)}»).
Первая часть: хук «${b.hook}»; угол: ${b.angle}
Факты первой части (НЕ повторяй их и их перефразы):
${facts || "—"}
${input.covered.length ? `\n${coveredPromptBlock(input.covered, `${b.title} ${b.angle}`)}\n` : ""}
Сделай новый угол той же темы и 2–4 НОВЫХ факта с источниками. hook — самостоятельный, без «во второй части»: зритель мог не видеть первую. title — рабочее название нового угла (в план пойдёт «${sequelTitle(b.title).title}»).
Ответ — {"items": [ одна тема ]}, code — ${input.position.id}.`;
}

// ---- Проверка ответа ----

const titleStems = (t: string) => new Set(stems(t));

// Похожие названия: доля общих основ слов (Жаккар) — «Почему небо голубое» ≈ «Почему небо синее?».
export function similarTitle(a: string, b: string): boolean {
  const x = titleStems(a);
  const y = titleStems(b);
  if (!x.size || !y.size) return false;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  const jaccard = common / (x.size + y.size - common);
  const contain = common / Math.min(x.size, y.size);
  return jaccard >= 0.6 || (contain >= 0.85 && Math.min(x.size, y.size) >= 3);
}

export interface TopicsVerdictCtx {
  positions: PlanPosition[];
  existingTitles: string[];
  covered: CoveredEntry[];
  minFacts?: number;
  long?: boolean; // «Разбор»: схема с главами и до 14 фактов
}

export interface CheckedTopics {
  topics: Map<string, PlanTopic>; // код → тема
  notes: string[]; // что выброшено и почему
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

// Неисправимое (нет JSON с темами) — в ремонт; остальное чиним сами: факт без
// ссылки или повтор уже сказанного выбрасываем, тема без фактов и дубль
// названия выпадает — недостающее CLI попросит отдельным запросом.
export function checkTopics(raw: unknown, ctx: TopicsVerdictCtx): Verdict<CheckedTopics> {
  const top = Array.isArray(raw) ? { items: raw } : unwrap(raw, "items");
  if (!isObj(top) || !Array.isArray(top.items)) return { ok: false, problems: ['ожидался JSON-объект {"items": [...]}'], warnings: [] };
  const items = top.items.map((it) => {
    if (!isObj(it)) return it;
    const o = coerceMeta(it);
    for (const f of ["hook", "angle", "code"]) if (typeof o[f] === "string") o[f] = (o[f] as string).replace(/\s+/g, " ").trim();
    // «31A» → «31a», «l04» → «L04» — как коды в запросе.
    if (typeof o.code === "string") o.code = normCode(o.code) ?? o.code.toLowerCase();
    if (Array.isArray(o.keyFacts)) o.keyFacts = o.keyFacts.filter(isObj).map((f) => ({ claim: String(f.claim ?? "").trim(), source: String(f.source ?? f.url ?? "").trim() }));
    if (ctx.long && Array.isArray(o.chapters)) o.chapters = o.chapters.filter((c): c is string => typeof c === "string" && Boolean(c.trim())).slice(0, LONG_CHAPTERS_MAX);
    return o;
  });
  const schema = schemaFor(Boolean(ctx.long));
  const parsed = schema.safeParse({ items });
  if (!parsed.success) {
    // Схема не сошлась целиком — принимаем годные темы по одной.
    const good = items.filter((it) => schema.shape.items.element.safeParse(it).success);
    if (!good.length) return { ok: false, problems: formatZodIssues(parsed.error, { items }, "items"), warnings: [] };
    return accept(schema.shape.items.parse(good) as LooseTopic[], ctx);
  }
  return accept(parsed.data.items as LooseTopic[], ctx);
}

type LooseTopic = z.infer<typeof PlanTopicsSchema>["items"][number] & { chapters?: string[] };

function accept(list: LooseTopic[], ctx: TopicsVerdictCtx): Verdict<CheckedTopics> {
  const minFacts = ctx.minFacts ?? MIN_FACTS;
  const notes: string[] = [];
  const topics = new Map<string, PlanTopic>();
  const free = ctx.positions.map((p) => p.id);
  const index = ctx.covered.length ? indexCovered(ctx.covered) : null;
  const titles = [...ctx.existingTitles];
  list.forEach((it, i) => {
    const code = it.code && free.includes(it.code) ? it.code : free.find((c) => !topics.has(c) && !list.some((x, j) => j > i && x.code === c));
    if (!code || topics.has(code)) {
      notes.push(`лишняя тема «${it.title}» — кодов на неё нет`);
      return;
    }
    const dup = titles.find((t) => similarTitle(t, it.title));
    if (dup) {
      notes.push(`${code}: «${it.title}» слишком похожа на «${dup}» — пропущена`);
      return;
    }
    const facts: PlanFact[] = [];
    for (const f of it.keyFacts) {
      const url = extractUrl(f.source);
      if (!url) {
        notes.push(`${code}: факт без ссылки на источник выброшен («${f.claim.slice(0, 60)}…»)`);
        continue;
      }
      if (index && findRepeats([{ id: "f", kind: "statement", narration: f.claim, onScreen: "" }], index).length) {
        notes.push(`${code}: факт уже был на канале — выброшен («${f.claim.slice(0, 60)}…»)`);
        continue;
      }
      facts.push({ claim: f.claim.replace(/\s+/g, " ").trim(), source: url });
    }
    if (facts.length < minFacts) {
      notes.push(`${code}: «${it.title}» — фактов с источниками ${facts.length}, нужно минимум ${minFacts}; тема пропущена`);
      return;
    }
    if (it.title.length > TITLE_SOFT) notes.push(`${code}: название длиннее ${TITLE_SOFT} символов — в поиске обрежется`);
    if (countWords(it.hook) > 15) notes.push(`${code}: хук длиннее 12 слов — сократите при написании сценария`);
    const chapters = (it.chapters ?? []).map((c) => c.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
    topics.set(code, { title: it.title.trim(), hook: it.hook.trim(), angle: it.angle.trim(), keyFacts: facts, ...(chapters.length ? { chapters } : {}) });
    titles.push(it.title);
  });
  if (!topics.size) return { ok: false, problems: notes.length ? notes : ["ни одной годной темы"], warnings: [] };
  return { ok: true, value: { topics, notes }, warnings: [] };
}

// ---- Точка входа ----

export interface PlanGenInput {
  plan: ContentPlan;
  positions: (PlanPosition & { pillar: string })[];
  pillars: { id: string; title: string }[];
  channel: PlanChannel;
  covered: CoveredEntry[];
  sequelOf?: PlanItem | null; // plan-sequel: первая часть
  long?: boolean; // plan-extend --long: темы «Разбора» (8–12 фактов, главы)
  extraTitles?: string[]; // названия, которых не должно быть среди новых тем (Shorts для «Разбора»)
}

export interface PlanGenResult {
  items: PlanItem[];
  missing: PlanPosition[]; // не удалось заполнить
  notes: string[];
  usage: LlmUsage[];
}

export async function generatePlanItems(input: PlanGenInput, deps: ScriptDeps = {}): Promise<PlanGenResult> {
  const env = deps.env ?? process.env;
  const log: Logger = deps.log ?? consoleLogger;
  const fetchImpl: FetchLike = deps.fetch ?? ((i, init) => fetch(i, init));
  const chain = resolveChain({ env, fetch: fetchImpl, anthropic: deps.anthropic, log });
  if (!chain.length) {
    throw new Error("Нет ни одной доступной LLM. Задайте GEMINI_API_KEY (бесплатно: https://aistudio.google.com/app/apikey) или ANTHROPIC_API_KEY (с веб-поиском источников).");
  }
  const searchOn = chain[0]!.provider === "claude" && !/^(0|off|false|no)$/i.test((env.PLAN_WEB_SEARCH ?? "").trim());
  const checkOn = !/^(0|off|false|no)$/i.test((env.PLAN_CHECK_URLS ?? "").trim());
  const usage = new UsageBook();
  const notes: string[] = [];
  const done = new Map<string, PlanTopic>();
  const long = Boolean(input.long) && !input.sequelOf;
  const titles = [...input.plan.items.map((i) => i.title), ...(input.extraTitles ?? [])];
  const sequel = input.sequelOf ?? null;
  const minFacts = long ? LONG_MIN_FACTS : MIN_FACTS;
  const schema = schemaFor(long);

  // Два захода: второй — свежим запросом только за недостающими темами.
  for (let round = 0; round < 2; round++) {
    const positions = input.positions.filter((p) => !done.has(p.id));
    if (!positions.length) break;
    const user = sequel
      ? buildSequelPrompt({ channel: input.channel, base: sequel, position: positions[0]!, pillars: input.pillars, covered: input.covered })
      : buildExtendPrompt({ channel: input.channel, positions, pillars: input.pillars, plan: input.plan, covered: input.covered, alsoTitles: [...done.values()].map((t) => t.title), long, extraTitles: input.extraTitles });
    let res: { value: CheckedTopics; sources: string[] };
    try {
      res = await generateStructured({
        chain,
        system: buildPlanSystemPrompt(searchOn, long),
        user,
        schemaName: "plan_topics",
        zodSchema: schema,
        jsonSchema: toCompatJsonSchema(schema),
        validate: (raw) =>
          checkTopics(raw, {
            positions,
            // Часть 2 называется как первая — её не сравниваем с ней самой.
            existingTitles: sequel ? titles.filter((t) => t !== sequel.title) : [...titles, ...[...done.values()].map((t) => t.title)],
            covered: input.covered,
            minFacts,
            long,
          }),
        what: sequel ? `«Часть 2» для ${sequel.id}` : `${positions.length} новых тем${long ? " «Разбора»" : ""} (заход ${round + 1})`,
        usage,
        log,
        signal: deps.signal,
        onCall: deps.onLlmCall,
        // У «Разбора» фактов втрое больше — и поисков на тему больше.
        ...(searchOn ? { webSearch: { maxUses: Math.min(30, Math.max(5, positions.length * (long ? 8 : 3))) } } : {}),
      });
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
      break;
    }
    notes.push(...res.value.notes);

    // Ссылки, которых не было в выдаче поиска, проверяем по сети.
    const seen = new Set(res.sources.map(urlKey));
    const facts = [...res.value.topics.entries()].flatMap(([code, t]) => t.keyFacts.map((f) => ({ code, f })));
    const timeoutMs = envNumber(env, "PLAN_URL_TIMEOUT_MS", 8000);
    const statuses = await pool(facts, 4, async ({ f }) => (!checkOn || seen.has(urlKey(f.source)) ? "ok" : await checkUrl(f.source, fetchImpl, timeoutMs)));
    const dead = new Set<PlanFact>();
    facts.forEach(({ code, f }, i) => {
      if (statuses[i] === "dead") {
        dead.add(f);
        notes.push(`${code}: ссылка не открывается (404 или нет такого сайта) — факт выброшен: ${f.source}`);
      }
    });
    if (checkOn) {
      const unknown = statuses.filter((s) => s === "unknown").length;
      if (unknown) log.info(`[план] ${unknown} ссылок не удалось проверить (сайт не пустил бота или не ответил) — оставлены, проверьте глазами`);
    }
    for (const [code, t] of res.value.topics) {
      const keyFacts = t.keyFacts.filter((f) => !dead.has(f));
      if (keyFacts.length < minFacts) {
        notes.push(`${code}: после проверки ссылок фактов осталось ${keyFacts.length} — тема пропущена`);
        continue;
      }
      done.set(code, { ...t, keyFacts });
    }
  }

  const items: PlanItem[] = [];
  for (const pos of input.positions) {
    const t = done.get(pos.id);
    if (!t) continue;
    items.push({
      id: pos.id,
      day: pos.day,
      slot: pos.slot,
      pillar: pos.pillar,
      title: sequel ? sequelTitle(sequel.title).title : t.title,
      hook: t.hook,
      angle: t.angle,
      keyFacts: t.keyFacts,
      ...(long && t.chapters?.length ? { chapters: t.chapters } : {}),
      status: "planned",
      ...(sequel ? { sequelOf: sequel.id } : {}),
    });
  }
  return { items, missing: input.positions.filter((p) => !done.has(p.id)), notes, usage: usage.list() };
}
