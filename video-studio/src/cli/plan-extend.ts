// Продление плана: N новых тем в content/plan.json — следующие коды по слотам
// канала (30b → 31a, 31b…), рубрики — самые редкие в плане, у каждого факта —
// ссылка на источник (с Claude — из веб-поиска; иначе ссылка проверяется по сети).
//
//   npm run plan-extend -- --count 10 [--dry-run]
//
// В GitHub Actions — workflow «video-studio: план тем» (video-studio-plan.yml).
import { parseArgs } from "node:util";
import { nextPlanPositions, pickPillars } from "../pipeline/plan";
import { generatePlanItems } from "../pipeline/script/plan-gen";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { ROOT, UserError, argsError, fail, loadEnv } from "./common";
import { planCovered, readChannelInfo, readPlan, reportNewTopics, savePlan } from "./plan-common";

const HELP = `Новые темы в content/plan.json.

  npm run plan-extend -- --count 10 [--dry-run]

--count N   сколько тем добавить (1–30, по умолчанию 10)
--dry-run   показать темы, но план не записывать

Коды продолжают план по слотам канала (после 30b — 31a, 31b…), рубрики — самые редкие.
Каждому факту нужна ссылка на источник: с LLM_PROVIDER=claude их ищет веб-поиск Claude
($10 за 1000 поисков сверх токенов; PLAN_WEB_SEARCH=0 — без поиска), с бесплатными моделями
ссылка проверяется запросом по сети (PLAN_CHECK_URLS=0 — не проверять). Факт без ссылки или с
битой ссылкой выбрасывается, тема без двух фактов — пропускается.
`;

async function main() {
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        count: { type: "string", default: "10" },
        "dry-run": { type: "boolean", default: false },
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
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new UserError(`--count: целое число от 1 до 30, а не «${String(values.count)}».`);
  const dryRun = Boolean(values["dry-run"]);

  const plan = readPlan();
  const { channel, pillars, slots } = readChannelInfo(plan);
  const positions = nextPlanPositions(plan, count, slots);
  const chosen = pickPillars(plan, positions, pillars.map((p) => p.id));
  const title = (id: string) => pillars.find((p) => p.id === id)?.title ?? id;
  console.log(`video-studio · новые темы плана: ${positions.map((p, i) => `${p.id} (${title(chosen[i]!)})`).join(", ")}`);

  // Поиск источников у Claude идёт минуты — даём запросу больше времени (если не задано своё).
  const env = { ...process.env };
  if (/^(claude|anthropic)$/i.test(env.LLM_PROVIDER?.trim() ?? "") && !env.LLM_TIMEOUT_MS) env.LLM_TIMEOUT_MS = "600000";
  const usage = collectLlmUsage(ROOT, null);
  let result: Awaited<ReturnType<typeof generatePlanItems>>;
  try {
    result = await generatePlanItems(
      {
        plan,
        positions: positions.map((p, i) => ({ ...p, pillar: chosen[i]! })),
        pillars,
        channel,
        covered: planCovered(plan),
      },
      { env, onLlmCall: usage.onLlmCall },
    );
  } finally {
    usage.flush();
  }

  // Без дыр в кодах: принятые темы занимают первые позиции по порядку
  // (иначе пропущенный 31b так и остался бы пустым — следующий запуск начнёт после 32a).
  const items = result.items.map((it, i) => ({ ...it, id: positions[i]!.id, day: positions[i]!.day, slot: positions[i]!.slot }));
  const moved = result.items.map((it, i) => (it.id !== items[i]!.id ? `${it.id} → ${items[i]!.id}` : "")).filter(Boolean);
  if (moved.length) result.notes.push(`коды сдвинуты, чтобы в плане не было пропусков: ${moved.join(", ")}`);
  const missing = positions.slice(items.length).map((p) => p.id);
  const cost = result.usage.reduce((a, u) => a + u.costUsd, 0);
  if (items.length && !dryRun) savePlan(plan, items);
  reportNewTopics("Новые темы плана", items, result.notes, missing, dryRun, title);
  console.log(`  стоимость LLM: $${cost.toFixed(4)}`);
  if (!items.length) throw new UserError("Ни одной новой темы с проверенными источниками — причины в замечаниях выше. Попробуйте ещё раз или другой LLM_PROVIDER.");
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
