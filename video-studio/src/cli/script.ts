// Черновик сценария для проверки человеком: тема → scripts/<slug>.json.
// Дальше: поправить текст (на ПК или прямо на github.com) и собрать ролик
//   npm run make -- --script scripts/<slug>.json
//
//   npm run script -- --topic "Почему мы забываем" [--format shorts|landscape] [--notes "..."] [--seconds 45]
//   npm run script -- --plan 08a,08b   — темы из content/plan.json: хук, угол и факты с источниками
//   npm run script -- --plan 08a --quiz   — Shorts-викторина «Правда или миф?»
//   npm run script -- --plan 08a --long   — «Разбор» 5–8 мин, 16:9, с главами
//   npm run script -- --plan 08a --lang en — тот же ролик на другом языке (scripts/en/…)
//   npm run script -- --long-plan L01   — «Разбор» на тему из content/long-plan.json (razbor-L01-…)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Format, VideoScript } from "../types";
import { parsePlan, planNotes, PLAN_CODE, scriptCode, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { isLongCode, normCode } from "../pipeline/codes";
import { LONG_PLAN_FILE, longPlanNotes, parseLongPlan } from "../pipeline/long-plan";
import { generateScript, lintScript, loadCovered, LONG_DEFAULT_SECONDS, ScriptGenerationError, searchPhrases, WORDS_PER_SECOND, type ScriptGenRequest } from "../pipeline/script/index";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { researchEnabled, researchNotes, researchTopic } from "../pipeline/script/research";
import { slugify } from "../pipeline/slug";
import { ROOT, UserError, argsError, escapeMd, fail, fmtDuration, ghOutput, ghSummary, loadEnv, rel, reportFailedLlmUsage, writeJson } from "./common";
import { langScriptDir } from "../pipeline/lang";
import { parseLangArg } from "./lang-run";
import { draftPlanInLanguage } from "./script-lang";

const HELP = `Черновик сценария для проверки перед рендером.

  npm run script -- --topic "тема" [--format shorts|landscape] [--notes "пожелания"] [--seconds 45] [--out scripts/]
  npm run script -- --plan 08a,08b [--seconds 45]
  npm run script -- --plan 08a --quiz     викторина «Правда или миф?» (Shorts)
  npm run script -- --topic "тема" --cinematic   Shorts в кинорежиме: планы и общий стиль кадров
  npm run script -- --plan 08a --long     «Разбор» 5–8 минут, 16:9, с главами (и с --topic)
  npm run script -- --plan 08a --lang en  ролик на другом языке (en, kk, uz…) → scripts/en/
  npm run script -- --long-plan L01       «Разбор» на тему из content/long-plan.json (коды L01… можно и в --plan)

Файл появится в scripts/<имя>.json. Проверьте факты и текст, затем:
  npm run make -- --script scripts/<имя>.json

--plan — темы из content/plan.json по коду: хук, угол подачи и факты с источниками идут в
пожелания LLM, файл — scripts/sut-<код>-<имя>.json, в плане тема получает status script-ready.
Темы, у которых сценарий уже есть, пропускаются.

--cinematic — Shorts как короткий фильм: у сцен планы (shots) по 2–3 с, общий style кадров,
  текста поверх кадра нет (только субтитры). Кадры — AI-генерация (VISUALS: cloudflare, pollinations).
--quiz — Shorts из 2 раундов (с --seconds 60 и больше — до 3): утверждение → пауза с отсчётом → «Правда»/«Миф» → ответ.
--long — «Разбор» (по умолчанию ${LONG_DEFAULT_SECONDS} с, 25–45 сцен, главы с карточками и таймкодами в описании).
  С --plan файл — scripts/razbor-<код>-<имя>.json: Shorts той же темы и план не трогаются.
  Озвучка: ~7 минут — это ~7000 символов, Gemini TTS режет их на запросы по
  GEMINI_TTS_BATCH_CHARS (2500) → ~3 запроса из ~10 бесплатных в сутки. Кончилась квота —
  Gemini переходит на запасную модель, а если и её нет — весь ролик переозвучит Edge
  (затем Piper, офлайн): голос будет другим. Надёжнее собирать «Разбор» с --voice edge,
  если в этот день уже делали несколько роликов.

--long-plan — третий поток канала: «Разборы» на свои темы (их нет среди Shorts), вт/чт/сб 21:00.
  Темы — content/long-plan.json (npm run plan-extend -- --long), файл — scripts/razbor-L01-<имя>.json,
  в длинном плане тема получает status script-ready. Видео — L01-<имя>.mp4 (пакет с plan = L01).

--lang — язык ролика: с --plan русский сценарий темы переводится (те же сцены, факты и числа;
  хук и призыв — как у носителя), а если его нет — пишется сразу на этом языке по плану;
  с --topic — сразу на этом языке. Файлы — scripts/<язык>/, канал — channels/<язык>.json.

Сценарист видит, что уже было на канале (сценарии scripts/ и факты готовых тем плана), и не
повторяет это; почти дословный повтор он один раз переписывает, иначе — замечание.
Заголовок и теги подсказывает поиск YouTube (YT_SUGGEST=0 — выключить).
Расход LLM пишется в content/usage.jsonl (USAGE_LOG=0 — выключить).
`;

const PLAN_FILE = path.join(ROOT, "content", "plan.json");
const LONG_PLAN_PATH = path.join(ROOT, ...LONG_PLAN_FILE.split("/"));

function uniquePath(dir: string, slug: string): string {
  let file = path.join(dir, `${slug}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${slug}-${i}.json`);
  return file;
}

interface Mode {
  long: boolean;
  quiz: boolean;
  cinematic?: boolean;
}

interface PlanDraft {
  item: PlanItem;
  file?: string; // scripts/sut-08a-….json — написан сейчас или уже был (skipped)
  script?: VideoScript;
  cost: number;
  warnings: string[];
  skipped?: boolean;
  error?: string;
}

// Журнал расхода: каждый запрос к LLM — строкой в content/usage.jsonl.
const usageCollector = (code: string | null) => collectLlmUsage(ROOT, code);

// «Разбор» по теме плана: свой префикс, чтобы его не принимали за Shorts этой темы
// (панель и пакетная сборка ищут scripts/sut-<код>-*.json).
const longPrefix = (code: string) => `razbor-${code}-`;

function readPlanFile(file: string, parse: (json: unknown) => ContentPlan): ContentPlan {
  try {
    return parse(fs.existsSync(file) || file === PLAN_FILE ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) : null);
  } catch (e) {
    throw new UserError(`Не прочитать ${rel(file)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Сценарии по темам плана: по одной, план сохраняется после каждой — сбой на следующей
// теме не теряет готовые (в Actions их закоммитит следующий шаг). Коды «L01» — темы
// «Разбора» из content/long-plan.json: их можно передать и в --plan (так зовёт workflow).
async function draftFromPlan(codesArg: string, seconds: number | undefined, mode: Mode): Promise<void> {
  const outDir = path.join(ROOT, "scripts");
  const raw = [...new Set(codesArg.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean))];
  if (!raw.length) throw new UserError(`--plan: укажите коды тем через запятую, например 08a,08b (или L01 — «Разбор»).\n\n${HELP}`);
  const codes = raw.map((c) => normCode(c) ?? c.toLowerCase());
  const longCodes = codes.filter((c) => isLongCode(c));
  const plan = readPlanFile(PLAN_FILE, parsePlan);
  const longPlan = longCodes.length ? readPlanFile(LONG_PLAN_PATH, parseLongPlan) : { items: [] };
  const unknown = codes.filter((c) => (isLongCode(c) ? !longPlan.items.some((i) => i.id === c) : !PLAN_CODE.test(c) || !plan.items.some((i) => i.id === c)));
  if (unknown.length) throw new UserError(`--plan: нет таких тем в ${rel(PLAN_FILE)}${longCodes.length ? ` и ${rel(LONG_PLAN_PATH)}` : ""}: ${unknown.join(", ")}`);
  if (longCodes.length && mode.quiz) throw new UserError(`--quiz — только Shorts, а ${longCodes.join(", ")} — «Разборы».`);
  const existing = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".json")) : [];
  const anyLong = mode.long || longCodes.length === codes.length;
  const format: Format = anyLong ? "landscape" : "shorts";
  const kindLabel = anyLong ? "«Разбор»" : mode.quiz ? "викторина" : longCodes.length ? "Shorts и «Разборы»" : "Shorts";
  // «Уже было» для «Разбора» по длинному плану — ещё и темы этого плана.
  const coveredPlan: ContentPlan = { ...plan, items: [...plan.items, ...longPlan.items] };

  console.log(`video-studio · сценарии по плану (${kindLabel}): ${codes.join(", ")}`);
  const results: PlanDraft[] = [];
  for (const code of codes) {
    const fromLong = isLongCode(code);
    const long = mode.long || fromLong;
    const item = (fromLong ? longPlan : plan).items.find((i) => i.id === code)!;
    const have = fromLong
      ? existing.find((f) => scriptCode(f) === code) ?? (item.script && fs.existsSync(path.join(ROOT, item.script)) ? path.basename(item.script) : undefined)
      : mode.long
        ? existing.find((f) => f.startsWith(longPrefix(code)))
        : existing.find((f) => scriptCode(f) === code) ?? (item.script && fs.existsSync(path.join(ROOT, item.script)) ? path.basename(item.script) : undefined);
    if (have) {
      console.log(`  ${code}: сценарий уже есть — scripts/${have}, пропускаю`);
      results.push({ item, file: `scripts/${have}`, cost: 0, warnings: [], skipped: true });
      continue;
    }
    const t0 = Date.now();
    const usage = usageCollector(code);
    let researchCost = 0;
    try {
      // Материал из интернета (факты, эпизоды, линия рассказа, жанр) — один раз на тему:
      // сохраняется в план, повторная генерация его не покупает заново.
      if (!mode.quiz && !item.researched && researchEnabled(process.env)) {
        const r = await researchTopic({ topic: item.title, hook: item.hook, angle: item.angle, facts: item.keyFacts, long }, { onLlmCall: usage.onLlmCall });
        if (r) {
          researchCost = r.usage.reduce((a, u) => a + u.costUsd, 0);
          Object.assign(item, { keyFacts: r.facts, genre: r.genre, story: r.story, researched: new Date().toISOString().slice(0, 10) });
          writeJson(fromLong ? LONG_PLAN_PATH : PLAN_FILE, fromLong ? longPlan : plan);
          console.log(`  ${code}: материал из интернета — +${r.added} пунктов, жанр: ${r.genre === "story" ? "история" : "объяснение"}`);
        }
      }
      const sequel = item.sequelOf ? plan.items.find((i) => i.id === item.sequelOf) ?? null : null;
      const req: ScriptGenRequest = {
        topic: item.title,
        format: long ? "landscape" : "shorts",
        language: "ru",
        notes: fromLong ? longPlanNotes(item) : planNotes(item, { strict: !long, sequel }),
        targetSeconds: seconds,
        long,
        quiz: mode.quiz,
        cinematic: mode.cinematic,
        genre: item.genre,
        // Своя тема (и её «Разбор»/Shorts) повтором не считается.
        covered: loadCovered(ROOT, { plan: coveredPlan, exclude: [code] }),
        searchPhrases: searchPhrases(item.title),
      };
      const { script, usage: spent, warnings: genWarnings } = await generateScript(req, { onLlmCall: usage.onLlmCall });
      const warnings = [...new Set([...genWarnings, ...lintScript(script)])];
      // «Разбор» по длинному плану — razbor-L01-…: по этому префиксу его находят пакет, панель и make.
      const file = uniquePath(outDir, `${long ? longPrefix(code).slice(0, -1) : `sut-${code}`}-${slugify(script.title)}`);
      writeJson(file, script);
      if (fromLong) {
        item.status = "script-ready";
        item.script = rel(file);
        writeJson(LONG_PLAN_PATH, longPlan);
      } else if (!mode.long) {
        item.status = "script-ready";
        item.script = rel(file);
        writeJson(PLAN_FILE, plan);
      }
      const cost = spent.reduce((a, u) => a + u.costUsd, 0) + researchCost;
      console.log(`  ${code}: ✔ ${rel(file)} — «${script.title}», ${script.scenes.length} сцен, $${cost.toFixed(4)}, ${fmtDuration(Date.now() - t0)}`);
      for (const w of warnings) console.log(`    замечание: ${w}`);
      results.push({ item, file: rel(file), script, cost, warnings });
    } catch (e) {
      if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, outDir);
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${code}: ✖ ${msg}`);
      results.push({ item, cost: 0, warnings: [], error: msg });
    } finally {
      usage.flush();
    }
  }

  const written = results.filter((r) => r.script);
  const failed = results.filter((r) => r.error);
  ghOutput({ script_paths: written.map((r) => r.file).join(" "), codes: written.map((r) => r.item.id).join(","), format });
  ghSummary(
    [
      `## 📝 Сценарии по плану (${kindLabel}): ${codes.join(", ")}`,
      "",
      "| Код | Тема | Итог |",
      "|---|---|---|",
      ...results.map((r) => {
        const result = r.script
          ? `✅ \`video-studio/${r.file}\` · «${escapeMd(r.script.title)}» · ${r.script.scenes.length} сцен · $${r.cost.toFixed(4)}${r.warnings.length ? ` · замечания: ${escapeMd(r.warnings.join("; "))}` : ""}`
          : r.skipped
            ? `уже есть: \`video-studio/${r.file}\``
            : `❌ ${escapeMd((r.error ?? "").slice(0, 300))}`;
        return `| ${r.item.id} | ${escapeMd(r.item.title)} | ${result} |`;
      }),
      "",
    ].join("\n"),
  );
  if (written.length) console.log(`\nПроверьте факты и формулировки, затем соберите: npm run make -- --script ${written[0]!.file}`);
  if (failed.length) {
    throw new UserError(`Не написаны: ${failed.map((r) => r.item.id).join(", ")} — причины выше. Готовые сохранены; повторный запуск их пропустит.`);
  }
}

async function main() {
  const t0 = Date.now();
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        topic: { type: "string" },
        plan: { type: "string" },
        "long-plan": { type: "string" },
        format: { type: "string" },
        notes: { type: "string" },
        seconds: { type: "string" },
        out: { type: "string" },
        long: { type: "boolean", default: false },
        quiz: { type: "boolean", default: false },
        cinematic: { type: "boolean", default: false },
        lang: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }).values;
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const topic = typeof values.topic === "string" ? values.topic.trim() : "";
  const longPlanCodes = typeof values["long-plan"] === "string" ? values["long-plan"].trim() : "";
  if (longPlanCodes) {
    if (values.plan) throw new UserError("--plan и --long-plan вместе не нужны: коды L01 можно передать и в --plan.");
    const bad = longPlanCodes.split(/[\s,]+/).filter((c) => c && !isLongCode(c));
    if (bad.length) throw new UserError(`--long-plan: коды «Разборов» вида L01, а не ${bad.join(", ")} (темы Shorts — --plan).`);
  }
  const planCodes = longPlanCodes || (typeof values.plan === "string" ? values.plan.trim() : "");
  const seconds = values.seconds ? Number(values.seconds) : undefined;
  if (seconds !== undefined && !(seconds > 0)) throw new UserError("--seconds: нужно положительное число.");
  const mode: Mode = { long: Boolean(values.long), quiz: Boolean(values.quiz), cinematic: Boolean(values.cinematic) };
  const lang = parseLangArg(typeof values.lang === "string" ? values.lang : undefined) ?? "ru";
  if (mode.long && mode.quiz) throw new UserError("--long и --quiz вместе нельзя: викторина — это Shorts, «Разбор» — длинный ролик.");
  const formatArg = typeof values.format === "string" ? values.format : undefined;
  if (mode.long && formatArg && formatArg !== "landscape") throw new UserError("--long — горизонтальный ролик: уберите --format или укажите --format landscape.");
  if (mode.quiz && formatArg && formatArg !== "shorts") throw new UserError("--quiz — только Shorts: уберите --format или укажите --format shorts.");
  if (mode.cinematic && (mode.long || mode.quiz)) throw new UserError("--cinematic пока только для обычных Shorts: без --long и --quiz.");
  if (mode.cinematic && formatArg && formatArg !== "shorts") throw new UserError("--cinematic — только Shorts: уберите --format или укажите --format shorts.");
  if (mode.cinematic && planCodes.split(/[\s,]+/).some((c) => isLongCode(c))) throw new UserError("--cinematic — только Shorts, а L01… — «Разборы».");
  if (mode.cinematic && lang !== "ru") throw new UserError("--cinematic пока только по-русски — уберите --lang.");
  if (planCodes) {
    if (topic || values.notes || values.out || formatArg) throw new UserError("--plan берёт тему, пожелания, формат и папку из плана — без --topic, --notes, --format и --out.");
    if (lang !== "ru" && planCodes.split(/[\s,]+/).some((c) => isLongCode(c))) throw new UserError("«Разборы» по длинному плану (L01…) пока только по-русски — уберите --lang.");
    if (lang !== "ru") await draftPlanInLanguage(planCodes, lang, seconds, mode, PLAN_FILE);
    else await draftFromPlan(planCodes, seconds, mode);
    return;
  }
  if (!topic) throw new UserError(`Не задана тема: --topic "…" (или --plan 08a для темы из плана)\n\n${HELP}`);
  const format = (mode.long ? "landscape" : (formatArg ?? "shorts")) as Format;
  if (format !== "shorts" && format !== "landscape") throw new UserError(`--format: shorts или landscape, а не «${format}».`);
  const outDir = path.resolve(typeof values.out === "string" ? values.out : path.join(ROOT, langScriptDir(lang)));

  console.log(`video-studio · черновик сценария\n  тема: «${topic}», формат: ${format}${mode.long ? " («Разбор» с главами)" : mode.quiz ? " (викторина)" : mode.cinematic ? " (кинорежим)" : ""}`);
  let generated: Awaited<ReturnType<typeof generateScript>>;
  const usage = usageCollector(null);
  let plan: ContentPlan | null = null;
  try {
    plan = parsePlan(JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")));
  } catch {
    plan = null; // без плана — сверяемся только со сценариями
  }
  let researchCost = 0;
  try {
    const userNotes = typeof values.notes === "string" ? values.notes : undefined;
    // Материал из интернета — и для темы вне плана (по-русски: поиск и правила — русские).
    const r = !mode.quiz && lang === "ru" && researchEnabled(process.env) ? await researchTopic({ topic, facts: [], long: mode.long }, { onLlmCall: usage.onLlmCall }) : null;
    if (r) researchCost = r.usage.reduce((a, u) => a + u.costUsd, 0);
    generated = await generateScript(
      {
        topic,
        format,
        language: lang,
        notes: r ? [userNotes, researchNotes(r, { strict: !mode.long })].filter(Boolean).join("\n") : userNotes,
        targetSeconds: seconds,
        long: mode.long,
        quiz: mode.quiz,
        cinematic: mode.cinematic,
        genre: r?.genre,
        covered: loadCovered(ROOT, { plan }),
        // Подсказки поиска — по русской теме; для другого языка они не к месту.
        searchPhrases: lang === "ru" ? searchPhrases(topic) : undefined,
      },
      { onLlmCall: usage.onLlmCall },
    );
  } catch (e) {
    if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, outDir);
    throw e;
  } finally {
    usage.flush();
  }
  const { script, usage: spent } = generated;
  const warnings = [...new Set([...generated.warnings, ...lintScript(script)])];
  const file = uniquePath(outDir, slugify(script.title));
  writeJson(file, script);

  const cost = spent.reduce((a, u) => a + u.costUsd, 0) + researchCost;
  const last = spent.at(-1);
  const words = script.scenes.reduce((a, s) => a + s.narration.split(/\s+/).filter(Boolean).length, 0);
  console.log(`\n✔ Черновик готов за ${fmtDuration(Date.now() - t0)}: ${rel(file)}`);
  console.log(`  «${script.title}» — ${script.scenes.length} сцен, ~${words} слов (≈${Math.round(words / WORDS_PER_SECOND)} с ролика)`);
  console.log(`  написал: ${last ? `${last.provider} · ${last.model}` : "LLM"}, стоимость $${cost.toFixed(4)}`);
  for (const w of warnings) console.log(`  замечание: ${w}`);
  console.log(`\nПроверьте факты и формулировки, затем:\n  npm run make -- --script ${rel(file)}`);

  const relPath = rel(file);
  // Формат — в подсказку следующего шага: длинному ролику в Actions нужен
  // лимит времени 2 ч (workflow даёт его рендеру) и format = landscape.
  const landscape = script.format === "landscape";
  ghOutput({ script_path: relPath, repo_path: `video-studio/${relPath}`, title: script.title, cost_usd: cost.toFixed(4), format: script.format });
  ghSummary(
    [
      `## 📝 Черновик: ${escapeMd(script.title)}`,
      "",
      `Файл: \`video-studio/${relPath}\` · ${script.scenes.length} сцен · ≈${Math.round(words / WORDS_PER_SECOND)} с · $${cost.toFixed(4)} (${last ? escapeMd(`${last.provider} · ${last.model}`) : "LLM"})`,
      "",
      "| # | Тип | Текст диктора | На экране |",
      "|---|---|---|---|",
      ...script.scenes.map((s) => `| ${s.id} | ${s.kind} | ${escapeMd(s.narration)} | ${escapeMd(s.onScreen)} |`),
      "",
      warnings.length ? `**Замечания:**\n${warnings.map((w) => `- ${escapeMd(w)}`).join("\n")}\n` : "",
      `Проверьте текст и факты (можно прямо на github.com → файл → ✏️), затем запустите workflow ещё раз: **mode = render**, **script** = путь выше${landscape ? ", **format = landscape**" : ""}.`,
      "",
    ].join("\n"),
  );
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
