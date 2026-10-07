// Черновик сценария для проверки человеком: тема → scripts/<slug>.json.
// Дальше: поправить текст (на ПК или прямо на github.com) и собрать ролик
//   npm run make -- --script scripts/<slug>.json
//
//   npm run script -- --topic "Почему мы забываем" [--format shorts|landscape] [--notes "..."] [--seconds 45]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Format } from "../types";
import { generateScript, lintScript, ScriptGenerationError } from "../pipeline/script/index";
import { slugify } from "../pipeline/slug";
import { ROOT, UserError, argsError, escapeMd, fail, fmtDuration, ghOutput, ghSummary, loadEnv, rel, reportFailedLlmUsage, writeJson } from "./common";

const HELP = `Черновик сценария для проверки перед рендером.

  npm run script -- --topic "тема" [--format shorts|landscape] [--notes "пожелания"] [--seconds 45] [--out scripts/]

Файл появится в scripts/<имя>.json. Проверьте факты и текст, затем:
  npm run make -- --script scripts/<имя>.json
`;

function uniquePath(dir: string, slug: string): string {
  let file = path.join(dir, `${slug}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${slug}-${i}.json`);
  return file;
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
  if (!topic) throw new UserError(`Не задана тема: --topic "…"\n\n${HELP}`);
  const format = String(values.format) as Format;
  if (format !== "shorts" && format !== "landscape") throw new UserError(`--format: shorts или landscape, а не «${format}».`);
  const seconds = values.seconds ? Number(values.seconds) : undefined;
  if (seconds !== undefined && !(seconds > 0)) throw new UserError("--seconds: нужно положительное число.");
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
