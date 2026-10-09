// Новые названия для роликов со слабым стартом: 3–5 вариантов на код в content/title-ideas.json.
//
//   npm run title-ideas -- 08a,08b [--dry-run]
//
// Опора — тема плана (хук, угол), нынешнее название (с YouTube, если заданы YT_*, иначе из
// content/videos.json) и подсказки поиска YouTube. LLM — та же цепочка, что у сценариев
// (LLM_PROVIDER), расход — в content/usage.jsonl. Применяет названия панель («Статистика»).
// В GitHub Actions — workflow «video-studio: названия» (video-studio-titles.yml).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PLAN_CODE } from "../pipeline/plan";
import { suggestEnabled, suggestionsFor } from "../pipeline/script/suggest";
import { generateTitleIdeas } from "../pipeline/script/title-gen";
import { envNumber } from "../pipeline/script/llm/types";
import { collectLlmUsage, usageNow } from "../pipeline/script/usage-log";
import { mergeTitleIdeas, parseTitleIdeas, TITLE_IDEAS_FILE, type TitleIdeasEntry } from "../pipeline/title-ideas";
import { missingYoutubeEnv, youtubeAuth } from "../pipeline/youtube";
import { fillItemsOf, listChannelVideos, matchVideos, type FillItem } from "../pipeline/youtube-fill";
import { ROOT, UserError, argsError, escapeMd, fail, ghSummary, loadEnv, rel, writeJson } from "./common";
import { readChannelInfo, readPlan } from "./plan-common";

const HELP = `Новые названия для роликов со слабым стартом → ${TITLE_IDEAS_FILE}.

  npm run title-ideas -- 08a,08b [--dry-run]

коды        ролики плана через запятую или пробел (до 10)
--dry-run   показать варианты, но файл не записывать

LLM — как у сценариев (LLM_PROVIDER, GEMINI_API_KEY / ANTHROPIC_API_KEY…). С YT_CLIENT_ID,
YT_CLIENT_SECRET и YT_REFRESH_TOKEN нынешнее название берётся с YouTube (≈ 3 единицы квоты),
без них — из content/week1-videos.json и content/videos.json. YT_SUGGEST=0 — без подсказок поиска.
`;

const MAX_CODES = 10;
const FILE = path.join(ROOT, ...TITLE_IDEAS_FILE.split("/"));

function readJsonFile(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new UserError(`${rel(file)}: битый JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
}

function parseCodes(args: string[]): string[] {
  const codes = [...new Set(args.flatMap((a) => a.split(/[\s,;]+/)).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const bad = codes.filter((c) => !PLAN_CODE.test(c));
  if (bad.length) throw new UserError(`Неверные коды: ${bad.join(", ")} — нужны коды плана вида 08a.`);
  if (!codes.length) throw new UserError(`Укажите коды роликов.\n\n${HELP}`);
  if (codes.length > MAX_CODES) throw new UserError(`Не больше ${MAX_CODES} роликов за раз (указано ${codes.length}).`);
  return codes;
}

// Нынешние названия с YouTube: в Studio их могли поменять после content/videos.json.
async function youtubeTitles(items: FillItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (missingYoutubeEnv().length) {
    console.log("  YT_* не заданы — нынешние названия беру из content/videos.json");
    return out;
  }
  try {
    const videos = await listChannelVideos({ auth: youtubeAuth(), log: (m) => console.log(`  ${m}`) }, 200, { search: false });
    for (const m of matchVideos(items, videos).matches) out.set(m.item.id.toLowerCase(), m.video.title);
  } catch (e) {
    console.warn(`  ⚠ YouTube недоступен (${e instanceof Error ? e.message : String(e)}) — названия из content/videos.json`);
  }
  return out;
}

async function main() {
  loadEnv();
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        codes: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (parsed.values.help) {
    console.log(HELP);
    return;
  }
  const codes = parseCodes([...(typeof parsed.values.codes === "string" ? [parsed.values.codes] : []), ...parsed.positionals]);
  const dryRun = parsed.values["dry-run"] === true;

  const plan = readPlan();
  const { channel, pillars } = readChannelInfo(plan);
  const unknown = codes.filter((c) => !plan.items.some((i) => i.id === c));
  if (unknown.length) throw new UserError(`Нет в content/plan.json: ${unknown.join(", ")}.`);

  // Тексты роликов (что ставили на YouTube) + темы плана без текстов — чтобы найти видео по коду.
  const items: FillItem[] = [];
  for (const f of ["week1-videos.json", "videos.json"]) {
    for (const it of fillItemsOf(readJsonFile(path.join(ROOT, "content", f)))) if (!items.some((x) => x.id === it.id)) items.push(it);
  }
  for (const it of plan.items) {
    if (!items.some((x) => x.id === it.id)) {
      items.push({ id: it.id, file: it.id, durationSec: Number.NaN, title: it.title, description: "", tags: [], categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true });
    }
  }
  console.log(`video-studio · новые названия: ${codes.join(", ")}${dryRun ? " (--dry-run: файл не записываю)" : ""}`);
  const onYoutube = await youtubeTitles(items);

  const env = process.env;
  const entries: TitleIdeasEntry[] = [];
  const problems: string[] = [];
  for (const code of codes) {
    const topic = plan.items.find((i) => i.id === code)!;
    const fill = items.find((i) => i.id === code);
    const current = onYoutube.get(code) ?? fill?.title ?? topic.title;
    const phrases = [topic.title, current].filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 2);
    const suggestions = suggestEnabled(env)
      ? await suggestionsFor(phrases, { fetch: (i, init) => fetch(i, init), timeoutMs: envNumber(env, "YT_SUGGEST_TIMEOUT_MS", 4000), lang: "ru" })
      : [];
    console.log(`\n▶ ${code} · «${current}»${suggestions.length ? ` · подсказок поиска: ${suggestions.length}` : ""}`);
    const usage = collectLlmUsage(ROOT, code);
    try {
      const r = await generateTitleIdeas({
        code,
        current,
        topic: { title: topic.title, hook: topic.hook, angle: topic.angle, pillarTitle: pillars.find((p) => p.id === topic.pillar)?.title ?? null },
        description: fill?.description ?? null,
        suggestions,
        channel: { name: channel.name ?? null, audience: channel.audience ?? null },
      }, { env, onLlmCall: usage.onLlmCall });
      entries.push({ code, at: usageNow(), current, ideas: r.ideas, model: r.model });
      for (const t of r.ideas) console.log(`  — ${t}`);
      const cost = r.usage.reduce((a, u) => a + u.costUsd, 0);
      if (cost > 0) console.log(`  стоимость LLM: $${cost.toFixed(4)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      problems.push(`${code}: ${msg}`);
      console.warn(`  ✖ ${msg}`);
    } finally {
      usage.flush();
    }
  }

  if (entries.length && !dryRun) {
    const next = mergeTitleIdeas(parseTitleIdeas(readJsonFile(FILE)), entries);
    writeJson(FILE, next);
    console.log(`\n✔ ${rel(FILE)}: идеи для ${entries.map((e) => e.code).join(", ")}`);
  }
  ghSummary(
    [
      `## ✏️ Новые названия: ${entries.length} из ${codes.length}`,
      "",
      ...entries.flatMap((e) => [`**${e.code}** — было «${escapeMd(e.current)}»`, "", ...e.ideas.map((t) => `- ${escapeMd(t)}`), ""]),
      problems.length ? `Не вышло:\n\n${problems.map((p) => `- ${escapeMd(p)}`).join("\n")}\n` : "",
      entries.length ? "Применить — панель → «Статистика» → «Слабый старт»." : "",
    ].join("\n"),
  );
  if (!entries.length) throw new UserError(`Ни одного варианта: ${problems.join("; ")}`);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
