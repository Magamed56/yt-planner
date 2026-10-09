// Офлайн-проверка операций панели: настройки автопилота, запас сценариев, повтор упавших
// сборок, уборка видео из релизов.
// Сеть и ключи не нужны. Запуск из папки video-studio: npx tsx panel/scripts/ops-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelVideo, FillItem } from "../../src/pipeline/youtube-fill";
import type { GhRelease } from "../lib/github";
import { decideReserve, pickCleanup, pickRetries, releaseVideosOf, RETRY_MAX } from "../lib/ops";
import { buildState, DEFAULT_AUTOPILOT, parseAutopilot, type Row, type RunInfo } from "../lib/state";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

const now = Date.parse("2026-10-09T03:00:00Z");
const run = (over: Partial<RunInfo>): RunInfo => ({
  id: 1,
  workflow: "video-studio: ролик",
  title: "",
  kind: "batch",
  codes: [],
  active: false,
  status: "completed",
  conclusion: "failure",
  createdAt: "2026-10-08T20:00:00Z",
  createdLabel: "",
  url: "",
  attempt: 1,
  ...over,
});
const rowsOf = (list: [string, Row["stage"], string?][]) => list.map(([code, stage, running]) => ({ code, stage, running: running ?? null }) as Row);

async function main() {
  await test("настройки: старый JSON получает умолчания новых полей, кривые значения — тоже", () => {
    assert.deepEqual(parseAutopilot('{"enabled":true,"days":5}'), { ...DEFAULT_AUTOPILOT, enabled: true, days: 5 });
    assert.deepEqual(parseAutopilot(null), DEFAULT_AUTOPILOT);
    assert.equal(DEFAULT_AUTOPILOT.retryFailed, true);
    assert.equal(DEFAULT_AUTOPILOT.keepReleaseDays, 0);
    assert.equal(DEFAULT_AUTOPILOT.scriptReserve, 0);
    assert.deepEqual(parseAutopilot('{"enabled":false,"days":3,"retryFailed":false,"keepReleaseDays":30,"scriptReserve":4}'), {
      enabled: false,
      days: 3,
      retryFailed: false,
      keepReleaseDays: 30,
      scriptReserve: 4,
    });
    const bad = parseAutopilot('{"retryFailed":"нет","keepReleaseDays":-1,"scriptReserve":11}');
    assert.deepEqual([bad.retryFailed, bad.keepReleaseDays, bad.scriptReserve], [true, 0, 0]);
    assert.equal(parseAutopilot('{"keepReleaseDays":null}').keepReleaseDays, 0);
  });

  await test("запас сценариев: ближайшие N тем без видео, кроме собираемых; в работе — не дублирует", () => {
    const rows = rowsOf([
      ["09a", "scheduled"],
      ["09b", "topic"],
      ["10a", "topic", "пишется сценарий"],
      ["10b", "script"],
      ["11a", "topic"],
      ["11b", "topic"],
      ["12a", "topic"],
    ]);
    const runs = [run({ id: 5, kind: "batch", codes: ["09b"], active: true, status: "in_progress", conclusion: null })];
    const state = { rows, runs, missingSecrets: [] as string[] };
    assert.deepEqual(decideReserve(state, 0, [], 6), { codes: [], skip: null });
    // 09b собирается → окно 10a, 10b, 11a: 10a уже пишется, 10b готов → только 11a.
    assert.deepEqual(decideReserve(state, 3, [], 6), { codes: ["11a"], skip: null });
    // 10a только что ушёл в сборку этого же запуска → окно 10b, 11a, 11b.
    assert.deepEqual(decideReserve(state, 3, ["10a"], 6).codes, ["11a", "11b"]);
    assert.deepEqual(decideReserve(state, 3, ["10a"], 1).codes, ["11a"]);
    assert.match(decideReserve(state, 2, [], 6).skip ?? "", /уже есть или пишется/);
    assert.match(decideReserve({ ...state, missingSecrets: ["ANTHROPIC_API_KEY"] }, 3, [], 6).skip ?? "", /ANTHROPIC_API_KEY/);
  });

  await test("повтор упавших: за сутки, с первой попытки, не готовое и не перезапущенное, в лимите озвучек", () => {
    const rows = rowsOf([
      ["10a", "topic"],
      ["10b", "video"],
      ["13a", "topic"],
      ["14a", "script"],
      ["15a", "topic"],
      ["15b", "topic"],
      ["15c", "topic"],
      ["15d", "topic"],
      ["15e", "topic"],
      ["16a", "topic"],
    ]);
    const runs = [
      run({ id: 1, title: "batch: 10a,10b", codes: ["10a", "10b"] }),
      run({ id: 2, title: "batch: 11a", codes: ["11a"], attempt: 2 }),
      run({ id: 3, title: "render: 12a", kind: "render", codes: ["12a"], conclusion: "timed_out", createdAt: "2026-10-07T20:00:00Z" }),
      run({ id: 4, title: "draft: 13a", kind: "draft", codes: ["13a"], createdAt: "2026-10-08T10:00:00Z" }),
      run({ id: 5, title: "batch: 13a", codes: ["13a"], conclusion: "success", createdAt: "2026-10-08T12:00:00Z" }),
      run({ id: 6, title: "youtube-fill: 01a", kind: "fill", codes: ["01a"] }),
      run({ id: 7, title: "draft: 14a", kind: "draft", codes: ["14a"], createdAt: "2026-10-08T22:00:00Z" }),
      run({ id: 8, title: "batch: 15a,…", codes: ["15a", "15b", "15c", "15d", "15e"], createdAt: "2026-10-08T23:00:00Z" }),
      run({ id: 9, title: "draft: 16a", kind: "draft", codes: ["16a"], createdAt: "2026-10-09T01:00:00Z" }),
      run({ id: 10, title: "batch: 16b", codes: ["16b"], conclusion: "cancelled" }),
    ];
    const r = pickRetries(runs, rows, now, 6);
    assert.deepEqual(
      r.runs.map((x) => x.id),
      [1, 9],
    );
    assert.equal(r.skipped.length, 3);
    assert.match(r.skipped.join("\n"), /draft: 13a.*запущено заново/);
    assert.match(r.skipped.join("\n"), /draft: 14a.*уже готово/);
    assert.match(r.skipped.join("\n"), /15a.*лимита озвучек/);
    // Весь лимит потратил автопилот — пакеты не повторяем, черновики (без озвучки) — да.
    assert.deepEqual(
      pickRetries(runs, rows, now, 0).runs.map((x) => x.id),
      [9],
    );
    // 10a автопилот только что отправил в сборку, 16a — в запас сценариев: их не повторяем,
    // и лимит озвучек достаётся пакету 15a–15e.
    const launched = pickRetries(runs, rows, now, 6, { batch: ["10a"], draft: ["16a"] });
    assert.deepEqual(
      launched.runs.map((x) => x.id),
      [8],
    );
    assert.match(launched.skipped.join("\n"), /batch: 10a,10b.*запущено заново/);
    assert.match(launched.skipped.join("\n"), /draft: 16a.*запущено заново/);
    const drafts = ["a", "b", "c", "d"].map((s, i) => run({ id: 20 + i, title: `draft: 2${i}${s}`, kind: "draft", codes: [`2${i}${s}`] }));
    assert.equal(pickRetries(drafts, [], now, 6).runs.length, RETRY_MAX);
    // Запуск без кодов (тема или демо): повторяем, если такой же не запускали заново.
    const topic = run({ id: 30, title: "draft: тема про сон", kind: "draft" });
    assert.deepEqual(
      pickRetries([topic], [], now, 6).runs.map((x) => x.id),
      [30],
    );
    assert.equal(pickRetries([topic, run({ id: 31, title: "draft: тема про сон", kind: "draft", conclusion: "success", createdAt: "2026-10-08T21:00:00Z" })], [], now, 6).runs.length, 0);
  });

  await test("уборка релизов: только mp4 вышедших роликов, старше N дней; 0 — ничего", () => {
    const releases: GhRelease[] = [
      { id: 1, tag_name: "video-01a-x-1-1-1", name: "01a", html_url: "", created_at: "2026-09-30T08:00:00Z", draft: false, assets: [
        { id: 101, name: "01a-x.mp4", size: 20_000_000 },
        { id: 102, name: "captions.srt", size: 2_000 },
        { id: 103, name: "cover.jpg", size: 90_000 },
      ] },
      { id: 2, tag_name: "video-01a-x-2-1-1", name: "01a", html_url: "", created_at: "2026-09-30T09:00:00Z", draft: false, assets: [{ id: 111, name: "01a-x.mp4", size: 21_000_000 }] },
      { id: 3, tag_name: "video-01b-y-3-1-1", name: "01b", html_url: "", created_at: "2026-10-01T08:00:00Z", draft: false, assets: [{ id: 121, name: "01b-y.mp4", size: 19_000_000 }] },
      { id: 4, tag_name: "video-08b-z-4-1-1", name: "08b", html_url: "", created_at: "2026-10-08T08:00:00Z", draft: false, assets: [{ id: 131, name: "08b-z.mp4", size: 18_000_000 }] },
      { id: 5, tag_name: "draft-01a", name: "01a", html_url: "", created_at: "2026-10-01T08:00:00Z", draft: true, assets: [{ id: 141, name: "01a-x.mp4", size: 1 }] },
      { id: 6, tag_name: "video-demo-6-1", name: "demo", html_url: "", created_at: "2026-10-01T08:00:00Z", draft: false, assets: [{ id: 151, name: "video.mp4", size: 1 }] },
    ];
    const published = new Map([
      ["01a", "2026-10-01T09:00:00Z"],
      ["01b", "2026-10-08T16:00:00Z"],
    ]);
    const files = releaseVideosOf(releases, published);
    assert.deepEqual(
      files.map((f) => f.assetId),
      [101, 111, 121],
    );
    assert.deepEqual(pickCleanup(files, 0, now), []);
    assert.deepEqual(
      pickCleanup(files, 7, now).map((f) => f.assetId),
      [101, 111],
    );
    assert.deepEqual(pickCleanup(files, 8, now), []);
  });

  await test("уборка релизов через buildState: 01a вышел — его mp4 в списке, 08b не вышел — нет", () => {
    const week1 = (json("content/week1-videos.json") as { videos: FillItem[] }).videos;
    const it = week1[0]!;
    const video: ChannelVideo = {
      videoId: "v01axx",
      title: it.title,
      description: it.description,
      fileName: `${it.file}.mp4`,
      durationSec: it.durationSec,
      uploadStatus: "processed",
      privacyStatus: "public",
      publishAt: null,
      embeddable: true,
      license: "youtube",
      publicStatsViewable: true,
      tags: it.tags,
      categoryId: it.categoryId,
      publishedAt: "2026-10-01T09:00:00Z",
      thumbnailUrl: null,
    };
    const rel = (id: number, code: string): GhRelease => ({ id, tag_name: `video-${code}`, name: code, html_url: "", created_at: "2026-09-30T08:00:00Z", draft: false, assets: [{ id: id * 10, name: `${code}-x.mp4`, size: 5 }] });
    const state = buildState({
      now: new Date(now),
      planJson: json("content/plan.json"),
      channelJson: json("channel.json"),
      scriptFiles: [],
      fillLists: [json("content/week1-videos.json"), null],
      releases: [rel(1, "01a"), rel(2, "08b")],
      runs: [],
      videos: [video],
      youtubeError: null,
      secretNames: null,
      autopilot: DEFAULT_AUTOPILOT,
      autopilotLast: null,
      repo: "x/y",
      branch: "master",
    });
    assert.equal(state.rows.find((r) => r.code === "01a")?.stage, "published");
    assert.deepEqual(
      state.releaseVideos.map((f) => [f.code, f.assetId, f.publishedAt]),
      [["01a", 10, "2026-10-01T09:00:00Z"]],
    );
  });

  console.log(`\nВсе проверки операций пройдены: ${passed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
