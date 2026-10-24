// Проверка сценария: zod-схема + правила структуры, которые схемой не
// выразить (хук первым, cta последним, id по порядку, не больше одного
// акцента и т.д.). Все проблемы собираются в один список по-русски — его же
// отправляем модели в «ремонтный» запрос, поэтому формулировки конкретные.

import type { z } from "zod";
import type { Format, ScriptRequest } from "../contracts";
import { CAMERA_MOVES, QUIZ_PAUSE_SEC, SCENE_KINDS, SHOT_FRAMINGS, SHOT_LIMITS, THEME_NAMES, findBeat, framesBudget, isCinematic, type SceneKind, type ScriptScene, type VideoScript } from "../../types";
import { stems } from "./covered";
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

// Размер items у сцены kind "list" точнее описывает правило структуры ниже —
// одинаковое сообщение от zod не дублируем. У других kind правило items не
// проверяет, поэтому там сообщение zod оставляем: иначе ошибка терялась бы
// совсем (сцена молча выпадала из части длинного ролика).
const coveredByRules = (issue: z.core.$ZodIssue, root: unknown): boolean =>
  issue.path[issue.path.length - 1] === "items" &&
  (issue.code === "too_small" || issue.code === "too_big") &&
  getAt(root, [...issue.path.slice(0, -1), "kind"]) === "list";

// Сырые сообщения zod с путём — запасной вариант, если ни одно не
// перевелось: «неизвестная ошибка» без места модели ничего не говорит.
const rawIssues = (error: z.ZodError): string[] => error.issues.map((x) => `${x.path.map(String).join(".") || "корень"}: ${x.message}`);

export function formatZodIssues(error: z.ZodError, root: unknown, scenesKey = "scenes"): string[] {
  return error.issues.filter((i) => !coveredByRules(i, root)).map((issue) => {
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
    if (kind === "quiz") {
      const q = raw.quiz;
      if (!isObj(q)) out.push(`${label}: для kind "quiz" обязательно поле quiz {answer: "truth" | "myth", explanation}`);
      else {
        if (q.answer !== "truth" && q.answer !== "myth") out.push(`${label}: quiz.answer — "truth" (правда) или "myth" (миф)`);
        const expl = str(q.explanation).trim();
        if (!expl) out.push(`${label}: quiz.explanation — короткое пояснение ответа на экране (до 12 слов)`);
        else if (countWords(expl) > 16) out.push(`${label}: quiz.explanation слишком длинное (${countWords(expl)} слов) — нужно до 12 слов`);
      }
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
    // Промпт плана уходит в генератор картинок как есть: кириллицу он не понимает.
    if (Array.isArray(raw.shots)) {
      raw.shots.forEach((shot, k) => {
        if (!isObj(shot)) return;
        for (const field of ["prompt", "subject"] as const) {
          const v = str(shot[field]);
          if (v && CYRILLIC.test(v)) out.push(`${label}, план ${k + 1}: ${field} должен быть на английском (сейчас «${v.slice(0, 40)}»)`);
        }
      });
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
    // Кинорежим: заголовков поверх кадра нет, поэтому сцена без планов осталась бы
    // голым текстом на фоне. Финал (cta) — карточка канала, ему планы не нужны.
    if (raw.mode === "cinematic") {
      raw.scenes.forEach((sc, i) => {
        if (!isObj(sc) || str(sc.kind) === "cta") return;
        if (!Array.isArray(sc.shots) || sc.shots.length === 0) {
          out.push(`сцена №${i + 1}${str(sc.id) ? ` (${str(sc.id)})` : ""}: в кинорежиме (mode "cinematic") нужны планы shots — 1–4 плана, кадр на каждый (или повтор кадра через reuse)`);
        }
      });
    }
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
  if (unique.length > 0 || !parsed.success) throw new ScriptValidationError(unique.length ? unique : parsed.success ? ["неизвестная ошибка схемы"] : rawIssues(parsed.error));
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
    else {
      // Сцена не прошла схему — это ВСЕГДА проблема (иначе часть принималась
      // бы без неё). Если перевод сообщений пуст — даём сырые с путём.
      const msgs = formatZodIssues(r.error, s, "scenes");
      const label = `сцена №${i + 1}${isObj(s) && str(s.id) ? ` (${str(s.id)})` : ""}`;
      const place = (m: string) => (m.startsWith("поле ") ? `${label}, ${m}` : m.startsWith("корень JSON") ? m.replace("корень JSON", label) : `${label}: ${m}`);
      if (msgs.length) problems.push(...msgs.map(place));
      else problems.push(`${label}: ${rawIssues(r.error).join("; ")}`);
    }
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
  cinematic?: boolean; // mode "cinematic": кадры дают планы, правило media и visualQuery не нужны
  completePrompts?: boolean; // shotPrompts "complete": промпт плана — полный, уходит в генератор как есть
}

// Темп ГОТОВОГО ролика — слова narration на секунду вместе с паузами между сценами:
// цель задаётся длительностью ролика, а не чистой речи. Калибровка 10.2026 — 20 Shorts
// без викторины (scripts/ ÷ durationSec из content/videos.json и week1-videos.json):
// в сумме 2,11 (1,75–2,46, медиана 2,17). С прежними 2,6 «45 секунд» выходили в 57.
export const WORDS_PER_SECOND = 2.1;

// Правила Shorts, которых схема не знает. Объём: первый ответ модели — строго ±15 %
// (иначе ремонт), после ремонта небольшой промах — только замечание (generate.ts).
export const SHORTS_RULES = {
  lengthTolerance: 0.15,
  lengthHard: { min: 0.75, max: 1.3 }, // за этими границами — ремонт всегда
  ctaWordsMax: 8,
  // После ремонта вопрос чуть длиннее 8 слов — замечание: из-за лишнего слова не
  // бросаем ответ сильной модели ради более слабой.
  ctaWordsSoft: 12,
  titleChars: 50,
  media: { min: 2, max: 3 },
} as const;

// Подписку показывает финальная сцена (кнопка с курсором), голосом её не просим.
// Призыв — возвратные формы («подпишись», «подписывайтесь», «подписаться»),
// «подписка», «подписчик». «Подписал договор», «подпиши», «подпись» — не призыв:
// иначе вопрос по истории («А ты бы подписал такой указ?») ушёл бы в ремонт.
const SUBSCRIBE = /подпи[шс]\p{L}*?(?:ся|сь)(?!\p{L})|подписк|подписч|subscri/iu;

const ctaScene = (scenes: unknown[]): Loose | null => {
  const last = scenes[scenes.length - 1];
  return isObj(last) && str(last.kind) === "cta" ? last : null;
};

// Финал: один короткий вопрос без «подпишись». Жёстко — только при генерации
// (generate.ts); у готовых сценариев из scripts/ это замечание в lintScenes.
export function ctaProblems(scenes: unknown[]): string[] {
  const cta = ctaScene(scenes);
  if (!cta) return [];
  const label = `сцена №${scenes.length}${str(cta.id) ? ` (${str(cta.id)})` : ""}`;
  const narration = str(cta.narration);
  const out: string[] = [];
  const words = countWords(narration);
  if (words > SHORTS_RULES.ctaWordsMax) out.push(`${label}: финал (kind "cta") — ${words} слов, нужно не больше ${SHORTS_RULES.ctaWordsMax}: один короткий вопрос зрителю по теме, который возвращает к хуку`);
  if (SUBSCRIBE.test(narration)) out.push(`${label}: в финале не проси подписаться — кнопку подписки ролик показывает сам; оставь только вопрос зрителю по теме`);
  return out;
}

// Ремонт не помог: убираем фразы с «подпишись», а если всё ещё длинно — оставляем
// только вопрос. null — исправить нечем (например, весь финал — «Подпишись!»).
export function trimCta(narration: string, maxWords: number = SHORTS_RULES.ctaWordsMax): string | null {
  const sentences = (narration.match(/[^.!?…]+[.!?…]*/g) ?? []).map((s) => s.trim()).filter((s) => countWords(s) > 0);
  let kept = sentences.filter((s) => !SUBSCRIBE.test(s));
  if (countWords(kept.join(" ")) > maxWords) kept = kept.filter((s) => /\?\s*$/.test(s));
  const out = kept.join(" ").trim();
  return out && countWords(out) <= maxWords ? out : null;
}

// Заголовок пересказывает хук: в ленте Shorts зритель видит и то и другое разом.
// Доля значимых слов заголовка, которые уже есть в хуке.
export function titleRepeatsHook(title: string, hook: string): boolean {
  const t = new Set(stems(title));
  if (t.size < 2) return false;
  const h = new Set(stems(hook));
  let common = 0;
  for (const w of t) if (h.has(w)) common++;
  return common / t.size >= 0.6;
}

// ---- Планы кинорежима: мягкие замечания ----

const SIM_STOP = new Set("the a an of in on at with and or to from by into over under its his her their this that".split(" "));
const promptWords = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !SIM_STOP.has(w)));

// Доля общих значимых слов двух промптов (0…1): почти одинаковые кадры —
// лишняя склейка, а не новый аспект истории.
export function promptSimilarity(a: string, b: string): number {
  const x = promptWords(a);
  const y = promptWords(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

export const SHOT_RULES = { minSec: 1.2, duplicate: 0.85, duplicateSameFraming: 0.6, sumTolerance: 0.5 } as const;

// Кадры, которые генератор почти всегда делает жуткими: макро кожи, пор и
// волос, раны, насекомые, скопления дырочек и пузырьков (трипофобия),
// испуганные лица. Контрольный 30a (10.2026): «мурашки» в макро вышли
// волдырями, срез кожи — «пауком», стволовые клетки — гроздью пузырей.
const CREEPY_SUBJECT = /\b(pores?|goosebumps?|follicles?|cross[- ]sections?|blisters?|bumps|rash|wounds?|blood|gore|insects?|spiders?|worms?|maggots?|larvae?|parasites?|teeth|eyeballs?|tentacles?|cluster(?:s|ed)?|corpses?|skulls?)\b/i;
const CREEPY_MOOD = /\b(crying|tears|screaming|terrified|scared|frightened|horror|creepy|eerie|gloomy|haunted|shivering|distressed)\b/i;
const MACRO = /\b(macro|extreme close-?up|microscop\w*|magnified)\b/i;

// Причина, по которой кадр рискует выйти жутким, или null.
export function creepyShot(shot: Loose): string | null {
  const text = `${str(shot.prompt)} ${str(shot.subject)}`;
  const mood = CREEPY_MOOD.exec(text);
  if (mood) return `«${mood[0]}»`;
  const close = shot.framing === "detail" || shot.framing === "close-up" || MACRO.test(text);
  const subject = CREEPY_SUBJECT.exec(text);
  if (subject && close) return `«${subject[0]}» крупным планом`;
  if (MACRO.test(text) && /\b(skin|hairs?)\b/i.test(text)) return "макро кожи и волос";
  return null;
}

// Тёмный холодный style делает мрачным весь ролик, а не один кадр.
const DARK_STYLE = /\b(low-key|dark|night|gloomy|eerie|horror|creepy|cold blue|grim|noir)\b/i;
export function styleLints(style: unknown): string[] {
  if (!isObj(style)) return [];
  const text = ["direction", "lighting", "palette", "mood", "environment", "world", "look"].map((k) => str(style[k])).join(" ");
  const hit = DARK_STYLE.exec(text);
  return hit ? [`style мрачный («${hit[0]}»): весь ролик выйдет тёмным и холодным — для научпопа бери дневной или тёплый золотой свет; тёмный стиль — только если его требует сама тема`] : [];
}

// Полный промпт (shotPrompts "complete") уходит в генератор как есть — что
// FLUX понимает плохо: отрицания («no text» он читает как «text»), несколько
// сцен в одном промпте (рисует коллаж из панелей), надписи (пишет с ошибками).
// Контрольный 30a (10.2026): «setting: дом, снежный парк, лаборатория» в
// каждом промпте дало 4 коллажа из 16 кадров.
export const PROMPT_RULES = { minWords: 25, maxWords: 140 } as const;
const NEGATION = /\b(no|not|without|never|avoid|don't|doesn't|isn't)\b/i;
const COLLAGE = /\b(split[- ]?screen|collage|triptych|diptych|side[- ]by[- ]side|(?:photo|image|picture) grid|grid of (?:images|photos|pictures|panels)|comic panels?|multiple (?:images|views|scenes|frames)|before and after)\b/i;
const LETTERING = /\b(text|lettering|caption|subtitles?|logo|watermark|inscription|signboard|headline|words? (?:on|reading))\b/i;

export function completePromptLints(shot: Loose, label: string): string[] {
  const prompt = str(shot.prompt);
  if (!prompt || str(shot.reuse)) return [];
  const out: string[] = [];
  const words = countWords(prompt);
  if (words < PROMPT_RULES.minWords) out.push(`${label}: промпт ${words} слов — нужен полный кадр: герой с приметами, действие, одно место из world, свет, объектив, композиция (${PROMPT_RULES.minWords}–${PROMPT_RULES.maxWords} слов)`);
  if (words > PROMPT_RULES.maxWords) out.push(`${label}: промпт ${words} слов — длиннее ${PROMPT_RULES.maxWords}: генератор теряет главное; оставь героя, действие, место, свет и композицию`);
  const neg = NEGATION.exec(prompt);
  if (neg) out.push(`${label}: в промпте отрицание «${neg[0]}» — генератор их не понимает и рисует названное; опиши, что в кадре ЕСТЬ`);
  const col = COLLAGE.exec(prompt);
  if (col) out.push(`${label}: «${col[0]}» в промпте — генератор нарисует коллаж; один кадр — одна сцена`);
  const txt = LETTERING.exec(prompt);
  if (txt) out.push(`${label}: «${txt[0]}» в промпте — надписи генератор пишет с ошибками; подписи и цифры добавит монтаж (callouts, sticker)`);
  return out;
}

// Первое предложение полного промпта — кто и что делает; дальше у всех
// планов общие свет, объектив и композиция, по ним дубли не ищем.
const promptCore = (p: string, complete: boolean) => (complete ? (p.split(/(?<=[.;])\s/)[0] ?? p) : p);

export function shotLints(shots: Loose[], narration: string, label: string, opts: { complete?: boolean } = {}): string[] {
  const out: string[] = [];
  const complete = Boolean(opts.complete);
  const est = countWords(narration) / WORDS_PER_SECOND;
  const n = shots.length;
  if (est > 0 && n > 1 && est / n < SHOT_RULES.minSec) {
    out.push(`${label}: ${n} планов на ~${est.toFixed(1)} с речи — план короче ${SHOT_RULES.minSec} с мелькает; оставь ${Math.max(1, Math.floor(est / 2))}`);
  }
  const secs = shots.map((sh) => (typeof sh.seconds === "number" ? sh.seconds : null));
  if (est > 0 && secs.every((v) => v !== null)) {
    const sum = (secs as number[]).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - est) / est > SHOT_RULES.sumTolerance) {
      out.push(`${label}: планы в сумме ${sum.toFixed(1)} с, а сцена звучит ~${est.toFixed(1)} с — длины планов растянутся пропорционально голосу`);
    }
  }
  const words = narration.split(/\s+/).map((text) => ({ text, startMs: 0, endMs: 0 }));
  shots.forEach((sh, k) => {
    const creepy = creepyShot(sh);
    if (creepy) out.push(`${label}, план ${k + 1}: ${creepy} — генератор делает такие кадры жуткими; покажи через ситуацию и реакцию человека или животного, а анатомию — чистой упрощённой 3D-иллюстрацией`);
    if (complete) out.push(...completePromptLints(sh, `${label}, план ${k + 1}`));
    if (Array.isArray(sh.callouts)) {
      sh.callouts.filter(isObj).forEach((c) => {
        if (countWords(str(c.label)) > 3) out.push(`${label}, план ${k + 1}: подпись «${str(c.label)}» длиннее 3 слов — на экране не успеть прочитать`);
      });
    }
    for (const f of ["footage", "photo"]) {
      const q = str(sh[f]);
      if (q && /[а-яё]/i.test(q)) out.push(`${label}, план ${k + 1}: ${f} «${q}» — по-английски: так ищут стоки и Wikimedia`);
      else if (q && countWords(q) > 8) out.push(`${label}, план ${k + 1}: ${f} «${q}» — длинно для поиска; 2–6 слов: главный предмет первым`);
    }
    if (k > 0 && !str(sh.reuse) && !str(shots[k - 1]!.reuse)) {
      const prev = shots[k - 1]!;
      const sim = promptSimilarity(promptCore(str(prev.prompt), complete), promptCore(str(sh.prompt), complete));
      const sameFraming = Boolean(sh.framing) && sh.framing === prev.framing;
      if (sim >= SHOT_RULES.duplicate || (sameFraming && sim >= SHOT_RULES.duplicateSameFraming)) {
        out.push(`${label}: планы ${k} и ${k + 1} почти одинаковые — покажи другой аспект истории (место, героя, деталь, реакцию), а не тот же кадр ещё раз`);
      }
    }
    if (k > 0) {
      const beat = str(sh.beat).trim();
      if (beat && !findBeat(beat, words)) out.push(`${label}, план ${k + 1}: beat «${beat}» не найден в narration — склейка встанет по длине плана`);
    }
  });
  return out;
}

// Весь ролик: сколько НОВЫХ картинок (планы без reuse) и куда ссылаются
// повторы — только на более ранний план с картинкой.
export function storyboardLints(scenes: unknown[], budget: number = SHOT_LIMITS.newFrames): string[] {
  const out: string[] = [];
  const known = new Set<string>();
  let fresh = 0;
  scenes.forEach((sc, i) => {
    if (!isObj(sc) || !Array.isArray(sc.shots)) return;
    const id = str(sc.id) || `s${i + 1}`;
    sc.shots.filter(isObj).forEach((sh, k) => {
      const reuse = str(sh.reuse);
      if (reuse) {
        if (!known.has(reuse)) out.push(`сцена ${id}, план ${k + 1}: reuse «${reuse}» — такого более раннего плана с картинкой нет; укажи id вида s2-k1 из прошлых планов`);
      } else {
        fresh++;
        known.add(`${id}-k${k + 1}`);
      }
    });
  });
  if (fresh > budget) out.push(`новых картинок ${fresh} — бюджет ${budget}: там, где герой и место те же, повтори кадр через reuse с другим движением камеры`);
  return out;
}

// Все планы ролика одной крупности — монтаж без «общий → средний → деталь».
function framingVariety(scenes: unknown[]): string[] {
  const framings = scenes.flatMap((s) => (isObj(s) && Array.isArray(s.shots) ? s.shots.filter(isObj).map((sh) => str(sh.framing)) : []));
  if (framings.length < 4) return [];
  const distinct = new Set(framings.filter(Boolean));
  return distinct.size <= 1 ? [`все ${framings.length} планов одной крупности${distinct.size ? ` («${[...distinct][0]}»)` : " (framing не задан)"} — чередуй общий план, средний, деталь и реакцию`] : [];
}

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
    // Карту и столбики рисует композиция — findVisual (visuals/index.ts) при том же
    // условии фото не ищет, и запрос им не нужен.
    const compareItems = isObj(raw.compare) && Array.isArray(raw.compare.items) ? raw.compare.items.length : 0;
    const drawn = kind !== "hook" && kind !== "cta" && (Boolean(raw.map) || compareItems >= 2);
    const shots = opts.cinematic && Array.isArray(raw.shots) ? raw.shots.filter(isObj) : [];
    if (!q && kind !== "cta" && !drawn && !shots.length) out.push(`${label}: нет visualQuery — визуал придётся подбирать наугад`);
    if (shots.length) out.push(...shotLints(shots, narration, label, { complete: opts.completePrompts }));
    if (q) {
      if (queries.has(q)) out.push(`${label}: visualQuery «${q}» повторяет сцену ${queries.get(q)} — визуал будет однообразным`);
      else queries.set(q, str(raw.id));
    }
    const icon = str(raw.icon);
    if (icon && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon)) out.push(`${label}: icon «${icon}» не в kebab-case`);
    const prev = i > 0 && isObj(scenes[i - 1]) ? str((scenes[i - 1] as Loose).kind) : "";
    sameKindRun = kind === prev ? sameKindRun + 1 : 1;
    if (sameKindRun === 3) out.push(`${label}: третья подряд сцена kind "${kind}" — чередуй типы сцен`);
    if (kind === "quiz") {
      // Утверждение звучит до паузы — без вопроса зритель не поймёт, что надо угадывать.
      if (narration && !/\?\s*$/.test(narration)) out.push(`${label}: закончи утверждение викторины вопросом «Правда или миф?»`);
      const next = isObj(scenes[i + 1]) ? (scenes[i + 1] as Loose) : null;
      if (!next || str(next.kind) === "cta") out.push(`${label}: после quiz нужна сцена с ответом («Правда!» или «Миф!» и почему)`);
      const expl = isObj(raw.quiz) ? str(raw.quiz.explanation) : "";
      if (countWords(expl) > 12) out.push(`${label}: пояснение вердикта длиннее 12 слов — на экране не успеют прочитать`);
    }
  });

  const words = scenes.reduce<number>((sum, s) => sum + (isObj(s) ? countWords(str(s.narration)) : 0), 0);
  const shorts = opts.format === "shorts";
  if (opts.targetSeconds) {
    const target = opts.targetSeconds * WORDS_PER_SECOND;
    const tol = SHORTS_RULES.lengthTolerance;
    const [lo, hi] = shorts ? [1 - tol, 1 + tol] : [0.75, 1.3];
    if (words < target * lo || words > target * hi) {
      out.push(`общий объём narration ${words} слов, а для ~${Math.round(opts.targetSeconds)} с нужно около ${Math.round(target)}`);
    }
  }
  if (shorts && (scenes.length < 5 || scenes.length > 12)) {
    out.push(`для Shorts лучше 6–8 сцен (сейчас ${scenes.length})`);
  }
  // Викторина строится из раундов — там сцены media не к месту. Викторина — от двух
  // раундов: один вопрос внутри обычного ролика не освобождает его от правила.
  const quiz = scenes.filter((s) => isObj(s) && s.kind === "quiz").length >= 2;
  if (opts.cinematic) out.push(...framingVariety(scenes), ...storyboardLints(scenes, framesBudget(shorts ? "shorts" : "landscape", words / WORDS_PER_SECOND)));
  else if (shorts && !quiz && scenes.length) {
    const media = scenes.filter((s) => isObj(s) && s.kind === "media").length;
    const { min, max } = SHORTS_RULES.media;
    if (media < min || media > max) out.push(`сцен kind "media" — ${media}, в Shorts нужно ${min}–${max}: живое видео по visualQuery там, где есть что показать (действие, место, процесс)`);
  }
  out.push(...ctaProblems(scenes));
  const cta = ctaScene(scenes);
  if (cta) {
    if (str(cta.narration) && !/\?/.test(str(cta.narration))) out.push(`финал (kind "cta") — вопрос зрителю по теме: закончи его знаком «?»`);
    if (SUBSCRIBE.test(str(cta.onScreen))) out.push(`onScreen финала — сам вопрос коротко, без «подпишись»: кнопка подписки уже на экране`);
  }
  return out;
}

export function lintScript(script: VideoScript, opts: Partial<LintOptions> = {}): string[] {
  const format = opts.format ?? script.format;
  const cinematic = isCinematic(script);
  const out = lintScenes(script.scenes, { format, targetSeconds: opts.targetSeconds, cinematic, completePrompts: script.shotPrompts === "complete" });
  if (!cinematic && script.scenes.some((s) => s.shots?.length)) out.push(`у сцен есть планы shots, но mode не "cinematic" — ролик соберётся в обычном режиме, планы не используются`);
  if (cinematic && !script.style) out.push(`кинорежим без style — кадры получат общий стиль по умолчанию; задай style (освещение, палитра, атмосфера), чтобы планы выглядели одним фильмом`);
  if (cinematic) out.push(...styleLints(script.style));
  if (script.title.length > 70) out.push(`title длиннее 70 символов — в поиске YouTube обрежется`);
  else if (format === "shorts" && script.title.length > SHORTS_RULES.titleChars) {
    out.push(`title ${script.title.length} символов — для Shorts лучше до ${SHORTS_RULES.titleChars}: в ленте видно только начало`);
  }
  const hook = script.scenes[0]?.kind === "hook" ? script.scenes[0].narration : "";
  if (hook && titleRepeatsHook(script.title, hook)) {
    out.push(`title почти повторяет хук («${hook}») — пусть заголовок дополняет его (тема и обещание ответа), а не пересказывает первую фразу`);
  }
  if (!/#[\p{L}\p{N}_]+/u.test(script.description)) out.push("в description нет хэштегов");
  // YouTube считает описание в байтах (≤ 5000), кириллица — 2 байта на букву;
  // ещё нужно место под источники, музыку и голос (meta.ts их свернёт/обрежет).
  const descBytes = Buffer.byteLength(script.description, "utf8");
  if (descBytes > 3500) out.push(`description ${descBytes} байт — YouTube принимает до 5000 байт вместе с источниками; сократи до ~1500 символов`);
  if (script.tags.length < 5) out.push("мало тегов (нужно 8–15)");
  out.push(...factChecks(script));
  return out;
}

// Модели (особенно лёгкие) уверенно выдумывают проценты и приписывают цитаты
// учёным. Автоматически это не проверить, поэтому явно показываем человеку,
// что сверить перед рендером, — это и защита от «неаутентичного контента» YouTube.
const ATTRIBUTION = /(?:говорил|говорит|писал|пишет|сказал|сказала|утверждал|по словам|как отмечал|цитата)\s+[А-ЯЁA-Z]/u;
export function factChecks(script: VideoScript): string[] {
  const out: string[] = [];
  for (const sc of script.scenes) {
    if (sc.kind === "stat" && sc.stat) {
      out.push(`проверь факт ${sc.id}: «${sc.stat.prefix ?? ""}${sc.stat.value}${sc.stat.suffix ?? ""} ${sc.stat.label}» — есть ли источник? Не уверен — замени на сцену statement без цифры.`);
    }
    if (ATTRIBUTION.test(sc.narration) || (sc.kind === "quote" && /[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/u.test(sc.narration))) {
      out.push(`проверь цитату ${sc.id}: «${sc.narration.slice(0, 90)}${sc.narration.length > 90 ? "…" : ""}» — действительно ли автор так говорил?`);
    }
  }
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
  trivia: "quiz",
  truth_or_myth: "quiz",
  myth_or_truth: "quiz",
  fact_or_myth: "quiz",
  myth_or_fact: "quiz",
  true_or_false: "quiz",
  quiz_question: "quiz",
};

// Вердикт викторины: модели пишут его по-разному — приводим к truth/myth.
const QUIZ_ANSWERS: Record<string, "truth" | "myth"> = {
  truth: "truth",
  true: "truth",
  fact: "truth",
  правда: "truth",
  верно: "truth",
  да: "truth",
  myth: "myth",
  false: "myth",
  fake: "myth",
  миф: "myth",
  неправда: "myth",
  ложь: "myth",
  нет: "myth",
};

function coerceQuiz(v: unknown): unknown {
  if (!isObj(v)) return v;
  const q = dropNulls(v);
  const rawAnswer = q.answer ?? q.verdict ?? q.isTrue;
  const key = typeof rawAnswer === "boolean" ? String(rawAnswer) : str(rawAnswer).trim().toLowerCase().replace(/[!.«»"]/g, "");
  if (QUIZ_ANSWERS[key]) q.answer = QUIZ_ANSWERS[key];
  delete q.verdict;
  delete q.isTrue;
  for (const f of ["explanation", "question"]) {
    if (typeof q[f] === "string") {
      q[f] = (q[f] as string).replace(/\*+/g, "").replace(/\s+/g, " ").trim();
      if (!q[f]) delete q[f];
    }
  }
  const p = typeof q.pauseSec === "string" ? Number.parseFloat(q.pauseSec) : q.pauseSec;
  if (typeof p === "number" && Number.isFinite(p)) q.pauseSec = Math.min(QUIZ_PAUSE_SEC.max, Math.max(QUIZ_PAUSE_SEC.min, Math.round(p)));
  else delete q.pauseSec;
  return q;
}

// Название главы: без кавычек, звёздочек и «Глава 2:» (номер рисует композиция).
export function cleanChapter(t: string): string {
  const s = t
    .replace(/[*«»"“”]/g, "")
    .replace(/^\s*(глава|часть|раздел)\s*\d+\s*[.:—-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= LIMITS.chapter) return s;
  const cut = s.slice(0, LIMITS.chapter);
  const sp = cut.lastIndexOf(" ");
  return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, "");
}

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

// Только однозначные записи: «66%», «1 000 000», «2,5», «≈ 40», «$12».
// «1,000,000», «1.000.000», «10–20%», «$1.5 млн» — null: строка остаётся,
// zod скажет «stat.value: должно быть числом», и модель исправит сама.
// Угадывать нельзя — «10–20%» раньше превращалось в уверенные «1020%» на экране.
function parseLooseNumber(v: unknown): { value: number; percent: boolean; prefix?: string } | null {
  if (typeof v === "number" && Number.isFinite(v)) return { value: v, percent: false };
  if (typeof v !== "string") return null;
  let t = v.replace(/[\s\u00A0\u202F]/g, "").replace(/\u2212/g, "-");
  const percent = t.endsWith("%");
  if (percent) t = t.slice(0, -1);
  const pre = /^(≈|~|\+|\$|€|£|₽)/.exec(t)?.[1];
  if (pre) t = t.slice(pre.length);
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? { value: n, percent, ...(pre ? { prefix: pre === "~" ? "≈" : pre } : {}) } : null;
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
  // items/stat у «чужого» kind (частая вольность бесплатных моделей в режиме
  // json_object) — просто лишние поля: композиция их не покажет, а схема
  // отвергла бы всю сцену из-за размера массива.
  if ((SCENE_KINDS as string[]).includes(String(s.kind))) {
    if (s.kind !== "list") delete s.items;
    if (s.kind !== "stat") delete s.stat;
    if (s.kind !== "quiz") delete s.quiz;
  }
  if (s.kind === "quiz" && s.quiz !== undefined) s.quiz = coerceQuiz(s.quiz);
  if (Array.isArray(s.shots)) s.shots = s.shots.map(coerceShot);
  if (typeof s.chapter === "string") {
    s.chapter = cleanChapter(s.chapter);
    if (!s.chapter) delete s.chapter;
  } else delete s.chapter;
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
      if (num.prefix && !st.prefix) st.prefix = num.prefix;
    }
    for (const f of ["prefix", "suffix"]) if (typeof st[f] === "string" && !st[f]) delete st[f];
    s.stat = st;
  }
  return dropNulls(s);
}

// Вольности моделей в планах: «zoom in», «Close Up», «2.5s».
const CAMERA_ALIASES: Record<string, string> = { zoomin: "push-in", pushin: "push-in", dollyin: "push-in", zoomout: "pull-out", pullout: "pull-out", dollyout: "pull-out", pan: "pan-right", panleft: "pan-left", panright: "pan-right", tilt: "tilt-up", tiltup: "tilt-up", tiltdown: "tilt-down", handheld: "handheld", shake: "handheld" };
const FRAMING_ALIASES: Record<string, string> = { closeup: "close-up", close: "close-up", extremecloseup: "detail", macro: "detail", insert: "detail", establishingshot: "establishing", wideshot: "wide", longshot: "wide", mediumshot: "medium", midshot: "medium", lowangle: "low-angle", highangle: "high-angle", topdown: "overhead", birdseye: "overhead", firstperson: "pov" };
const aliasKey = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");

function coerceShot(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const sh = dropNulls(raw);
  for (const f of ["prompt", "subject", "beat", "footage", "photo"]) {
    if (typeof sh[f] === "string") {
      sh[f] = (sh[f] as string).replace(/\s+/g, " ").trim();
      if (!sh[f]) delete sh[f];
    }
  }
  if (typeof sh.camera === "string" && !(CAMERA_MOVES as string[]).includes(sh.camera)) {
    const c = CAMERA_ALIASES[aliasKey(sh.camera)];
    if (c) sh.camera = c;
    else delete sh.camera; // непонятное движение — подберётся по крупности
  }
  if (typeof sh.framing === "string" && !(SHOT_FRAMINGS as string[]).includes(sh.framing)) {
    const f = FRAMING_ALIASES[aliasKey(sh.framing)];
    if (f) sh.framing = f;
    else delete sh.framing;
  }
  if (typeof sh.seconds === "string") {
    const n = Number(sh.seconds.replace(",", ".").replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) sh.seconds = n;
    else delete sh.seconds;
  }
  if (typeof sh.reuse === "string") {
    const m = /s\s*(\d+)\s*[-_ ]?\s*k\s*(\d+)/i.exec(sh.reuse);
    if (m) sh.reuse = `s${Number(m[1])}-k${Number(m[2])}`;
    else delete sh.reuse;
  } else if (sh.reuse !== undefined) delete sh.reuse;
  for (const f of ["footage", "photo"]) {
    // Повтор кадра — уже готовая картинка: искать съёмку для него незачем.
    if (sh[f] !== undefined && (typeof sh[f] !== "string" || sh.reuse)) delete sh[f];
  }
  if (Array.isArray(sh.callouts)) {
    const list = sh.callouts
      .filter(isObj)
      .map((c) => dropNulls(c))
      .map((c) => ({ ...c, label: str(c.label).replace(/\s+/g, " ").trim(), target: str(c.target).replace(/\s+/g, " ").trim(), ...(str(c.beat).trim() ? { beat: str(c.beat).trim() } : {}) }))
      .filter((c) => c.label && c.target)
      .slice(0, SHOT_LIMITS.callouts);
    if (list.length) sh.callouts = list.map(({ label, target, beat }) => (beat ? { label, target, beat } : { label, target }));
    else delete sh.callouts;
  } else if (sh.callouts !== undefined) delete sh.callouts;
  if (typeof sh.sticker === "string" || typeof sh.sticker === "number") sh.sticker = { text: String(sh.sticker) };
  if (isObj(sh.sticker)) {
    const text = String(sh.sticker.text ?? "").trim();
    const beat = str(sh.sticker.beat).trim();
    if (text) sh.sticker = beat ? { text, beat } : { text };
    else delete sh.sticker;
  } else if (sh.sticker !== undefined) delete sh.sticker;
  return sh;
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

export function coerceScriptCandidate(raw: unknown, req: Pick<ScriptRequest, "format" | "language"> & { cinematic?: boolean }): unknown {
  const top = unwrap(raw, "scenes");
  if (!isObj(top)) return top;
  const out = coerceMeta(top);
  // Режим задаёт запрос, а не модель: в обычном режиме поля кино убираем,
  // в кинорежиме mode ставим сами.
  // Кинорежим пишет полные промпты планов (prompt.ts, buildCinematicPrompt) — помечаем это.
  if (req.cinematic) {
    out.mode = "cinematic";
    out.shotPrompts = "complete";
  } else {
    delete out.mode;
    delete out.style;
    delete out.shotPrompts;
    if (Array.isArray(out.scenes)) out.scenes = out.scenes.map((sc) => (isObj(sc) ? (({ shots: _s, ...rest }) => rest)(sc) : sc));
  }
  // Язык, как и формат, задаёт запрос: в системном промпте пример с "ru", и модель
  // переписывает его даже в английском сценарии (npm run script -- --lang en).
  out.language = req.language?.trim() || (typeof out.language === "string" && out.language.trim() ? out.language.trim() : "ru");
  out.format = req.format; // формат задаёт запрос, а не модель
  if (Array.isArray(out.scenes)) out.scenes = out.scenes.map((s, i) => coerceScene(s, i));
  return out;
}
