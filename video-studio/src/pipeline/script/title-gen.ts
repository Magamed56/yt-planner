// Новые названия для ролика со слабым стартом: 3–5 вариантов от той же цепочки LLM, что
// пишет сценарии (LLM_PROVIDER, запасные модели, журнал расхода через onLlmCall). Опора —
// тема плана (хук, угол), нынешнее название и подсказки поиска YouTube (как формулируют зрители).

import { z } from "zod";
import type { LlmUsage } from "../contracts";
import { IDEAS_MAX, IDEAS_MIN, TITLE_MAX, cleanTitle, titleProblem, usableIdeas } from "../title-ideas";
import type { ScriptDeps } from "./generate";
import { resolveChain } from "./llm/chain";
import { generateStructured, UsageBook, type Verdict } from "./llm/runner";
import { consoleLogger, type FetchLike, type Logger } from "./llm/types";
import { toCompatJsonSchema } from "./schema";

const TitleIdeasSchema = z.object({
  ideas: z
    .array(z.string().trim().min(1).max(160).describe(`новое название ролика по-русски, до ${TITLE_MAX} символов (лучше до 70)`))
    .min(IDEAS_MIN)
    .max(IDEAS_MAX + 2),
});

export interface TitleGenInput {
  code: string;
  current: string; // нынешнее название на YouTube
  topic: { title: string; hook: string; angle: string; pillarTitle: string | null } | null;
  description: string | null; // описание ролика (первые строки — о чём он)
  suggestions: string[]; // подсказки поиска YouTube по теме
  channel: { name: string | null; audience: string | null };
}

export function buildTitleSystemPrompt(): string {
  return [
    "Ты — редактор YouTube Shorts познавательного канала на русском языке.",
    "Задача: придумать новые названия для уже вышедшего ролика, который плохо стартовал.",
    "Правила названия:",
    `- до ${TITLE_MAX} символов, лучше 40–70: в ленте Shorts видно начало;`,
    "- сразу понятно, о чём ролик: главный предмет темы — в первых словах;",
    "- интрига без обмана: обещай только то, что ролик действительно объясняет (по хуку и углу);",
    "- живой разговорный русский; без КАПСА, эмодзи, хэштегов, кавычек-ёлочек вокруг всего названия и символов «<» «>»;",
    "- варианты — разные приёмы: вопрос «Почему…», парадокс, конкретное число или факт, «ты»-обращение, неожиданное сравнение;",
    "- если подсказка поиска YouTube точно про эту тему — используй её формулировку в одном-двух вариантах;",
    "- не повторяй нынешнее название и не меняй в нём одно слово.",
    `Ответ — только JSON: {"ideas": ["…", "…"]}, от ${IDEAS_MIN} до ${IDEAS_MAX} вариантов, лучший — первым.`,
  ].join("\n");
}

export function buildTitleUserPrompt(input: TitleGenInput): string {
  const lines: string[] = [];
  if (input.channel.name) lines.push(`Канал: «${input.channel.name}».`);
  if (input.channel.audience) lines.push(`Аудитория: ${input.channel.audience}`);
  lines.push(`Ролик ${input.code}. Нынешнее название: «${input.current}».`);
  if (input.topic) {
    if (input.topic.pillarTitle) lines.push(`Рубрика: ${input.topic.pillarTitle}.`);
    if (input.topic.title && input.topic.title !== input.current) lines.push(`Тема в плане: ${input.topic.title}.`);
    if (input.topic.hook) lines.push(`Первая фраза ролика (хук): ${input.topic.hook}`);
    if (input.topic.angle) lines.push(`О чём ролик и развязка: ${input.topic.angle}`);
  }
  const about = (input.description ?? "").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")).slice(0, 2).join(" ");
  if (about) lines.push(`Описание: ${about.slice(0, 400)}`);
  if (input.suggestions.length) lines.push(`Подсказки поиска YouTube по теме (как ищут зрители): ${input.suggestions.slice(0, 10).map((s) => `«${s}»`).join(", ")}.`);
  lines.push(`Ролик набирает заметно меньше просмотров, чем обычно у канала. Предложи ${IDEAS_MIN}–${IDEAS_MAX} новых названий.`);
  return lines.join("\n");
}

// Проверка ответа: чистим кавычки и пробелы, отбрасываем повторы и нынешнее название.
// Длинные — ошибка для ремонтного запроса, но если годных набралось достаточно, берём их.
export function checkTitleIdeas(raw: unknown, current: string): Verdict<string[]> {
  const parsed = TitleIdeasSchema.safeParse(raw);
  const list: unknown[] = parsed.success ? parsed.data.ideas : Array.isArray((raw as { ideas?: unknown } | null)?.ideas) ? (raw as { ideas: unknown[] }).ideas : [];
  const ideas = usableIdeas(list, current).slice(0, IDEAS_MAX);
  const problems: string[] = [];
  for (const x of list) {
    if (typeof x !== "string") continue;
    const why = titleProblem(cleanTitle(x));
    if (why) problems.push(`«${String(x).slice(0, 120)}»: ${why}`);
  }
  const warnings = problems.length ? [`отброшено вариантов: ${problems.length}`] : [];
  if (ideas.length >= IDEAS_MIN) return { ok: true, value: ideas, warnings };
  if (!list.length) problems.unshift(`нужен объект {"ideas": [${IDEAS_MIN}–${IDEAS_MAX} строк]}`);
  problems.push(`годных вариантов ${ideas.length}, нужно от ${IDEAS_MIN} до ${IDEAS_MAX}: разные, не как нынешнее «${current}», до ${TITLE_MAX} символов, без «<» и «>»`);
  return { ok: false, problems, warnings };
}

export interface TitleGenResult {
  ideas: string[];
  model: string;
  usage: LlmUsage[];
}

export async function generateTitleIdeas(input: TitleGenInput, deps: ScriptDeps = {}): Promise<TitleGenResult> {
  const env = deps.env ?? process.env;
  const log: Logger = deps.log ?? consoleLogger;
  const fetchImpl: FetchLike = deps.fetch ?? ((i, init) => fetch(i, init));
  const chain = resolveChain({ env, fetch: fetchImpl, anthropic: deps.anthropic, log });
  if (!chain.length) throw new Error("Нет ни одной доступной LLM. Задайте GEMINI_API_KEY (бесплатно: https://aistudio.google.com/app/apikey) или ANTHROPIC_API_KEY.");
  const usage = new UsageBook();
  const res = await generateStructured({
    chain,
    system: buildTitleSystemPrompt(),
    user: buildTitleUserPrompt(input),
    schemaName: "title_ideas",
    zodSchema: TitleIdeasSchema,
    jsonSchema: toCompatJsonSchema(TitleIdeasSchema),
    validate: (raw) => checkTitleIdeas(raw, input.current),
    what: `названия для ${input.code}`,
    usage,
    log,
    maxTokens: 2000,
    signal: deps.signal,
    onCall: deps.onLlmCall,
  });
  return { ideas: res.value, model: res.target.model, usage: usage.list() };
}
