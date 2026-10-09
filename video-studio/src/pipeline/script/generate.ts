// Генерация сценария: Shorts — одним запросом; длинный ролик — сначала план,
// потом сцены по частям (так не упираемся в лимиты вывода бесплатных
// моделей: Groq 8K токенов/мин, OpenRouter :free и т.п.), затем склейка и
// общая проверка.

import type { LlmUsage, ScriptRequest } from "../contracts";
import type { ScriptScene, VideoScript } from "../../types";
import { resolveChain, type Env } from "./llm/chain";
import type { AnthropicLike } from "./llm/claude";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, type FetchLike, type LlmTarget, type Logger } from "./llm/types";
import {
  buildChunkPrompt,
  buildOutlinePrompt,
  buildShortsPrompt,
  buildSystemPrompt,
  landscapePlan,
  shortsTargets,
  type ChunkSpec,
} from "./prompt";
import { LIMITS, OutlineSchema, SceneChunkSchema, VideoScriptSchema, toCompatJsonSchema, type Outline } from "./schema";
import {
  coerceMeta,
  coerceScene,
  coerceScriptCandidate,
  countWords,
  formatZodIssues,
  lintScenes,
  lintScript,
  ScriptValidationError,
  unwrap,
  validateScenes,
  validateScript,
  WORDS_PER_SECOND,
} from "./validate";

export interface ScriptDeps {
  env?: Env;
  fetch?: FetchLike; // подмена сети в тестах
  anthropic?: AnthropicLike; // подмена клиента Claude в тестах
  log?: Logger;
  signal?: AbortSignal;
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

const narrationWords = (scenes: unknown[]) =>
  scenes.reduce<number>((sum, s) => sum + (isObj(s) && typeof s.narration === "string" ? countWords(s.narration) : 0), 0);

// ---- Shorts ----

function shortsValidator(req: ScriptRequest, seconds: number): (raw: unknown) => Verdict<VideoScript> {
  const t = shortsTargets(seconds);
  return (raw) => {
    const cand = coerceScriptCandidate(raw, req);
    const scenes = isObj(cand) && Array.isArray(cand.scenes) ? cand.scenes : [];
    const problems: string[] = [];
    let script: VideoScript | null = null;
    try {
      script = validateScript(cand);
    } catch (e) {
      if (!(e instanceof ScriptValidationError)) throw e;
      problems.push(...e.problems);
    }
    // Правила конкретного запроса: объём и число сцен под длительность.
    const words = narrationWords(scenes);
    const target = seconds * WORDS_PER_SECOND;
    // Нижняя граница 0.75: короче — ролик выходит заметно короче заказанного
    // (запасная Flash-Lite любит сжимать), один ремонтный ход это исправляет.
    if (scenes.length && (words < target * 0.75 || words > target * 1.6)) {
      problems.push(`общий объём narration ${words} слов — для ~${seconds} с нужно ${t.wordsMin}–${t.wordsMax} слов`);
    }
    if (scenes.length && (scenes.length < 4 || scenes.length > t.scenesMax + 5)) {
      problems.push(`сцен ${scenes.length} — нужно ${t.scenesMin}–${t.scenesMax}`);
    }
    if (problems.length || !script) return { ok: false, problems, warnings: lintScenes(scenes, { format: "shorts", targetSeconds: seconds }) };
    return { ok: true, value: script, warnings: lintScript(script, { targetSeconds: seconds }) };
  };
}

// ---- Длинный ролик ----

function outlineValidator(seconds: number): (raw: unknown) => Verdict<Outline> {
  return (raw) => {
    const top = unwrap(raw, "sections");
    if (!isObj(top)) return { ok: false, problems: ["ожидался JSON-объект плана"], warnings: [] };
    const o = coerceMeta(top);
    if (Array.isArray(o.sections)) {
      o.sections = o.sections.map((s) => {
        if (!isObj(s)) return s;
        const sec = { ...s };
        if (typeof sec.points === "string") sec.points = sec.points.split(/\n|;/).map((p) => p.replace(/^\s*[-–•\d.)]+\s*/, "").trim()).filter(Boolean);
        const n = typeof sec.seconds === "string" ? Number.parseFloat(sec.seconds) : sec.seconds;
        sec.seconds = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
        return sec;
      });
    }
    const parsed = OutlineSchema.safeParse(o);
    if (!parsed.success) return { ok: false, problems: formatZodIssues(parsed.error, o, "sections"), warnings: [] };
    // Длительности разделов приводим к целевой сумме сами — это арифметика,
    // а не повод для ремонтного запроса.
    const sections = parsed.data.sections;
    const sum = sections.reduce((a, s) => a + (s.seconds > 0 ? s.seconds : 0), 0);
    const even = seconds / sections.length;
    const scaled = sections.map((s) => ({ ...s, seconds: sum > 0 && s.seconds > 0 ? (s.seconds / sum) * seconds : even }));
    return { ok: true, value: { ...parsed.data, sections: scaled }, warnings: [] };
  };
}

function chunkValidator(spec: ChunkSpec): (raw: unknown) => Verdict<ScriptScene[]> {
  const first = spec.index === 0;
  const last = spec.index === spec.count - 1;
  const what = `Часть ${spec.index + 1}`;
  return (raw) => {
    const top = Array.isArray(raw) ? { scenes: raw } : unwrap(raw, "scenes");
    const list = isObj(top) && Array.isArray(top.scenes) ? top.scenes.map((s, i) => coerceScene(s, i)) : null;
    if (!list) return { ok: false, problems: ['ожидался JSON-объект { "scenes": [...] }'], warnings: [] };
    const warnings = lintScenes(list, { format: "landscape" });
    const problems: string[] = [];
    let scenes: ScriptScene[] = [];
    try {
      scenes = validateScenes(list, { hookFirst: first, ctaLast: last, allowHook: first, allowCta: last, checkIds: false }, what);
    } catch (e) {
      if (!(e instanceof ScriptValidationError)) throw e;
      problems.push(...e.problems);
    }
    // Общий лимит сцен ролика (90) делится между частями заранее: иначе у
    // ролика от ~16 мин части в сумме перебирали лимит, и всё падало только
    // на финальной склейке — после того как все запросы к LLM уже потрачены.
    if (spec.scenesBudget !== undefined && list.length > spec.scenesBudget) {
      problems.push(`в части ${list.length} сцен — нужно не больше ${spec.scenesBudget} (общий лимит ролика — ${LIMITS.scenesMax} сцен): объедини соседние короткие сцены`);
    }
    const words = narrationWords(list);
    const target = spec.seconds * WORDS_PER_SECOND;
    if (words < target * 0.5 || words > target * 1.8) {
      problems.push(`объём части ${words} слов — для ~${Math.round(spec.seconds)} с нужно около ${Math.round(target)}`);
    }
    if (problems.length) return { ok: false, problems, warnings };
    return { ok: true, value: scenes, warnings };
  };
}

// Разделы → части примерно по 170 с: 2 раздела по ~80 с на запрос — это
// ~4–5 тысяч токенов ответа, влезает в лимиты бесплатных моделей.
function groupSections(sections: Outline["sections"], maxSeconds = 170): { from: number; items: Outline["sections"] }[] {
  const out: { from: number; items: Outline["sections"] }[] = [];
  let cur: Outline["sections"] = [];
  let curSec = 0;
  let from = 0;
  sections.forEach((s, i) => {
    if (cur.length > 0 && curSec + s.seconds > maxSeconds) {
      out.push({ from, items: cur });
      cur = [];
      curSec = 0;
      from = i;
    }
    cur.push(s);
    curSec += s.seconds;
  });
  if (cur.length) out.push({ from, items: cur });
  return out;
}

// После успеха следующую часть начинаем с той же модели: незачем снова
// упираться в 429 у первой.
const rotateTo = (chain: LlmTarget[], t: LlmTarget) => {
  const i = chain.indexOf(t);
  return i > 0 ? [...chain.slice(i), ...chain.slice(0, i)] : chain;
};

// ---- Точка входа ----

// Неудача генерации вместе с уже потраченным: платный Claude мог ответить
// дважды (запрос + ремонт) до того, как всё упало, — CLI печатает расход и
// при ошибке, а не только при успехе.
export class ScriptGenerationError extends Error {
  readonly usage: LlmUsage[];
  constructor(message: string, usage: LlmUsage[], cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ScriptGenerationError";
    this.usage = usage;
  }
}

export async function generateScript(req: ScriptRequest, deps: ScriptDeps = {}): Promise<{ script: VideoScript; usage: LlmUsage[] }> {
  if (!req.topic?.trim()) throw new Error("Не задана тема ролика (topic).");
  const env = deps.env ?? process.env;
  const log = deps.log ?? consoleLogger;
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const chain = resolveChain({ env, fetch: fetchImpl, anthropic: deps.anthropic, log });
  if (chain.length === 0) {
    throw new Error(
      "Нет ни одной доступной LLM для сценария. Задайте, например, GEMINI_API_KEY (бесплатно: https://aistudio.google.com/app/apikey), " +
        "или GROQ_API_KEY / OPENROUTER_API_KEY, или LLM_PROVIDER=ollama для локальной модели.",
    );
  }
  const usage = new UsageBook();
  try {
    return await generateWith(req, chain, usage, log, deps.signal);
  } catch (e) {
    if (e instanceof ScriptGenerationError) throw e;
    throw new ScriptGenerationError(e instanceof Error ? e.message : String(e), usage.list(), e);
  }
}

async function generateWith(req: ScriptRequest, chain: LlmTarget[], usage: UsageBook, log: Logger, signal?: AbortSignal): Promise<{ script: VideoScript; usage: LlmUsage[] }> {
  const system = buildSystemPrompt();
  const base = { system, usage, log, signal };

  let script: VideoScript;
  if (req.format === "shorts") {
    const seconds = req.targetSeconds ?? 45;
    const { value } = await generateStructured({
      ...base,
      chain,
      user: buildShortsPrompt(req, shortsTargets(seconds)),
      schemaName: "video_script",
      zodSchema: VideoScriptSchema,
      jsonSchema: toCompatJsonSchema(VideoScriptSchema),
      validate: shortsValidator(req, seconds),
      what: "сценарий Shorts",
    });
    script = value;
  } else {
    const seconds = req.targetSeconds ?? 480;
    const plan = landscapePlan(seconds);
    const outlineRes = await generateStructured({
      ...base,
      chain,
      user: buildOutlinePrompt(req, plan),
      schemaName: "video_outline",
      zodSchema: OutlineSchema,
      jsonSchema: toCompatJsonSchema(OutlineSchema),
      validate: outlineValidator(seconds),
      what: "план ролика",
    });
    const outline = outlineRes.value;
    let current = rotateTo(chain, outlineRes.target);
    const groups = groupSections(outline.sections);
    const scenes: ScriptScene[] = [];
    let previousTail: string[] = [];
    let secondsLeft = groups.reduce((a, g) => a + g.items.reduce((b, s) => b + s.seconds, 0), 0);
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      const chunkSeconds = g.items.reduce((a, s) => a + s.seconds, 0);
      // Доля оставшегося лимита сцен пропорционально длительности части.
      const budgetLeft = LIMITS.scenesMax - scenes.length;
      const scenesBudget = Math.max(1, Math.floor((budgetLeft * chunkSeconds) / Math.max(chunkSeconds, secondsLeft)));
      secondsLeft -= chunkSeconds;
      const spec: ChunkSpec = {
        index: k,
        count: groups.length,
        sections: g.items,
        sectionOffset: g.from,
        seconds: chunkSeconds,
        previousTail,
        scenesBudget,
      };
      const res = await generateStructured({
        ...base,
        chain: current,
        user: buildChunkPrompt(req, outline, spec),
        schemaName: "video_scenes",
        zodSchema: SceneChunkSchema,
        jsonSchema: toCompatJsonSchema(SceneChunkSchema),
        validate: chunkValidator(spec),
        what: `часть ${k + 1} из ${groups.length}`,
      });
      current = rotateTo(current, res.target);
      scenes.push(...res.value);
      previousTail = res.value.slice(-2).map((s) => s.narration);
    }
    const merged = coerceScriptCandidate(
      {
        title: outline.title,
        description: outline.description,
        tags: outline.tags,
        language: req.language ?? "ru",
        format: "landscape",
        theme: outline.theme,
        scenes,
      },
      req,
    );
    script = validateScript(merged); // id перенумерованы в coerceScene
    for (const w of lintScript(script, { targetSeconds: seconds })) log.info(`[сценарий] замечание: ${w}`);
  }

  const list = usage.list();
  const cost = list.reduce((a, u) => a + u.costUsd, 0);
  const words = narrationWords(script.scenes);
  log.info(
    `[сценарий] Готово: «${script.title}», ${script.scenes.length} сцен, ${words} слов (~${Math.round(words / WORDS_PER_SECOND)} с)` +
      (cost > 0 ? `, стоимость ≈ $${cost.toFixed(4)}` : ", бесплатно"),
  );
  return { script, usage: list };
}
