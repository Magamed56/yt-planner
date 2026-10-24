// Zod-схемы сценария. Одна и та же схема служит трём целям: проверка JSON
// (своего или от LLM), генерация JSON Schema для response_format у
// OpenAI-совместимых провайдеров и output_config.format у Claude.
// Типы обязаны совпадать с src/types.ts — это проверяет компилятор ниже.

import { z } from "zod";
import {
  CAMERA_MOVES,
  SCENE_KINDS,
  SHOT_FRAMINGS,
  SHOT_LIMITS,
  THEME_NAMES,
  type CameraMove,
  type SceneKind,
  type ScriptScene,
  type ShotFraming,
  type ThemeName,
  type VideoScript,
} from "../../types";

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
  quizExplanation: 120, // пояснение под вердиктом (в промпте — до 12 слов)
  quizQuestion: 80,
  chapter: 60, // название главы: карточка в ролике и строка таймкода в описании
  shotPrompt: 1200, // полный промпт плана: герой с приметами, действие, место, свет, объектив, композиция
  shotSubject: 60,
  shotBeat: 120,
  styleField: 300,
  calloutLabel: 32,
  calloutTarget: 80,
  realQuery: 80, // shot.footage / shot.photo — запрос к стокам и архивам
  stickerText: 12,
  characterName: 40,
  characterLook: 300,
} as const;

export const SceneStatSchema = z.object({
  value: z.number().describe("число без единиц измерения"),
  prefix: z.string().max(LIMITS.statAffix).optional().describe("знак перед числом: ≈, $, +"),
  suffix: z.string().max(LIMITS.statAffix).optional().describe("единицы после числа: %, ' млн', ×"),
  label: z.string().trim().min(1).max(LIMITS.statLabel).describe("подпись под числом, до 6 слов"),
});

// ---- Карта и сравнение (необязательные поля сцены, см. SceneMap/SceneCompare в types.ts) ----
export const SceneMapSchema = z.object({
  lat: z.number().min(-90).max(90).describe("широта места"),
  lon: z.number().min(-180).max(180).describe("долгота места"),
  label: z.string().trim().min(1).max(40).describe("подпись метки по-русски, 1–3 слова"),
  zoom: z.enum(["world", "region", "city"]).optional().describe("world — страна/континент, region — область, city — город"),
});

export const SceneCompareSchema = z.object({
  items: z
    .array(z.object({ label: z.string().trim().min(1).max(40).describe("что сравниваем, 1–3 слова"), value: z.number().describe("число без единиц") }))
    .min(2)
    .max(4),
  suffix: z.string().max(LIMITS.statAffix).optional().describe("единицы после числа: ' лет', '%'"),
});
// ---- конец: карта и сравнение ----

// ---- Кинорежим (SceneShot / VisualStyle в types.ts) ----
export const SceneShotSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.shotPrompt)
    .describe("COMPLETE ENGLISH image prompt in prose: hero with exact look, action, one location, light, lens, composition; no negations, no text in frame"),
  seconds: z.number().min(SHOT_LIMITS.minSec).max(SHOT_LIMITS.maxSec).optional().describe("желаемая длина плана в секундах"),
  framing: z.enum(SHOT_FRAMINGS as [ShotFraming, ...ShotFraming[]]).optional().describe("крупность или ракурс плана"),
  camera: z.enum(CAMERA_MOVES as [CameraMove, ...CameraMove[]]).optional().describe("движение камеры"),
  subject: z.string().trim().min(1).max(LIMITS.shotSubject).optional().describe("ENGLISH name of the hero or object in frame, the same in every shot"),
  beat: z.string().trim().min(1).max(LIMITS.shotBeat).optional().describe("первые 1–3 слова narration, на которых начинается план"),
  reuse: z
    .string()
    .regex(/^s\d+-k\d+$/)
    .optional()
    .describe("id более раннего плана (s2-k1): показать его кадр ещё раз с другим движением камеры, без новой картинки"),
  callouts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(LIMITS.calloutLabel).describe("подпись по-русски, 1–3 слова"),
        target: z.string().trim().min(1).max(LIMITS.calloutTarget).describe("ENGLISH: the object in the image to point at"),
        beat: z.string().trim().min(1).max(LIMITS.shotBeat).optional().describe("слова narration, на которых появляется подпись"),
      }),
    )
    .max(SHOT_LIMITS.callouts)
    .optional()
    .describe("подписи со стрелкой к предметам в кадре"),
  sticker: z
    .object({
      text: z.string().trim().min(1).max(LIMITS.stickerText).describe("крупная цифра или дата: 1932, ×10"),
      beat: z.string().trim().min(1).max(LIMITS.shotBeat).optional().describe("слова narration, на которых она появляется"),
    })
    .optional()
    .describe("крупная цифра поверх кадра"),
  footage: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.realQuery)
    .optional()
    .describe("ENGLISH 2–6 words: real stock video to search instead of a drawing (place, nature, process); not found — the image by prompt"),
  photo: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.realQuery)
    .optional()
    .describe("ENGLISH 2–6 words: real archive photo (Wikimedia Commons) of a real person, object or event; not found — the image by prompt"),
});

const styleField = (about: string) => z.string().trim().min(1).max(LIMITS.styleField).optional().describe(about);
export const VisualStyleSchema = z.object({
  direction: styleField("ENGLISH art direction"),
  lighting: styleField("ENGLISH lighting"),
  palette: styleField("ENGLISH color palette"),
  realism: styleField("ENGLISH degree of realism"),
  mood: styleField("ENGLISH mood"),
  environment: styleField("ENGLISH recurring environment"),
  world: styleField("ENGLISH: the one world of the video — place, era, season, weather"),
  look: styleField("ENGLISH: camera, lens, film stock, light and color of every shot"),
  characters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(LIMITS.characterName),
        look: z.string().trim().min(1).max(LIMITS.characterLook).describe("ENGLISH fixed appearance, repeated word for word in every prompt"),
      }),
    )
    .max(4)
    .optional()
    .describe("сквозные герои ролика"),
});
// ---- конец: кинорежим ----

export const ScriptSceneSchema = z.object({
  id: z.string().regex(/^s\d+$/).describe("s1, s2, … по порядку"),
  kind: z.enum(SCENE_KINDS as [SceneKind, ...SceneKind[]]),
  narration: z.string().trim().min(1).max(LIMITS.narration).describe("текст диктора по-русски, числа словами"),
  onScreen: z.string().trim().min(1).max(LIMITS.onScreen).describe("текст на экране, до 7 слов, одно *акцентное* слово"),
  items: z.array(z.string().trim().min(1).max(LIMITS.item)).min(LIMITS.itemsMin).max(LIMITS.itemsMax).optional().describe("только для list: 2–4 пункта"),
  stat: SceneStatSchema.optional().describe("только для stat"),
  icon: z.string().trim().min(1).max(LIMITS.icon).optional().describe("иконка lucide в kebab-case"),
  visualQuery: z.string().trim().min(1).max(LIMITS.visualQuery).optional().describe("ENGLISH photo search query, 2-5 concrete nouns, main subject first (its real Wikipedia name if the scene is about a real object or place)"),
  imagePrompt: z.string().trim().min(1).max(LIMITS.imagePrompt).optional().describe("ENGLISH cinematic image prompt"),
  quiz: z
    .object({
      answer: z.enum(["truth", "myth"]).describe("truth — утверждение верно, myth — это миф"),
      explanation: z.string().trim().min(1).max(LIMITS.quizExplanation).describe("пояснение на экране после вердикта, до 12 слов"),
      question: z.string().trim().min(1).max(LIMITS.quizQuestion).optional().describe("вопрос зрителю для комментариев, до 8 слов"),
      pauseSec: z.number().optional().describe("пауза на раздумье, 3–5 с"),
    })
    .optional()
    .describe("только для quiz"),
  chapter: z.string().trim().min(1).max(LIMITS.chapter).optional().describe("название главы — у первой сцены каждой главы длинного ролика"),
  map: SceneMapSchema.optional().describe("место на карте (необязательно)"),
  compare: SceneCompareSchema.optional().describe("сравнение 2–4 чисел столбиками (необязательно)"),
  shots: z.array(SceneShotSchema).min(1).max(SHOT_LIMITS.perScene).optional().describe("кинорежим: планы сцены по порядку"),
});

export const VideoScriptSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  description: z.string().trim().min(1).max(LIMITS.description),
  tags: z.array(z.string().trim().min(1).max(LIMITS.tagLen)).max(LIMITS.tagsMax),
  language: z.string().trim().min(2).max(10),
  format: z.enum(["shorts", "landscape"]),
  theme: z.enum(THEME_NAMES as [ThemeName, ...ThemeName[]]).optional(),
  scenes: z.array(ScriptSceneSchema).min(LIMITS.scenesMin).max(LIMITS.scenesMax),
  mode: z.enum(["infographic", "cinematic"]).optional().describe("cinematic — кинорежим: планы shots и общий style"),
  style: VisualStyleSchema.optional().describe("общий стиль AI-кадров ролика"),
  shotPrompts: z.enum(["complete"]).optional().describe("служебное: промпты планов полные"),
});

// Ответ модели в обычном режиме — без полей кинорежима: JSON Schema, которую
// видит модель, остаётся прежней, и планы она не выдумывает.
export const ClassicSceneSchema = ScriptSceneSchema.omit({ shots: true });
export const ClassicVideoScriptSchema = VideoScriptSchema.omit({ mode: true, style: true, shotPrompts: true }).extend({
  scenes: z.array(ClassicSceneSchema).min(LIMITS.scenesMin).max(LIMITS.scenesMax),
});

// Ответ для части длинного ролика: только сцены, id перенумеруем при склейке.
export const SceneChunkSchema = z.object({
  scenes: z.array(ClassicSceneSchema).min(1).max(40),
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

// Кинорежим «Разбора»: план несёт «библию» ролика (style), части — сцены с планами shots.
export const CinematicOutlineSchema = OutlineSchema.extend({ style: VisualStyleSchema });
export const CinematicChunkSchema = z.object({
  scenes: z.array(ScriptSceneSchema).min(1).max(40),
});

export type Outline = z.infer<typeof OutlineSchema> & { style?: z.infer<typeof VisualStyleSchema> };
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
