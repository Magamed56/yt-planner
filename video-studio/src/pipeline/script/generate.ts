// Генерация сценария: Shorts — одним запросом; длинный ролик — сначала план,
// потом сцены по частям (так не упираемся в лимиты вывода бесплатных
// моделей: Groq 8K токенов/мин, OpenRouter :free и т.п.), затем склейка и
// общая проверка.
// Дополнительно (ScriptExtras): викторина «Правда или миф?» (quiz), «Разбор»
// с главами (long), проверка на повтор уже сказанного на канале (covered) и
// подсказки поиска YouTube для заголовка и тегов (searchPhrases).

import type { LlmUsage } from "../contracts";
import type { ScriptScene, VideoScript } from "../../types";
import { assignChapters, countChapters } from "./chapters";
import { ctaRepeat, indexCovered, recentCtas, RepeatGuard, type RecentCta } from "./covered";
import { resolveChain, type Env } from "./llm/chain";
import type { AnthropicLike } from "./llm/claude";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, envNumber, type FetchLike, type LlmTarget, type Logger } from "./llm/types";
import {
  buildChunkPrompt,
  buildOutlinePrompt,
  buildShortsPrompt,
  buildSystemPrompt,
  landscapePlan,
  LONG_DEFAULT_SECONDS,
  LONG_SCENES,
  QUIZ_ROUNDS_PLANNED,
  QUIZ_SILENCE_SEC,
  SHORTS_DEFAULT_SECONDS,
  shortsTargets,
  type ChunkSpec,
  type ScriptGenRequest,
} from "./prompt";
import { ClassicVideoScriptSchema, LIMITS, OutlineSchema, SceneChunkSchema, VideoScriptSchema, toCompatJsonSchema, type Outline } from "./schema";
import { suggestEnabled, suggestionsFor } from "./suggest";
import type { LlmCallInfo } from "./usage-log";
import {
  coerceMeta,
  coerceScene,
  coerceScriptCandidate,
  countWords,
  ctaProblems,
  formatZodIssues,
  lintScenes,
  lintScript,
  ScriptValidationError,
  SHORTS_RULES,
  shotLints,
  styleLints,
  trimCta,
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
  onLlmCall?: (call: LlmCallInfo) => void; // каждый запрос к LLM — для журнала расхода
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

const narrationWords = (scenes: unknown[]) =>
  scenes.reduce<number>((sum, s) => sum + (isObj(s) && typeof s.narration === "string" ? countWords(s.narration) : 0), 0);

// Сцены для проверки на повтор — из «сырого» кандидата (до схемы), чтобы
// повтор попал в тот же ремонтный запрос, что и остальные ошибки.
const looseScenes = (scenes: unknown[]): Pick<ScriptScene, "id" | "kind" | "narration" | "onScreen">[] =>
  scenes.filter(isObj).map((s, i) => ({
    id: typeof s.id === "string" ? s.id : `s${i + 1}`,
    kind: (typeof s.kind === "string" ? s.kind : "statement") as ScriptScene["kind"],
    narration: typeof s.narration === "string" ? s.narration : "",
    onScreen: typeof s.onScreen === "string" ? s.onScreen : "",
  }));

// Главы — только у «Разбора»: в Shorts их нет, лишнее поле от модели убираем.
function dropChapters(cand: unknown): unknown {
  if (isObj(cand) && Array.isArray(cand.scenes)) cand.scenes = cand.scenes.map((s) => (isObj(s) ? (({ chapter: _c, ...rest }) => rest)(s) : s));
  return cand;
}

const quizCount = (scenes: unknown[]) => scenes.filter((s) => isObj(s) && s.kind === "quiz").length;

// Строгие правила (объём ±15 %, финал) — только к ПЕРВОМУ ответу: он уходит в
// ремонт. Дальше небольшой промах — замечание или автоправка: иначе ответ
// бросали бы и шли к следующей (более слабой) модели, а то и падали совсем.
function firstPass(): () => boolean {
  let armed = true;
  return () => {
    const first = armed;
    armed = false;
    return first;
  };
}

// Финал: строго — в ремонт; после ремонта убираем «подпишись» и лишние фразы
// сами (сцена в кандидате правится на месте, до проверки схемой). Вопрос чуть
// длиннее 8 слов после ремонта — принимаем с замечанием.
function checkCta(scenes: unknown[], strict: boolean): { problems: string[]; notes: string[] } {
  const problems = ctaProblems(scenes);
  const last = scenes[scenes.length - 1];
  if (!problems.length || strict || !isObj(last)) return { problems, notes: [] };
  const before = typeof last.narration === "string" ? last.narration : "";
  const soft = trimCta(before, SHORTS_RULES.ctaWordsSoft);
  const fixed = trimCta(before) ?? (soft && /\?/.test(soft) ? soft : null);
  if (!fixed) return { problems, notes: [] };
  last.narration = fixed;
  const notes: string[] = [];
  if (fixed !== before) notes.push(`финал сокращён автоматически: «${before}» → «${fixed}» — проверь, что это вопрос по теме ролика`);
  const n = countWords(fixed);
  if (n > SHORTS_RULES.ctaWordsMax) notes.push(`финал «${fixed}» — ${n} слов, лучше до ${SHORTS_RULES.ctaWordsMax}: сократи до одного короткого вопроса по теме`);
  return { problems: [], notes };
}

// Финал повторяет прошлые ролики — замечание человеку (и подсказка в ремонт).
function ctaRepeatWarnings(scenes: unknown[], recent: RecentCta[]): string[] {
  const last = scenes[scenes.length - 1];
  if (!recent.length || !isObj(last) || last.kind !== "cta" || typeof last.narration !== "string") return [];
  const hit = ctaRepeat(last.narration, recent);
  const where = hit ? (hit.code ? `ролика ${hit.code}` : `ролика «${hit.title}»`) : "";
  return hit ? [`финал «${last.narration}» почти повторяет финал ${where} («${hit.cta}») — придумай свой вопрос по теме, иначе концовки на канале звучат одинаково`] : [];
}

// Замечания отклонённого ответа — в ремонтный запрос, без дублей с проблемами.
const softOnly = (warnings: string[], problems: string[]) => [...new Set(warnings)].filter((w) => !problems.includes(w));

// ---- Shorts ----

function shortsValidator(req: ScriptGenRequest, seconds: number, guard: RepeatGuard, recent: RecentCta[], accepted: string[]): (raw: unknown) => Verdict<VideoScript> {
  const isFirst = firstPass();
  return (raw) => {
    const strict = isFirst();
    const cand = dropChapters(coerceScriptCandidate(raw, req));
    const scenes = isObj(cand) && Array.isArray(cand.scenes) ? cand.scenes : [];
    const problems: string[] = [];
    const warnings: string[] = [];
    const cta = checkCta(scenes, strict);
    problems.push(...cta.problems);
    let script: VideoScript | null = null;
    try {
      script = validateScript(cand);
    } catch (e) {
      if (!(e instanceof ScriptValidationError)) throw e;
      problems.push(...e.problems);
    }
    // Пауза и вердикт викторины не озвучиваются — слова считаем без них.
    const voiceSeconds = Math.max(10, seconds - quizCount(scenes) * QUIZ_SILENCE_SEC);
    const t = shortsTargets(voiceSeconds);
    // Правила конкретного запроса: объём и число сцен под длительность.
    const words = narrationWords(scenes);
    const target = voiceSeconds * WORDS_PER_SECOND;
    const ratio = words / target;
    const { lengthTolerance: tol, lengthHard: hard } = SHORTS_RULES;
    // Нижняя граница 0.75 — всегда: короче — ролик выходит заметно короче заказанного
    // (запасная Flash-Lite любит сжимать), один ремонтный ход это исправляет.
    const offTarget = Math.abs(ratio - 1) > tol;
    if (scenes.length && (ratio < hard.min || ratio > hard.max || (strict && offTarget))) {
      // Лишний раунд викторины — ещё и 4,5 с тишины: проще убрать раунд, чем ужимать текст.
      const extraRound = quizCount(scenes) > QUIZ_ROUNDS_PLANNED && ratio > 1 ? ` — или оставь ${QUIZ_ROUNDS_PLANNED} раунда викторины` : "";
      problems.push(`общий объём narration ${words} слов — для ~${Math.round(voiceSeconds)} с нужно ${t.wordsMin}–${t.wordsMax} слов${extraRound}`);
    }
    if (scenes.length && (scenes.length < 4 || scenes.length > t.scenesMax + 5)) {
      problems.push(`сцен ${scenes.length} — нужно ${t.scenesMin}–${t.scenesMax}`);
    }
    if (req.quiz && scenes.length && quizCount(scenes) === 0) {
      problems.push('нет ни одной сцены kind "quiz" — нужен хотя бы один раунд «Правда или миф?» (сцена quiz с полем quiz, затем сцена-ответ)');
    }
    // Повтор уже сказанного на канале: первый раз — в ремонт, дальше — замечание.
    const rep = guard.check(looseScenes(scenes));
    problems.push(...rep.problems);
    warnings.push(...rep.warnings);
    // Кинорежим: одинаковые планы подряд, мелькание, фраза склейки мимо текста —
    // первый ответ в ремонт, после ремонта только замечание (оно и так в lintScript).
    if (req.cinematic && strict) {
      scenes.forEach((sc, i) => {
        if (isObj(sc) && Array.isArray(sc.shots)) problems.push(...shotLints(sc.shots.filter(isObj), typeof sc.narration === "string" ? sc.narration : "", `сцена №${i + 1}`));
      });
      problems.push(...styleLints(isObj(cand) ? cand.style : undefined));
    }
    if (problems.length || !script) {
      const soft = [...warnings, ...lintScenes(scenes, { format: "shorts", targetSeconds: voiceSeconds, cinematic: req.cinematic }), ...ctaRepeatWarnings(scenes, recent)];
      return { ok: false, problems, warnings: softOnly(soft, problems) };
    }
    guard.accept(rep.warnings);
    // Принят с промахом по объёму (уже после ремонта) — человеку стоит знать.
    const notes = [...cta.notes];
    if (offTarget) notes.push(`объём narration ${words} слов вместо ~${Math.round(target)} — ролик выйдет на ${Math.round(Math.abs(ratio - 1) * 100)} % ${ratio > 1 ? "длиннее" : "короче"} цели (~${Math.round(seconds)} с)`);
    accepted.push(...notes);
    return { ok: true, value: script, warnings: [...warnings, ...notes, ...lintScript(script)] };
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

function chunkValidator(spec: ChunkSpec, guard: RepeatGuard, accepted: string[]): (raw: unknown) => Verdict<ScriptScene[]> {
  const first = spec.index === 0;
  const last = spec.index === spec.count - 1;
  const what = `Часть ${spec.index + 1}`;
  const isFirst = firstPass();
  return (raw) => {
    const strict = isFirst();
    const top = Array.isArray(raw) ? { scenes: raw } : unwrap(raw, "scenes");
    let list = isObj(top) && Array.isArray(top.scenes) ? top.scenes.map((s, i) => coerceScene(s, i)) : null;
    if (!list) return { ok: false, problems: ['ожидался JSON-объект { "scenes": [...] }'], warnings: [] };
    if (!spec.chapters) list = (dropChapters({ scenes: list }) as { scenes: unknown[] }).scenes;
    // Финал — только в последней части (в остальных cta и так запрещён).
    const cta = last ? checkCta(list, strict) : { problems: [], notes: [] };
    const warnings = [...cta.notes, ...lintScenes(list, { format: "landscape" })];
    const problems: string[] = [...cta.problems];
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
    const rep = guard.check(looseScenes(list));
    problems.push(...rep.problems);
    warnings.push(...rep.warnings);
    if (problems.length) return { ok: false, problems, warnings: softOnly(warnings, problems) };
    guard.accept(rep.warnings);
    accepted.push(...cta.notes);
    // Главы: первая сцена каждого раздела; модель сбилась — по доле слов.
    return { ok: true, value: spec.chapters ? assignChapters(scenes, spec.sections) : scenes, warnings };
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

export interface ScriptResult {
  script: VideoScript;
  usage: LlmUsage[];
  warnings: string[]; // повторы уже сказанного, нехватка глав и т.п. — показать человеку
}

// Подсказки поиска — по мере возможности: нет сети или YT_SUGGEST=0 — без них.
async function loadSuggestions(req: ScriptGenRequest, env: Env, fetchImpl: FetchLike, log: Logger, signal?: AbortSignal): Promise<string[]> {
  if (req.suggestions) return req.suggestions;
  if (!req.searchPhrases?.length || !suggestEnabled(env)) return [];
  const list = await suggestionsFor(req.searchPhrases, { fetch: fetchImpl, timeoutMs: envNumber(env, "YT_SUGGEST_TIMEOUT_MS", 4000), signal, lang: req.language ?? "ru" });
  if (list.length) log.info(`[сценарий] подсказки поиска YouTube (${list.length}): ${list.slice(0, 5).map((s) => `«${s}»`).join(", ")}${list.length > 5 ? "…" : ""}`);
  return list;
}

export async function generateScript(req: ScriptGenRequest, deps: ScriptDeps = {}): Promise<ScriptResult> {
  if (!req.topic?.trim()) throw new Error("Не задана тема ролика (topic).");
  if (req.long && req.format !== "landscape") throw new Error("«Разбор» (long) — только горизонтальный формат: format = landscape.");
  if (req.quiz && req.format !== "shorts") throw new Error("Викторина (quiz) — только формат shorts.");
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
    const suggestions = await loadSuggestions(req, env, fetchImpl, log, deps.signal);
    return await generateWith({ ...req, suggestions }, chain, usage, log, deps.signal, deps.onLlmCall);
  } catch (e) {
    if (e instanceof ScriptGenerationError) throw e;
    throw new ScriptGenerationError(e instanceof Error ? e.message : String(e), usage.list(), e);
  }
}

async function generateWith(
  req: ScriptGenRequest,
  chain: LlmTarget[],
  usage: UsageBook,
  log: Logger,
  signal?: AbortSignal,
  onCall?: (call: LlmCallInfo) => void,
): Promise<ScriptResult> {
  const system = buildSystemPrompt();
  const base = { system, usage, log, signal, onCall };
  const coveredIndex = req.covered?.length ? indexCovered(req.covered) : null;
  // У Shorts — одна проверка повторов, у длинного ролика — своя на каждую часть.
  const guards: RepeatGuard[] = [];
  const newGuard = () => {
    const g = new RepeatGuard(coveredIndex);
    guards.push(g);
    return g;
  };
  const extraWarnings: string[] = [];
  // Автоправки и промахи, принятые после ремонта: в лог их уже вывел runner, здесь — в итог.
  const accepted: string[] = [];
  const recent = recentCtas(req.covered ?? []);

  let script: VideoScript;
  if (req.format === "shorts") {
    const seconds = req.targetSeconds ?? SHORTS_DEFAULT_SECONDS;
    // Для викторины цели по словам — без тишины раундов (её добавит ролик).
    const voiceSeconds = req.quiz ? Math.max(15, seconds - QUIZ_ROUNDS_PLANNED * QUIZ_SILENCE_SEC) : seconds;
    const { value } = await generateStructured({
      ...base,
      chain,
      user: buildShortsPrompt(req, shortsTargets(voiceSeconds)),
      schemaName: "video_script",
      // Обычный режим — прежняя схема без полей кино; кинорежим — с планами и стилем.
      zodSchema: req.cinematic ? VideoScriptSchema : ClassicVideoScriptSchema,
      jsonSchema: toCompatJsonSchema(req.cinematic ? VideoScriptSchema : ClassicVideoScriptSchema),
      validate: shortsValidator(req, seconds, newGuard(), recent, accepted),
      what: req.quiz ? "сценарий викторины" : req.cinematic ? "сценарий Shorts (кинорежим)" : "сценарий Shorts",
    });
    script = value;
  } else {
    const seconds = req.targetSeconds ?? (req.long ? LONG_DEFAULT_SECONDS : 480);
    const plan = landscapePlan(seconds);
    const outlineRes = await generateStructured({
      ...base,
      chain,
      user: buildOutlinePrompt(req, plan),
      schemaName: "video_outline",
      zodSchema: OutlineSchema,
      jsonSchema: toCompatJsonSchema(OutlineSchema),
      validate: outlineValidator(seconds),
      what: req.long ? "план «Разбора»" : "план ролика",
    });
    const outline = outlineRes.value;
    let current = rotateTo(chain, outlineRes.target);
    const groups = groupSections(outline.sections);
    const scenes: ScriptScene[] = [];
    let previousTail: string[] = [];
    let secondsLeft = groups.reduce((a, g) => a + g.items.reduce((b, s) => b + s.seconds, 0), 0);
    // «Разбор» — 25–45 сцен: делим меньший общий лимит, чем у обычного длинного ролика.
    const scenesTotal = req.long ? LONG_SCENES.max : LIMITS.scenesMax;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      const chunkSeconds = g.items.reduce((a, s) => a + s.seconds, 0);
      // Доля оставшегося лимита сцен пропорционально длительности части.
      const budgetLeft = scenesTotal - scenes.length;
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
        chapters: Boolean(req.long),
      };
      const res = await generateStructured({
        ...base,
        chain: current,
        user: buildChunkPrompt(req, outline, spec),
        schemaName: "video_scenes",
        zodSchema: SceneChunkSchema,
        jsonSchema: toCompatJsonSchema(SceneChunkSchema),
        validate: chunkValidator(spec, newGuard(), accepted),
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
    if (req.long) {
      const n = script.scenes.length;
      if (n < LONG_SCENES.min || n > LONG_SCENES.max) extraWarnings.push(`в «Разборе» ${n} сцен — задумано ${LONG_SCENES.min}–${LONG_SCENES.max}`);
      const ch = countChapters(script.scenes);
      if (ch < 3) extraWarnings.push(`глав ${ch} — YouTube показывает главы, только если их не меньше 3`);
    }
  }

  extraWarnings.push(...ctaRepeatWarnings(script.scenes, recent));

  const list = usage.list();
  const cost = list.reduce((a, u) => a + u.costUsd, 0);
  const words = narrationWords(script.scenes);
  // Длительность ролика: голос с паузами между сцен + тишина раундов викторины.
  const estSeconds = words / WORDS_PER_SECOND + quizCount(script.scenes) * QUIZ_SILENCE_SEC;
  log.info(
    `[сценарий] Готово: «${script.title}», ${script.scenes.length} сцен, ${words} слов (~${Math.round(estSeconds)} с)` +
      (cost > 0 ? `, стоимость ≈ $${cost.toFixed(4)}` : ", бесплатно"),
  );
  const warnings = [...new Set([...guards.flatMap((g) => g.warnings), ...accepted, ...extraWarnings])];
  for (const w of extraWarnings) log.info(`[сценарий] замечание: ${w}`);
  return { script, usage: list, warnings };
}
