// Офлайн-проверка карточки «Сейчас» (lib/todo.ts): какие дела, в каком порядке, какие кнопки, и что
// из этого уходит в утреннее уведомление. Настоящие plan.json и channel.json, подставные YouTube,
// релизы и запуски. Сеть не нужна. Запуск из папки video-studio: npx tsx panel/scripts/todo-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelVideo, FillItem } from "../../src/pipeline/youtube-fill";
import type { GhRelease, GhRun } from "../lib/github";
import { dailySummary } from "../lib/push-summary";
import { buildState, parseAutopilot, type StateInput } from "../lib/state";
import { badgeCount, buildTodo, pushLine, STUDIO_URL } from "../lib/todo";

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

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;
const now = new Date("2026-10-08T12:00:00Z"); // чт 08.10, 15:00 МСК
const video = (code: string, over: Partial<ChannelVideo> = {}): ChannelVideo => ({
  videoId: `v${code}${over.publishAt ?? ""}`,
  title: `${code} черновик`,
  description: "",
  fileName: `${code}-test.mp4`,
  durationSec: 55,
  uploadStatus: "processed",
  privacyStatus: "private",
  publishAt: null,
  embeddable: true,
  license: "youtube",
  publicStatsViewable: true,
  tags: [],
  categoryId: "27",
  publishedAt: "2026-10-07T10:00:00Z",
  thumbnailUrl: null,
  ...over,
});
const release = (id: number, code: string): GhRelease => ({
  id,
  tag_name: `video-${code}`,
  name: code,
  html_url: `https://github.com/x/y/releases/tag/video-${code}`,
  created_at: "2026-10-08T08:00:00Z",
  draft: false,
  assets: [{ id: id * 10, name: `${code}-x.mp4`, size: 1 }],
});
const failedRun: GhRun = {
  id: 3,
  name: "video-studio",
  display_title: "batch: 10a,10b",
  path: ".github/workflows/video-studio.yml",
  event: "workflow_dispatch",
  status: "completed",
  conclusion: "failure",
  created_at: "2026-10-08T11:30:00Z",
  updated_at: "2026-10-08T11:35:00Z",
  html_url: "https://github.com/x/y/actions/runs/3",
};
// Тексты ролика есть, релиза нет — собран на компьютере.
const localTexts = (code: string): FillItem => ({ id: code, file: `${code}-x`, durationSec: 55, title: code, description: "", tags: [], categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true });
const far = video("01a", { publishAt: "2026-10-14T16:00:00Z" }); // расписание до ср 14.10 — запас есть
const base: StateInput = {
  now,
  planJson: json("content/plan.json"),
  channelJson: json("channel.json"),
  scriptFiles: [],
  fillLists: [],
  releases: [],
  runs: [],
  videos: [far],
  youtubeError: null,
  secretNames: null,
  autopilot: parseAutopilot(null),
  autopilotLast: null,
  repo: "x/y",
  branch: "master",
};
const todo = (over: Partial<StateInput> = {}) => buildTodo(buildState({ ...base, ...over }), now);

console.log("Карточка «Сейчас» (без сети):");

test("всё в порядке — дел нет, уведомления нет, на иконке ничего", () => {
  assert.deepEqual(todo(), []);
  assert.equal(dailySummary(buildState(base), now), null);
});

test("загрузить в Studio: коды по времени выхода, срок первого, «Скачать» только с релизом, ссылка на Studio", () => {
  const list = todo({ releases: [release(1, "08b"), release(2, "08a")], fillLists: [[localTexts("09a")]] });
  assert.equal(list.length, 1);
  const t = list[0]!;
  assert.equal(t.id, "upload");
  assert.deepEqual(t.codes, ["08a", "08b", "09a"]);
  assert.deepEqual(t.action, { kind: "download", label: "⬇ Скачать 2", codes: ["08a", "08b"] });
  assert.deepEqual(t.secondary, { label: "YouTube Studio ↗", href: STUDIO_URL });
  assert.match(t.detail, /^первый выходит .+ \(через \d+ (дня|дней|день)\) · 09a — видео только на компьютере$/);
  assert.equal(t.level, "info", "до выхода больше двух суток — не срочно");
  assert.equal(badgeCount(list), 0);
});

test("загрузить срочно: первый ролик выходит меньше чем через двое суток", () => {
  // Свободные слоты раздаются по порядку плана: 01b… встают раньше, поэтому 08a ставим первым в очередь.
  const t = todo({ releases: [release(1, "08a")], queueOrder: ["08a"] })[0]!;
  assert.equal(t.level, "warn");
  assert.match(t.detail, /^выходит сегодня 19:00 \(через 4 ч\)$/);
  assert.deepEqual(t.action, { kind: "download", label: "⬇ Скачать", codes: ["08a"] });
});

test("каждый вид дела: кнопка одна и действует здесь же", () => {
  const list = todo({
    releases: [release(1, "08a")],
    runs: [failedRun],
    videos: [far, video("09a"), video("07a"), video("07a", { videoId: "v07a-2" })],
  });
  const by = Object.fromEntries(list.map((t) => [t.id, t]));
  assert.deepEqual(by.run!.action, { kind: "href", label: "Запуски", href: "/runs" });
  assert.deepEqual(by.run!.secondary, { label: "Лог ↗", href: "https://github.com/x/y/actions/runs/3" });
  assert.equal(by.run!.title, "Не удался запуск «batch: 10a,10b»");
  assert.deepEqual(by.problem!.codes, ["07a"]);
  assert.deepEqual(by.problem!.action, { kind: "open", label: "Открыть 07a", code: "07a" });
  assert.deepEqual(by.fill!.codes, ["09a"]);
  assert.deepEqual(by.fill!.action, { kind: "find", label: "Найти новые загрузки" });
  assert.equal(by.upload!.action?.kind, "download");
  for (const t of list) assert.ok(!t.action || ["download", "find", "open"].includes(t.action.kind) || (t.action.kind === "href" && t.action.href.startsWith("/")), "кнопка — внутри панели");
});

test("порядок: срочное → важное (по сроку) → остальное; при равенстве — по виду", () => {
  const list = todo({
    releases: [release(1, "08a"), release(2, "08b")],
    runs: [failedRun],
    videos: [far, video("09a"), video("07a"), video("07a", { videoId: "v07a-2" })],
  });
  assert.deepEqual(
    list.map((t) => `${t.level}:${t.id}`),
    ["error:problem", "error:run", "warn:fill", "info:upload"],
  );
  assert.equal(badgeCount(list), 3);
  // Уведомление — те же дела в том же порядке.
  const msg = dailySummary(buildState({ ...base, releases: [release(1, "08a"), release(2, "08b")], runs: [failedRun], videos: [far, video("09a"), video("07a"), video("07a", { videoId: "v07a-2" })] }), now)!;
  assert.equal(msg.body, `${list.map(pushLine).join(" · ")} · расписание до 14.10`.replace(/^./, (c) => c.toUpperCase()));
  assert.equal(msg.badge, 3);
  assert.equal(msg.url, "/runs");
});

test("расписание: пусто или меньше двух суток — важное дело; без YouTube — молчим о нём", () => {
  const empty = todo({ videos: [] });
  assert.deepEqual(
    empty.map((t) => [t.id, t.level, t.title]),
    [["runway", "warn", "Расписание пусто"]],
  );
  const short = todo({ videos: [video("01a", { publishAt: "2026-10-09T16:00:00Z" })] });
  assert.equal(short[0]!.id, "runway");
  assert.match(short[0]!.detail, /^остался 1 день/);
  assert.equal(pushLine(short[0]!), "расписание до 09.10 — остался 1 день");
  const offline = todo({ videos: null, youtubeError: "квота", releases: [release(1, "08a")] });
  assert.deepEqual(
    offline.map((t) => t.id),
    ["youtube", "upload"],
  );
  assert.equal(offline[0]!.detail, "квота");
});

test("10 роликов ждут загрузки: в карточке все коды, в уведомлении 6 и «и ещё 4»", () => {
  const codes = ["02a", "02b", "03a", "03b", "04a", "04b", "05a", "05b", "06a", "06b"];
  const list = todo({ releases: codes.map((c, i) => release(10 + i, c)) });
  assert.deepEqual(list[0]!.codes, codes);
  assert.equal(pushLine(list[0]!), "загрузите в Studio: 02a, 02b, 03a, 03b, 04a, 04b и ещё 4");
  assert.equal(dailySummary(buildState({ ...base, releases: codes.map((c, i) => release(10 + i, c)) }), now)?.body, "Загрузите в Studio: 02a, 02b, 03a, 03b, 04a, 04b и ещё 4 · расписание до 14.10");
});

console.log(`\nВсе проверки «Сейчас» пройдены: ${passed}.`);
