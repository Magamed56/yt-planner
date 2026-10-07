// Проверка сценария: zod-схема + правила структуры, которые схемой не
// выразить (хук первым, cta последним, id по порядку, не больше одного
// акцента и т.д.). Все проблемы собираются в один список по-русски — его же
// отправляем модели в «ремонтный» запрос, поэтому формулировки конкретные.

import type { z } from "zod";
import type { Format, ScriptRequest } from "../contracts";
import { SCENE_KINDS, THEME_NAMES, type SceneKind, type ScriptScene, type VideoScript } from "../../types";
import { LIMITS, ScriptSceneSchema, VideoScriptSchema } from "./schema";

export class ScriptValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[], what = "Сценарий") {
    super(`${what} не прошёл проверку (${problems.length} ${plural(problems.length, "проблема", "проблемы", "проблем")}):\n- ${problems.join("\n- ")}`);
    this.name = "ScriptValidationError";
    this.problems = problems;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const CYRILLIC = /[Ѐ-ӿ]/;
// Слово — токен, в котором есть буква или цифра («—» и «*» словами не считаются).
export const countWords = (s: string): number => s.replace(/\*/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// ---- Сообщения zod по-русски ----

function getAt(root: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[k];
  }
  return cur;
}

function describePath(root: unknown, path: PropertyKey[], scenesKey = "scenes"): string {
  if (path.length === 0) return "корень JSON";
  if (path[0] === scenesKey && typeof path[1] === "number") {
    const id = str(getAt(root, [scenesKey, path[1], "id"]));
    const rest = path.slice(2).map(String).join(".");
    return `сцена №${path[1] + 1}${id ? ` (${id})` : ""}${rest ? `, поле ${rest}` : ""}`;
  }
  return `поле ${path.map(String).join(".")}`;
}

const TYPE_RU: Record<string, string> = {
  string: "строкой",
  number: "числом",
  array: "массивом",
  object: "объектом",
  boolean: "true/false",
};

// Размер items и пустой narration точнее описывают правила структуры ниже —
// одинаковые сообщения от zod не дублируем.
const coveredByRules = (issue: z.core.$ZodIssue): boolean =>
  (issue.path[issue.path.length - 1] === "items" && (issue.code === "too_small" || issue.code === "too_big"));

export function formatZodIssues(error: z.ZodError, root: unknown, scenesKey = "scenes"): string[] {
  return error.issues.filter((i) => !coveredByRules(i)).map((issue) => {
    const where = describePath(root, issue.path, scenesKey);
    const value = getAt(root, issue.path);
    switch (issue.code) {
      case "invalid_type":
        if (value === undefined) return `${where}: обязательное поле отсутствует`;
        return `${where}: должно быть ${TYPE_RU[issue.expected] ?? issue.expected}${value === null ? " (сейчас null)" : ""}`;
      case "too_small":
        if (issue.origin === "string") return `${where}: пустая строка`;
        if (issue.origin === "array") return `${where}: нужно минимум ${String(issue.minimum)} элемент(ов)`;
        return `${where}: значение меньше ${String(issue.minimum)}`;
      case "too_big":
        if (issue.origin === "string") return `${where}: слишком длинно (больше ${String(issue.maximum)} символов)`;
        if (issue.origin === "array") return `${where}: слишком много элементов (максимум ${String(issue.maximum)})`;
        return `${where}: значение больше ${String(issue.maximum)}`;
      case "invalid_value":
        return `${where}: недопустимое значение ${JSON.stringify(value)}; допустимо: ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`;
      case "invalid_format":
        return `${where}: неверный формат ${JSON.stringify(value)}`;
      default:
        return `${where}: ${issue.message}`;
    }
  });
}

// ---- Правила структуры ----

export interface SceneRuleOptions {
  hookFirst: boolean; // первая сцена обязана быть hook
  ctaLast: boolean; // последняя обязана быть cta
  allowHook: boolean; // hook допустим только первым (для частей длинного ролика — вообще нельзя)
  allowCta: boolean;
  checkIds: boolean;
}

// Работает на «сыром» JSON, чтобы показать все проблемы сразу, даже когда
// zod уже нашёл ошибки типов.
export function checkSceneRules(scenes: unknown[], opts: SceneRuleOptions): string[] {
  const out: string[] = [];
  const n = scenes.length;
  scenes.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const id = str(raw.id);
    const label = `сцена №${i + 1}${id ? ` (${id})` : ""}`;
    const kind = str(raw.kind) as SceneKind;

    if (opts.checkIds && id !== `s${i + 1}`) out.push(`${label}: id должен быть "s${i + 1}" (id идут по порядку s1…sN)`);

    if (i === 0 && opts.hookFirst && kind !== "hook") out.push(`${label}: первая сцена должна иметь kind "hook" (сейчас "${kind}")`);
    if (kind === "hook" && (!opts.allowHook || i !== 0)) out.push(`${label}: kind "hook" допустим только у самой первой сцены ролика`);
    if (i === n - 1 && opts.ctaLast && kind !== "cta") out.push(`${label}: последняя сцена должна иметь kind "cta" (сейчас "${kind}")`);
    if (kind === "cta" && (!opts.allowCta || i !== n - 1)) out.push(`${label}: kind "cta" допустим только у последней сцены ролика`);

    if (kind === "stat") {
      const stat = raw.stat;
      if (!isObj(stat)) out.push(`${label}: для kind "stat" обязательно поле stat {value, label}`);
      else if (typeof stat.value !== "number" || !Number.isFinite(stat.value)) out.push(`${label}: stat.value должно быть числом`);
    }
    if (kind === "list") {
      const items = raw.items;
      if (!Array.isArray(items)) out.push(`${label}: для kind "list" обязательно поле items (2–4 пункта)`);
      else if (items.length < LIMITS.itemsMin || items.length > LIMITS.itemsMax) out.push(`${label}: в items должно быть от 2 до 4 пунктов (сейчас ${items.length})`);
    }
    if (kind === "media" && !str(raw.visualQuery).trim() && !str(raw.imagePrompt).trim()) {
      out.push(`${label}: для kind "media" нужен visualQuery или imagePrompt`);
    }

    const narration = str(raw.narration);
    if (kind === "hook" && countWords(narration) > LIMITS.hookWordsHard) {
      out.push(`${label}: хук слишком длинный (${countWords(narration)} слов) — нужно не больше ${LIMITS.hookWordsSoft} слов`);
    }

    const onScreen = str(raw.onScreen);
    if (onScreen) {
      const words = countWords(onScreen);
      if (words > LIMITS.onScreenWords) out.push(`${label}: onScreen слишком длинный (${words} слов) — нужно не больше 7 слов`);
      const stars = (onScreen.match(/\*/g) ?? []).length;
      if (stars % 2 === 1) out.push(`${label}: в onScreen непарная звёздочка — акцент пишется как *слово*`);
      else if (stars > 2) out.push(`${label}: в onScreen больше одного акцента — оставь одно *слово*`);
      else if (stars === 2 && /\*\s*\*/.test(onScreen)) out.push(`${label}: пустой акцент ** в onScreen`);
    }

    for (const field of ["visualQuery", "imagePrompt"] as const) {
      const v = str(raw[field]);
      if (v && CYRILLIC.test(v)) out.push(`${label}: ${field} должен быть на английском (сейчас «${v.slice(0, 40)}»)`);
    }
  });
  return out;
}

function checkScriptRules(raw: Loose): string[] {
  const out: string[] = [];
  if (Array.isArray(raw.tags)) {
    const total = raw.tags.reduce<number>((sum, t) => sum + str(t).length, 0);
    if (total > LIMITS.tagsTotalChars) out.push(`tags: суммарно ${total} символов — YouTube принимает не больше ${LIMITS.tagsTotalChars}`);
  }
  if (Array.isArray(raw.scenes)) {
    out.push(...checkSceneRules(raw.scenes, { hookFirst: true, ctaLast: true, allowHook: true, allowCta: true, checkIds: true }));
  }
  return out;
}

// Публичная проверка (контракт script/index.ts): возвращает типизированный
// сценарий или бросает ScriptValidationError со списком ВСЕХ проблем.
export function validateScript(json: unknown): VideoScript {
  if (!isObj(json)) throw new ScriptValidationError(["ожидался JSON-объект сценария"]);
  // language — единственное поле, которое разумно подставить по умолчанию.
  const input: Loose = json.language === undefined ? { ...json, language: "ru" } : json;
  const parsed = VideoScriptSchema.safeParse(input);
  const problems = parsed.success ? [] : formatZodIssues(parsed.error, input);
  problems.push(...checkScriptRules(input));
  const unique = [...new Set(problems)];
  if (unique.length > 0 || !parsed.success) throw new ScriptValidationError(unique.length ? unique : ["неизвестная ошибка схемы"]);
  return parsed.data;
}

// Проверка части длинного ролика (только сцены).
export function validateScenes(scenes: unknown, opts: SceneRuleOptions, what: string): ScriptScene[] {
  if (!Array.isArray(scenes)) throw new ScriptValidationError(["ожидался массив scenes"], what);
  const problems: string[] = [];
  const out: ScriptScene[] = [];
  scenes.forEach((s, i) => {
    const r = ScriptSceneSchema.safeParse(s);
    if (r.success) out.push(r.data);
    else problems.push(...formatZodIssues(r.error, { scenes }, "scenes").map((m) => m.replace(/^сцена №\d+/, `сцена №${i + 1}`)));
  });
  problems.push(...checkSceneRules(scenes, opts));
  if (scenes.length === 0) problems.push("scenes пустой");
  const unique = [...new Set(problems)];
  if (unique.length) throw new ScriptValidationError(unique, what);
  return out;
}

// ---- Мягкие замечания (не блокируют, но уходят в лог и в ремонтный запрос) ----

export interface LintOptions {
  format: Format;
  targetSeconds?: number;
}

export const WORDS_PER_SECOND = 2.6; // темп русской озвучки ≈ 150 слов/мин

export function lintScenes(scenes: unknown[], opts: LintOptions): string[] {
  const out: string[] = [];
  const queries = new Map<string, string>();
  let sameKindRun = 1;
  scenes.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const label = `сцена ${str(raw.id) || `№${i + 1}`}`;
    const kind = str(raw.kind);
    const narration = str(raw.narration);
    const digits = narration.match(/\d[\d\s.,]*/g);
    if (digits) out.push(`${label}: в narration есть цифры (${digits.map((d) => `«${d.trim()}»`).join(", ")}) — напиши числа словами в нужном падеже`);
    if (/[%№$€₽]/.test(narration)) out.push(`${label}: в narration есть символы %/№/валюты — напиши их словами`);
    if (kind === "hook" && countWords(narration) > LIMITS.hookWordsSoft) out.push(`${label}: хук длиннее ${LIMITS.hookWordsSoft} слов — сократи до одной цепляющей фразы`);
    if (kind === "list" && Array.isArray(raw.items)) {
      raw.items.forEach((it, k) => {
        if (countWords(str(it)) > 6) out.push(`${label}: пункт ${k + 1} длиннее 6 слов`);
      });
    }
    const q = str(raw.visualQuery).trim().toLowerCase();
    if (!q && kind !== "cta") out.push(`${label}: нет visualQuery — визуал придётся подбирать наугад`);
    if (q) {
      if (queries.has(q)) out.push(`${label}: visualQuery «${q}» повторяет сцену ${queries.get(q)} — визуал будет однообразным`);
      else queries.set(q, str(raw.id));
    }
    const icon = str(raw.icon);
    if (icon && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon)) out.push(`${label}: icon «${icon}» не в kebab-case`);
    const prev = i > 0 && isObj(scenes[i - 1]) ? str((scenes[i - 1] as Loose).kind) : "";
    sameKindRun = kind === prev ? sameKindRun + 1 : 1;
    if (sameKindRun === 3) out.push(`${label}: третья подряд сцена kind "${kind}" — чередуй типы сцен`);
  });

  const words = scenes.reduce<number>((sum, s) => sum + (isObj(s) ? countWords(str(s.narration)) : 0), 0);
  if (opts.targetSeconds) {
    const target = opts.targetSeconds * WORDS_PER_SECOND;
    if (words < target * 0.75 || words > target * 1.3) {
      out.push(`общий объём narration ${words} слов, а для ~${opts.targetSeconds} с нужно около ${Math.round(target)}`);
    }
  }
  if (opts.format === "shorts" && (scenes.length < 5 || scenes.length > 12)) {
    out.push(`для Shorts лучше 6–9 сцен (сейчас ${scenes.length})`);
  }
  return out;
}

export function lintScript(script: VideoScript, opts: Partial<LintOptions> = {}): string[] {
  const out = lintScenes(script.scenes, { format: opts.format ?? script.format, targetSeconds: opts.targetSeconds });
  if (script.title.length > 70) out.push(`title длиннее 70 символов — в поиске YouTube обрежется`);
  if (!/#[\p{L}\p{N}_]+/u.test(script.description)) out.push("в description нет хэштегов");
  // YouTube считает описание в байтах (≤ 5000), кириллица — 2 байта на букву;
  // ещё нужно место под источники, музыку и голос (meta.ts их свернёт/обрежет).
  const descBytes = Buffer.byteLength(script.description, "utf8");
  if (descBytes > 3500) out.push(`description ${descBytes} байт — YouTube принимает до 5000 байт вместе с источниками; сократи до ~1500 символов`);
  if (script.tags.length < 5) out.push("мало тегов (нужно 8–15)");
  return out;
}

// ---- Мягкая нормализация ответа LLM ----
// Исправляем то, что можно исправить без модели и без риска исказить смысл:
// обёртки, null вместо пропуска, синонимы kind, "66%" в stat.value, нумерацию
// id, **жирный** вместо *акцента*. Всё остальное — в ремонтный запрос.

const KIND_ALIASES: Record<string, SceneKind> = {
  intro: "hook",
  opening: "hook",
  hook_scene: "hook",
  fact: "statement",
  text: "statement",
  point: "statement",
  claim: "statement",
  explanation: "statement",
  number: "stat",
  statistic: "stat",
  statistics: "stat",
  stats: "stat",
  counter: "stat",
  bullets: "list",
  bullet_list: "list",
  steps: "list",
  checklist: "list",
  citation: "quote",
  image: "media",
  visual: "media",
  video: "media",
  broll: "media",
  "b-roll": "media",
  outro: "cta",
  ending: "cta",
  call_to_action: "cta",
  "call-to-action": "cta",
  subscribe: "cta",
};

const WRAPPER_KEYS = ["script", "video", "videoScript", "video_script", "data", "result", "output"];

export function unwrap(raw: unknown, mustHave: string): unknown {
  let cur = raw;
  for (let depth = 0; depth < 3; depth++) {
    if (!isObj(cur) || mustHave in cur) return cur;
    const key = WRAPPER_KEYS.find((k) => isObj(cur) && isObj(cur[k]));
    if (!key) return cur;
    cur = (cur as Loose)[key];
  }
  return cur;
}

const dropNulls = (o: Loose): Loose => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

function toKebab(icon: string): string {
  return icon
    .trim()
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/^lucide-/, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseLooseNumber(v: unknown): { value: number; percent: boolean } | null {
  if (typeof v === "number" && Number.isFinite(v)) return { value: v, percent: false };
  if (typeof v !== "string") return null;
  const percent = v.includes("%");
  const cleaned = v.replace(/[\s ]/g, "").replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? { value: n, percent } : null;
}

function fixAccents(s: string): string {
  let t = s.replace(/\*\*+/g, "*");
  const stars = (t.match(/\*/g) ?? []).length;
  if (stars === 1) t = t.replace("*", "");
  if (stars > 2) {
    // оставляем первую пару, остальные звёздочки убираем
    let seen = 0;
    t = t.replace(/\*/g, () => (++seen <= 2 ? "*" : ""));
  }
  return t.replace(/\s+/g, " ").trim();
}

export function coerceScene(raw: unknown, index: number): unknown {
  if (!isObj(raw)) return raw;
  const s = dropNulls(raw);
  s.id = `s${index + 1}`;
  if (typeof s.kind === "string") {
    const k = s.kind.trim().toLowerCase();
    s.kind = (SCENE_KINDS as string[]).includes(k) ? k : KIND_ALIASES[k] ?? KIND_ALIASES[k.replace(/\s+/g, "_")] ?? k;
  }
  for (const f of ["narration", "onScreen", "visualQuery", "imagePrompt", "icon"]) {
    if (typeof s[f] === "string") {
      s[f] = (s[f] as string).replace(/\s+/g, " ").trim();
      if (!s[f]) delete s[f];
    }
  }
  // На экран модели любят писать «на экране: …» или **жирный** markdown.
  if (typeof s.onScreen === "string") s.onScreen = fixAccents(s.onScreen.replace(/^(на экране|текст)\s*:\s*/i, ""));
  if (typeof s.narration === "string") s.narration = s.narration.replace(/\*+/g, "");
  if (typeof s.icon === "string") s.icon = toKebab(s.icon) || undefined;
  if (typeof s.items === "string") s.items = s.items.split(/\n|;|•/);
  if (Array.isArray(s.items)) {
    s.items = s.items
      .map((it) => (typeof it === "string" ? it.replace(/^\s*(\d+[.)]|[-–—•])\s*/, "").trim() : it))
      .filter((it) => it !== "" && it !== null);
  }
  if (isObj(s.stat)) {
    const st = dropNulls(s.stat);
    const num = parseLooseNumber(st.value);
    if (num) {
      st.value = num.value;
      if (num.percent && !st.suffix) st.suffix = "%";
    }
    for (const f of ["prefix", "suffix"]) if (typeof st[f] === "string" && !st[f]) delete st[f];
    s.stat = st;
  }
  return dropNulls(s);
}

function coerceTags(v: unknown): unknown {
  const list = typeof v === "string" ? v.split(/[,;\n]/) : v;
  if (!Array.isArray(list)) return v;
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const t of list) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, LIMITS.tagLen);
    if (!tag || seen.has(tag)) continue;
    if (out.length >= LIMITS.tagsMax || total + tag.length > LIMITS.tagsTotalChars) break;
    seen.add(tag);
    out.push(tag);
    total += tag.length;
  }
  return out;
}

function cutTitle(t: string): string {
  const s = t.replace(/\s+/g, " ").trim().replace(/^["«“]+|["»”]+$/g, "");
  if (s.length <= LIMITS.title) return s;
  const cut = s.slice(0, LIMITS.title);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, "");
}

// Метаданные + общие поля, одинаковые для сценария и плана.
export function coerceMeta(o: Loose): Loose {
  const out = dropNulls(o);
  if (typeof out.title === "string") out.title = cutTitle(out.title);
  if (typeof out.description === "string") out.description = out.description.trim();
  if ("tags" in out) out.tags = coerceTags(out.tags);
  if (typeof out.theme === "string") {
    const th = out.theme.trim().toLowerCase();
    if ((THEME_NAMES as string[]).includes(th)) out.theme = th;
    else delete out.theme; // выдуманная тема — просто берём тему по умолчанию
  }
  return out;
}

export function coerceScriptCandidate(raw: unknown, req: Pick<ScriptRequest, "format" | "language">): unknown {
  const top = unwrap(raw, "scenes");
  if (!isObj(top)) return top;
  const out = coerceMeta(top);
  out.language = typeof out.language === "string" && out.language.trim() ? out.language.trim() : req.language ?? "ru";
  out.format = req.format; // формат задаёт запрос, а не модель
  if (Array.isArray(out.scenes)) out.scenes = out.scenes.map((s, i) => coerceScene(s, i));
  return out;
}
