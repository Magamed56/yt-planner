// Темы, которые смотрят: Claude предлагает темы массового интереса, YouTube меряет спрос
// (просмотры похожих роликов) → content/topic-ideas.json, список с цифрами — человеку на выбор.
//
//   npm run topic-ideas -- [--shorts 20] [--long 6]
//   npm run topic-ideas -- --add 1,4,7    выбранные номера → в план (Shorts — content/plan.json,
//                                         «Разборы» — content/long-plan.json); факты найдёт
//                                         поиск материала перед сценарием (script/research.ts)
// В GitHub Actions — workflow «video-studio: темы, которые смотрят» (video-studio-topics.yml).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { nextLongPositions } from "../pipeline/long-plan";
import { nextPlanPositions, refreshPlanStats, type PlanItem } from "../pipeline/plan";
import { accessToken } from "../pipeline/google-api";
import { loadCovered } from "../pipeline/script/covered";
import { fmtViews, generateTopicIdeas, type TopicIdea } from "../pipeline/script/topic-ideas";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { missingYoutubeEnv, youtubeAuth } from "../pipeline/youtube";
import { ROOT, UserError, argsError, escapeMd, fail, ghOutput, ghSummary, loadEnv, rel, writeJson } from "./common";
import { LONG_PLAN_PATH, PLAN_FILE, readChannelInfo, readLongPlan, readPlan } from "./plan-common";

const HELP = `Темы, которые смотрят → content/topic-ideas.json.

  npm run topic-ideas -- [--shorts 20] [--long 6]
  npm run topic-ideas -- --add 1,4,7

--shorts N   сколько тем Shorts показать (по умолчанию 20)
--long N     сколько тем «Разбора» показать (по умолчанию 6)
--add 1,4,7  номера из content/topic-ideas.json → в план (Shorts и «Разборы» — каждый в свой)

Темы предлагает LLM сценариев (с ANTHROPIC_API_KEY — с веб-поиском). С YT_CLIENT_ID, YT_CLIENT_SECRET
и YT_REFRESH_TOKEN у каждой темы — просмотры роликов, которые YouTube находит по ней (≈ 101 единица
квоты на тему из 10 000 в сутки); без них — темы без цифр.
`;

const FILE = path.join(ROOT, "content", "topic-ideas.json");

interface IdeasFile {
  generatedAt: string;
  quotaUnits?: number;
  items: (TopicIdea & { n: number; added?: string })[];
}

function readIdeas(): IdeasFile {
  if (!fs.existsSync(FILE)) throw new UserError(`Нет ${rel(FILE)} — сначала: npm run topic-ideas`);
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8").replace(/^﻿/, "")) as IdeasFile;
  } catch (e) {
    throw new UserError(`${rel(FILE)}: битый JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
}

const demandText = (i: TopicIdea) => (i.demand ? `медиана ${fmtViews(i.demand.median)}, максимум ${fmtViews(i.demand.max)}${i.demand.hits1m ? `, миллионников ${i.demand.hits1m}` : ""}` : "не измерено");
const interestText = (i: TopicIdea) => `${i.fresh ? "🔥 свежее · " : ""}${i.interest}${i.interestUrl ? ` (${i.interestUrl}${i.interestSeen ? "" : ", ссылка не из поиска — проверить"})` : ""}`;

async function generate(shorts: number, long: number): Promise<void> {
  const plan = readPlan();
  const longPlan = readLongPlan();
  const { channel, pillars } = readChannelInfo(plan);
  const existing = [...new Set([...plan.items.map((i) => i.title), ...longPlan.items.map((i) => i.title), ...loadCovered(ROOT, { plan }).map((c) => c.title)])];
  let token: string | null = null;
  if (!missingYoutubeEnv().length) {
    try {
      token = await accessToken(youtubeAuth());
    } catch (e) {
      console.warn(`  ⚠ ${e instanceof Error ? e.message : String(e)} — темы без замера спроса`);
    }
  }
  console.log(`video-studio · темы, которые смотрят: Shorts ${shorts}, «Разборы» ${long}${token ? "" : " (без замера спроса на YouTube)"}`);
  const usage = collectLlmUsage(ROOT, null);
  let res: Awaited<ReturnType<typeof generateTopicIdeas>>;
  try {
    res = await generateTopicIdeas({ channel, pillars, shorts, long, existing, youtubeToken: token }, { onLlmCall: usage.onLlmCall });
  } finally {
    usage.flush();
  }
  const out: IdeasFile = { generatedAt: new Date().toISOString(), quotaUnits: res.quotaUnits, items: res.ideas.map((x, i) => ({ n: i + 1, ...x })) };
  writeJson(FILE, out);
  const cost = res.usage.reduce((a, u) => a + u.costUsd, 0);
  console.log(`\n✔ ${rel(FILE)}: ${out.items.length} тем · LLM $${cost.toFixed(4)} · квота YouTube ≈ ${res.quotaUnits}`);
  for (const it of out.items) console.log(`  ${String(it.n).padStart(2)}. [${it.format === "long" ? "Разбор" : "Shorts"}] ${it.title} — YouTube: ${demandText(it)}; интерес: ${interestText(it)}`);
  for (const n of res.notes) console.log(`  замечание: ${n}`);
  ghOutput({ ideas_file: rel(FILE), count: String(out.items.length) });
  ghSummary(
    [
      `## 💡 Темы, которые смотрят (${out.items.length})`,
      "",
      `YouTube — просмотры роликов, которые поиск YouTube находит по запросу темы (регион RU). Интерес — где о теме читают и спорят в интернете. LLM $${cost.toFixed(4)}, квота YouTube ≈ ${res.quotaUnits}.`,
      "",
      "| № | Формат | Тема | YouTube | Интерес в интернете | Почему посмотрят |",
      "|---|---|---|---|---|---|",
      ...out.items.map((it) => `| ${it.n} | ${it.format === "long" ? "Разбор" : "Shorts"} | ${escapeMd(it.title)} | ${escapeMd(demandText(it))} | ${escapeMd(interestText(it))} | ${escapeMd(it.why)} |`),
      "",
      res.notes.length ? `**Замечания:**\n${res.notes.map((n) => `- ${escapeMd(n)}`).join("\n")}\n` : "",
      "Выбранные номера — в план: `npm run topic-ideas -- --add 1,4,7`.",
      "",
    ].join("\n"),
  );
}

// Выбранные идеи → темы плана: Shorts — следующие коды дня (33a…), «Разборы» — L17….
function add(numbers: number[]): void {
  const ideas = readIdeas();
  const picked = numbers.map((n) => {
    const it = ideas.items.find((x) => x.n === n);
    if (!it) throw new UserError(`--add: нет темы №${n} в ${rel(FILE)} (есть 1–${ideas.items.length}).`);
    if (it.added) throw new UserError(`--add: тема №${n} уже в плане (${it.added}).`);
    return it;
  });
  const plan = readPlan();
  const longPlan = readLongPlan();
  const info = readChannelInfo(plan);
  const shorts = picked.filter((p) => p.format === "shorts");
  const longs = picked.filter((p) => p.format === "long");
  const item = (it: TopicIdea, pos: { id: string; day: number; slot: string }): PlanItem => ({
    id: pos.id,
    day: pos.day,
    slot: pos.slot,
    pillar: it.pillar,
    title: it.title,
    hook: it.hook,
    angle: it.why,
    keyFacts: [],
    status: "planned",
    genre: it.genre,
  });
  const added: string[] = [];
  if (shorts.length) {
    const pos = nextPlanPositions(plan, shorts.length, info.slots);
    shorts.forEach((it, i) => {
      plan.items.push(item(it, pos[i]!));
      it.added = pos[i]!.id;
      added.push(`${pos[i]!.id} — ${it.title}`);
    });
    refreshPlanStats(plan);
    writeJson(PLAN_FILE, plan);
  }
  if (longs.length) {
    const pos = nextLongPositions(longPlan, longs.length, info.longTime);
    longs.forEach((it, i) => {
      longPlan.items.push(item(it, pos[i]!));
      it.added = pos[i]!.id;
      added.push(`${pos[i]!.id} — ${it.title}`);
    });
    writeJson(LONG_PLAN_PATH, longPlan);
  }
  writeJson(FILE, ideas);
  console.log(`✔ В план добавлено ${added.length}:\n${added.map((a) => `  ${a}`).join("\n")}`);
  ghOutput({ codes: picked.map((p) => p.added).join(",") });
}

async function main() {
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        shorts: { type: "string" },
        long: { type: "string" },
        add: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }).values;
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (typeof values.add === "string") {
    const nums = [...new Set(values.add.split(/[\s,;]+/).filter(Boolean).map(Number))];
    if (!nums.length || nums.some((n) => !Number.isInteger(n) || n < 1)) throw new UserError(`--add: номера тем через запятую, например 1,4,7 — а не «${values.add}».`);
    add(nums);
    return;
  }
  const count = (v: unknown, def: number, max: number) => {
    const n = v === undefined ? def : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new UserError(`число тем — от 0 до ${max}, а не «${String(v)}».`);
    return n;
  };
  const shorts = count(values.shorts, 20, 40);
  const long = count(values.long, 6, 12);
  if (!shorts && !long) throw new UserError("Нужна хотя бы одна тема: --shorts или --long больше нуля.");
  await generate(shorts, long);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
