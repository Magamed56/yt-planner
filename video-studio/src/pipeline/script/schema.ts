// Zod-схемы сценария. Одна и та же схема служит трём целям: проверка JSON
// (своего или от LLM), генерация JSON Schema для response_format у
// OpenAI-совместимых провайдеров и output_config.format у Claude.
// Типы обязаны совпадать с src/types.ts — это проверяет компилятор ниже.

import { z } from "zod";
import { SCENE_KINDS, THEME_NAMES, type SceneKind, type ScriptScene, type ThemeName, type VideoScript } from "../../types";

// Пределы подобраны под раскладку сцен в композиции и лимиты YouTube
// (заголовок ≤ 100 символов, теги суммарно ≤ 500).
export const LIMITS = {
  title: 100,
  description: 5000,
  tagsMax: 30,
  tagLen: 60,
  tagsTotalChars: 500,
  scenesMin: 3,
  scenesMax: 90,
  narration: 700,
  onScreen: 90,
  onScreenWords: 8, // в промпте просим ≤ 7, жёсткая граница чуть шире
  itemsMin: 2,
  itemsMax: 4,
  item: 70,
  statLabel: 90,
  statAffix: 12,
  icon: 40,
  visualQuery: 80,
  imagePrompt: 500,
  hookWordsHard: 20, // в промпте ≤ 12; жёстко режем только явный перебор
  hookWordsSoft: 12,
} as const;

export const SceneStatSchema = z.object({
  value: z.number().describe("число без единиц измерения"),
  prefix: z.string().max(LIMITS.statAffix).optional().describe("знак перед числом: ≈, $, +"),
  suffix: z.string().max(LIMITS.statAffix).optional().describe("единицы после числа: %, ' млн', ×"),
  label: z.string().trim().min(1).max(LIMITS.statLabel).describe("подпись под числом, до 6 слов"),
});

export const ScriptSceneSchema = z.object({
  id: z.string().regex(/^s\d+$/).describe("s1, s2, … по порядку"),
  kind: z.enum(SCENE_KINDS as [SceneKind, ...SceneKind[]]),
  narration: z.string().trim().min(1).max(LIMITS.narration).describe("текст диктора по-русски, числа словами"),
  onScreen: z.string().trim().min(1).max(LIMITS.onScreen).describe("текст на экране, до 7 слов, одно *акцентное* слово"),
  items: z.array(z.string().trim().min(1).max(LIMITS.item)).min(LIMITS.itemsMin).max(LIMITS.itemsMax).optional().describe("только для list: 2–4 пункта"),
  stat: SceneStatSchema.optional().describe("только для stat"),
  icon: z.string().trim().min(1).max(LIMITS.icon).optional().describe("иконка lucide в kebab-case"),
  visualQuery: z.string().trim().min(1).max(LIMITS.visualQuery).optional().describe("ENGLISH stock search query, 2-4 concrete nouns"),
  imagePrompt: z.string().trim().min(1).max(LIMITS.imagePrompt).optional().describe("ENGLISH cinematic image prompt"),
});

export const VideoScriptSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  description: z.string().trim().min(1).max(LIMITS.description),
  tags: z.array(z.string().trim().min(1).max(LIMITS.tagLen)).max(LIMITS.tagsMax),
  language: z.string().trim().min(2).max(10),
  format: z.enum(["shorts", "landscape"]),
  theme: z.enum(THEME_NAMES as [ThemeName, ...ThemeName[]]).optional(),
  scenes: z.array(ScriptSceneSchema).min(LIMITS.scenesMin).max(LIMITS.scenesMax),
});

// Ответ для части длинного ролика: только сцены, id перенумеруем при склейке.
export const SceneChunkSchema = z.object({
  scenes: z.array(ScriptSceneSchema).min(1).max(40),
});

// План длинного ролика: сначала структура, потом сцены по разделам.
export const OutlineSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  description: z.string().trim().min(1).max(LIMITS.description),
  tags: z.array(z.string().trim().min(1).max(LIMITS.tagLen)).max(LIMITS.tagsMax),
  theme: z.enum(THEME_NAMES as [ThemeName, ...ThemeName[]]).optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(120).describe("заголовок раздела"),
        goal: z.string().trim().min(1).max(400).describe("что зритель поймёт в этом разделе"),
        points: z.array(z.string().trim().min(1).max(300)).min(1).max(8).describe("конкретные факты/шаги раздела"),
        seconds: z.number().describe("длительность раздела в секундах"),
      }),
    )
    .min(2)
    .max(14),
});

export type Outline = z.infer<typeof OutlineSchema>;
export type SceneChunk = z.infer<typeof SceneChunkSchema>;

// Компилятор следит, чтобы схема не разошлась с общим контрактом types.ts.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sceneMatches: Same<z.infer<typeof ScriptSceneSchema>, ScriptScene> = true;
const _scriptMatches: Same<z.infer<typeof VideoScriptSchema>, VideoScript> = true;
export const __schemaTypeChecks = [_sceneMatches, _scriptMatches] as const;

// ---- JSON Schema для response_format ----

// Gemini/Groq strict понимают только простое подмножество JSON Schema
// (см. research/llm.md): убираем pattern, format, длины строк и границы чисел —
// их всё равно проверяет zod после ответа. $ref не появляется: схемы без
// повторного использования объектов, zod встраивает всё по месту.
const DROP_KEYS = new Set([
  "$schema",
  "pattern",
  "format",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "default",
]);

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = k === "properties" && v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, simplify(pv)]))
      : simplify(v);
  }
  return out;
}

export function toCompatJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return simplify(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

// Для Claude structured outputs: по документации поддерживаются enum,
// required и additionalProperties:false, но не «сложные» ограничения массивов
// (minItems > 1, maxItems). Помощник SDK betaZodOutputFormat переносит в
// description ещё и enum — тогда kind/theme не были бы ограничены вовсе,
// поэтому схему собираем сами из той же zod-схемы.
function dropArrayBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropArrayBounds);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "maxItems") continue;
    if (k === "minItems" && typeof v === "number" && v > 1) continue;
    out[k] = k === "properties" && v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, dropArrayBounds(pv)]))
      : dropArrayBounds(v);
  }
  return out;
}

export function toClaudeJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return dropArrayBounds(toCompatJsonSchema(schema)) as Record<string, unknown>;
}
