// Промпты сценариста. Системный промпт ОДИН на всю генерацию (и для Shorts,
// и для плана/частей длинного ролика) — он стабилен, поэтому кэшируется у
// Claude и не ломает правила «preserved thinking» при ремонтном запросе.
// Всё, что меняется от запроса к запросу, — в user-сообщении.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Format, ScriptRequest } from "../contracts";
import type { Genre } from "../plan";
import { FPS, QUIZ_PAUSE_SEC, QUIZ_REVEAL_FRAMES, SHOT_LIMITS } from "../../types";
import { coveredPromptBlock, recentCtas, type CoveredEntry } from "./covered";
import type { Outline } from "./schema";
import { SHORTS_RULES, WORDS_PER_SECOND } from "./validate";

// Дополнительные параметры генерации — аддитивно к контракту ScriptRequest.
export interface ScriptExtras {
  long?: boolean; // «Разбор»: landscape 5–8 мин, разделы = главы
  quiz?: boolean; // Shorts-викторина «Правда или миф?»
  cinematic?: boolean; // Shorts в кинорежиме: планы shots и общий style, без текста поверх кадра
  genre?: Genre; // от поиска материала: история — около минуты, объяснение — 40–45 с
  covered?: CoveredEntry[]; // что канал уже рассказал (не повторять)
  searchPhrases?: string[]; // ключевые фразы → подсказки поиска YouTube
  suggestions?: string[]; // готовые подсказки (иначе их получит generateScript)
}
export type ScriptGenRequest = ScriptRequest & ScriptExtras;

// Shorts по умолчанию: готовые ролики выходили по 49–68 с (медиана 57), досматривают
// короткие лучше — цель 40–45 с, середина.
export const SHORTS_DEFAULT_SECONDS = 42;
// История (жанр от поиска материала): в 42 с завязка, поворот и развязка не помещались —
// рассказ обрывался на середине. Около минуты — ≈ 120 слов.
export const STORY_SECONDS = 58;

export function shortsSeconds(req: Pick<ScriptExtras, "genre" | "quiz">): number {
  return req.genre === "story" && !req.quiz ? STORY_SECONDS : SHORTS_DEFAULT_SECONDS;
}
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

## Рассказ — история, а не список фактов
- Ролик — одна история с началом, развитием и развязкой: зритель досматривает, потому что хочет узнать, чем кончится. Даже объяснение — история: загадка → как думали → как на самом деле → что из этого следует.
- Герои — с именами и мотивами: кто это, чего хотел, что мешало. События — конкретными сценами: кто, где, что сделал и сказал, что из этого вышло.
- Сцены сцеплены причиной и следствием («но», «и тогда», «поэтому», «через неделю»): каждая отвечает на вопрос, который оставила предыдущая, и ставит новый.
- Живые детали из источников сильнее общих слов: реальная реплика или цитата, деталь обстановки, число, которое можно представить.
- Рассказ не обрывается: развязка — чем всё кончилось (итог, число, цитата), затем одна фраза — что из этого следует или что было потом. Только после этого — финальный вопрос.

## Удержание внимания
- Первая сцена (kind "hook") цепляет за первые 2 секунды: narration не длиннее 12 слов. Хук — загадка, парадокс или ставка, на которую хочется узнать ответ; сам ответ (чем кончилось, главное число) хук не выдаёт — его зритель получит в развязке. Приёмы: неожиданный факт, разрушение мифа, конкретная цифра, прямой вызов зрителю, обещание результата. Запрещены заходы «Привет», «Сегодня я расскажу», «В этом видео», «Знаете ли вы».
- Одна сцена — один шаг истории. Каждая сцена приносит что-то новое: факт, поворот, вопрос, пример. Не пересказывай уже сказанное.
- Pattern interrupt: регулярно меняй ритм — новый тип сцены, неожиданный вопрос зрителю, контраст «думали так — а на деле так».
- Чередуй kind: не ставь подряд больше двух "statement"; используй "stat", "list", "quote", "media" там, где они действительно к месту.
- В Shorts (кроме викторины) — ${SHORTS_RULES.media.min}–${SHORTS_RULES.media.max} сцены "media": полноэкранное живое видео по visualQuery. Ставь их туда, где есть что показать камерой (действие, место, животное, процесс), и не подряд.
- Открытая петля: в начале намекни, что самое ценное будет в конце, — и обязательно это раскрой. Самая сильная мысль — ближе к концу, а не в первой сцене.
- Последняя сцена (kind "cta") — один короткий вопрос зрителю по теме ролика, до ${SHORTS_RULES.ctaWordsMax} слов, который возвращает к хуку: на него хочется ответить в комментариях и пересмотреть начало (хук «Через сутки ты забудешь почти всё» → финал «А что из вчерашнего ты помнишь сегодня?»). Только вопрос: без «подпишись» и «напиши в комментариях» — кнопку подписки и облачко комментария ролик показывает на экране сам. На вопрос нет готового ответа в ролике (сказали «армия проиграла» — не спрашивай «кто победил?»): спроси мнение, опыт или «а ты бы…». Не повторяй финалы прошлых роликов.

## Темп
- Shorts: сцена звучит 4–7 секунд (10–16 слов); длительность и число сцен даёт запрос (история — около минуты, объяснение — 40–45 секунд).
- Длинный ролик (landscape): сцена 8–14 секунд (20–35 слов); каждые 60–90 секунд — мини-развязка и новый крючок на следующий раздел.

## Текст диктора (narration)
- Живой разговорный русский, на «ты», как рассказ умного друга. Предложения разной длины: короткие (3–6 слов) — для удара и поворота, обычные (10–18 слов) — чтобы рассказывать; не руби весь текст на телеграфные фразы. Активные глаголы, без канцелярита и вводных «итак», «таким образом», «стоит отметить».
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
- visualQuery — НА АНГЛИЙСКОМ, 2–5 слов: что именно в кадре, конкретные существительные, главный предмет сцены — первым. Если сцена про реальный объект, место, вид животного, прибор или событие — начни с его настоящего названия с заглавной буквы, как в Википедии ("Apollo Guidance Computer", "Tenochtitlan model", "Radcliffe Camera Oxford", "Greenland shark"): по нему на Wikimedia Commons находится настоящее фото. Исторический человек — имя и portrait ("Edme Mariotte portrait"). Иначе — то, что реально снимают камерой и находят на фотостоке: "tired student night desk", "coffee cup steam". Без абстракций (success, concept, idea), брендов, имён ныне живущих людей, текста и слов о стиле и свете (cinematic, close-up, dark). У каждой сцены свой запрос; у "cta" можно не указывать.
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
Возьми из него формат полей и разговорный тон (это короткое объяснение; историю строй по арке из запроса). Факты и формулировки не копируй.
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

// Арка рассказа — общая для обычных Shorts и кинорежима. Раньше здесь было «подбери
// 4–6 фактов», и ролик выходил перечнем фактов, обрывавшимся на вопросе зрителю.
function arcBlock(req: ScriptGenRequest): string {
  const { ctaWordsMax, titleChars } = SHORTS_RULES;
  const steps =
    req.genre === "explainer"
      ? [
          `Хук (сцена "hook", до 12 слов) — загадка или вопрос, ответа на который зритель не знает. Ответ не выдаёт.`,
          `Завязка — как это обычно объясняют или что мы видим в жизни.`,
          `Развитие — как на самом деле: по шагам, на примере из жизни, с конкретикой из материала.`,
          `Поворот — неожиданное следствие или деталь.`,
          `Развязка — ответ на загадку хука и одна фраза: что зритель теперь может сделать или как посмотрит на это иначе.`,
        ]
      : [
          `Хук (сцена "hook", до 12 слов) — загадка, парадокс или ставка. Развязку не выдаёт.`,
          `Завязка — кто, где, когда и что на кону: герой по имени, его цель или беда.`,
          `Развитие — 2–3 шага, каждый — конкретный эпизод, который усложняет дело («но», «и тогда»).`,
          `Поворот — момент, которого зритель не ждал.`,
          `Развязка — чем кончилось (итог, число или цитата) и одна фраза: что из этого следует или что было потом.`,
        ];
  steps.push(`Финал (сцена "cta") — один вопрос зрителю до ${ctaWordsMax} слов, который возвращает к хуку; готового ответа на него в ролике нет. Без «подпишись».`);
  return `Сначала про себя выстрой рассказ по шагам, потом пиши сцены:
${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Затем напиши сценарий целиком. title — до ${titleChars} символов и не повторяет хук.${recentCtaBlock(req)}`;
}

export function buildShortsPrompt(req: ScriptGenRequest, t: ShortsTargets): string {
  if (req.quiz) return buildQuizPrompt(req, t);
  if (req.cinematic) return buildCinematicPrompt(req, t);
  const { media } = SHORTS_RULES;
  return `${header(req)}
${formatLine("shorts")}
Длительность: около ${t.seconds} секунд — это ${t.wordsMin}–${t.wordsMax} слов narration суммарно, ${t.scenesMin}–${t.scenesMax} сцен, из них ${media.min}–${media.max} — kind "media".${channelContext(req)}

${arcBlock(req)}
Ответ — JSON-объект с полями title, description, tags, language, format, theme, scenes.`;
}

// Кинорежим: ролик — короткий связный фильм. Картинку несут планы (shots):
// сценарист сам решает, сколько нужно кадров, и пишет ПОЛНЫЙ промпт каждого —
// код к нему ничего не дописывает (shotPrompts "complete"). Системный промпт
// общий, поэтому правила кино (и отмена правила про сцены media) — здесь.
function buildCinematicPrompt(req: ScriptGenRequest, t: ShortsTargets): string {
  const max = SHOT_LIMITS.newFrames;
  const hi = Math.min(max, Math.round(t.seconds / 4));
  return `${header(req)}
${formatLine("shorts")}
Режим — КИНО (поле mode: "cinematic"): ролик — короткий связный фильм, а не набор иллюстраций. Текста поверх кадра нет, кроме субтитров голоса и коротких подписей монтажа (callouts, sticker), поэтому историю рассказывают кадры.
Длительность: около ${t.seconds} секунд — это ${t.wordsMin}–${t.wordsMax} слов narration суммарно, ${t.scenesMin}–${t.scenesMax} сцен.${channelContext(req)}

${arcBlock(req)}

${cinematicRules({ format: "shorts", frames: { lo: Math.min(hi, Math.max(5, Math.round(t.seconds / 6))), hi, max }, real: "2–5 планов ролика", bible: "make" })}
- kind сцен — только "hook", "statement", "media" и "cta": цифры, пункты и цитаты отдельными сценами не выводятся. onScreen всё равно заполни — коротко мысль сцены (в кадре его не будет).
- visualQuery и imagePrompt в кинорежиме не нужны.
Ответ — JSON-объект с полями title, description, tags, language, format, theme, mode, style, scenes.`;
}

// Правила кино — общие для Shorts и частей «Разбора» 16:9: библия ролика, число
// кадров, полный промпт, настоящая съёмка, монтаж поверх кадра, поля плана.
// bible "given" — библию уже придумал план «Разбора»: части пишут кадры по ней.
export function cinematicRules(o: { format: Format; frames: { lo: number; hi: number; max: number }; real: string; bible: "make" | "given" }): string {
  const vertical = o.format === "shorts";
  const bible =
    o.bible === "make"
      ? `1. Один фильм. Сначала придумай «библию» ролика в style (всё по-английски):
   - world — один мир ролика: место, эпоха, время года, погода. Все кадры происходят в нём; другое место — только если туда переходит сама история.
   - look — как снято всё: камера, объектив, плёнка, свет, цвет (например, "35mm film photograph, 35mm lens, natural afternoon sunlight, warm true-to-life colors, soft grain").
   - characters — 1–3 сквозных героя: name и look — точные приметы (возраст, лицо, причёска, одежда и её цвет; у животного — вид и окрас). Эти приметы слово в слово повторяй в каждом промпте с этим героем, иначе генератор каждый раз нарисует другого.
   - direction, lighting, palette, mood — коротко, для справки.
   Веди историю через героя: зритель узнаёт его и место из кадра в кадр, видит его действие, реакцию и последствие.`
      : `1. Один фильм: «библия» ролика (world, look, characters) уже задана выше — держись её. Приметы героев из characters слово в слово повторяй в каждом промпте с этим героем, look — в каждом рисованном кадре.`;
  return `Правила кинорежима (сильнее общих правил про сцены "media" и visualQuery):
${bible}
2. Сколько кадров — решаешь ты. Новый кадр нужен, когда меняется то, что видит зритель: место, герой, действие, важная деталь. Пока речь об одном — держи один кадр: картинка с движением камеры живёт 3–6 секунд, а повтор кадра (reuse) с другим движением камеры даёт новый план без новой картинки. Новых кадров — не больше ${o.frames.max}, обычно ${o.frames.lo}–${o.frames.hi}. У сцены 1–3 плана${vertical ? ', у "hook" — 1–2, и первый кадр сразу показывает героя или главный предмет' : ""}. У "cta" планов нет.
3. prompt — ПОЛНЫЙ промпт картинки по-английски, связный текст, как описание фотографии, 40–90 слов, в таком порядке:
   1) герой или главный предмет — с приметами из characters слово в слово;
   2) что он делает — одно ясное действие, понятное с первого взгляда;
   3) где — конкретное место из world и время суток;
   4) свет и съёмка — из look; крупность словами (wide shot, medium shot, close-up);
   5) ${vertical ? "композиция вертикального кадра 9:16: главное — в верхних двух третях, нижняя треть спокойная (там пойдут субтитры)" : "композиция горизонтального кадра 16:9: главное — по центру или по третям, нижняя пятая часть спокойная (там пойдут субтитры)"}; само слово subtitles в промпт не пиши — генератор нарисует текст.
   Нельзя: отрицания (no, not, without — генератор их не понимает и рисует названное); несколько мест или сцен в одном промпте (выйдет коллаж из панелей); надписи, вывески, тексты и логотипы (генератор пишет их с ошибками — подписи и цифры добавит монтаж).
4. Настоящая съёмка — там, где она сильнее рисунка (на ${o.real}). Кроме prompt у плана можно указать:
   - footage — живое видео со стоков (Pexels, Pixabay): по-английски, 2–6 слов, главный предмет первым ("wheat field wind sunset", "emu running", "rocket launch night"). Для природы, животных, неба, моря, космоса, огня, процессов и мест, где эпоху не видно: в истории о прошлом — без современных машин, одежды и зданий.
   - photo — настоящее фото из архива (Wikimedia Commons): реальный предмет, место, документ или событие ("Lewis gun", "Apollo 13 service module", "Rosetta Stone"). Людей из characters — только рисунком, иначе зритель увидит двух разных людей.
   prompt пиши всегда: не найдётся съёмка по теме — кадр нарисуют по нему. callouts — только у планов без footage и photo.
5. Кадры — привлекательные: светлые, приятные глазу; люди — со спокойными, радостными или удивлёнными лицами. Без крови, ран, мёртвых людей и животных, оружия, направленного в зрителя, страха и боли, макро кожи и насекомых. Даже про драму — с юмором и теплом: реакция героя, а не жестокость. Абстрактное (механизм, процесс) — чистой простой иллюстрацией на светлом однотонном фоне с одним-двумя крупными предметами и подписями callouts.
6. Монтаж поверх кадра:
   - callouts — до ${SHOT_LIMITS.callouts} подписей к предметам, которые ЯВНО видны на картинке: label — по-русски, 1–3 слова; target — по-английски, тот же предмет, как он назван в prompt; beat — слова narration, на которых подпись появляется. На ${vertical ? "3–5 планов ролика" : "каждый третий-четвёртый рисованный план"}, там, где зрителю важно понять, что именно на экране.
   - sticker — крупная цифра или дата в момент, когда её произносят: text до 8 символов ("1932", "×10", "986"), beat — слова narration. ${vertical ? "1–3 на ролик" : "1–2 на раздел"}.
7. Поля плана:
   - framing — establishing, wide, medium, close-up, detail, reaction, pov, low-angle, high-angle, overhead; чередуй крупности.
   - camera — push-in, pull-out, pan-left, pan-right, tilt-up, tilt-down, handheld; чередуй; у повтора кадра — другое движение, чем в прошлый раз.
   - seconds — 2–6, сколько держится план; сумма по сцене ≈ длине её фразы (≈ ${WORDS_PER_SECOND} слова в секунду).
   - subject — по-английски, кто в центре кадра (имя героя из characters).
   - beat — у 2-го и следующих планов сцены: первые 1–3 слова narration этой сцены, на которых план начинается (слово в слово).
   - reuse — вместо нового кадра: id более раннего плана "sN-kM" (сцена sN, план M по порядку с единицы); prompt тогда — одной фразой, что показываем ("slow push-in on the jammed gun"), framing и camera — новые.`;
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
  // Кинорежим «Разбора»: «библию» кадров придумывает план — части пишут планы по ней.
  const cinema = req.cinematic
    ? `\nРежим — КИНО (документальный фильм): картинку несут кадры планов, текста поверх кадра нет, кроме субтитров и коротких подписей монтажа. Придумай «библию» ролика — поле style (всё по-английски): world — мир истории (места, эпоха, время года); look — как снято всё (камера, объектив, плёнка, свет, цвет, например "35mm documentary film photograph, natural light, warm true-to-life colors, soft grain"); characters — 1–4 сквозных героя: name и look — точные приметы (возраст, лицо, причёска, одежда и её цвет); direction, lighting, palette, mood — коротко.`
    : "";
  return `${header(req)}
${formatLine("landscape")}
Длительность: около ${plan.seconds} секунд (${minutes} мин).${channelContext(req)}${cinema}

Сейчас нужен только ПЛАН ролика — сцены напишем потом по частям.
Ролик — одна большая история или расследование, а не лекция: загадка в начале (без ответа), герои с именами и мотивами, события по порядку, поворот, развязка и что из этого следует.
Раздели ролик на ${plan.sections} ${ruPlural(plan.sections, "раздел", "раздела", "разделов")}. Первый раздел открывается хуком-загадкой и обещанием ответа, последний — главной развязкой и призывом. Каждый раздел — эпизод истории с мини-развязкой и крючком на следующий.${chapters}
Для каждого раздела: heading — заголовок, goal — что зритель поймёт, points — 2–6 конкретных фактов, эпизодов или шагов (реальных, проверяемых), seconds — длительность; сумма seconds ≈ ${plan.seconds}.
Также дай title, description (для длинного ролика — 2–3 предложения и 3–5 хэштегов, без #shorts), tags и theme${req.cinematic ? " и style" : ""} для всего ролика.
Ответ — JSON-объект с полями title, description, tags, theme${req.cinematic ? ", style" : ""}, sections.`;
}

// «Библия» ролика текстом — для частей «Разбора» в кинорежиме.
function bibleText(style: NonNullable<Outline["style"]>): string {
  const lines = [
    style.world ? `world: ${style.world}` : "",
    style.look ? `look: ${style.look}` : "",
    ...(style.characters ?? []).map((c) => `character «${c.name}»: ${c.look}`),
    style.palette ? `palette: ${style.palette}` : "",
    style.mood ? `mood: ${style.mood}` : "",
  ].filter(Boolean);
  return lines.join("\n");
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
  const cinema =
    req.cinematic && outline.style
      ? `\n\nРежим — КИНО. «Библия» ролика (style):\n${bibleText(outline.style)}\n\n${cinematicRules({
          format: "landscape",
          frames: { lo: Math.max(3, Math.round(spec.seconds / 10)), hi: Math.max(4, Math.round(spec.seconds / 7)), max: Math.max(4, Math.round(spec.seconds / 7)) },
          real: "треть–половину планов части",
          bible: "given",
        })}\n- kind сцен — только "hook", "statement", "media" и "cta"; у каждой сцены, кроме "cta", — планы shots. onScreen всё равно заполни — коротко мысль сцены (в кадре его не будет); visualQuery и imagePrompt не нужны.\n- reuse — только на планы этой части, по id её сцен ("s2-k1").`
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
${end}${chapters}${cinema}
Ответ — JSON-объект { "scenes": [ … ] }; поля сцен — как в инструкции; id внутри части: "s1", "s2", … (при склейке перенумеруем).`;
}

export function buildRepairPrompt(problems: string[], warnings: string[]): string {
  const soft = warnings.length ? `\n\nТакже желательно поправить:\n- ${warnings.slice(0, 12).join("\n- ")}` : "";
  return `Твой JSON не прошёл проверку. Исправь ВСЕ проблемы ниже и верни исправленный JSON целиком — только JSON, без пояснений.

Проблемы:
- ${problems.slice(0, 30).join("\n- ")}${soft}`;
}
