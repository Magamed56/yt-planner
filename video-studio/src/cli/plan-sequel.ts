// «Часть 2»: продолжение темы плана новым углом и НОВЫМИ фактами (с источниками).
// Новая тема встаёт на следующий свободный код после последней темы плана,
// название — «<первая часть>. Часть 2», в поле sequelOf — код первой части.
//
//   npm run plan-sequel -- 01a [--dry-run]
import { parseArgs } from "node:util";
import { nextPlanPositions, PLAN_CODE } from "../pipeline/plan";
import { generatePlanItems } from "../pipeline/script/plan-gen";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { ROOT, UserError, argsError, fail, loadEnv } from "./common";
import { planCovered, readChannelInfo, readPlan, reportNewTopics, savePlan } from "./plan-common";

const HELP = `Продолжение темы плана — «Часть 2».

  npm run plan-sequel -- 01a [--dry-run]

Новая тема: та же рубрика, новый угол и 2–4 новых факта с источниками (факты первой части
и всё, что уже было на канале, не повторяются). Код — следующий свободный после последней
темы плана; сценарий потом пишется как обычно: npm run script -- --plan <код>.
`;

async function main() {
  loadEnv();
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (parsed.values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const code = (parsed.positionals[0] ?? "").trim().toLowerCase();
  if (!PLAN_CODE.test(code) || parsed.positionals.length > 1) throw new UserError(`Укажите один код темы, например: npm run plan-sequel -- 01a\n\n${HELP}`);
  const dryRun = Boolean(parsed.values["dry-run"]);

  const plan = readPlan();
  const base = plan.items.find((i) => i.id === code);
  if (!base) throw new UserError(`В content/plan.json нет темы ${code}.`);
  const already = plan.items.find((i) => i.sequelOf === code);
  if (already) throw new UserError(`У ${code} уже есть продолжение — ${already.id} «${already.title}». Следующую часть: npm run plan-sequel -- ${already.id}`);
  const { channel, pillars, slots } = readChannelInfo(plan);
  const position = nextPlanPositions(plan, 1, slots)[0]!;
  const title = (id: string) => pillars.find((p) => p.id === id)?.title ?? id;
  console.log(`video-studio · «Часть 2» для ${code} «${base.title}» → ${position.id}`);

  // Факты первой части (и всех тем плана) — в «уже было», даже если ролик ещё не снят.
  const covered = planCovered(plan);

  const env = { ...process.env };
  if (/^(claude|anthropic)$/i.test(env.LLM_PROVIDER?.trim() ?? "") && !env.LLM_TIMEOUT_MS) env.LLM_TIMEOUT_MS = "600000";
  const usage = collectLlmUsage(ROOT, position.id);
  let result: Awaited<ReturnType<typeof generatePlanItems>>;
  try {
    result = await generatePlanItems({ plan, positions: [{ ...position, pillar: base.pillar }], pillars, channel, covered, sequelOf: base }, { env, onLlmCall: usage.onLlmCall });
  } finally {
    usage.flush();
  }
  const cost = result.usage.reduce((a, u) => a + u.costUsd, 0);
  if (result.items.length && !dryRun) savePlan(plan, result.items);
  reportNewTopics("«Часть 2»", result.items, result.notes, result.missing.map((p) => p.id), dryRun, title);
  console.log(`  стоимость LLM: $${cost.toFixed(4)}`);
  if (!result.items.length) throw new UserError("Продолжение с проверенными источниками не получилось — причины в замечаниях выше. Попробуйте ещё раз или другой LLM_PROVIDER.");
  if (!dryRun) console.log(`\nСценарий: npm run script -- --plan ${result.items[0]!.id}`);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
