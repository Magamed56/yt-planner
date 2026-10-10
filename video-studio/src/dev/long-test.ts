// Офлайн-проверка третьего потока — «Разборов» (L01…, 16:9, ~7 минут, вт/чт/сб 21:00):
// коды обоих видов, длинный план, слоты longSlots (DST), youtube-fill без смешения слотов,
// своя обложка (thumbnails.set на подменённом fetch), темы plan-extend --long на подменённом LLM
// и CLI без сети. Ключи и интернет не нужны. Запуск: npx tsx src/dev/long-test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { channelFromJson, longScheduleOf, parseWeekdays, upcomingSlots, type ChannelSchedule } from "../pipeline/channel";
import { codesIn, compareCodes, isLongCode, mp4Code, MP4_WITH_CODE, normCode, stripCode, VIDEO_CODE } from "../pipeline/codes";
import { LONG_MIN_FACTS, longPlanNotes, nextLongPositions, parseLongPlan } from "../pipeline/long-plan";
import { parsePlan, scriptCode, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { codesWithRelease, slugOf } from "../pipeline/release-files";
import { coveredCode, loadCovered } from "../pipeline/script/covered";
import { buildPlanSystemPrompt, generatePlanItems } from "../pipeline/script/plan-gen";
import { matchVideos, planUpdates, setThumbnail, THUMBNAIL_MAX_BYTES, upsertFillItem, type ChannelVideo, type FillItem } from "../pipeline/youtube-fill";

process.env.LLM_BUSY_WAIT_MS = "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8").replace(/^﻿/, "")) as unknown;
const logs: string[] = [];
const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${logs.map((l) => `      | ${l}`).join("\n")}`);
    throw e;
  }
}

await test("коды: Shorts «08a» и «Разбор» «L01» — нормализация, поиск в тексте, файлы видео", () => {
  assert.equal(normCode(" 08A "), "08a");
  assert.equal(normCode("l01"), "L01");
  assert.equal(normCode("L1"), null);
  assert.equal(normCode("108a"), null);
  assert.equal(normCode(42), null);
  assert.ok(VIDEO_CODE.test("08a") && VIDEO_CODE.test("L01") && !VIDEO_CODE.test("l01"), "канонический вид: L заглавная");
  assert.ok(isLongCode("L07") && isLongCode("l07") && !isLongCode("07l"), "07l — Shorts (слот l)");
  assert.deepEqual(codesIn("batch: 08a,L01, 09B"), ["08a", "L01", "09b"]);
  assert.deepEqual(codesIn("plan: +10 тем"), []);
  assert.deepEqual(codesIn("draft: L01-chto-takoe и L01"), ["L01"], "без повторов");
  assert.equal(mp4Code("08a-pochemu.mp4"), "08a");
  assert.equal(mp4Code("L01-chto-takoe-vremya.mp4"), "L01");
  assert.equal(mp4Code("en-08a-why.mp4"), null, "другой язык — не ролик русского канала");
  assert.equal(mp4Code("video.mp4"), null);
  assert.ok(MP4_WITH_CODE.test("l02-x.mp4"));
  assert.equal(stripCode("L01-chto-takoe"), "chto-takoe");
  assert.equal(stripCode("08a-pochemu"), "pochemu");
  assert.equal(slugOf("L01-chto-takoe"), "chto-takoe");
  assert.deepEqual(["L02", "09a", "L01", "08b"].sort(compareCodes), ["08b", "09a", "L01", "L02"]);
  assert.deepEqual([...codesWithRelease([{ assets: [{ name: "L01-x.mp4" }, { name: "08A-y.mp4" }, { name: "en-09a-z.mp4" }] }])].sort(), ["08a", "L01"]);
});

await test("сценарии: sut-08a → 08a, razbor-L01 → L01, «Разбор» темы Shorts (razbor-08a) — не сценарий темы", () => {
  assert.equal(scriptCode("scripts/sut-08a-pochemu.json"), "08a");
  assert.equal(scriptCode("C:\\x\\scripts\\sut-12B-abc.json"), "12b");
  assert.equal(scriptCode("scripts/razbor-L01-chto-takoe.json"), "L01");
  assert.equal(scriptCode("razbor-l03-x.json"), "L03");
  assert.equal(scriptCode("scripts/razbor-08a-pochemu.json"), null, "как раньше");
  assert.equal(scriptCode("scripts/sut-L01-x.json"), null, "у «Разбора» префикс razbor-");
  assert.equal(coveredCode("scripts/razbor-08a-x.json"), "08a");
  assert.equal(coveredCode("scripts/razbor-L01-x.json"), "L01");
  assert.equal(coveredCode("scripts/sut-01a-x.json"), "01a");
});

await test("длинный план: пустой файл, проверка кодов, следующие L-коды, пожелания с главами", () => {
  const real = parseLongPlan(readJson("content/long-plan.json"));
  assert.ok(Array.isArray(real.items), "content/long-plan.json читается");
  assert.deepEqual(parseLongPlan(null).items, []);
  assert.throws(() => parseLongPlan({ items: [{ id: "08a", title: "x", keyFacts: [] }] }), /вида «L01»/);
  assert.throws(() => parseLongPlan({ items: [{ id: "L01", title: "x", keyFacts: [] }, { id: "L01", title: "y", keyFacts: [] }] }), /повторяется/);
  assert.throws(() => parseLongPlan({ items: [{ id: "L01", title: "x", keyFacts: [], chapters: "глава" }] }), /chapters/);
  assert.deepEqual(nextLongPositions({ items: [] }, 3, "21:00"), [
    { id: "L01", day: 1, slot: "21:00" },
    { id: "L02", day: 2, slot: "21:00" },
    { id: "L03", day: 3, slot: "21:00" },
  ]);
  assert.deepEqual(nextLongPositions({ items: [{ id: "L05" }, { id: "L02" }] as PlanItem[] }, 1, "21:00").map((p) => p.id), ["L06"]);
  assert.throws(() => nextLongPositions({ items: [{ id: "L99" }] as PlanItem[] }, 1, "21:00"), /L99/);
  // Shorts-план с кодами «Разбора» не путается: parsePlan их по-прежнему не принимает.
  assert.throws(() => parsePlan({ items: [{ id: "L01", title: "x", keyFacts: [] }] }), /вида «08a»/);
  const item = { id: "L01", day: 1, slot: "21:00", pillar: "space", title: "Как устроены чёрные дыры", hook: "Хук.", angle: "Угол.", keyFacts: [{ claim: "Факт", source: "https://a.org" }], status: "planned", chapters: ["Что это", "Как нашли"] } as PlanItem;
  const notes = longPlanNotes(item);
  assert.match(notes, /Обязательно используй эти проверенные факты/, "как «Разбор»: общеизвестное можно добавить");
  assert.match(notes, /Набросок глав[^\n]*\n1\. Что это\n2\. Как нашли/);
  assert.doesNotMatch(longPlanNotes({ ...item, chapters: undefined }), /Набросок глав/);
});

const MSK = "Europe/Moscow";
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

await test("слоты «Разборов»: channel.json → вт/чт/сб 21:00, умолчание, DST-безопасно, Shorts как раньше", () => {
  const ch = channelFromJson(readJson("channel.json"));
  assert.deepEqual(ch.schedule, { perDay: 2, publishTimesLocal: ["12:00", "19:00"], timezone: MSK }, "Shorts не изменились");
  assert.deepEqual(longScheduleOf(ch), { perDay: 1, publishTimesLocal: ["21:00"], timezone: MSK, weekdays: [2, 4, 6] });
  // Без longSlots — те же вт/чт/сб 21:00, в поясе канала.
  const bare = channelFromJson({ schedule: { timezone: "Asia/Bishkek" } });
  assert.deepEqual(longScheduleOf(bare), { perDay: 1, publishTimesLocal: ["21:00"], timezone: "Asia/Bishkek", weekdays: [2, 4, 6] });
  assert.deepEqual(longScheduleOf({ schedule: bare.schedule }), longScheduleOf(bare), "старый ChannelConfig без поля");
  assert.deepEqual(channelFromJson({ longSlots: { days: "пн, ср", times: ["20:30", "9:05"] } }).longSchedule?.weekdays, [1, 3]);
  assert.deepEqual(channelFromJson({ longSlots: { days: "пн, ср", times: ["20:30", "9:05"] } }).longSchedule?.publishTimesLocal, ["09:05", "20:30"]);
  assert.deepEqual(parseWeekdays(["tue", "Thursday", "сб", "6", "x", 0]), [0, 2, 4, 6]);
  // Пн 12.10.2026 10:00 МСК → вт 13, чт 15, сб 17 в 21:00 МСК (18:00 UTC).
  const from = new Date("2026-10-12T07:00:00Z");
  const long = longScheduleOf(ch);
  assert.deepEqual(upcomingSlots(long, 3, { from }).map(iso), ["2026-10-13T18:00:00Z", "2026-10-15T18:00:00Z", "2026-10-17T18:00:00Z"]);
  // Занятый вторник пропускается.
  assert.deepEqual(upcomingSlots(long, 1, { from, taken: ["2026-10-13T18:00:00Z"] }).map(iso), ["2026-10-15T18:00:00Z"]);
  // Берлин: 25.10.2026 летнее время кончается — суббота ещё UTC+2, вторник уже UTC+1.
  const berlin: ChannelSchedule = { ...long, timezone: "Europe/Berlin" };
  assert.deepEqual(upcomingSlots(berlin, 2, { from: new Date("2026-10-23T12:00:00Z") }).map(iso), ["2026-10-24T19:00:00Z", "2026-10-27T20:00:00Z"]);
  // Shorts без weekdays — каждый день, как раньше.
  assert.deepEqual(upcomingSlots(ch.schedule, 3, { from }).map(iso), ["2026-10-12T09:00:00Z", "2026-10-12T16:00:00Z", "2026-10-13T09:00:00Z"]);
});

const fill = (id: string, durationSec: number, over: Partial<FillItem> = {}): FillItem => ({
  id,
  file: `${id}-tema-${id.toLowerCase()}`,
  durationSec,
  title: `Ролик ${id}`,
  description: `Описание ${id}`,
  tags: ["наука"],
  categoryId: "27",
  defaultLanguage: "ru",
  containsSyntheticMedia: true,
  ...over,
});
const video = (over: Partial<ChannelVideo>): ChannelVideo => ({
  videoId: "v",
  title: "",
  description: "",
  fileName: null,
  durationSec: 45,
  uploadStatus: "processed",
  privacyStatus: "private",
  publishAt: null,
  embeddable: true,
  license: "youtube",
  publicStatsViewable: true,
  tags: [],
  categoryId: null,
  ...over,
});

await test("youtube-fill: L01 находится по файлу, «Разбор» — в свой слот вт/чт/сб 21:00, Shorts — в 12:00/19:00", () => {
  const items = [fill("09a", 44), fill("L01", 421.5), fill("L02", 400), fill("09b", 50)];
  const videos = [
    video({ videoId: "s9", fileName: "09a-tema-09a.mp4", title: "09a-tema-09a", durationSec: 44 }),
    video({ videoId: "l1", fileName: "L01-tema-l01.mp4", title: "L01-tema-l01", durationSec: 421.5 }),
    // Уже запланированный «Разбор» другого кода занял вторник.
    video({ videoId: "l2", fileName: "L02-tema-l02.mp4", title: "Ролик L02", description: "Описание L02", publishAt: "2026-10-13T18:00:00Z", durationSec: 400, tags: ["наука"], categoryId: "27" }),
    // Черновик с кодом другого «Разбора» по длительности не подбирается (иначе переписали бы чужое видео).
    video({ videoId: "x", fileName: "L09-drugoe.mp4", title: "L09-drugoe", durationSec: 50 }),
  ];
  const report = matchVideos(items, videos);
  assert.deepEqual(report.matches.map((m) => [m.item.id, m.video.videoId, m.by]), [
    ["09a", "s9", "файл"],
    ["L01", "l1", "файл"],
    ["L02", "l2", "файл"],
  ]);
  assert.deepEqual(report.missing.map((i) => i.id), ["09b"]);
  const ch = channelFromJson(readJson("channel.json"));
  const now = new Date("2026-10-12T07:00:00Z");
  const plan = planUpdates(report, { schedule: ch.schedule, longSchedule: longScheduleOf(ch), mode: "slots", now });
  const at = new Map(plan.map((p) => [p.match.item.id, p.publishAt]));
  assert.equal(at.get("09a"), "2026-10-12T09:00:00Z", "Shorts — ближайший 12:00");
  assert.equal(at.get("L01"), "2026-10-15T18:00:00Z", "вторник занят L02 → четверг 21:00");
  assert.equal(at.get("L02"), "2026-10-13T18:00:00Z");
  assert.ok(plan.find((p) => p.match.item.id === "L02")!.keptPublishAt);
  // Без longSchedule — те же вт/чт/сб 21:00 по умолчанию: «Разбор» никогда не встаёт в слот Shorts.
  const plain = planUpdates(report, { schedule: ch.schedule, mode: "slots", now });
  assert.equal(plain.find((p) => p.match.item.id === "L01")!.publishAt, "2026-10-15T18:00:00Z");
  // Только Shorts — поведение прежнее.
  const shortsOnly = planUpdates(matchVideos([fill("09a", 44)], videos.slice(0, 1)), { schedule: ch.schedule, mode: "slots", now });
  assert.deepEqual(shortsOnly.map((p) => p.publishAt), ["2026-10-12T09:00:00Z"]);
  // Список текстов: Shorts по коду, «Разборы» после них.
  assert.deepEqual(upsertFillItem([fill("L01", 1), fill("09a", 1)], fill("08b", 1)).map((i) => i.id), ["08b", "09a", "L01"]);
});

await test("своя обложка «Разбора»: thumbnails.set, отказ неподтверждённому каналу, предел 2 МБ", async () => {
  const auth = { getAccessToken: async () => ({ token: "tok" }) };
  const calls: { url: string; init?: RequestInit }[] = [];
  const ok = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ items: [{ default: { url: "https://i.ytimg.com/x.jpg" } }] }), { status: 200 });
  };
  await setThumbnail({ auth, fetch: ok as typeof fetch }, "abc123XYZ", new Uint8Array([137, 80, 78, 71]), "image/png");
  assert.equal(calls.length, 1);
  const u = new URL(calls[0]!.url);
  assert.equal(u.origin + u.pathname, "https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
  assert.equal(u.searchParams.get("videoId"), "abc123XYZ");
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = new Headers(calls[0]!.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer tok");
  assert.equal(headers.get("content-type"), "image/png");
  const refuse = (status: number, reason: string, message: string) => async () => new Response(JSON.stringify({ error: { code: status, message, errors: [{ reason, message }] } }), { status });
  await assert.rejects(
    setThumbnail({ auth, fetch: refuse(403, "forbidden", "The authenticated user doesn't have permissions to upload and set custom video thumbnails.") as typeof fetch }, "v", new Uint8Array([1]), "image/jpeg"),
    /youtube\.com\/verify.*thumbnail\.png из релиза/s,
  );
  await assert.rejects(setThumbnail({ auth, fetch: refuse(403, "insufficientPermissions", "Insufficient Permission") as typeof fetch }, "v", new Uint8Array([1]), "image/png"), /не хватает прав/);
  await assert.rejects(setThumbnail({ auth, fetch: refuse(400, "invalidImage", "bad") as typeof fetch }, "v", new Uint8Array([1]), "image/png"), /не принял картинку/);
  let touched = false;
  const never = async () => {
    touched = true;
    return new Response("{}");
  };
  await assert.rejects(setThumbnail({ auth, fetch: never as typeof fetch }, "v", new Uint8Array(THUMBNAIL_MAX_BYTES + 1), "image/png"), /до 2 МБ/);
  assert.equal(touched, false, "слишком большой файл не отправляется");
});

// ---- plan-extend --long на подменённом Gemini ----

const chat = (content: string) =>
  new Response(JSON.stringify({ model: "gemini-test", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 4000, completion_tokens: 3000, total_tokens: 7000 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

await test("plan-extend --long: 8–12 фактов, главы, темы Shorts в запросе, тема с 4 живыми фактами — во второй заход", async () => {
  const facts = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ claim: `Проверяемый факт ${from + i} о длинной теме с цифрами ${1900 + from + i}`, source: `https://en.wikipedia.org/wiki/Long_${from + i}` }));
  const round1 = {
    items: [
      { code: "l01", title: "Как люди научились измерять время", hook: "Секунда старше часов.", angle: "От солнца к атомам.", keyFacts: facts(9), chapters: ["1. Солнце и тени", "Механические часы", "Атомная секунда", "Зачем точность"] },
      { code: "L02", title: "Почему океан солёный, а реки нет", hook: "Реки несут соль.", angle: "Круговорот.", keyFacts: facts(4, 20) },
    ],
  };
  const round2 = { items: [{ code: "L02", title: "Почему океан солёный, а реки нет", hook: "Реки несут соль.", angle: "Круговорот солей.", keyFacts: facts(8, 40), chapters: ["Откуда соль", "Куда уходит"] }] };
  const llm = [round1, round2];
  const prompts: { system: string; user: string }[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("generativelanguage")) {
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
      prompts.push({ system: body.messages[0]!.content, user: body.messages.find((m) => m.role === "user")!.content });
      return chat(JSON.stringify(llm.shift()));
    }
    return new Response(null, { status: 200 }); // проверка ссылок
  };
  const longPlan: ContentPlan = { items: [] };
  const res = await generatePlanItems(
    {
      plan: longPlan,
      positions: [
        { id: "L01", day: 1, slot: "21:00", pillar: "history" },
        { id: "L02", day: 2, slot: "21:00", pillar: "nature" },
      ],
      pillars: [{ id: "history", title: "История" }, { id: "nature", title: "Природа и животные" }],
      channel: { name: "Суть за минуту" },
      covered: [],
      long: true,
      extraTitles: ["Почему свой голос на записи звучит чужим"],
    },
    { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fetchFn, log },
  );
  assert.equal(prompts.length, 2, "второй заход — только за L02");
  assert.match(prompts[0]!.system, /«Разборов»/);
  assert.match(prompts[0]!.system, /keyFacts — 8–12 фактов/);
  assert.match(prompts[0]!.system, /"chapters"/);
  assert.match(prompts[0]!.user, /«Почему свой голос на записи звучит чужим»/, "темы Shorts — в запросе, чтобы не повторять");
  assert.match(prompts[0]!.user, /L01 — рубрика «История»/);
  assert.ok(prompts[1]!.user.includes("L02 —") && !prompts[1]!.user.includes("L01 —"));
  assert.deepEqual(res.items.map((i) => i.id), ["L01", "L02"]);
  assert.equal(res.items[0]!.keyFacts.length, 9);
  assert.deepEqual(res.items[0]!.chapters, ["Солнце и тени", "Механические часы", "Атомная секунда", "Зачем точность"], "нумерация из глав убрана");
  assert.equal(res.items[0]!.slot, "21:00");
  assert.equal(res.items[1]!.keyFacts.length, 8);
  assert.ok(res.notes.some((n) => n.includes(`нужно минимум ${LONG_MIN_FACTS}`)), res.notes.join("\n"));
  // Shorts-промпт не изменился.
  assert.match(buildPlanSystemPrompt(false), /^Ты — редактор и фактчекер русскоязычного научно-популярного канала коротких роликов/);
  assert.doesNotMatch(buildPlanSystemPrompt(false), /chapters/);
});

await test("«уже было»: факты тем длинного плана со сценарием, своя тема L01 исключается", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "long-covered-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    const scene = (narration: string) => ({ id: "s1", kind: "statement", narration, onScreen: "x" });
    fs.writeFileSync(path.join(dir, "scripts", "razbor-L01-vremya.json"), JSON.stringify({ title: "Время", scenes: [scene("Атомные часы ошибаются на секунду за миллионы лет")] }));
    fs.writeFileSync(path.join(dir, "scripts", "sut-01a-golos.json"), JSON.stringify({ title: "Голос", scenes: [scene("Голос слышен через кости")] }));
    const all = loadCovered(dir, {});
    assert.deepEqual(all.map((e) => e.code).sort(), ["01a", "L01"]);
    assert.deepEqual(loadCovered(dir, { exclude: ["l01"] }).map((e) => e.code), ["01a"], "exclude — в любом регистре");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- CLI без сети ----

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const cli = (args: string[]) => spawnSync(process.execPath, [tsx, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" }, timeout: 120_000 });

await test("CLI: videos-list принимает L01, script --long-plan проверяет коды до любых запросов", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "long-cli-"));
  try {
    fs.writeFileSync(
      path.join(dir, "youtube.json"),
      JSON.stringify({ title: "Как люди научились измерять время", description: "Описание\n\nТаймкоды:\n0:00 Вступление", tags: ["время"], categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true }),
    );
    const list = path.join(dir, "videos.json");
    fs.writeFileSync(list, JSON.stringify({ about: "тест", videos: [fill("09a", 44)] }));
    const r = cli(["src/cli/videos-list.ts", dir, "--code", "l01", "--file", "L01-kak-lyudi", "--duration", "421.4", "--list", list]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const saved = JSON.parse(fs.readFileSync(list, "utf8")) as { videos: FillItem[] };
    assert.deepEqual(saved.videos.map((v) => v.id), ["09a", "L01"]);
    assert.equal(saved.videos[1]!.file, "L01-kak-lyudi");
    assert.equal(saved.videos[1]!.durationSec, 421.4);
    const bad = cli(["src/cli/videos-list.ts", dir, "--code", "L1", "--file", "L1-x", "--duration", "1", "--list", list]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout + bad.stderr, /«08a» или «L01»/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const notLong = cli(["src/cli/script.ts", "--long-plan", "08a"]);
  assert.notEqual(notLong.status, 0);
  assert.match(notLong.stdout + notLong.stderr, /--long-plan: коды «Разборов» вида L01/);
  const lang = cli(["src/cli/script.ts", "--plan", "L01", "--lang", "en"]);
  assert.notEqual(lang.status, 0);
  assert.match(lang.stdout + lang.stderr, /только по-русски/);
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
