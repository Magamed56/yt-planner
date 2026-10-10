// Продление плана: N новых тем в content/plan.json — следующие коды по слотам
// канала (30b → 31a, 31b…), рубрики — самые редкие в плане, у каждого факта —
// ссылка на источник (с Claude — из веб-поиска; иначе ссылка проверяется по сети).
//
//   npm run plan-extend -- --count 10 [--dry-run]
//   npm run plan-extend -- --long --count 6   — темы «Разбора» в content/long-plan.json (L01, L02…)
//
// В GitHub Actions — workflow «video-studio: план тем» (video-studio-plan.yml, long = true — «Разборы»).
import { parseArgs } from "node:util";
import type { CoveredEntry } from "../pipeline/script/covered";
import { nextLongPositions } from "../pipeline/long-plan";
import { nextPlanPositions, pickPillars, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { generatePlanItems } from "../pipeline/script/plan-gen";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { ROOT, UserError, argsError, fail, loadEnv } from "./common";
import { LONG_PLAN_PATH, planCovered, readChannelInfo, readLongPlan, readPlan, reportNewTopics, saveLongPlan, savePlan } from "./plan-common";

const HELP = `Новые темы в content/plan.json (Shorts) или content/long-plan.json («Разборы»).

  npm run plan-extend -- --count 10 [--dry-run]
  npm run plan-extend -- --long --count 6 [--dry-run]

--count N   сколько тем добавить (1–30, по умолчанию 10; с --long — 1–12, по умолчанию 6)
--long      темы «Разбора» (~7 минут, 16:9): 8–12 фактов с источниками и набросок глав, коды
            L01, L02… по порядку выхода; ни одна не повторяет темы и факты Shorts и прошлых «Разборов»
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
        count: { type: "string" },
        long: { type: "boolean", default: false },
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
  const long = Boolean(values.long);
  const max = long ? LONG_COUNT_MAX : 30;
  const count = Number(values.count ?? (long ? 6 : 10));
  if (!Number.isInteger(count) || count < 1 || count > max) throw new UserError(`--count: целое число от 1 до ${max}, а не «${String(values.count)}».`);
  const dryRun = Boolean(values["dry-run"]);
  if (long) return extendLong(count, dryRun);

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

// ---- «Разборы»: content/long-plan.json ----

const LONG_COUNT_MAX = 12;
// В одном запросе — не больше 3 тем: у каждой 8–12 фактов, длинный ответ бесплатные модели обрывают.
const LONG_CHUNK = 3;

// «Уже было» для «Разбора»: всё из Shorts (снятое и запланированное) и все темы длинного плана.
function longCovered(shorts: ContentPlan, longPlan: ContentPlan): CoveredEntry[] {
  const covered = planCovered(shorts);
  for (const it of longPlan.items) {
    const claims = it.keyFacts.map((f) => f.claim.trim()).filter(Boolean);
    if (claims.length && !covered.some((e) => e.code === it.id)) covered.push({ code: it.id, title: it.title, texts: claims });
  }
  return covered;
}

async function extendLong(count: number, dryRun: boolean): Promise<void> {
  const shorts = readPlan();
  const longPlan = readLongPlan();
  const { channel, pillars, longTime } = readChannelInfo(longPlan.pillars?.length ? longPlan : shorts);
  const positions = nextLongPositions(longPlan, count, longTime);
  const chosen = pickPillars(longPlan, positions, pillars.map((p) => p.id));
  const title = (id: string) => pillars.find((p) => p.id === id)?.title ?? id;
  console.log(`video-studio · новые темы «Разбора»: ${positions.map((p, i) => `${p.id} (${title(chosen[i]!)})`).join(", ")}`);

  const env = { ...process.env };
  if (/^(claude|anthropic)$/i.test(env.LLM_PROVIDER?.trim() ?? "") && !env.LLM_TIMEOUT_MS) env.LLM_TIMEOUT_MS = "600000";
  const usage = collectLlmUsage(ROOT, null);
  const accepted: PlanItem[] = [];
  const notes: string[] = [];
  let cost = 0;
  try {
    for (let i = 0; i < positions.length; i += LONG_CHUNK) {
      const chunk = positions.slice(i, i + LONG_CHUNK).map((p, k) => ({ ...p, pillar: chosen[i + k]! }));
      // Уже принятые в этом запуске — тоже «было»: следующая пачка их не повторит.
      const soFar: ContentPlan = { ...longPlan, items: [...longPlan.items, ...accepted] };
      const result = await generatePlanItems(
        { plan: soFar, positions: chunk, pillars, channel, covered: longCovered(shorts, soFar), long: true, extraTitles: shorts.items.map((it) => it.title) },
        { env, onLlmCall: usage.onLlmCall },
      );
      accepted.push(...result.items);
      notes.push(...result.notes);
      cost += result.usage.reduce((a, u) => a + u.costUsd, 0);
    }
  } finally {
    usage.flush();
  }

  // Коды подряд, без дыр: принятые темы занимают первые позиции по порядку.
  const items = accepted.map((it, i) => ({ ...it, id: positions[i]!.id, day: positions[i]!.day, slot: positions[i]!.slot }));
  const moved = accepted.map((it, i) => (it.id !== items[i]!.id ? `${it.id} → ${items[i]!.id}` : "")).filter(Boolean);
  if (moved.length) notes.push(`коды сдвинуты, чтобы в плане не было пропусков: ${moved.join(", ")}`);
  const missing = positions.slice(items.length).map((p) => p.id);
  if (items.length && !dryRun) saveLongPlan(longPlan, items);
  reportNewTopics("Новые темы «Разбора»", items, notes, missing, dryRun, title, LONG_PLAN_PATH);
  console.log(`  стоимость LLM: $${cost.toFixed(4)}`);
  if (!items.length) throw new UserError("Ни одной новой темы «Разбора» с проверенными источниками — причины в замечаниях выше. Попробуйте ещё раз или другой LLM_PROVIDER.");
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
