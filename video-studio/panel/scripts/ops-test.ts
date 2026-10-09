// Офлайн-проверка операций панели: настройки автопилота, запас сценариев, повтор упавших
// сборок, уборка видео из релизов, правка сценария, пересборка.
// Сеть и ключи не нужны. Запуск из папки video-studio: npx tsx panel/scripts/ops-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ChannelVideo, FillItem } from "../../src/pipeline/youtube-fill";
import { ASSET_CHUNK, assetHeaders, assetType, contentDisposition, parseContentRange, planRange } from "../lib/asset-range";
import { listReleases, nextPage, type GhRelease } from "../lib/github";
import { addDispatch, dispatchConflict, parseDispatches, type RunLike } from "../lib/dispatch-guard";
import { canRetry, DAY_MS, decideReserve, failedRun, pickCleanup, pickRetries, releaseVideosOf, RETRY_MAX } from "../lib/ops";
import { rebuildInputs, DEFAULT_REBUILD } from "../lib/rebuild";
import { applyScriptEdit, checkScriptEdit, countWords, parseTags, SCRIPT_LIMITS, scriptEditOf, scriptFileText, type ScriptEdit } from "../lib/script-edit";
import { buildState, DEFAULT_AUTOPILOT, parseAutopilot, type Row, type RunInfo } from "../lib/state";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// План «как на 08b»: автопилот каждый день дописывает сценарии в plan.json, а проверки порядка тем
// ждут, что дальние темы ещё без сценария.
const FROZEN_AT = "08b";
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;
const json = (p: string): unknown => {
  const data = read(p);
  if (p !== "content/plan.json") return data;
  const plan = data as { items: { id: string }[] };
  return { ...plan, items: plan.items.map((it) => (it.id > FROZEN_AT ? { ...it, status: "planned", script: undefined } : it)) };
};
// validate.ts и schema.ts тянут zod (он есть только в node_modules video-studio): путь — строкой,
// чтобы проверка типов панели (next build) их не разбирала.
const pipeline = (rel: string) => import(pathToFileURL(path.join(studio, "src", "pipeline", "script", rel)).href) as Promise<Record<string, unknown>>;

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
  file: "video-studio.yml",
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
  label: over.label ?? over.title ?? "",
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

  await test("правка сценария: без изменений файл тот же; пределы как в schema.ts; итог проходит validateScript", async () => {
    const file = fs.readdirSync(path.join(studio, "scripts")).find((f) => /^sut-\d{2}[a-z]-.+\.json$/.test(f))!;
    const text = fs.readFileSync(path.join(studio, "scripts", file), "utf8").replace(/\r\n/g, "\n");
    const original = JSON.parse(text) as unknown;
    const edit = scriptEditOf(original);
    assert.deepEqual(checkScriptEdit(edit), [], "настоящий сценарий проходит проверку панели");
    assert.equal(scriptFileText(applyScriptEdit(original, edit)), text, "без правок файл не меняется");

    const { LIMITS } = (await pipeline("schema.ts")) as { LIMITS: Record<string, number> };
    for (const [k, v] of Object.entries(SCRIPT_LIMITS)) assert.equal(v, LIMITS[k], `предел ${k}`);
    const { validateScript } = (await pipeline("validate.ts")) as { validateScript: (j: unknown) => unknown };

    const changed: ScriptEdit = {
      ...edit,
      title: "  Новое название  ",
      tags: parseTags("наука, факты,  наука ,"),
      scenes: edit.scenes.map((s, i) => (i === 1 ? { ...s, narration: "Новый текст диктора.", onScreen: "Новый *акцент*" } : s)),
    };
    assert.deepEqual(changed.tags, ["наука", "факты"]);
    assert.deepEqual(checkScriptEdit(changed), []);
    const saved = applyScriptEdit(original, changed) as { title: string; scenes: Record<string, unknown>[] };
    assert.equal(saved.title, "Новое название");
    assert.equal(saved.scenes[1]!.onScreen, "Новый *акцент*");
    assert.deepEqual(Object.keys(saved.scenes[1]!), Object.keys((original as { scenes: object[] }).scenes[1]!), "остальные поля сцены на месте");
    validateScript(JSON.parse(scriptFileText(saved)));

    const bad: ScriptEdit = {
      ...edit,
      title: "",
      tags: Array.from({ length: 12 }, (_, i) => `очень-длинный-тег-номер-${i}-${"ж".repeat(20)}`),
      scenes: edit.scenes.map((s, i) => (i === 0 ? { ...s, onScreen: "раз два три четыре пять шесть семь восемь девять" } : i === 1 ? { ...s, onScreen: "непарная *звезда" } : s)),
    };
    const problems = checkScriptEdit(bad).join("\n");
    assert.match(problems, /Название пустое/);
    assert.match(problems, /суммарно \d+ символов/);
    assert.match(problems, /Сцена 1.*9 слов/);
    assert.match(problems, /Сцена 2.*непарная/);
    assert.equal(countWords("*Слово* — и ещё 2"), 4);
    const list = edit.scenes.findIndex((s) => s.kind === "list");
    if (list >= 0) {
      const one = { ...edit, scenes: edit.scenes.map((s, i) => (i === list ? { ...s, items: ["один пункт"] } : s)) };
      assert.match(checkScriptEdit(one).join("\n"), /от 2 до 4 пунктов/);
    }
    // Файл успели поменять: сцен стало меньше — правку не накладываем.
    const shorter = { ...(original as object), scenes: (original as { scenes: unknown[] }).scenes.slice(1) };
    assert.throws(() => applyScriptEdit(shorter, edit), /откройте правку заново/);
  });

  await test("пересборка: голос, имя голоса, палитра, музыка → входные данные workflow", () => {
    assert.deepEqual(rebuildInputs("08a", DEFAULT_REBUILD), { mode: "batch", plan: "08a", upload: "release", voice: "auto", theme: "auto" });
    assert.deepEqual(rebuildInputs("08a", { voice: "edge", voiceName: " ru-RU-SvetlanaNeural ", theme: "sunset", music: false }), {
      mode: "batch",
      plan: "08a",
      upload: "release",
      voice: "edge",
      theme: "sunset",
      voice_name: "ru-RU-SvetlanaNeural",
      music: "none",
    });
    assert.throws(() => rebuildInputs("08a", { ...DEFAULT_REBUILD, voice: "elevenlabs" }), /озвучка/);
    assert.throws(() => rebuildInputs("08a", { ...DEFAULT_REBUILD, theme: "neon" }), /палитра/);
    assert.throws(() => rebuildInputs("08a", { ...DEFAULT_REBUILD, voiceName: "Charon; rm -rf" }), /Имя голоса/);
  });

  // workflow: в video-studio.yml есть выбор music (auto, none), и он доходит до MUSIC.
  await test("workflow: поле music (auto | none) и MUSIC=none при выключенной музыке", () => {
    const yml = fs.readFileSync(path.join(studio, "..", ".github", "workflows", "video-studio.yml"), "utf8").replace(/\r\n/g, "\n");
    assert.match(yml, /\n {6}music:\n(?: {8}.+\n)*? {8}options: \[auto, none\]/);
    assert.match(yml, /MUSIC: \$\{\{ inputs\.music == 'none' && 'none' \|\| vars\.MUSIC \}\}/);
  });

  await test("файл через панель: диапазоны кусками ≤ 4 МБ, 416, video/mp4, inline или attachment", () => {
    const size = 20_000_000;
    assert.deepEqual(planRange(null, size), { status: 200 });
    assert.deepEqual(planRange("bytes=0-1", size), { status: 206, start: 0, end: 1 }); // проба Safari
    assert.deepEqual(planRange("bytes=0-", size), { status: 206, start: 0, end: ASSET_CHUNK - 1 });
    assert.deepEqual(planRange("bytes=19000000-", size), { status: 206, start: 19_000_000, end: size - 1 });
    assert.deepEqual(planRange("bytes=0-", size, 0), { status: 206, start: 0, end: size - 1 }, "скачивание файлом — без куска");
    assert.deepEqual(planRange("bytes=-500", size), { status: 206, start: size - 500, end: size - 1 });
    assert.deepEqual(planRange("bytes=0-99999999", 1000), { status: 206, start: 0, end: 999 });
    assert.deepEqual(planRange("bytes=0-1, 5-6", size), { status: 206, start: 0, end: 1 });
    assert.deepEqual(planRange("bytes=5-3", size), { status: 200 }, "кривой диапазон — файл целиком");
    assert.deepEqual(planRange("items=0-5", size), { status: 200 });
    assert.deepEqual(planRange(`bytes=${size}-`, size), { status: 416 });
    assert.deepEqual(planRange("bytes=-0", size), { status: 416 });

    assert.equal(assetType("08a-x.mp4", "application/octet-stream"), "video/mp4");
    assert.equal(assetType("cover.jpg", "application/octet-stream"), "image/jpeg");
    assert.equal(assetType("thumbnail.png", "image/png"), "image/png");
    const part = assetHeaders("08a-x.mp4", "video/mp4", size, { status: 206, start: 4, end: 9 }, false);
    assert.deepEqual(part, {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="08a-x.mp4"; filename*=UTF-8''08a-x.mp4`,
      "Content-Range": `bytes 4-9/${size}`,
      "Content-Length": "6",
    });
    assert.deepEqual(parseContentRange(part["Content-Range"]!), { start: 4, end: 9, total: size });
    const whole = assetHeaders("08a-x.mp4", "video/mp4", size, { status: 200 }, true);
    assert.equal(whole["Content-Length"], String(size));
    assert.match(whole["Content-Disposition"]!, /^attachment; filename="08a-x\.mp4"/);
    assert.equal(whole["Content-Range"], undefined);
    assert.equal(assetHeaders("x.mp4", "video/mp4", size, { status: 416 }, false)["Content-Range"], `bytes */${size}`);
    // Обложки браузер кэширует (у файла релиза номер меняется вместе с содержимым), видео — нет.
    assert.equal(assetHeaders("cover.jpg", "image/jpeg", 100, { status: 200 }, false)["Cache-Control"], "private, max-age=604800, immutable");
    assert.equal(whole["Cache-Control"], "private, no-store");
    assert.equal(contentDisposition("ролик «1».mp4", true), `attachment; filename="_____ _1_.mp4"; filename*=UTF-8''%D1%80%D0%BE%D0%BB%D0%B8%D0%BA%20%C2%AB1%C2%BB.mp4`);
    assert.equal(parseContentRange("bytes */20"), null);
  });

  await test("релизы: больше сотни — по ссылке Link на следующие страницы, не больше 5", async () => {
    assert.equal(nextPage('<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=3>; rel="last"'), "/repositories/1/releases?per_page=100&page=2");
    assert.equal(nextPage(null), null);
    assert.equal(nextPage('<https://evil.example/x>; rel="next"'), null, "только адрес API GitHub");
    const realFetch = globalThis.fetch;
    const token = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "t";
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(url);
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
      const items = Array.from({ length: page < 7 ? 100 : 3 }, (_, i) => ({ id: page * 1000 + i }));
      const link = page < 7 ? `<https://api.github.com/repositories/1/releases?per_page=100&page=${page + 1}>; rel="next"` : "";
      return new Response(JSON.stringify(items), { status: 200, headers: link ? { link } : {} });
    }) as typeof fetch;
    try {
      const all = await listReleases();
      assert.equal(all.length, 500, "5 страниц по 100");
      assert.equal(seen.length, 5);
    } finally {
      globalThis.fetch = realFetch;
      process.env.GITHUB_TOKEN = token;
    }
  });

  await test("«Повторить» руками: упавший, не отменённый, меньше 3 попыток, ролики ещё не готовы", () => {
    const failed = run({ id: 7, title: "batch: 08a,08b", codes: ["08a", "08b"] });
    const rows = rowsOf([
      ["08a", "script"],
      ["08b", "topic"],
    ]);
    assert.deepEqual(canRetry(failed, { runs: [failed], rows }), { ok: true, cost: 2 });
    assert.deepEqual(canRetry(run({ kind: "draft", codes: ["08b"] }), { runs: [], rows }), { ok: true, cost: 0 }, "черновик голос не тратит");
    const no = (r: RunInfo, rs = rows) => {
      const c = canRetry(r, { runs: [r], rows: rs });
      return c.ok ? "можно" : c.reason;
    };
    assert.match(no(run({ codes: ["08a"], conclusion: "cancelled" })), /отменён/);
    assert.match(no(run({ codes: ["08a"], attempt: 3 })), /уже 3 попытки/);
    assert.match(no(run({ codes: ["08a"], active: true, status: "in_progress", conclusion: null })), /ещё идёт/);
    assert.match(no(run({ codes: ["08a"], kind: "fill" })), /только у сценариев и сборок/);
    assert.equal(no(failed, rowsOf([["08a", "video"], ["08b", "studio"]])), "уже готово или запущено заново");
    // Тот же ролик потом собрали удачно — повторять нечего.
    const later = run({ id: 8, codes: ["08a", "08b"], conclusion: "success", createdAt: "2026-10-08T22:00:00Z" });
    assert.equal(canRetry(failed, { runs: [later, failed], rows }).ok, false);
    // Последний упавший за двое суток — для «Сейчас» и напоминания.
    assert.equal(failedRun([later, failed], now), null, "последний закончился удачно");
    assert.equal(failedRun([failed], now)?.id, 7);
    assert.equal(failedRun([failed], now + 3 * DAY_MS), null, "старше двух суток — не напоминаем");
  });

  await test("повтор платного запуска: идёт или только что запускали — отказ; после сбоя и другой workflow — можно", () => {
    const t = Date.parse("2026-10-09T11:00:00Z");
    const iso = (min: number) => new Date(t - min * 60_000).toISOString();
    const label = (x: string) => x.slice(11, 16);
    const want = { file: "video-studio.yml", kind: "batch", codes: ["08a", "08b"] };
    const r = (over: Partial<RunLike>): RunLike => ({ file: "video-studio.yml", kind: "batch", codes: ["08a"], active: false, conclusion: "success", createdAt: iso(30), ...over });
    assert.equal(dispatchConflict(want, [], [], t, label), null);
    assert.equal(dispatchConflict(want, [r({ active: true, conclusion: null, createdAt: iso(5), kind: "draft" })], [], t, label), "08a уже в работе (запуск 10:55) — второй раз не запускаю.");
    assert.match(dispatchConflict(want, [r({ createdAt: iso(1) })], [], t, label)!, /^08a только что запускали \(10:59\)/);
    assert.equal(dispatchConflict(want, [r({ createdAt: iso(1), conclusion: "failure" })], [], t, label), null, "после сбоя пересобрать сразу можно");
    assert.equal(dispatchConflict(want, [r({ createdAt: iso(1), kind: "draft" })], [], t, label), null, "сценарий готов — собирать видео можно");
    assert.equal(dispatchConflict(want, [r({ active: true, file: "video-studio-titles.yml" })], [], t, label), null, "другой workflow не мешает");
    assert.equal(dispatchConflict(want, [r({ active: true, codes: ["09a"] })], [], t, label), null, "другие ролики не мешают");
    // Нажали 10 с назад, GitHub ещё не показал запуск — второе нажатие (хоть с другого устройства) — отказ.
    const pressed = addDispatch([], { ...want, at: iso(1 / 6) }, t);
    assert.match(dispatchConflict({ ...want, codes: ["08b"] }, [], pressed, t, label)!, /^08b уже запущен \(10:59\), GitHub ещё ставит его в очередь/);
    // Запуск появился и уже закончился удачно сценарием — запись о нажатии больше не держит.
    assert.equal(dispatchConflict({ ...want, kind: "batch" }, [r({ kind: "draft", codes: ["08a", "08b"], createdAt: iso(0) })], [{ ...want, kind: "draft", at: iso(1 / 6) }], t, label), null);
    // Записи старше 10 минут и мусор не читаются.
    assert.deepEqual(parseDispatches(JSON.stringify([{ ...want, at: iso(11) }, { file: 1 }]), t), []);
    assert.equal(parseDispatches("oops", t).length, 0);
  });

  console.log(`\nВсе проверки операций пройдены: ${passed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
