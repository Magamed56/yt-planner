// Офлайн-проверка «Разборов» в панели (L01…, 16:9, вт/чт/сб 21:00): строки очереди со значком,
// свои слоты в календаре, Shorts без изменений, автопилот (один «Разбор» за раз, заказ тем),
// коды «L01» в запусках, релизах и очереди. Настоящие plan.json и channel.json, остальное подставное.
// Запуск из папки video-studio: npx tsx panel/scripts/long-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelVideo, FillItem } from "../../src/pipeline/youtube-fill";
import { autopilotPlan, autopilotPreview, decideAutopilot, decideLong, LONG_COST } from "../lib/autopilot-rules";
import type { GhRelease, GhRun } from "../lib/github";
import { decideReserve, releaseVideosOf, retryCost } from "../lib/ops";
import { runLabel } from "../lib/stages";
import { buildState, parseAutopilot, parseQueueOrder, type RunInfo, type StateInput } from "../lib/state";
import { withFixtureSchedule } from "../lib/fixture-channel";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8").replace(/^﻿/, "")) as unknown;

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

// Пн 12.10.2026, 10:00 МСК. «Разборы»: L04 уже стоит на вт 13.10 21:00, L01 собран (релиз),
// у L02 есть сценарий, L03 — только тема.
const now = new Date("2026-10-12T07:00:00Z");
const fact = (n: number) => ({ claim: `Факт ${n}`, source: `https://en.wikipedia.org/wiki/F${n}` });
const topic = (id: string, title: string, pillar: string) => ({ id, day: Number(id.slice(1)), slot: "21:00", pillar, title, hook: "Хук.", angle: "Угол.", keyFacts: [1, 2, 3, 4, 5, 6].map(fact), status: "planned" });
const longPlan = {
  note: "тест",
  pillars: [{ id: "history", title: "История" }],
  items: [topic("L01", "Как люди научились измерять время", "history"), topic("L02", "Почему океан солёный", "nature"), topic("L03", "Как работает память", "mind"), topic("L04", "Кто придумал деньги", "money")],
};
const fill = (id: string, durationSec: number): FillItem => ({
  id,
  file: `${id}-tema`,
  durationSec,
  title: `Ролик ${id}`,
  description: `Описание ${id}`,
  tags: ["наука"],
  categoryId: "27",
  defaultLanguage: "ru",
  containsSyntheticMedia: true,
});
const longVideo: ChannelVideo = {
  videoId: "vL04xxxx",
  title: "Ролик L04",
  description: "Описание L04",
  fileName: "L04-tema.mp4",
  durationSec: 433,
  uploadStatus: "processed",
  privacyStatus: "private",
  publishAt: "2026-10-13T18:00:00Z",
  embeddable: true,
  license: "youtube",
  publicStatsViewable: true,
  tags: ["наука"],
  categoryId: "27",
};
const releases: GhRelease[] = [
  {
    id: 7,
    tag_name: "video-L01-tema-9-1-1",
    name: "L01",
    html_url: "https://github.com/x/y/releases/tag/video-L01-tema-9-1-1",
    created_at: "2026-10-11T08:00:00Z",
    draft: false,
    assets: [
      { id: 71, name: "L01-tema.mp4", size: 180_000_000 },
      { id: 72, name: "thumbnail.png", size: 2_600_000 },
      { id: 73, name: "thumbnail.jpg", size: 400_000 },
      { id: 74, name: "description.txt", size: 3000 },
    ],
  },
];
const run = (over: Partial<GhRun>): GhRun => ({
  id: 1,
  name: "video-studio: ролик",
  display_title: "",
  path: ".github/workflows/video-studio.yml",
  event: "workflow_dispatch",
  status: "completed",
  conclusion: "success",
  created_at: "2026-10-12T05:00:00Z",
  updated_at: "2026-10-12T05:10:00Z",
  html_url: "https://github.com/x/y/actions/runs/1",
  ...over,
});
const base: StateInput = {
  now,
  planJson: read("content/plan.json"),
  channelJson: withFixtureSchedule(read("channel.json")),
  // Настоящие razbor-L*.json не берём: этапы «Разборов» задаёт фикстура withLong ниже.
  scriptFiles: fs.readdirSync(path.join(studio, "scripts")).filter((f) => !f.startsWith("razbor-")),
  fillLists: [read("content/week1-videos.json"), { videos: [fill("L01", 421), fill("L04", 433)] }],
  releases,
  runs: [],
  videos: [longVideo],
  youtubeError: null,
  secretNames: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
  autopilot: parseAutopilot(null),
  autopilotLast: null,
  repo: "x/y",
  branch: "master",
};
const withLong: StateInput = { ...base, longPlanJson: longPlan, scriptFiles: [...base.scriptFiles, "razbor-L02-pochemu-okean.json", "razbor-08a-staryy-razbor.json"] };
const plain = buildState(base);
const state = buildState(withLong);
const row = (code: string) => state.rows.find((r) => r.code === code)!;
const shortsOf = (s: typeof state) => s.rows.filter((r) => !r.long).map((r) => [r.code, r.stage, r.when, r.scriptPath]);

test("строки «Разборов»: значок long, этапы, сценарий razbor-L02, релиз L01 с обложкой .jpg", () => {
  for (const c of ["L01", "L02", "L03", "L04"]) assert.equal(row(c).long, true, c);
  assert.ok(state.rows.filter((r) => /^\d{2}[a-z]$/.test(r.code)).every((r) => r.long === undefined), "у Shorts поля нет");
  assert.deepEqual(["L01", "L02", "L03", "L04"].map((c) => row(c).stage), ["video", "script", "topic", "scheduled"]);
  assert.equal(row("L02").scriptPath, "scripts/razbor-L02-pochemu-okean.json");
  assert.equal(row("L01").release?.mp4.id, 71);
  assert.equal(row("L01").release?.thumbJpg?.id, 73);
  assert.equal(row("L01").hasTexts, true);
  assert.equal(row("L01").pillar, "История");
  assert.equal(row("L04").youtube?.videoId, "vL04xxxx");
});

test("Shorts не изменились: этапы, ориентиры, сетка слотов, запас расписания и темы плана — как без «Разборов»", () => {
  assert.deepEqual(shortsOf(state), shortsOf(plain));
  assert.deepEqual(state.slotGrid, plain.slotGrid);
  assert.deepEqual(state.coverage, plain.coverage);
  assert.deepEqual(state.firstGap, plain.firstGap);
  assert.equal(state.runwayDays, plain.runwayDays);
  assert.equal(state.topicsLeft, plain.topicsLeft);
  assert.equal(state.topicsUntil, plain.topicsUntil);
  assert.equal(row("08a").scriptPath === "scripts/razbor-08a-staryy-razbor.json", false, "«Разбор» темы Shorts — не её сценарий");
  assert.equal(plain.rows.some((r) => r.long), false);
  assert.deepEqual(plain.longSlotTimes, ["21:00"]);
});

test("свои слоты: вт/чт/сб 21:00 МСК, L04 занял вторник, остальные — по очереди плана", () => {
  assert.deepEqual(state.longWeekdays, [2, 4, 6]);
  assert.deepEqual(state.longSlotTimes, ["21:00"]);
  assert.deepEqual(state.longSlotGrid.slice(0, 4).map((c) => [c.iso, c.time, c.occupant]), [
    ["2026-10-13T18:00:00Z", "21:00", "L04"],
    ["2026-10-15T18:00:00Z", "21:00", null],
    ["2026-10-17T18:00:00Z", "21:00", null],
    ["2026-10-20T18:00:00Z", "21:00", null],
  ]);
  assert.ok(state.longSlotGrid.length >= 25, "≈ 60 дней вперёд");
  assert.deepEqual(["L04", "L01", "L02", "L03"].map((c) => [row(c).when, row(c).timeLabel, row(c).whenExact]), [
    ["2026-10-13T18:00:00Z", "21:00", true],
    ["2026-10-15T18:00:00Z", "21:00", false],
    ["2026-10-17T18:00:00Z", "21:00", false],
    ["2026-10-20T18:00:00Z", "21:00", false],
  ]);
  // Ни одна строка Shorts не стоит в 21:00, ни один «Разбор» — в 12:00/19:00.
  assert.ok(state.rows.every((r) => !r.when || (r.long ? r.timeLabel === "21:00" : r.timeLabel !== "21:00")));
  // Порядок выхода «Разборов» — та же переменная очереди, что у Shorts, но только среди своих.
  const swapped = buildState({ ...withLong, queueOrder: ["L03", "L02"] });
  const rowIn = (s: typeof state, c: string) => s.rows.find((r) => r.code === c)!;
  assert.deepEqual(["L03", "L02", "L01"].map((c) => rowIn(swapped, c).when), ["2026-10-15T18:00:00Z", "2026-10-17T18:00:00Z", "2026-10-20T18:00:00Z"]);
  assert.deepEqual(shortsOf(swapped), shortsOf(plain));
});

test("счётчики, напоминания и «Разборы»: L01 ждёт загрузки, тем «Разбора» мало", () => {
  assert.equal(state.counts.video, plain.counts.video + 1, "L01 — этап «Видео»");
  assert.equal(state.longTopicsLeft, 1);
  const upload = state.reminders.find((m) => m.kind === "upload");
  assert.ok(upload?.codes?.includes("L01"), JSON.stringify(upload));
  const long = state.reminders.find((m) => m.kind === "long");
  assert.equal(long?.level, "info");
  assert.match(long?.text ?? "", /без сценария: 1/);
  assert.equal(plain.reminders.some((m) => m.kind === "long"), false, "нет файла длинного плана — не напоминаем");
  const broken = buildState({ ...base, longPlanJson: { items: [{ id: "08a", title: "x", keyFacts: [] }] } });
  assert.match(broken.longPlanError ?? "", /вида «L01»/);
  assert.equal(broken.reminders.find((m) => m.kind === "long")?.level, "warn");
  assert.deepEqual(shortsOf(broken), shortsOf(plain), "битый длинный план не трогает Shorts");
});

test("коды L01 в запусках, очереди, релизах и повторах", () => {
  const s = buildState({ ...withLong, runs: [run({ id: 9, display_title: "batch: L02", status: "in_progress", conclusion: null })] });
  const r9 = s.runs.find((r) => r.id === 9)!;
  assert.deepEqual(r9.codes, ["L02"]);
  assert.equal(r9.label, "Ролик · L02");
  assert.equal(s.rows.find((r) => r.code === "L02")!.running, "сценарий и видео в работе");
  assert.deepEqual(parseQueueOrder('["09a","L01","l02","L1",5,"09a"]'), ["09a", "L01"]);
  assert.equal(retryCost({ kind: "batch", codes: ["L01"] } as RunInfo), LONG_COST);
  assert.equal(retryCost({ kind: "batch", codes: ["08a", "L01"] } as RunInfo), 1 + LONG_COST);
  assert.equal(retryCost({ kind: "batch", codes: ["08a", "08b"] } as RunInfo), 2, "Shorts — как раньше");
  assert.deepEqual(releaseVideosOf(releases, new Map([["L01", "2026-10-15T18:00:00Z"]])).map((f) => [f.code, f.assetId]), [["L01", 71]]);
  assert.equal(runLabel("plan", "plan: +6 тем «Разбор»", []), "План +6 тем «Разбора»");
  assert.equal(runLabel("plan", "plan: +10 тем", []), "План +10 тем");
});

test("автопилот: Shorts — без «Разборов»; «Разбор» — один, в горизонте дней, заказ тем не чаще раза в сутки", () => {
  const settings = { ...parseAutopilot(null), enabled: true, days: 3 };
  // Shorts-решение то же, что без «Разборов».
  assert.deepEqual(decideAutopilot(state, settings, now), decideAutopilot(plain, settings, now));
  // Чт 15.10 21:00 (L01, уже с видео) не нужен; сб 17.10 (L02) — за горизонтом 3 дней.
  const d3 = decideLong(state, settings, now);
  assert.equal(d3.code, null);
  assert.equal(d3.orderTopics, true, "тем без сценария 1 < 3 — заказать");
  const d6 = decideLong(state, { ...settings, days: 6 }, now);
  assert.equal(d6.code, "L02", "ближайший без видео");
  assert.equal(decideLong(state, { ...settings, days: 6, long: false }, now).code, null);
  assert.match(decideLong(state, { ...settings, days: 6, long: false }, now).skip ?? "", /выключены/);
  const ordered = buildState({ ...withLong, runs: [run({ id: 5, name: "video-studio: план тем", path: ".github/workflows/video-studio-plan.yml", display_title: "plan: +6 тем «Разбор»", created_at: "2026-10-12T04:00:00Z" })] });
  const dOrdered = decideLong(ordered, { ...settings, days: 6 }, now);
  assert.equal(dOrdered.orderTopics, false);
  assert.match(dOrdered.topicsNote ?? "", /уже заказаны/);
  assert.equal(decideLong(plain, settings, now).skip, "в плане «Разборов» нет тем");
  // «Разбор» в работе — Shorts за этот запуск не больше AUTOPILOT_MAX − 3; запас сценариев «Разборы» не берёт.
  const p = autopilotPlan(state, { ...settings, days: 6 }, now);
  assert.equal(p.long.code, "L02");
  assert.ok(p.shorts.codes.length <= 3, String(p.shorts.codes));
  assert.ok(p.shorts.codes.every((c) => /^\d{2}[a-z]$/.test(c)));
  assert.ok(decideReserve(state, 10, [], 10).codes.every((c) => /^\d{2}[a-z]$/.test(c)));
  const preview = autopilotPreview(state, { ...settings, days: 6 }, now);
  assert.equal(preview.long?.code, "L02");
  assert.deepEqual(preview.build, decideAutopilot(state, { ...settings, days: 6 }, new Date("2026-10-13T03:00:00Z"), 6 - LONG_COST).codes);
  // Без «Разборов» превью — как раньше.
  const old = autopilotPreview(plain, settings, now);
  assert.deepEqual(old.build, decideAutopilot(plain, settings, new Date("2026-10-13T03:00:00Z")).codes);
});

console.log(`\nВсе проверки «Разборов» в панели пройдены: ${passed}.`);
