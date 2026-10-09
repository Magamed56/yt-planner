// Промпты сценариста. Системный промпт ОДИН на всю генерацию (и для Shorts,
// и для плана/частей длинного ролика) — он стабилен, поэтому кэшируется у
// Claude и не ломает правила «preserved thinking» при ремонтном запросе.
// Всё, что меняется от запроса к запросу, — в user-сообщении.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Format, ScriptRequest } from "../contracts";
import { FPS, QUIZ_PAUSE_SEC, QUIZ_REVEAL_FRAMES } from "../../types";
import { coveredPromptBlock, recentCtas, type CoveredEntry } from "./covered";
import type { Outline } from "./schema";
import { SHORTS_RULES, WORDS_PER_SECOND } from "./validate";

// Дополнительные параметры генерации — аддитивно к контракту ScriptRequest.
export interface ScriptExtras {
  long?: boolean; // «Разбор»: landscape 5–8 мин, разделы = главы
  quiz?: boolean; // Shorts-викторина «Правда или миф?»
  covered?: CoveredEntry[]; // что канал уже рассказал (не повторять)
  searchPhrases?: string[]; // ключевые фразы → подсказки поиска YouTube
  suggestions?: string[]; // готовые подсказки (иначе их получит generateScript)
}
export type ScriptGenRequest = ScriptRequest & ScriptExtras;

// Shorts по умолчанию: готовые ролики выходили по 49–68 с (медиана 57), досматривают
// короткие лучше — цель 40–45 с, середина.
export const SHORTS_DEFAULT_SECONDS = 42;
// Тишина одного раунда викторины: отсчёт + вердикт (голоса нет).
export const QUIZ_SILENCE_SEC = QUIZ_PAUSE_SEC.default + QUIZ_REVEAL_FRAMES / FPS;
export const QUIZ_ROUNDS_PLANNED = 2;
// «Разбор»: 5–8 минут, 25–45 сцен.
export const LONG_DEFAULT_SECONDS = 420;
export const LONG_SCENES = { min: 25, max: 45 } as const;

// Пример стиля — examples/demo-ru.json (ищем вверх от этого файла, чтобы не
// зависеть от текущей папки; на Windows CLI часто запускают «не оттуда»).
function loadExample(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, "examples", "demo-ru.json");
    if (existsSync(file)) {
      try {
        return JSON.stringify(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        break;
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return FALLBACK_EXAMPLE;
}

// Запасной короткий пример на случай, если файла нет рядом (например, код
// скопирован без examples/).
const FALLBACK_EXAMPLE = JSON.stringify({
  title: "Почему ты забываешь 66% выученного за сутки",
  description: "Кривая забывания Эббингауза и способ запоминать надолго.\n#память #учёба #shorts",
  tags: ["память", "мозг", "учёба"],
  language: "ru",
  format: "shorts",
  theme: "midnight",
  scenes: [
    { id: "s1", kind: "hook", narration: "Через сутки ты забудешь почти всё, что выучил сегодня.", onScreen: "Через 24 часа ты *забудешь* почти всё", icon: "brain", visualQuery: "tired student night desk", imagePrompt: "cinematic close-up of a glowing human brain fading into darkness" },
    { id: "s2", kind: "stat", narration: "Это доказал Герман Эббингауз ещё в тысяча восемьсот восемьдесят пятом году.", onScreen: "Кривая забывания, 1885", stat: { value: 66, suffix: "%", label: "нового забывается за сутки" }, icon: "trending-down", visualQuery: "old library books", imagePrompt: "vintage scientist notebook with a declining curve, candle light" },
    { id: "s3", kind: "cta", narration: "А что из вчерашнего ты помнишь сегодня?", onScreen: "Что помнишь *ты*?", icon: "message-circle" },
  ],
});

let cachedSystem: string | null = null;

export function buildSystemPrompt(): string {
  if (cachedSystem) return cachedSystem;
  cachedSystem = `Ты — сильный сценарист и редактор русскоязычного YouTube-канала. Твои ролики досматривают до конца, потому что в них есть настоящая польза и живая подача, а не «вода».

## Польза и подлинность — главное
- У ролика одна ясная идея и развязка: к концу зритель знает конкретную вещь, которую можно применить сегодня или пересказать другу.
- Только конкретика: имена, годы, механизмы, точные примеры из жизни, наглядные сравнения («размером с рисовое зерно», «как два футбольных поля»). Никаких пустых фраз вроде «в современном мире», «многие считают», «учёные доказали» — если ссылаешься на исследование, скажи, чьё и что именно нашли.
- НЕ выдумывай факты, цифры, исследования, цитаты и личные истории. Пиши только то, что общеизвестно и проверяемо. Не знаешь точного числа — не делай сцену stat, скажи качественно («в разы», «почти половина»).
- Цитата (kind "quote") — только реальная, широко известная, с настоящим автором. Сомневаешься — сделай сцену "statement".
- Звучи как живой автор с позицией: удивляйся, разбивай мифы, давай честный совет. Но не изображай личный опыт, которого не было.
- Без кликбейта, который ролик не оправдывает: заголовок и хук обещают ровно то, что ролик даёт.
- YouTube понижает однотипный «массовый» ИИ-контент, поэтому каждый сценарий уникален по фактам, примерам и подаче; не используй шаблонные заходы.

## Удержание внимания
- Первая сцена (kind "hook") цепляет за первые 2 секунды: narration не длиннее 12 слов. Приёмы: неожиданный факт, разрушение мифа, конкретная цифра, прямой вызов зрителю, обещание результата. Запрещены заходы «Привет», «Сегодня я расскажу», «В этом видео», «Знаете ли вы».
- Одна сцена — одна мысль. Каждая сцена приносит что-то новое: факт, поворот, вопрос, пример. Не пересказывай уже сказанное.
- Pattern interrupt: регулярно меняй ритм — новый тип сцены, неожиданный вопрос зрителю, контраст «думали так — а на деле так».
- Чередуй kind: не ставь подряд больше двух "statement"; используй "stat", "list", "quote", "media" там, где они действительно к месту.
- В Shorts (кроме викторины) — ${SHORTS_RULES.media.min}–${SHORTS_RULES.media.max} сцены "media": полноэкранное живое видео по visualQuery. Ставь их туда, где есть что показать камерой (действие, место, животное, процесс), и не подряд.
- Открытая петля: в начале намекни, что самое ценное будет в конце, — и обязательно это раскрой. Самая сильная мысль — ближе к концу, а не в первой сцене.
- Последняя сцена (kind "cta") — один короткий вопрос зрителю по теме ролика, до ${SHORTS_RULES.ctaWordsMax} слов, который возвращает к хуку: на него хочется ответить в комментариях и пересмотреть начало (хук «Через сутки ты забудешь почти всё» → финал «А что из вчерашнего ты помнишь сегодня?»). Только вопрос: без «подпишись» и «напиши в комментариях» — кнопку подписки и облачко комментария ролик показывает на экране сам. Не повторяй финалы прошлых роликов.

## Темп
- Shorts: сцена звучит 3–5 секунд (8–12 слов); точную длительность и число сцен даёт запрос (обычно 40–45 секунд и 6–8 сцен).
- Длинный ролик (landscape): сцена 8–14 секунд (20–35 слов), но внутри — короткие предложения; каждые 60–90 секунд — мини-развязка и новый крючок на следующий раздел.

## Текст диктора (narration)
- Живой разговорный русский, на «ты». Короткие предложения (до 12 слов), активные глаголы, без канцелярита и вводных «итак», «таким образом», «стоит отметить».
- ВСЕ ЧИСЛА ПИШИ СЛОВАМИ, в правильном падеже: «в тысяча восемьсот восемьдесят пятом году», «шестьдесят шесть процентов», «в три раза». Никаких цифр, символов % № $ и сокращений («т.е.», «млн», «км») — диктор читает текст буквально.
- Без эмодзи, хэштегов, звёздочек, скобок и кавычек-ёлочек вокруг целых фраз.
- Narration всех сцен подряд — связный монолог: каждая сцена продолжает мысль предыдущей.

## Текст на экране (onScreen)
- Не дублирует narration слово в слово — это короткий заголовок сцены: ключевая мысль, цифра или контраст. Не больше 7 слов.
- Ровно одно акцентное слово или короткая фраза в *звёздочках* (или ни одного): «Мозг не ленится. Он *экономит* энергию».
- На экране числа пиши цифрами: «66%», «1885», «×3».

## Поля сцены
- id: "s1", "s2", … строго по порядку.
- kind: "hook" | "statement" | "list" | "stat" | "quote" | "media" | "cta".
- stat — только для "stat" и там обязателен: value — число без единиц (66, 1.5, 300), prefix/suffix — знаки и единицы ("≈", "%", " млн", "×"), label — подпись до 6 слов. Только реальные проверяемые числа.
- items — только для "list" и там обязателен: 2–4 пункта по 1–5 слов в одном грамматическом стиле; narration проговаривает их в том же порядке.
- icon — иконка Lucide в kebab-case, например: brain, rocket, clock, zap, target, lightbulb, trending-up, trending-down, shield, heart, coins, book-open, globe, flame, eye, timer, hourglass, circle-check, circle-x, triangle-alert, list-checks, calendar-check, bell-ring, quote, battery-low, dumbbell, moon, sun, users, wallet, piggy-bank, key, lock, compass, leaf, droplet, flask-conical, microscope, atom, dna, cpu, smartphone, thumbs-up, star, trophy, gift, coffee, utensils, plane, house, music, camera, graduation-cap, briefcase, smile.
- visualQuery — НА АНГЛИЙСКОМ, 2–4 конкретных существительных: то, что реально снимают камерой и находят на фотостоке (Pexels/Pixabay): "tired student night desk", "coffee cup steam". Без абстракций (success, concept, idea), имён, брендов и текста. У каждой сцены свой запрос; у "cta" можно не указывать.
- imagePrompt — НА АНГЛИЙСКОМ, кинематографичное описание кадра для генератора картинок: объект, окружение, свет, ракурс, настроение ("cinematic close-up of ..., soft rim light, shallow depth of field"). Без надписей и букв в кадре. Единый визуальный стиль и палитра на весь ролик.
- map — НЕОБЯЗАТЕЛЬНО, только для сцены "statement" или "media" про конкретное место: {"lat": 29.98, "lon": 31.13, "label": "Гиза", "zoom": "region"} — точные координаты, label по-русски (1–3 слова), zoom: "world" (страна, континент) | "region" | "city". Не больше одной карты на ролик.
- compare — НЕОБЯЗАТЕЛЬНО, для сцены "statement" или "stat", где сравниваются 2–4 реальные величины одного типа: {"items": [{"label": "Пирамида", "value": 4500}, {"label": "Клеопатра", "value": 2050}], "suffix": " лет"} — на экране будут столбики. Только проверяемые числа.

## Метаданные для YouTube
- title — по-русски, с главным поисковым запросом темы; у Shorts до ${SHORTS_RULES.titleChars} символов (в ленте видно только начало), у длинного ролика до 70. Заголовок дополняет хук, а не пересказывает его: хук — неожиданный факт, заголовок — тема и обещание ответа. Интрига без обмана, без КАПСА и эмодзи; можно цифру.
- description — по-русски: 2–3 предложения о том, что зритель узнает и чем это полезно (с ключевыми словами), затем с новой строки 3–5 хэштегов (для Shorts обязательно #shorts).
- tags — 8–15 тегов по-русски (можно 2–3 английских), строчными буквами, без «#».
- theme — "midnight" (тёмная: наука, технологии, космос), "sunset" (тёплая: эмоции, история, отношения), "emerald" (природа, здоровье, деньги), "mono" (строгая: бизнес, факты).
- language — "ru".

## Пример готового сценария Shorts на ДРУГУЮ тему
Возьми из него стиль, ритм и формат полей. Факты и формулировки не копируй.
${loadExample()}

## Формат ответа
Ответь ТОЛЬКО одним JSON-объектом — без markdown, без \`\`\`-блоков, без пояснений до или после.`;
  return cachedSystem;
}

// ---- Пользовательские сообщения ----

export interface ShortsTargets {
  seconds: number;
  wordsMin: number;
  wordsMax: number;
  scenesMin: number;
  scenesMax: number;
}

export function shortsTargets(seconds: number): ShortsTargets {
  const words = seconds * WORDS_PER_SECOND;
  const scenesMin = Math.max(4, Math.round(seconds / 7.5));
  return {
    seconds,
    wordsMin: Math.round(words * 0.9),
    wordsMax: Math.round(words * 1.1),
    scenesMin,
    scenesMax: Math.max(scenesMin + 2, Math.round(seconds / 5)),
  };
}

function header(req: ScriptRequest): string {
  const lang = req.language && req.language !== "ru" ? `\nЯзык ролика: ${req.language} (narration, onScreen и метаданные — на этом языке; visualQuery и imagePrompt — на английском).` : "";
  const notes = req.notes?.trim() ? `\nПожелания автора: ${req.notes.trim()}` : "";
  return `Тема: ${req.topic.trim()}${lang}${notes}`;
}

// «Уже было на канале» и подсказки поиска — только туда, где выбираются факты и
// заголовок (Shorts и план длинного ролика), а не в каждую часть.
function channelContext(req: ScriptGenRequest): string {
  const parts: string[] = [];
  if (req.covered?.length) parts.push(coveredPromptBlock(req.covered, `${req.topic} ${req.notes ?? ""}`));
  if (req.suggestions?.length) {
    parts.push(
      `Так эту тему ищут на YouTube (подсказки поиска): ${req.suggestions.map((s) => `«${s}»`).join("; ")}.\n` +
        `Если какая-то формулировка точно подходит ролику — возьми её в основу title (до ${req.format === "shorts" ? SHORTS_RULES.titleChars : 70} символов, без обмана и кликбейта) и добавь 2–4 подходящие подсказки в tags.`,
    );
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

// Финалы последних роликов — чтобы концовки не звучали одинаково (проверка — generate.ts).
function recentCtaBlock(req: ScriptGenRequest): string {
  const list = recentCtas(req.covered ?? [], 5);
  return list.length ? `\nФиналы последних роликов — не повторяй ни вопрос, ни формулировку: ${list.map((c) => `«${c.cta}»`).join("; ")}.` : "";
}

const formatLine = (f: Format) =>
  f === "shorts" ? 'Формат: YouTube Shorts, вертикальное видео 9:16 (поле format: "shorts").' : 'Формат: длинное горизонтальное видео 16:9 (поле format: "landscape").';

export function buildShortsPrompt(req: ScriptGenRequest, t: ShortsTargets): string {
  if (req.quiz) return buildQuizPrompt(req, t);
  const { media, ctaWordsMax, titleChars } = SHORTS_RULES;
  return `${header(req)}
${formatLine("shorts")}
Длительность: около ${t.seconds} секунд — это ${t.wordsMin}–${t.wordsMax} слов narration суммарно, ${t.scenesMin}–${t.scenesMax} сцен, из них ${media.min}–${media.max} — kind "media".${channelContext(req)}

Сначала про себя найди самый неожиданный и полезный факт по теме и развязку ролика, подбери 4–6 конкретных фактов, которые к ней ведут. Затем напиши сценарий целиком: первая сцена — "hook", последняя — "cta": один вопрос зрителю до ${ctaWordsMax} слов, который возвращает к хуку, без «подпишись». title — до ${titleChars} символов и не повторяет хук.${recentCtaBlock(req)}
Ответ — JSON-объект с полями title, description, tags, language, format, theme, scenes.`;
}

// Викторина: t — цели по словам уже без тишины раундов (её добавит ролик).
function buildQuizPrompt(req: ScriptGenRequest, t: ShortsTargets): string {
  const total = Math.round(t.seconds + QUIZ_ROUNDS_PLANNED * QUIZ_SILENCE_SEC);
  // Третий раунд — ещё ≈ 30 слов и 4,5 с тишины: в 40–45 с влезают только два
  // (хук + 3 раунда + финал ≈ 95 слов), иначе ответ не проходит проверку объёма.
  const three = (total - 3 * QUIZ_SILENCE_SEC) * WORDS_PER_SECOND >= 95;
  return `${header(req)}
${formatLine("shorts")}
Формат ролика — викторина «Правда или миф?». Длительность: около ${total} секунд, из них голос — ${t.wordsMin}–${t.wordsMax} слов narration суммарно (остальное — паузы викторины), ${t.scenesMin}–${t.scenesMax} сцен.${channelContext(req)}

Структура: hook → ${three ? "2–3 раунда" : `ровно ${QUIZ_ROUNDS_PLANNED} раунда`} → cta.
- hook: вызов зрителю и тема, до 12 слов («Проверь себя: правда или миф? ${three ? "Три" : "Два"} факта о сне»).
- Раунд — две сцены подряд:
  1) kind "quiz": narration — одно утверждение по теме и в конце вопрос «Правда или миф?» (до 16 слов); onScreen — само утверждение коротко (до 7 слов, без вопроса); поле quiz: {"answer": "truth" (правда) или "myth" (миф), "explanation": пояснение ответа для экрана — до 12 слов, "question": короткий вопрос зрителю для комментариев — необязательно}. После этой сцены ролик сам делает паузу с отсчётом 3…2…1 и показывает вердикт — в narration этого не пиши.
  2) следующая сцена (statement, stat или list) начинается со слов «Правда!» или «Миф!» и объясняет почему — конкретным фактом.
- Утверждения-«правда» — только проверяемые факты темы; «миф» — распространённое заблуждение, которое факты темы опровергают. Нужна хотя бы одна правда и один миф, порядок — непредсказуемый.
- cta: один короткий вопрос, до ${SHORTS_RULES.ctaWordsMax} слов («Сколько из них ты угадал?»), без «подпишись» и «пиши в комментариях» — кнопку подписки и облачко комментария ролик показывает сам.
- Сцены "media" в викторине не нужны: её ритм задают раунды.
- title — до ${SHORTS_RULES.titleChars} символов.${recentCtaBlock(req)}
Ответ — JSON-объект с полями title, description, tags, language, format, theme, scenes.`;
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export interface LandscapePlan {
  seconds: number;
  sections: number;
}

export function landscapePlan(seconds: number): LandscapePlan {
  return { seconds, sections: Math.min(10, Math.max(3, Math.round(seconds / 80))) };
}

export function buildOutlinePrompt(req: ScriptGenRequest, plan: LandscapePlan): string {
  const minutes = Math.round((plan.seconds / 60) * 10) / 10;
  const chapters = req.long
    ? "\nЭто «Разбор» — подробный ролик, разделы станут главами YouTube: heading — короткое название главы (2–5 слов, до 40 символов), без нумерации и кавычек; главы не повторяют друг друга."
    : "";
  return `${header(req)}
${formatLine("landscape")}
Длительность: около ${plan.seconds} секунд (${minutes} мин).${channelContext(req)}

Сейчас нужен только ПЛАН ролика — сцены напишем потом по частям.
Раздели ролик на ${plan.sections} ${ruPlural(plan.sections, "раздел", "раздела", "разделов")}. Первый раздел открывается хуком и обещанием ценности, последний — главной развязкой и призывом. Каждый раздел — отдельная мысль с мини-развязкой и крючком на следующий.${chapters}
Для каждого раздела: heading — заголовок, goal — что зритель поймёт, points — 2–6 конкретных фактов, примеров или шагов (реальных, проверяемых), seconds — длительность; сумма seconds ≈ ${plan.seconds}.
Также дай title, description (для длинного ролика — 2–3 предложения и 3–5 хэштегов, без #shorts), tags и theme для всего ролика.
Ответ — JSON-объект с полями title, description, tags, theme, sections.`;
}

export interface ChunkSpec {
  index: number; // 0-based
  count: number;
  sections: Outline["sections"];
  sectionOffset: number; // номер первого раздела части (0-based)
  seconds: number;
  previousTail: string[]; // последние narration предыдущей части
  scenesBudget?: number; // доля общего лимита сцен ролика (LIMITS.scenesMax) на эту часть
  chapters?: boolean; // «Разбор»: первая сцена раздела несёт chapter
}

export function buildChunkPrompt(req: ScriptGenRequest, outline: Outline, spec: ChunkSpec): string {
  const first = spec.index === 0;
  const last = spec.index === spec.count - 1;
  const words = spec.seconds * WORDS_PER_SECOND;
  const base = Math.max(3, Math.round(spec.seconds / 14));
  const scenesMax = Math.min(spec.scenesBudget ?? Infinity, Math.max(base + 2, Math.round(spec.seconds / 8)));
  // Упёрлись в долю общего лимита сцен — сцены просто длиннее.
  const scenesMin = base < scenesMax ? base : Math.max(1, scenesMax - 2);
  const planLines = outline.sections
    .map((s, i) => `${i + 1}. ${s.heading} — ${s.goal} (≈${Math.round(s.seconds)} с)`)
    .join("\n");
  const detail = spec.sections
    .map(
      (s, i) =>
        `### Раздел ${spec.sectionOffset + i + 1}. ${s.heading}\nЗадача: ${s.goal}\nОпорные факты:\n${s.points.map((p) => `- ${p}`).join("\n")}`,
    )
    .join("\n\n");
  const start = first
    ? 'Это начало ролика: первая сцена — kind "hook" (narration до 12 слов), затем коротко — что зритель получит к концу.'
    : `Не начинай с приветствия или хука — продолжи с того места, где остановилась предыдущая часть:\n${spec.previousTail.map((t) => `«${t}»`).join("\n")}`;
  const end = last
    ? `Это конец ролика: подведи итог одной сильной фразой и закончи сценой kind "cta" — один короткий вопрос зрителю по теме (до ${SHORTS_RULES.ctaWordsMax} слов), без «подпишись».`
    : 'Не используй kind "hook" и "cta", не подводи итог всего ролика и не прощайся — ролик продолжится.';
  const chapters = spec.chapters
    ? `\nГлавы: у ПЕРВОЙ сцены каждого раздела этой части поле chapter — название раздела дословно (${spec.sections.map((s) => `«${s.heading}»`).join(", ")}); у остальных сцен chapter не указывай.`
    : "";
  return `${header(req)}
${formatLine("landscape")}
Название ролика: ${outline.title}

План ролика (утверждён):
${planLines}

Сейчас напиши ЧАСТЬ ${spec.index + 1} из ${spec.count} — только эти разделы:
${detail}

Длительность части: около ${Math.round(spec.seconds)} с — это ${Math.round(words * 0.9)}–${Math.round(words * 1.1)} слов narration, ${scenesMin}–${scenesMax} сцен.
${start}
${end}${chapters}
Ответ — JSON-объект { "scenes": [ … ] }; поля сцен — как в инструкции; id внутри части: "s1", "s2", … (при склейке перенумеруем).`;
}

export function buildRepairPrompt(problems: string[], warnings: string[]): string {
  const soft = warnings.length ? `\n\nТакже желательно поправить:\n- ${warnings.slice(0, 12).join("\n- ")}` : "";
  return `Твой JSON не прошёл проверку. Исправь ВСЕ проблемы ниже и верни исправленный JSON целиком — только JSON, без пояснений.

Проблемы:
- ${problems.slice(0, 30).join("\n- ")}${soft}`;
}
