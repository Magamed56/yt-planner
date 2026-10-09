// Перевод через ту же цепочку LLM, что пишет сценарии (бесплатный Gemini по умолчанию):
//   translateCues   — реплики субтитров: ровно столько же и в том же порядке (тайминги
//                     переносит srt.ts, модель их не видит и сломать не может);
//   translateScript — готовый русский сценарий на другой язык: те же сцены, факты и числа,
//                     хук и CTA — по-живому, как у носителя языка.
// Ответ проверяется (число реплик/сцен, пустые и непереведённые места, объём речи); не
// прошёл — один ремонтный запрос со списком ошибок, затем следующая модель (runner.ts).

import { z } from "zod";
import type { LlmUsage } from "../contracts";
import { langInfo, type LangInfo } from "../lang";
import type { SceneCompare, SceneMap, SceneQuiz, SceneStat, ScriptScene, VideoScript } from "../../types";
import { ScriptGenerationError, type ScriptDeps } from "./generate";
import { resolveChain } from "./llm/chain";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, type FetchLike, type LlmTarget, type Logger } from "./llm/types";
import { LIMITS, toCompatJsonSchema } from "./schema";
import { ScriptValidationError, countWords, unwrap, validateScript } from "./validate";

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const CYRILLIC = /[Ѐ-ӿ]/;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Текст не переведён: в латинице осталась кириллица; в кириллице (казахский, украинский) —
// дословно русская фраза из оригинала.
function untranslated(target: LangInfo, source: string, text: string): boolean {
  if (!target.cyrillic) return CYRILLIC.test(text);
  return countWords(source) >= 3 && norm(source) === norm(text);
}

function makeChain(deps: ScriptDeps): { chain: LlmTarget[]; log: Logger } {
  const env = deps.env ?? process.env;
  const log = deps.log ?? consoleLogger;
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const chain = resolveChain({ env, fetch: fetchImpl, anthropic: deps.anthropic, log });
  if (!chain.length) {
    throw new Error("Нет ни одной доступной LLM для перевода. Задайте GEMINI_API_KEY (бесплатно: https://aistudio.google.com/app/apikey) или другой ключ из .env.example.");
  }
  return { chain, log };
}

// ---- Субтитры ----

const CueReplySchema = z.object({
  cues: z
    .array(
      z.object({
        n: z.number().int().describe("номер реплики из запроса"),
        text: z.string().describe("перевод этой реплики, одной строкой"),
      }),
    )
    .min(1),
});

export function buildCueSystemPrompt(): string {
  return `Ты — профессиональный переводчик субтитров познавательных YouTube-роликов. Переводишь реплики субтитров с русского на указанный язык.

Правила:
- Ровно столько же реплик, сколько в запросе, с теми же номерами n и в том же порядке. Не объединяй, не дроби и не пропускай реплики: каждая показывается на экране в своё время.
- Реплика бывает частью фразы — переводи так, чтобы фраза естественно продолжалась в следующей реплике, но смысл каждой реплики оставался в ней.
- Длина перевода — примерно как у оригинала: зритель успевает прочитать за то же время.
- Естественный разговорный язык носителя, без канцелярита. Факты, числа, имена и годы — точно как в оригинале; числа можно писать цифрами. Имена и названия — в принятом в этом языке написании.
- Без пояснений, примечаний, кавычек вокруг всей реплики, разметки и номеров внутри текста.

Ответ — только JSON: {"cues": [{"n": 1, "text": "..."}, ...]}.`;
}

export function buildCuePrompt(texts: string[], lang: string, opts: { from?: number; context?: string[] } = {}): string {
  const info = langInfo(lang);
  const from = opts.from ?? 0;
  const ctx = opts.context?.length ? `\nПредыдущие реплики уже переведены (для связности, их НЕ переводи и не включай в ответ):\n${opts.context.map((c) => `- ${c}`).join("\n")}\n` : "";
  const list = texts.map((t, i) => ({ n: from + i + 1, text: t.replace(/\s+/g, " ").trim() }));
  return `Язык перевода: ${info.name} (${info.code}).${ctx}
Реплик: ${texts.length} (номера ${from + 1}–${from + texts.length}).
${JSON.stringify({ cues: list })}`;
}

// Проверка ответа: число и номера реплик, пустые и непереведённые, явный перебор длины.
export function checkCueTranslation(source: string[], raw: unknown, lang: string, from = 0): Verdict<string[]> {
  const target = langInfo(lang);
  const top = unwrap(raw, "cues");
  const list: unknown[] | null = Array.isArray(top) ? top : isObj(top) && Array.isArray(top.cues) ? top.cues : null;
  if (!list) return { ok: false, problems: ['ожидался JSON-объект {"cues": [{"n": 1, "text": "..."}]}'], warnings: [] };
  const problems: string[] = [];
  if (list.length !== source.length) {
    problems.push(`реплик в ответе ${list.length}, а нужно ровно ${source.length} (номера ${from + 1}–${from + source.length}) — не объединяй, не дроби и не пропускай реплики`);
  }
  const out: string[] = [];
  let same = 0;
  list.slice(0, source.length).forEach((item, i) => {
    const n = from + i + 1;
    const text = typeof item === "string" ? str(item) : isObj(item) ? str(item.text) : "";
    const num = isObj(item) ? Number(item.n) : n;
    if (isObj(item) && Number.isFinite(num) && num !== n) problems.push(`на месте реплики ${n} стоит номер ${num} — порядок и номера как в запросе`);
    if (!text) problems.push(`реплика ${n}: пустой перевод`);
    else if (text.includes("-->")) problems.push(`реплика ${n}: в тексте строка времени «-->» — нужен только перевод`);
    else if (untranslated(target, source[i]!, text)) {
      if (!target.cyrillic) problems.push(`реплика ${n}: осталась кириллица — переведи на ${target.name}`);
      else same++;
    } else if (text.length > Math.max(source[i]!.length * 2.5, source[i]!.length + 50)) {
      problems.push(`реплика ${n}: перевод в ${Math.round(text.length / Math.max(1, source[i]!.length))} раза длиннее оригинала — сократи, его не успеют прочитать`);
    }
    out.push(text);
  });
  if (same > Math.max(1, source.length * 0.3)) problems.push(`${same} реплик совпадают с русским оригиналом — переведи их на ${target.name}`);
  if (problems.length) return { ok: false, problems, warnings: [] };
  return { ok: true, value: out, warnings: [] };
}

export interface CueTranslation {
  texts: string[];
  usage: LlmUsage[];
  servedBy: string | null; // «gemini · gemini-3.8-flash» — для сводки
}

// По частям (chunk реплик за запрос): у длинного «Разбора» их сотни, а ответ бесплатной
// модели ограничен. Каждой следующей части — две последние переведённые реплики для связности.
export async function translateCues(texts: string[], lang: string, deps: ScriptDeps & { chunk?: number } = {}): Promise<CueTranslation> {
  langInfo(lang); // понятная ошибка на неизвестный язык — до запросов
  const { chain, log } = makeChain(deps);
  const usage = new UsageBook();
  const size = Math.max(5, deps.chunk ?? 60);
  const out: string[] = [];
  let current = chain;
  let servedBy: string | null = null;
  try {
    for (let from = 0; from < texts.length; from += size) {
      const part = texts.slice(from, from + size);
      const res = await generateStructured({
        chain: current,
        system: buildCueSystemPrompt(),
        user: buildCuePrompt(part, lang, { from, context: out.slice(-2) }),
        schemaName: "caption_translation",
        zodSchema: CueReplySchema,
        jsonSchema: toCompatJsonSchema(CueReplySchema),
        validate: (raw) => checkCueTranslation(part, raw, lang, from),
        what: `субтитры ${lang}${texts.length > size ? ` (${from + 1}–${from + part.length} из ${texts.length})` : ""}`,
        usage,
        log,
        signal: deps.signal,
        onCall: deps.onLlmCall,
        maxTokens: 8192,
      });
      out.push(...res.value);
      servedBy = `${res.target.provider} · ${res.target.model}`;
      // Следующую часть — с той же модели: незачем снова упираться в 429 у первой.
      const i = current.indexOf(res.target);
      if (i > 0) current = [...current.slice(i), ...current.slice(0, i)];
    }
  } catch (e) {
    throw new ScriptGenerationError(e instanceof Error ? e.message : String(e), usage.list(), e);
  }
  return { texts: out, usage: usage.list(), servedBy };
}

// ---- Сценарий ----

// Что переводится в сцене. visualQuery, imagePrompt, icon, числа и координаты не трогаем.
interface SceneText {
  id: string;
  kind: string;
  narration: string;
  onScreen: string;
  items?: string[];
  statPrefix?: string;
  statSuffix?: string;
  statLabel?: string;
  quizExplanation?: string;
  quizQuestion?: string;
  chapter?: string;
  mapLabel?: string;
  compareLabels?: string[];
  compareSuffix?: string;
}

interface ScriptText {
  title: string;
  description: string;
  tags: string[];
  scenes: SceneText[];
}

const ScriptTextSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  scenes: z.array(
    z.object({
      id: z.string(),
      narration: z.string(),
      onScreen: z.string(),
      items: z.array(z.string()).optional(),
      statPrefix: z.string().optional(),
      statSuffix: z.string().optional(),
      statLabel: z.string().optional(),
      quizExplanation: z.string().optional(),
      quizQuestion: z.string().optional(),
      chapter: z.string().optional(),
      mapLabel: z.string().optional(),
      compareLabels: z.array(z.string()).optional(),
      compareSuffix: z.string().optional(),
    }),
  ),
});

export function scriptTextOf(s: VideoScript): ScriptText {
  return {
    title: s.title,
    description: s.description,
    tags: s.tags,
    scenes: s.scenes.map((sc) => {
      const t: SceneText = { id: sc.id, kind: sc.kind, narration: sc.narration, onScreen: sc.onScreen };
      if (sc.items) t.items = sc.items;
      if (sc.stat) {
        if (sc.stat.prefix) t.statPrefix = sc.stat.prefix;
        if (sc.stat.suffix) t.statSuffix = sc.stat.suffix;
        t.statLabel = sc.stat.label;
      }
      if (sc.quiz) {
        t.quizExplanation = sc.quiz.explanation;
        if (sc.quiz.question) t.quizQuestion = sc.quiz.question;
      }
      if (sc.chapter) t.chapter = sc.chapter;
      if (sc.map) t.mapLabel = sc.map.label;
      if (sc.compare) {
        t.compareLabels = sc.compare.items.map((i) => i.label);
        if (sc.compare.suffix) t.compareSuffix = sc.compare.suffix;
      }
      return t;
    }),
  };
}

export function buildScriptSystemPrompt(): string {
  return `Ты — редактор-локализатор познавательного YouTube-канала. Переводишь готовый русский сценарий ролика на другой язык так, чтобы он звучал как написанный носителем языка, а не как перевод.

## Что неизменно
- Структура: те же сцены, в том же порядке, с теми же id; в items — столько же пунктов, в compareLabels — столько же подписей.
- Факты, числа, годы, имена и источники — ровно как в оригинале. Ничего не добавляй и не выдумывай. Величины не пересчитывай (рубли остаются рублями; можно пояснить «рублей»).
- Объём narration — примерно как в оригинале (±20%): от него зависит длительность ролика.

## Как писать
- Первая сцена (hook) — перепиши по-своему, как сказал бы носитель языка: коротко (до 12 слов), цепляюще, без дословного перевода и без заходов «Hi», «In this video».
- narration — живая разговорная речь, короткие предложения; числа словами так, как их произносят (диктор читает текст буквально). Без эмодзи, хэштегов и звёздочек.
- onScreen — короткий заголовок сцены, не больше 7 слов, числа цифрами; ровно одно акцентное слово в *звёздочках* (или ни одного), как в оригинале.
- Последняя сцена (cta): короткий вопрос зрителю по теме, как в оригинале, — на языке перевода. Призыв подписаться не добавляй: кнопку подписки ролик показывает сам.
- statPrefix/statSuffix — знаки и единицы на языке перевода («%», « M», «×»); statLabel, items, quizExplanation, quizQuestion, chapter, mapLabel, compareLabels, compareSuffix — коротко, на языке перевода.
- title — до 70 символов, с главным поисковым запросом темы на языке перевода, без КАПСА и эмодзи. description — 2–3 предложения о пользе ролика, затем с новой строки 3–5 хэштегов на языке перевода (для Shorts — и #shorts). tags — 8–15 тегов на языке перевода, строчными, без «#».

Ответ — только JSON той же формы, что в запросе: {"title", "description", "tags", "scenes": [{"id", "narration", "onScreen", …}]} (поле kind не нужно).`;
}

export function buildScriptPrompt(script: VideoScript, lang: string, notes?: string): string {
  const info = langInfo(lang);
  return `Язык перевода: ${info.name} (${info.code}). Формат ролика: ${script.format === "shorts" ? "Shorts (вертикальный, до минуты)" : "горизонтальный ролик"}.${notes?.trim() ? `\n\n${notes.trim()}` : ""}

Сценарий на русском:
${JSON.stringify(scriptTextOf(script))}`;
}

// Переведённые поля поверх оригинала: всё, что не текст (числа, иконки, запросы стоков,
// координаты, тема, формат), остаётся как было.
function mergeScene(src: ScriptScene, t: Loose): ScriptScene {
  const scene: ScriptScene = { ...src, narration: str(t.narration), onScreen: str(t.onScreen) };
  if (src.items && Array.isArray(t.items)) scene.items = t.items.map(str);
  if (src.stat) {
    const stat: SceneStat = { ...src.stat, label: str(t.statLabel) || src.stat.label };
    if (src.stat.prefix !== undefined) stat.prefix = typeof t.statPrefix === "string" ? t.statPrefix : src.stat.prefix;
    if (src.stat.suffix !== undefined) stat.suffix = typeof t.statSuffix === "string" ? t.statSuffix : src.stat.suffix;
    scene.stat = stat;
  }
  if (src.quiz) {
    const quiz: SceneQuiz = { ...src.quiz, explanation: str(t.quizExplanation) };
    if (src.quiz.question !== undefined) quiz.question = str(t.quizQuestion) || undefined;
    if (!quiz.question) delete quiz.question;
    scene.quiz = quiz;
  }
  if (src.chapter) scene.chapter = str(t.chapter);
  if (src.map) scene.map = { ...src.map, label: str(t.mapLabel) || src.map.label } satisfies SceneMap;
  if (src.compare) {
    const labels = Array.isArray(t.compareLabels) ? t.compareLabels.map(str) : [];
    const compare: SceneCompare = { ...src.compare, items: src.compare.items.map((it, i) => ({ ...it, label: labels[i] || it.label })) };
    if (src.compare.suffix !== undefined) compare.suffix = typeof t.compareSuffix === "string" ? t.compareSuffix : src.compare.suffix;
    scene.compare = compare;
  }
  return scene;
}

const narrationWords = (s: { scenes: { narration: string }[] }) => s.scenes.reduce((a, sc) => a + countWords(sc.narration), 0);

// Проверка перевода сценария: структура как у оригинала, всё переведено, объём речи близок,
// итоговый сценарий проходит обычную проверку (validateScript).
export function checkScriptTranslation(source: VideoScript, raw: unknown, lang: string): Verdict<VideoScript> {
  const target = langInfo(lang);
  const top = unwrap(raw, "scenes");
  if (!isObj(top) || !Array.isArray(top.scenes)) return { ok: false, problems: ['ожидался JSON-объект {"title", "description", "tags", "scenes": [...]}'], warnings: [] };
  const problems: string[] = [];
  const title = str(top.title);
  if (!title) problems.push("title: пустой заголовок");
  if (title.length > LIMITS.title) problems.push(`title: ${title.length} символов — нужно до 70`);
  if (!Array.isArray(top.tags) || !top.tags.some((t) => str(t))) problems.push("tags: нужен список тегов на языке перевода");
  const scenes = top.scenes;
  if (scenes.length !== source.scenes.length) {
    problems.push(`сцен в ответе ${scenes.length}, а в оригинале ${source.scenes.length} — переведи каждую сцену, ничего не объединяя и не добавляя`);
    return { ok: false, problems, warnings: [] };
  }
  const merged: ScriptScene[] = [];
  let same = 0;
  source.scenes.forEach((src, i) => {
    const t = scenes[i];
    const label = `сцена ${src.id}`;
    if (!isObj(t)) {
      problems.push(`${label}: ожидался объект сцены`);
      return;
    }
    if (str(t.id) && str(t.id) !== src.id) problems.push(`${label}: на её месте сцена с id «${str(t.id)}» — порядок и id как в оригинале`);
    if (!str(t.narration)) problems.push(`${label}: пустой narration`);
    if (!str(t.onScreen)) problems.push(`${label}: пустой onScreen`);
    if (src.items && (!Array.isArray(t.items) || t.items.length !== src.items.length)) problems.push(`${label}: в items нужно ${src.items.length} пункта(ов), как в оригинале`);
    if (src.stat && !str(t.statLabel)) problems.push(`${label}: нет statLabel — подписи к числу`);
    if (src.quiz && !str(t.quizExplanation)) problems.push(`${label}: нет quizExplanation — пояснения ответа`);
    if (src.chapter && !str(t.chapter)) problems.push(`${label}: нет chapter — названия главы`);
    if (src.compare && (!Array.isArray(t.compareLabels) || t.compareLabels.length !== src.compare.items.length)) {
      problems.push(`${label}: в compareLabels нужно ${src.compare.items.length} подписи, как в оригинале`);
    }
    for (const field of ["narration", "onScreen"] as const) {
      const text = str(t[field]);
      if (!text || !untranslated(target, src[field], text)) continue;
      if (!target.cyrillic) problems.push(`${label}: в ${field} осталась кириллица — переведи на ${target.name}`);
      else same++;
    }
    merged.push(mergeScene(src, t));
  });
  if (same > Math.max(1, source.scenes.length * 0.3)) problems.push(`${same} текстов совпадают с русским оригиналом — переведи их на ${target.name}`);
  if (!target.cyrillic && CYRILLIC.test(title)) problems.push(`title: осталась кириллица — переведи на ${target.name}`);
  if (problems.length) return { ok: false, problems, warnings: [] };

  const candidate: VideoScript = {
    ...source,
    title,
    description: typeof top.description === "string" ? top.description.trim() : "",
    tags: (top.tags as unknown[]).map(str).filter(Boolean),
    language: target.code,
    scenes: merged,
  };
  // Объём речи определяет длительность: Shorts не должен вылезти за минуту или сжаться вдвое.
  const was = narrationWords(source);
  const now = narrationWords(candidate);
  if (was > 0 && (now < was * 0.6 || now > was * 1.6)) {
    problems.push(`объём narration ${now} слов, в оригинале ${was} — ролик выйдет заметно ${now < was ? "короче" : "длиннее"}; переведи ближе к оригиналу по объёму`);
  }
  let script: VideoScript | null = null;
  try {
    script = validateScript(candidate);
  } catch (e) {
    if (!(e instanceof ScriptValidationError)) throw e;
    problems.push(...e.problems);
  }
  if (problems.length || !script) return { ok: false, problems, warnings: [] };
  return { ok: true, value: script, warnings: [] };
}

export interface ScriptTranslation {
  script: VideoScript;
  usage: LlmUsage[];
  servedBy: string | null;
}

export async function translateScript(script: VideoScript, lang: string, deps: ScriptDeps & { notes?: string } = {}): Promise<ScriptTranslation> {
  const info = langInfo(lang);
  if (info.code === script.language) throw new Error(`Сценарий уже на языке «${info.code}» — переводить нечего.`);
  const { chain, log } = makeChain(deps);
  const usage = new UsageBook();
  try {
    const res = await generateStructured({
      chain,
      system: buildScriptSystemPrompt(),
      user: buildScriptPrompt(script, info.code, deps.notes),
      schemaName: "script_translation",
      zodSchema: ScriptTextSchema,
      jsonSchema: toCompatJsonSchema(ScriptTextSchema),
      validate: (raw) => checkScriptTranslation(script, raw, info.code),
      what: `перевод сценария (${info.code})`,
      usage,
      log,
      signal: deps.signal,
      onCall: deps.onLlmCall,
      maxTokens: script.format === "shorts" ? 8192 : 32_000,
    });
    return { script: res.value, usage: usage.list(), servedBy: `${res.target.provider} · ${res.target.model}` };
  } catch (e) {
    throw new ScriptGenerationError(e instanceof Error ? e.message : String(e), usage.list(), e);
  }
}
