// Черновик сценария для проверки человеком: тема → scripts/<slug>.json.
// Дальше: поправить текст (на ПК или прямо на github.com) и собрать ролик
//   npm run make -- --script scripts/<slug>.json
//
//   npm run script -- --topic "Почему мы забываем" [--format shorts|landscape] [--notes "..."] [--seconds 45]
//   npm run script -- --plan 08a,08b   — темы из content/plan.json: хук, угол и факты с источниками
//   npm run script -- --plan 08a --quiz   — Shorts-викторина «Правда или миф?»
//   npm run script -- --plan 08a --long   — «Разбор» 5–8 мин, 16:9, с главами
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Format, VideoScript } from "../types";
import { parsePlan, planNotes, PLAN_CODE, scriptCode, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { generateScript, lintScript, loadCovered, LONG_DEFAULT_SECONDS, ScriptGenerationError, searchPhrases, type ScriptGenRequest } from "../pipeline/script/index";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { slugify } from "../pipeline/slug";
import { ROOT, UserError, argsError, escapeMd, fail, fmtDuration, ghOutput, ghSummary, loadEnv, rel, reportFailedLlmUsage, writeJson } from "./common";

const HELP = `Черновик сценария для проверки перед рендером.

  npm run script -- --topic "тема" [--format shorts|landscape] [--notes "пожелания"] [--seconds 45] [--out scripts/]
  npm run script -- --plan 08a,08b [--seconds 45]
  npm run script -- --plan 08a --quiz     викторина «Правда или миф?» (Shorts)
  npm run script -- --plan 08a --long     «Разбор» 5–8 минут, 16:9, с главами (и с --topic)

Файл появится в scripts/<имя>.json. Проверьте факты и текст, затем:
  npm run make -- --script scripts/<имя>.json

--plan — темы из content/plan.json по коду: хук, угол подачи и факты с источниками идут в
пожелания LLM, файл — scripts/sut-<код>-<имя>.json, в плане тема получает status script-ready.
Темы, у которых сценарий уже есть, пропускаются.

--quiz — Shorts из 2–3 раундов: утверждение → пауза с отсчётом → «Правда»/«Миф» → ответ.
--long — «Разбор» (по умолчанию ${LONG_DEFAULT_SECONDS} с, 25–45 сцен, главы с карточками и таймкодами в описании).
  С --plan файл — scripts/razbor-<код>-<имя>.json: Shorts той же темы и план не трогаются.
  Озвучка: ~7 минут — это ~7000 символов, Gemini TTS режет их на запросы по
  GEMINI_TTS_BATCH_CHARS (2500) → ~3 запроса из ~10 бесплатных в сутки. Кончилась квота —
  Gemini переходит на запасную модель, а если и её нет — весь ролик переозвучит Edge
  (затем Piper, офлайн): голос будет другим. Надёжнее собирать «Разбор» с --voice edge,
  если в этот день уже делали несколько роликов.

Сценарист видит, что уже было на канале (сценарии scripts/ и факты готовых тем плана), и не
повторяет это; почти дословный повтор он один раз переписывает, иначе — замечание.
Заголовок и теги подсказывает поиск YouTube (YT_SUGGEST=0 — выключить).
Расход LLM пишется в content/usage.jsonl (USAGE_LOG=0 — выключить).
`;

const PLAN_FILE = path.join(ROOT, "content", "plan.json");

function uniquePath(dir: string, slug: string): string {
  let file = path.join(dir, `${slug}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${slug}-${i}.json`);
  return file;
}

interface Mode {
  long: boolean;
  quiz: boolean;
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

// Сценарии по темам плана: по одной, план сохраняется после каждой — сбой на следующей
// теме не теряет готовые (в Actions их закоммитит следующий шаг).
async function draftFromPlan(codesArg: string, seconds: number | undefined, mode: Mode): Promise<void> {
  const outDir = path.join(ROOT, "scripts");
  let plan: ContentPlan;
  try {
    plan = parsePlan(JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")));
  } catch (e) {
    throw new UserError(`Не прочитать ${rel(PLAN_FILE)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const codes = [...new Set(codesArg.split(/[\s,]+/).map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (!codes.length) throw new UserError(`--plan: укажите коды тем через запятую, например 08a,08b.\n\n${HELP}`);
  const unknown = codes.filter((c) => !PLAN_CODE.test(c) || !plan.items.some((i) => i.id === c));
  if (unknown.length) throw new UserError(`--plan: нет таких тем в ${rel(PLAN_FILE)}: ${unknown.join(", ")}`);
  const existing = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".json")) : [];
  const format: Format = mode.long ? "landscape" : "shorts";
  const kindLabel = mode.long ? "«Разбор»" : mode.quiz ? "викторина" : "Shorts";

  console.log(`video-studio · сценарии по плану (${kindLabel}): ${codes.join(", ")}`);
  const results: PlanDraft[] = [];
  for (const code of codes) {
    const item = plan.items.find((i) => i.id === code)!;
    const have = mode.long
      ? existing.find((f) => f.startsWith(longPrefix(code)))
      : existing.find((f) => scriptCode(f) === code) ?? (item.script && fs.existsSync(path.join(ROOT, item.script)) ? path.basename(item.script) : undefined);
    if (have) {
      console.log(`  ${code}: сценарий уже есть — scripts/${have}, пропускаю`);
      results.push({ item, file: `scripts/${have}`, cost: 0, warnings: [], skipped: true });
      continue;
    }
    const t0 = Date.now();
    const usage = usageCollector(code);
    try {
      const sequel = item.sequelOf ? plan.items.find((i) => i.id === item.sequelOf) ?? null : null;
      const req: ScriptGenRequest = {
        topic: item.title,
        format,
        language: "ru",
        notes: planNotes(item, { strict: !mode.long, sequel }),
        targetSeconds: seconds,
        long: mode.long,
        quiz: mode.quiz,
        // Своя тема (и её «Разбор»/Shorts) повтором не считается.
        covered: loadCovered(ROOT, { plan, exclude: [code] }),
        searchPhrases: searchPhrases(item.title),
      };
      const { script, usage: spent, warnings: genWarnings } = await generateScript(req, { onLlmCall: usage.onLlmCall });
      const warnings = [...new Set([...genWarnings, ...lintScript(script)])];
      const file = uniquePath(outDir, `${mode.long ? longPrefix(code).slice(0, -1) : `sut-${code}`}-${slugify(script.title)}`);
      writeJson(file, script);
      if (!mode.long) {
        item.status = "script-ready";
        item.script = rel(file);
        writeJson(PLAN_FILE, plan);
      }
      const cost = spent.reduce((a, u) => a + u.costUsd, 0);
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
        format: { type: "string" },
        notes: { type: "string" },
        seconds: { type: "string" },
        out: { type: "string" },
        long: { type: "boolean", default: false },
        quiz: { type: "boolean", default: false },
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
  const planCodes = typeof values.plan === "string" ? values.plan.trim() : "";
  const seconds = values.seconds ? Number(values.seconds) : undefined;
  if (seconds !== undefined && !(seconds > 0)) throw new UserError("--seconds: нужно положительное число.");
  const mode: Mode = { long: Boolean(values.long), quiz: Boolean(values.quiz) };
  if (mode.long && mode.quiz) throw new UserError("--long и --quiz вместе нельзя: викторина — это Shorts, «Разбор» — длинный ролик.");
  const formatArg = typeof values.format === "string" ? values.format : undefined;
  if (mode.long && formatArg && formatArg !== "landscape") throw new UserError("--long — горизонтальный ролик: уберите --format или укажите --format landscape.");
  if (mode.quiz && formatArg && formatArg !== "shorts") throw new UserError("--quiz — только Shorts: уберите --format или укажите --format shorts.");
  if (planCodes) {
    if (topic || values.notes || values.out || formatArg) throw new UserError("--plan берёт тему, пожелания, формат и папку из плана — без --topic, --notes, --format и --out.");
    await draftFromPlan(planCodes, seconds, mode);
    return;
  }
  if (!topic) throw new UserError(`Не задана тема: --topic "…" (или --plan 08a для темы из плана)\n\n${HELP}`);
  const format = (mode.long ? "landscape" : (formatArg ?? "shorts")) as Format;
  if (format !== "shorts" && format !== "landscape") throw new UserError(`--format: shorts или landscape, а не «${format}».`);
  const outDir = path.resolve(typeof values.out === "string" ? values.out : path.join(ROOT, "scripts"));

  console.log(`video-studio · черновик сценария\n  тема: «${topic}», формат: ${format}${mode.long ? " («Разбор» с главами)" : mode.quiz ? " (викторина)" : ""}`);
  let generated: Awaited<ReturnType<typeof generateScript>>;
  const usage = usageCollector(null);
  let plan: ContentPlan | null = null;
  try {
    plan = parsePlan(JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")));
  } catch {
    plan = null; // без плана — сверяемся только со сценариями
  }
  try {
    generated = await generateScript(
      {
        topic,
        format,
        language: "ru",
        notes: typeof values.notes === "string" ? values.notes : undefined,
        targetSeconds: seconds,
        long: mode.long,
        quiz: mode.quiz,
        covered: loadCovered(ROOT, { plan }),
        searchPhrases: searchPhrases(topic),
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

  const cost = spent.reduce((a, u) => a + u.costUsd, 0);
  const last = spent.at(-1);
  const words = script.scenes.reduce((a, s) => a + s.narration.split(/\s+/).filter(Boolean).length, 0);
  console.log(`\n✔ Черновик готов за ${fmtDuration(Date.now() - t0)}: ${rel(file)}`);
  console.log(`  «${script.title}» — ${script.scenes.length} сцен, ~${words} слов (≈${Math.round(words / 2.6)} с озвучки)`);
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
      `Файл: \`video-studio/${relPath}\` · ${script.scenes.length} сцен · ≈${Math.round(words / 2.6)} с · $${cost.toFixed(4)} (${last ? escapeMd(`${last.provider} · ${last.model}`) : "LLM"})`,
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
