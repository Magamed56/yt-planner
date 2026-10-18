// Проверка сценария: zod-схема + правила структуры, которые схемой не
// выразить (хук первым, cta последним, id по порядку, не больше одного
// акцента и т.д.). Все проблемы собираются в один список по-русски — его же
// отправляем модели в «ремонтный» запрос, поэтому формулировки конкретные.

import type { z } from "zod";
import type { Format, ScriptRequest } from "../contracts";
import { QUIZ_PAUSE_SEC, SCENE_KINDS, THEME_NAMES, type SceneKind, type ScriptScene, type VideoScript } from "../../types";
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

// Пустые слова в заголовке: хвост «: и вот почему», «: простая физика», «шок» место занимает,
// а ничего не обещает — в ленте Shorts видно только начало. «Простыми словами» не трогаем:
// так зрители ищут («эффект Даннинга — Крюгера простыми словами»).
const TITLE_FILLER: RegExp[] = [
  /(?:^|[\s:—–-])(?:и\s+)?вот\s+почему[\s.!?…]*$/iu,
  /прост(?:ая|ой|ые)\s+(?:физика|химия|биология|математика|наука|объяснение)/iu,
  /(?:^|[\s:—–-])(?:объясняем|объясняю|рассказываем|разбираемся|разбираем|разбор)[\s.!?…]*$/iu,
  /(?:интересн|удивительн)\p{L}*\s+факт/iu,
  /вы\s+не\s+поверите|(?<!\p{L})шок(?!\p{L})/iu,
];

export function titleFiller(title: string): string | null {
  for (const re of TITLE_FILLER) {
    const m = re.exec(title);
    if (m) return m[0].replace(/^[\s:—–-]+/u, "").replace(/[\s.!?…]+$/u, "");
  }
  return null;
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
    if (!q && kind !== "cta" && !drawn) out.push(`${label}: нет visualQuery — визуал придётся подбирать наугад`);
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
  if (shorts && !quiz && scenes.length) {
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
  const out = lintScenes(script.scenes, { format, targetSeconds: opts.targetSeconds });
  if (script.title.length > 70) out.push(`title длиннее 70 символов — в поиске YouTube обрежется`);
  else if (format === "shorts" && script.title.length > SHORTS_RULES.titleChars) {
    out.push(`title ${script.title.length} символов — для Shorts лучше до ${SHORTS_RULES.titleChars}: в ленте видно только начало`);
  }
  const hook = script.scenes[0]?.kind === "hook" ? script.scenes[0].narration : "";
  if (hook && titleRepeatsHook(script.title, hook)) {
    out.push(`title почти повторяет хук («${hook}») — пусть заголовок дополняет его (тема и обещание ответа), а не пересказывает первую фразу`);
  }
  const filler = titleFiller(script.title);
  if (filler) out.push(`в title пустые слова «${filler}» — замени конкретикой: число, контраст «думали — оказалось» или вопрос, на который хочется узнать ответ`);
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
  // Язык, как и формат, задаёт запрос: в системном промпте пример с "ru", и модель
  // переписывает его даже в английском сценарии (npm run script -- --lang en).
  out.language = req.language?.trim() || (typeof out.language === "string" && out.language.trim() ? out.language.trim() : "ru");
  out.format = req.format; // формат задаёт запрос, а не модель
  if (Array.isArray(out.scenes)) out.scenes = out.scenes.map((s, i) => coerceScene(s, i));
  return out;
}
