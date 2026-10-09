// Офлайн-проверка очереди панели: настоящие plan.json, channel.json и week1-videos.json +
// подставные YouTube, релизы и запуски. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/state-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelVideo, FillItem } from "../../src/pipeline/youtube-fill";
import { decideAutopilot } from "../lib/autopilot";
import type { GhRelease, GhRun } from "../lib/github";
import { buildState, parseAutopilot, type StateInput } from "../lib/state";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;
const week1 = (json("content/week1-videos.json") as { videos: FillItem[] }).videos;

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

// 08.10.2026, 15:00 МСК. На канале: 01a вышел в 12:00, 01b–05b стоят на 12:00/19:00 до 12.10;
// в описаниях на YouTube нет строки «Озвучка: …» (её убрали руками), 09a загружен в Studio.
const now = new Date("2026-10-08T12:00:00Z");
const slotsUtc = ["2026-10-08T16:00:00Z", "2026-10-09T09:00:00Z", "2026-10-09T16:00:00Z", "2026-10-10T09:00:00Z", "2026-10-10T16:00:00Z", "2026-10-11T09:00:00Z", "2026-10-11T16:00:00Z", "2026-10-12T09:00:00Z", "2026-10-12T16:00:00Z"];
const onYoutube = (item: FillItem, over: Partial<ChannelVideo>): ChannelVideo => ({
  videoId: `v${item.id}xx`,
  title: item.title,
  description: item.description,
  fileName: `${item.file}.mp4`,
  durationSec: item.durationSec,
  uploadStatus: "processed",
  privacyStatus: "private",
  publishAt: null,
  embeddable: true,
  license: "youtube",
  publicStatsViewable: true,
  tags: item.tags,
  categoryId: item.categoryId,
  publishedAt: "2026-10-07T10:00:00Z",
  thumbnailUrl: `https://i9.ytimg.com/vi/${item.id}/mqdefault.jpg`,
  ...over,
});
const videos: ChannelVideo[] = [
  onYoutube(week1[0]!, { privacyStatus: "public", publishedAt: "2026-10-08T09:00:00Z" }),
  // У 01b описание поправили в Studio — панель должна это заметить и не трогать.
  ...week1.slice(1, 10).map((it, i) => onYoutube(it, { publishAt: slotsUtc[i]!, ...(it.id === "01b" ? { description: `${it.description}\nправка в Studio` } : {}) })),
  { ...onYoutube({ ...week1[0]!, id: "09a", file: "09a-chernovik", title: "09a-chernovik", description: "" }, {}), videoId: "v09axxx", publishedAt: null },
];
const releases: GhRelease[] = [
  {
    id: 1,
    tag_name: "video-08b-x-7-1-2",
    name: "08b",
    html_url: "https://github.com/x/y/releases/tag/video-08b-x-7-1-2",
    created_at: "2026-10-08T08:00:00Z",
    draft: false,
    assets: [
      { id: 11, name: "08b-x.mp4", size: 20_000_000 },
      { id: 12, name: "cover.jpg", size: 100_000 },
      { id: 13, name: "instagram.txt", size: 900 },
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
  created_at: "2026-10-08T11:00:00Z",
  updated_at: "2026-10-08T11:10:00Z",
  html_url: "https://github.com/x/y/actions/runs/1",
  ...over,
});
const input: StateInput = {
  now,
  planJson: json("content/plan.json"),
  channelJson: json("channel.json"),
  scriptFiles: [...fs.readdirSync(path.join(studio, "scripts")), "sut-08a-test.json"],
  fillLists: [json("content/week1-videos.json"), null],
  releases,
  runs: [
    run({ id: 2, display_title: "batch: 10a,10b", status: "in_progress", conclusion: null, created_at: "2026-10-08T11:50:00Z" }),
    run({ id: 3, display_title: "youtube-fill: 01a (проверка)", path: ".github/workflows/video-studio-youtube-fill.yml", conclusion: "failure", created_at: "2026-10-08T11:30:00Z" }),
  ],
  videos,
  youtubeError: null,
  secretNames: ["ANTHROPIC_API_KEY"],
  autopilot: parseAutopilot(null),
  autopilotLast: null,
  repo: "x/y",
  branch: "master",
};
const state = buildState(input);
const row = (code: string) => state.rows.find((r) => r.code === code)!;

test("этапы: вышел, запланирован, видео (неделя 1 — на компьютере, 08b — в релизе), сценарий, в Studio, тема", () => {
  assert.equal(row("01a").stage, "published");
  assert.equal(row("01a").when, "2026-10-08T09:00:00Z");
  for (const c of ["01b", "02a", "05b"]) assert.equal(row(c).stage, "scheduled", c);
  for (const c of ["06a", "07b"]) {
    assert.equal(row(c).stage, "video", c);
    assert.equal(row(c).localVideo, true, c);
  }
  assert.equal(row("08a").stage, "script");
  assert.equal(row("08a").scriptPath, "scripts/sut-08a-test.json");
  assert.equal(row("08b").stage, "video");
  assert.equal(row("08b").release?.mp4.id, 11);
  assert.equal(row("08b").release?.caption?.id, 13);
  assert.equal(row("09a").stage, "studio");
  assert.equal(row("09b").stage, "topic");
  assert.deepEqual(state.counts, { topic: 43, script: 1, video: 5, studio: 1, scheduled: 9, published: 1 });
});

test("ориентир: следующие свободные слоты по порядку плана — с 13.10 12:00 МСК", () => {
  assert.equal(row("06a").when, "2026-10-13T09:00:00Z");
  assert.equal(row("06a").whenExact, false);
  assert.equal(row("06b").when, "2026-10-13T16:00:00Z");
  assert.equal(row("08a").when, "2026-10-15T09:00:00Z");
  assert.equal(row("09a").when, "2026-10-16T09:00:00Z");
  assert.equal(row("06a").timeLabel, "12:00");
  assert.equal(row("06a").dateKey, "2026-10-13");
  assert.equal(state.todayKey, "2026-10-08");
  // По времени: вышедшие и запланированные — раньше ориентиров.
  assert.deepEqual(state.rows.slice(0, 3).map((r) => r.code), ["01a", "01b", "02a"]);
});

test("напоминания: запас расписания, загрузить в Studio, заполнить, тексты отличаются, упавший запуск, ключи, Instagram", () => {
  const text = state.reminders.map((r) => r.text).join("\n");
  assert.match(text, /заполнено до пн, 12\.10 19:00 — осталось 4 дня/);
  assert.match(text, /Ждут загрузки в Studio: 06a, 06b, 07a, 07b, 08b/);
  assert.match(text, /В Studio без времени выхода: 09a/);
  assert.match(text, /Тексты на YouTube отличаются от файла: 01b\./);
  assert.equal(row("02a").textsDiffer, false);
  assert.match(text, /youtube-fill: 01a \(проверка\).*не удался/);
  assert.match(text, /нет: GEMINI_API_KEY — без него .*Edge/);
  assert.doesNotMatch(text, /YT_CLIENT_ID/); // тексты на YouTube ставит сама панель — YT_* в GitHub ей не нужны
  assert.match(text, /затем «Найти новые загрузки»/);
  assert.match(text, /Instagram ждёт токен EAA/);
  assert.equal(row("01b").textsDiffer, true);
});

test("обложки: с YouTube, иначе cover.jpg из релиза, иначе нет (плитка с кодом)", () => {
  assert.equal(row("01b").cover, "https://i9.ytimg.com/vi/01b/mqdefault.jpg");
  assert.equal(row("08b").cover, "/api/asset/12");
  assert.equal(row("08b").release?.thumb, null);
  assert.equal(row("06a").cover, null);
});

test("запуски: коды из названия запуска — «в работе» у роликов", () => {
  assert.equal(row("10a").running, "сценарий и видео в работе");
  assert.equal(row("10b").running, "сценарий и видео в работе");
  assert.equal(row("08a").running, null);
});

test("слоты для переноса: 14 дней, занятые — с кодом", () => {
  assert.equal(state.slotGrid.length, 28);
  assert.deepEqual(state.slotGrid.slice(0, 2).map((c) => [c.iso, c.occupant]), [
    ["2026-10-08T16:00:00Z", "01b"],
    ["2026-10-09T09:00:00Z", "02a"],
  ]);
  assert.equal(state.slotGrid.find((c) => c.iso === "2026-10-13T09:00:00Z")?.occupant, null);
});

test("автопилот: на 3 дня всё готово; на 8 — нужен 08a, но без GEMINI_API_KEY не запускает; с ключом — запускает", () => {
  assert.match(decideAutopilot(state, { enabled: true, days: 3 }, now).skip ?? "", /уже готово/);
  assert.match(decideAutopilot(state, { enabled: true, days: 8 }, now).skip ?? "", /GEMINI_API_KEY/);
  const withKey = buildState({ ...input, secretNames: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"] });
  assert.deepEqual(decideAutopilot(withKey, { enabled: true, days: 8 }, now), { codes: ["08a"], skip: null });
  assert.equal(withKey.missingSecrets?.length, 0);
  assert.match(decideAutopilot({ ...withKey, youtubeError: "квота" }, { enabled: true, days: 8 }, now).skip ?? "", /YouTube недоступен/);
  assert.deepEqual(parseAutopilot('{"enabled":true,"days":40}'), { enabled: true, days: 3 });
});

console.log(`\nВсе проверки панели пройдены: ${passed}.`);
