// Сценарии на другом языке по темам плана: npm run script -- --plan 08a,08b --lang en.
// Есть русский сценарий темы — переводим его (те же сцены, факты и числа; хук и призыв — как
// у носителя языка); нет — пишем сразу на этом языке по плану (хук, угол, факты с источниками).
// Файлы — scripts/<язык>/sut-08a-<имя>.json: пакет, панель и проверка повторов ищут русские
// сценарии только в scripts/, перевод их не путает. План (status) не меняется — он про русский.
import fs from "node:fs";
import path from "node:path";
import type { Format, VideoScript } from "../types";
import { langInfo, langScriptDir } from "../pipeline/lang";
import { parsePlan, planNotes, PLAN_CODE, scriptCode, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { generateScript, lintScript, ScriptGenerationError } from "../pipeline/script/index";
import { translateScript } from "../pipeline/script/translate";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { slugify } from "../pipeline/slug";
import { ROOT, UserError, escapeMd, fmtDuration, ghOutput, ghSummary, rel, reportFailedLlmUsage, writeJson } from "./common";
import { loadScriptFile } from "./scriptFile";

export interface LangDraftMode {
  long: boolean;
  quiz: boolean;
}

// Факты темы с источниками — переводчику для сверки, а не для новых фраз.
export function factsNote(item: Pick<PlanItem, "keyFacts">): string {
  if (!item.keyFacts.length) return "";
  return `Факты темы с источниками (для сверки: не меняй их и не добавляй новых):\n${item.keyFacts.map((f, i) => `${i + 1}. ${f.claim.trim()} (${f.source.trim()})`).join("\n")}`;
}

// Имя файла перевода: тот же префикс, что у русского (sut-08a- / razbor-08a-), имя — из нового заголовка.
export function langScriptName(code: string, title: string, long: boolean): string {
  return `${long ? "razbor" : "sut"}-${code}-${slugify(title)}`;
}

function uniquePath(dir: string, base: string): string {
  let file = path.join(dir, `${base}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.json`);
  return file;
}

const jsonFiles = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []);

// Русский сценарий темы: scripts/sut-08a-….json (или путь из плана), для «Разбора» — razbor-08a-….
function russianScript(item: PlanItem, long: boolean): string | null {
  const dir = path.join(ROOT, "scripts");
  const files = jsonFiles(dir);
  const found = long ? files.find((f) => f.startsWith(`razbor-${item.id}-`)) : files.find((f) => scriptCode(f) === item.id);
  if (found) return path.join(dir, found);
  if (!long && item.script && fs.existsSync(path.join(ROOT, item.script))) return path.join(ROOT, item.script);
  return null;
}

interface Result {
  item: PlanItem;
  file?: string;
  script?: VideoScript;
  how?: string; // «перевод scripts/sut-08a-….json» или «по плану»
  cost: number;
  warnings: string[];
  skipped?: boolean;
  error?: string;
}

export async function draftPlanInLanguage(codesArg: string, lang: string, seconds: number | undefined, mode: LangDraftMode, planFile: string): Promise<void> {
  const info = langInfo(lang);
  let plan: ContentPlan;
  try {
    plan = parsePlan(JSON.parse(fs.readFileSync(planFile, "utf8")));
  } catch (e) {
    throw new UserError(`Не прочитать ${rel(planFile)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const codes = [...new Set(codesArg.split(/[\s,]+/).map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (!codes.length) throw new UserError("--plan: укажите коды тем через запятую, например 08a,08b.");
  const unknown = codes.filter((c) => !PLAN_CODE.test(c) || !plan.items.some((i) => i.id === c));
  if (unknown.length) throw new UserError(`--plan: нет таких тем в ${rel(planFile)}: ${unknown.join(", ")}`);
  const outDir = path.join(ROOT, langScriptDir(info.code));
  const format: Format = mode.long ? "landscape" : "shorts";
  const prefix = (code: string) => `${mode.long ? "razbor" : "sut"}-${code}-`;

  console.log(`video-studio · сценарии на «${info.code}» (${info.name}) по плану: ${codes.join(", ")}`);
  const results: Result[] = [];
  for (const code of codes) {
    const item = plan.items.find((i) => i.id === code)!;
    const have = jsonFiles(outDir).find((f) => f.startsWith(prefix(code)));
    if (have) {
      console.log(`  ${code}: уже есть — ${rel(path.join(outDir, have))}, пропускаю`);
      results.push({ item, file: rel(path.join(outDir, have)), cost: 0, warnings: [], skipped: true });
      continue;
    }
    const t0 = Date.now();
    const usage = collectLlmUsage(ROOT, code);
    try {
      const source = russianScript(item, mode.long);
      let script: VideoScript;
      let how: string;
      let cost = 0;
      if (source) {
        const ru = loadScriptFile(source);
        const r = await translateScript(ru, info.code, { notes: factsNote(item), onLlmCall: usage.onLlmCall });
        script = r.script;
        cost = r.usage.reduce((a, u) => a + u.costUsd, 0);
        how = `перевод ${rel(source)}`;
      } else {
        // Русского сценария нет — пишем сразу на языке ролика по плану.
        const sequel = item.sequelOf ? plan.items.find((i) => i.id === item.sequelOf) ?? null : null;
        const r = await generateScript(
          {
            topic: item.title,
            format,
            language: info.code,
            notes: `${planNotes(item, { strict: !mode.long, sequel })}\nПиши весь ролик сразу на языке ${info.name} (${info.code}) — как носитель языка, а не переводом с русского.`,
            targetSeconds: seconds,
            long: mode.long,
            quiz: mode.quiz,
          },
          { onLlmCall: usage.onLlmCall },
        );
        script = r.script;
        cost = r.usage.reduce((a, u) => a + u.costUsd, 0);
        how = "по плану (русского сценария нет)";
      }
      const warnings = lintScript(script);
      const file = uniquePath(outDir, langScriptName(code, script.title, mode.long));
      writeJson(file, script);
      console.log(`  ${code}: ✔ ${rel(file)} — «${script.title}», ${script.scenes.length} сцен, ${how}, $${cost.toFixed(4)}, ${fmtDuration(Date.now() - t0)}`);
      results.push({ item, file: rel(file), script, how, cost, warnings });
    } catch (e) {
      if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, null);
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${code}: ✖ ${msg}`);
      results.push({ item, cost: 0, warnings: [], error: msg });
    } finally {
      usage.flush();
    }
  }

  const written = results.filter((r) => r.script);
  const failed = results.filter((r) => r.error);
  ghOutput({ script_paths: written.map((r) => r.file).join(" "), codes: written.map((r) => r.item.id).join(","), format, lang: info.code });
  ghSummary(
    [
      `## 🌐 Сценарии на «${info.code}» по плану: ${codes.join(", ")}`,
      "",
      "| Код | Тема | Итог |",
      "|---|---|---|",
      ...results.map((r) => {
        const result = r.script
          ? `✅ \`video-studio/${r.file}\` · «${escapeMd(r.script.title)}» · ${escapeMd(r.how ?? "")} · $${r.cost.toFixed(4)}${r.warnings.length ? ` · замечания: ${escapeMd(r.warnings.join("; "))}` : ""}`
          : r.skipped
            ? `уже есть: \`video-studio/${r.file}\``
            : `❌ ${escapeMd((r.error ?? "").slice(0, 300))}`;
        return `| ${r.item.id} | ${escapeMd(r.item.title)} | ${result} |`;
      }),
      "",
    ].join("\n"),
  );
  if (written.length) console.log(`\nПроверьте текст (лучше — носителю языка), затем соберите: npm run make -- --script ${written[0]!.file}`);
  if (failed.length) throw new UserError(`Не написаны: ${failed.map((r) => r.item.id).join(", ")} — причины выше. Готовые сохранены; повторный запуск их пропустит.`);
}
