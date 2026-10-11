// Офлайн-проверка «ждёт пересборки» (content/rebuild.json → lib/rebuild-hold.ts): старый релиз не
// зовут грузить в Studio, идущая сборка — «пересобирается», свежий релиз (по published_at) снимает
// пометку, ролик в YouTube не меняется, без файла или с битым — всё как раньше. Настоящие plan.json,
// channel.json и rebuild.json, подставные релизы, запуски и YouTube. Сеть не нужна.
// Запуск из папки video-studio: npx tsx panel/scripts/rebuild-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelVideo, FillItem } from "../../src/pipeline/youtube-fill";
import type { GhRelease, GhRun } from "../lib/github";
import { canRetry } from "../lib/ops";
import { dailySummary } from "../lib/push-summary";
import { buildsVideo, holdLabel, parseRebuildList, REBUILD_FILE } from "../lib/rebuild-hold";
import { buildState, parseAutopilot, type PanelState, type StateInput } from "../lib/state";
import { buildTodo, pushLine } from "../lib/todo";

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
const now = new Date("2026-10-11T13:00:00Z"); // вс 11.10, 16:00 МСК
const SINCE = "2026-10-11T12:00:00Z";
const rebuildFile = json(REBUILD_FILE);

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
// created — дата коммита (так GitHub отдаёт created_at релиза), published — когда релиз вышел.
let nextId = 1;
const release = (code: string, created: string, published: string | null, tag = `video-${code}-${nextId}`): GhRelease => {
  const id = nextId++;
  return { id, tag_name: tag, name: code, html_url: `https://github.com/x/y/releases/tag/${tag}`, created_at: created, published_at: published, draft: false, assets: [{ id: id * 10, name: `${code}-x.mp4`, size: 1 }] };
};
const OLD = (code: string) => release(code, "2026-10-09T05:13:06Z", "2026-10-09T10:44:36Z", `video-${code}-old`);
const run = (id: number, title: string, status: string, conclusion: string | null, created = "2026-10-11T12:28:54Z"): GhRun => ({
  id,
  name: "video-studio",
  display_title: title,
  path: ".github/workflows/video-studio.yml",
  event: "workflow_dispatch",
  status,
  conclusion,
  created_at: created,
  updated_at: created,
  html_url: `https://github.com/x/y/actions/runs/${id}`,
});
const localTexts = (code: string): FillItem => ({ id: code, file: `${code}-x`, durationSec: 55, title: code, description: "", tags: [], categoryId: "27", defaultLanguage: "ru", containsSyntheticMedia: true });
// Расписание без пропусков до сб 17.10: чужие ролики на всех слотах — «пустой слот» не мешает.
const fullSlots = ["2026-10-11T16:00:00Z", ...["12", "13", "14", "15", "16", "17"].flatMap((d) => [`2026-10-${d}T09:00:00Z`, `2026-10-${d}T16:00:00Z`])];
const full = fullSlots.map((iso, i) => video(`other${i}`, { publishAt: iso }));

// 08b пересобран (новый релиз: коммит 12:04, вышел 12:18); 09a в списке нет; 09b и 10b сейчас
// собираются; 11a — повтор старого запуска: коммит старый, релиз вышел после since; у 11b идёт
// только английская сборка; 12a уже в Studio; 13a собран на компьютере (релиза нет).
const releases: GhRelease[] = [
  OLD("08b"),
  release("08b", "2026-10-11T12:04:22Z", "2026-10-11T12:18:46Z", "video-08b-new"),
  OLD("09a"),
  OLD("09b"),
  OLD("10b"),
  OLD("11a"),
  release("11a", "2026-10-09T05:13:06Z", "2026-10-11T12:50:00Z", "video-11a-rerun"),
  OLD("11b"),
  OLD("12a"),
];
const base: StateInput = {
  now,
  planJson: json("content/plan.json"),
  channelJson: json("channel.json"),
  scriptFiles: [],
  fillLists: [[localTexts("13a")]],
  releases,
  runs: [run(1, "batch: 09b,10b", "in_progress", null), run(2, "batch: 11b [en]", "in_progress", null)],
  videos: [...full, video("12a")],
  youtubeError: null,
  secretNames: null,
  autopilot: parseAutopilot(null),
  autopilotLast: null,
  repo: "x/y",
  branch: "master",
  rebuildJson: rebuildFile,
};
const state = (over: Partial<StateInput> = {}) => buildState({ ...base, ...over });
const rowOf = (s: PanelState, code: string) => s.rows.find((r) => r.code === code)!;
const upload = (s: PanelState) => buildTodo(s, now).find((t) => t.id === "upload") ?? null;
const reminder = (s: PanelState, kind: string) => s.reminders.find((m) => m.kind === kind) ?? null;

console.log("«Ждёт пересборки» (без сети):");

test("content/rebuild.json: 10 кодов, since и причина; свой since у кода; битое — пусто", () => {
  const list = parseRebuildList(rebuildFile);
  assert.deepEqual([...list.keys()], ["08a", "08b", "09b", "10b", "11a", "11b", "12a", "12b", "13a", "13b"]);
  assert.deepEqual(list.get("09b"), { since: "2026-10-11T12:00:00.000Z", reason: "голос нарезан не по речи — субтитры расходятся с голосом" });
  assert.equal(list.has("09a"), false, "09a и 10a — нормальные, их грузить можно");
  assert.equal(list.has("10a"), false);
  const own = parseRebuildList({ since: SINCE, reason: "общая", codes: [" 08A ", { code: "l01", since: "2026-10-12", reason: "своя" }, { code: "11b" }, "мусор", 7, null] });
  assert.deepEqual(Object.fromEntries(own), {
    "08a": { since: "2026-10-11T12:00:00.000Z", reason: "общая" },
    L01: { since: "2026-10-12T00:00:00.000Z", reason: "своя" },
    "11b": { since: "2026-10-11T12:00:00.000Z", reason: "общая" },
  });
  // Без пояса время поняли бы по-разному сервер и браузер — такую запись пропускаем.
  assert.deepEqual([...parseRebuildList({ since: "2026-10-11T12:00:00", codes: ["08a", { code: "08b", since: "2026-10-11T12:00:00+03:00" }] })], [["08b", { since: "2026-10-11T09:00:00.000Z", reason: "" }]]);
  for (const bad of [null, undefined, "{oops", 7, [], ["08a"], { codes: "08a" }, { since: "вчера", codes: ["08a"] }, { codes: ["08a"] }]) {
    assert.equal(parseRebuildList(bad).size, 0, JSON.stringify(bad) ?? "undefined");
  }
});

test("сборка русского ролика — да, другой язык и черновик — нет", () => {
  assert.equal(buildsVideo({ kind: "batch", title: "batch: 09b,10b" }), true);
  assert.equal(buildsVideo({ kind: "render", title: "render: scripts/sut-10b-x.json" }), true);
  assert.equal(buildsVideo({ kind: "batch", title: "batch: 11b [en]" }), false);
  assert.equal(buildsVideo({ kind: "draft", title: "draft: 09b" }), false);
});

test("старый релиз — удержан; идёт сборка — «пересобирается», иначе «ждёт пересборки» с причиной", () => {
  const s = state();
  const h = (c: string) => rowOf(s, c).hold;
  assert.equal(rowOf(s, "09b").stage, "video", "этап прежний — меняется только то, куда зовут");
  assert.deepEqual(h("09b"), { reason: "голос нарезан не по речи — субтитры расходятся с голосом", since: "2026-10-11T12:00:00.000Z", sinceLabel: "вс, 11.10 15:00", rebuilding: true });
  assert.equal(h("10b")?.rebuilding, true);
  assert.equal(holdLabel(h("10b")!), "пересобирается");
  assert.equal(h("11b")?.rebuilding, false, "английская сборка 11b русский ролик не пересобирает");
  assert.equal(holdLabel(h("11b")!), "ждёт пересборки");
  assert.equal(h("13a")?.rebuilding, false, "собранный на компьютере тоже ждёт (релиза новее нет)");
  for (const c of ["08b", "09a", "11a", "12a"]) assert.equal(h(c), undefined, c);
  assert.equal(rowOf(s, "08b").release?.tag, "video-08b-new", "в карточке — новый релиз");
  assert.equal(rowOf(s, "11a").release?.tag, "video-11a-rerun", "свежее — по published_at, а не по дате коммита");
});

test("удержанные — не в «Загрузить в Studio», не в «⬇ Скачать N», не в напоминании и не в уведомлении", () => {
  const s = state();
  const t = upload(s)!;
  assert.deepEqual(t.codes, ["08b", "09a", "11a"]);
  assert.deepEqual(t.action, { kind: "download", label: "⬇ Скачать 3", codes: ["08b", "09a", "11a"] });
  assert.equal(t.detail.includes("13a"), false, "13a и на компьютере не зовём загружать");
  assert.deepEqual(reminder(s, "upload")?.codes, ["08b", "09a", "11a"]);
  assert.match(reminder(s, "upload")!.text, /^Ждут загрузки в Studio: 08b, 09a, 11a\./);
  const rb = reminder(s, "rebuild")!;
  assert.deepEqual(rb.codes, ["09b", "10b", "11b", "13a"]);
  assert.equal(rb.level, "info", "выходят не раньше чем через двое суток");
  assert.equal(
    rb.text,
    "Пересборка (голос нарезан не по речи — субтитры расходятся с голосом) — старые версии в Studio не загружайте. Идёт: 09b, 10b. Ждут: 11b, 13a — «Пересобрать» в карточке ролика. Готовый ролик сам вернётся в «Загрузить в Studio».",
  );
  const msg = dailySummary(s, now)!;
  assert.match(msg.body, /загрузите в Studio: 08b, 09a, 11a( ·|$)/i);
  for (const c of ["09b", "10b", "11b", "13a"]) assert.equal(msg.body.includes(c), false, c);
  assert.equal(pushLine(t), "загрузите в Studio: 08b, 09a, 11a");
});

test("появился релиз новее since — ролик снова «видео готово — загрузите в Studio»", () => {
  const s = state({
    releases: [...releases, release("09b", "2026-10-11T12:28:54Z", "2026-10-11T12:41:06Z"), release("13a", "2026-10-11T12:04:22Z", "2026-10-11T12:55:00Z")],
    runs: [run(1, "batch: 09b,10b", "in_progress", null)],
  });
  assert.equal(rowOf(s, "09b").hold, undefined);
  assert.equal(rowOf(s, "13a").hold, undefined);
  assert.equal(rowOf(s, "13a").localVideo, false);
  assert.deepEqual(upload(s)!.codes, ["08b", "09a", "09b", "11a", "13a"]);
  assert.deepEqual(reminder(s, "rebuild")!.codes, ["10b", "11b"]);
  // Релиз опубликован до since (дата коммита при этом новее) — всё ещё старая версия.
  const early = state({ releases: [...releases, release("10b", "2026-10-11T12:30:00Z", "2026-10-11T11:59:59Z")] });
  assert.ok(rowOf(early, "10b").hold);
});

test("ролик уже в YouTube — без пометки и как раньше", () => {
  const withFile = state();
  const without = state({ rebuildJson: null });
  for (const c of ["12a"]) {
    const [a, b] = [rowOf(withFile, c), rowOf(without, c)];
    assert.equal(a.stage, "studio");
    assert.equal(a.hold, undefined);
    assert.deepEqual({ ...a }, { ...b });
  }
  assert.deepEqual(buildTodo(withFile, now).find((t) => t.id === "fill")?.codes, ["12a"]);
  // Вышедший или запланированный ролик из списка — тоже без пометки.
  const out = state({ videos: [...full, video("08a", { privacyStatus: "public", publishedAt: "2026-10-10T09:00:00Z" }), video("09b", { publishAt: "2026-10-20T09:00:00Z" })] });
  assert.equal(rowOf(out, "08a").stage, "published");
  assert.equal(rowOf(out, "09b").stage, "scheduled");
  assert.equal(rowOf(out, "08a").hold, undefined);
  assert.equal(rowOf(out, "09b").hold, undefined);
});

test("без rebuild.json и с битым файлом — как раньше, без падения", () => {
  const before = upload(state({ rebuildJson: undefined }))!;
  assert.deepEqual(before.codes, ["08b", "09a", "09b", "10b", "11a", "11b", "13a"]);
  assert.deepEqual(before.action, { kind: "download", label: "⬇ Скачать 6", codes: ["08b", "09a", "09b", "10b", "11a", "11b"] });
  for (const bad of [null, "{oops", 42, [], { since: "вчера", codes: ["09b"] }, { codes: "09b" }]) {
    const s = state({ rebuildJson: bad });
    assert.deepEqual(upload(s), before, JSON.stringify(bad));
    assert.equal(reminder(s, "rebuild"), null);
    assert.equal(s.rows.some((r) => r.hold), false);
  }
});

test("пустой слот: удержанный — «открыть» (там «Пересобрать»), не «Скачать»; идёт сборка — без кнопки", () => {
  // Сегодня 19:00 и завтра 12:00 заняты, завтра 19:00 — пусто: туда первым встанет 09b.
  const short = { videos: [video("o1", { publishAt: "2026-10-11T16:00:00Z" }), video("o2", { publishAt: "2026-10-12T09:00:00Z" })], queueOrder: ["09b"] };
  const waiting = buildTodo(state({ ...short, runs: [] }), now).find((t) => t.id === "runway")!;
  assert.equal(waiting.detail, "осталось 1 день · встанет 09b — ждёт пересборки — старую версию не загружайте");
  assert.deepEqual(waiting.action, { kind: "open", label: "Открыть 09b", code: "09b" });
  const building = buildTodo(state(short), now).find((t) => t.id === "runway")!;
  assert.equal(building.detail, "осталось 1 день · встанет 09b — пересобирается");
  assert.equal(building.action, null);
  // Без файла — как раньше: «⬇ Скачать».
  const plain = buildTodo(state({ ...short, rebuildJson: null }), now).find((t) => t.id === "runway")!;
  assert.equal(plain.detail, "осталось 1 день · встанет 09b — видео готово — загрузите в Studio");
  assert.deepEqual(plain.action, { kind: "download", label: "⬇ Скачать", codes: ["09b"] });
  // Удержанный выходит меньше чем через двое суток и никто его не собирает — напоминание важное.
  assert.equal(reminder(state({ ...short, runs: [] }), "rebuild")!.level, "warn");
});

test("упавшая пересборка: «Повторить» есть, пока ролик ждёт; свежий релиз — повторять нечего", () => {
  const failed = run(5, "batch: 09b,10b", "completed", "failure", "2026-10-11T12:20:00Z");
  const s = state({ runs: [failed] });
  assert.deepEqual(canRetry(s.runs[0]!, s), { ok: true, cost: 2 });
  const plain = state({ runs: [failed], rebuildJson: null });
  assert.deepEqual(canRetry(plain.runs[0]!, plain), { ok: false, reason: "уже готово или запущено заново" }, "без файла — как раньше: видео есть");
  const fresh = state({ runs: [failed], releases: [...releases, release("09b", "2026-10-11T12:28:54Z", "2026-10-11T12:41:06Z"), release("10b", "2026-10-11T12:28:54Z", "2026-10-11T12:48:00Z")] });
  assert.deepEqual(canRetry(fresh.runs[0]!, fresh), { ok: false, reason: "уже готово или запущено заново" });
});

console.log(`\nВсе проверки «ждёт пересборки» пройдены: ${passed}.`);
