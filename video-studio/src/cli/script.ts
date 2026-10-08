// Черновик сценария для проверки человеком: тема → scripts/<slug>.json.
// Дальше: поправить текст (на ПК или прямо на github.com) и собрать ролик
//   npm run make -- --script scripts/<slug>.json
//
//   npm run script -- --topic "Почему мы забываем" [--format shorts|landscape] [--notes "..."] [--seconds 45]
//   npm run script -- --plan 08a,08b   — темы из content/plan.json: хук, угол и факты с источниками
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Format, VideoScript } from "../types";
import { parsePlan, planNotes, PLAN_CODE, scriptCode, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { generateScript, lintScript, ScriptGenerationError } from "../pipeline/script/index";
import { slugify } from "../pipeline/slug";
import { ROOT, UserError, argsError, escapeMd, fail, fmtDuration, ghOutput, ghSummary, loadEnv, rel, reportFailedLlmUsage, writeJson } from "./common";

const HELP = `Черновик сценария для проверки перед рендером.

  npm run script -- --topic "тема" [--format shorts|landscape] [--notes "пожелания"] [--seconds 45] [--out scripts/]
  npm run script -- --plan 08a,08b [--seconds 45]

Файл появится в scripts/<имя>.json. Проверьте факты и текст, затем:
  npm run make -- --script scripts/<имя>.json

--plan — темы из content/plan.json по коду: хук, угол подачи и факты с источниками идут в
пожелания LLM, файл — scripts/sut-<код>-<имя>.json, в плане тема получает status script-ready.
Темы, у которых сценарий уже есть, пропускаются.
`;

const PLAN_FILE = path.join(ROOT, "content", "plan.json");

function uniquePath(dir: string, slug: string): string {
  let file = path.join(dir, `${slug}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${slug}-${i}.json`);
  return file;
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

// Сценарии по темам плана: по одной, план сохраняется после каждой — сбой на следующей
// теме не теряет готовые (в Actions их закоммитит следующий шаг).
async function draftFromPlan(codesArg: string, seconds: number | undefined): Promise<void> {
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

  console.log(`video-studio · сценарии по плану: ${codes.join(", ")}`);
  const results: PlanDraft[] = [];
  for (const code of codes) {
    const item = plan.items.find((i) => i.id === code)!;
    const have = existing.find((f) => scriptCode(f) === code) ?? (item.script && fs.existsSync(path.join(ROOT, item.script)) ? path.basename(item.script) : undefined);
    if (have) {
      console.log(`  ${code}: сценарий уже есть — scripts/${have}, пропускаю`);
      results.push({ item, file: `scripts/${have}`, cost: 0, warnings: [], skipped: true });
      continue;
    }
    const t0 = Date.now();
    try {
      const { script, usage } = await generateScript({ topic: item.title, format: "shorts", language: "ru", notes: planNotes(item), targetSeconds: seconds });
      const warnings = lintScript(script);
      const file = uniquePath(outDir, `sut-${code}-${slugify(script.title)}`);
      writeJson(file, script);
      item.status = "script-ready";
      item.script = rel(file);
      writeJson(PLAN_FILE, plan);
      const cost = usage.reduce((a, u) => a + u.costUsd, 0);
      console.log(`  ${code}: ✔ ${rel(file)} — «${script.title}», ${script.scenes.length} сцен, $${cost.toFixed(4)}, ${fmtDuration(Date.now() - t0)}`);
      for (const w of warnings) console.log(`    замечание: ${w}`);
      results.push({ item, file: rel(file), script, cost, warnings });
    } catch (e) {
      if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, outDir);
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${code}: ✖ ${msg}`);
      results.push({ item, cost: 0, warnings: [], error: msg });
    }
  }

  const written = results.filter((r) => r.script);
  const failed = results.filter((r) => r.error);
  ghOutput({ script_paths: written.map((r) => r.file).join(" "), codes: written.map((r) => r.item.id).join(","), format: "shorts" });
  ghSummary(
    [
      `## 📝 Сценарии по плану: ${codes.join(", ")}`,
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
        format: { type: "string", default: "shorts" },
        notes: { type: "string" },
        seconds: { type: "string" },
        out: { type: "string" },
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
  if (planCodes) {
    if (topic || values.notes || values.out) throw new UserError("--plan берёт тему, пожелания и папку из плана — без --topic, --notes и --out.");
    await draftFromPlan(planCodes, seconds);
    return;
  }
  if (!topic) throw new UserError(`Не задана тема: --topic "…" (или --plan 08a для темы из плана)\n\n${HELP}`);
  const format = String(values.format) as Format;
  if (format !== "shorts" && format !== "landscape") throw new UserError(`--format: shorts или landscape, а не «${format}».`);
  const outDir = path.resolve(typeof values.out === "string" ? values.out : path.join(ROOT, "scripts"));

  console.log(`video-studio · черновик сценария\n  тема: «${topic}», формат: ${format}`);
  let generated: Awaited<ReturnType<typeof generateScript>>;
  try {
    generated = await generateScript({
      topic,
      format,
      language: "ru",
      notes: typeof values.notes === "string" ? values.notes : undefined,
      targetSeconds: seconds,
    });
  } catch (e) {
    if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, outDir);
    throw e;
  }
  const { script, usage } = generated;
  const warnings = lintScript(script);
  const file = uniquePath(outDir, slugify(script.title));
  writeJson(file, script);

  const cost = usage.reduce((a, u) => a + u.costUsd, 0);
  const last = usage.at(-1);
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
