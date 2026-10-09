// Офлайн-проверка очереди выхода (перетаскивание ориентиров в календаре): разбор переменной
// PANEL_QUEUE_ORDER, сортировка и ориентиры дат в buildState; прогресс идущих запусков.
// Запуск из папки video-studio:
// npx tsx panel/scripts/queue-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedMs, minutesLabel, progressAt, runProgress, stageOf } from "../lib/progress";
import { buildState, parseAutopilot, parseQueueOrder, queueSort, type StateInput } from "../lib/state";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;

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

test("PANEL_QUEUE_ORDER: только коды плана, без повторов; битое — пусто", () => {
  assert.deepEqual(parseQueueOrder('["09a","07a","09a","x","123",5]'), ["09a", "07a"]);
  assert.deepEqual(parseQueueOrder(null), []);
  assert.deepEqual(parseQueueOrder("{"), []);
  assert.deepEqual(parseQueueOrder('{"a":1}'), []);
});

test("очередь: сначала по списку, остальные — в прежнем порядке после них", () => {
  const rows = ["01a", "01b", "02a", "02b", "03a"].map((code) => ({ code }));
  assert.deepEqual(
    queueSort(rows, ["02b", "01a"]).map((r) => r.code),
    ["02b", "01a", "01b", "02a", "03a"],
  );
  assert.deepEqual(
    queueSort(rows, []).map((r) => r.code),
    ["01a", "01b", "02a", "02b", "03a"],
  );
  assert.deepEqual(
    queueSort(rows, ["99z", "03a"]).map((r) => r.code),
    ["03a", "01a", "01b", "02a", "02b"],
    "коды не из очереди не мешают",
  );
});

test("buildState: ориентиры дат идут по очереди выхода — обмен двух роликов меняет их слоты", () => {
  const base: StateInput = {
    now: new Date("2026-10-09T20:00:00Z"),
    planJson: json("content/plan.json"),
    channelJson: json("channel.json"),
    scriptFiles: fs.readdirSync(path.join(studio, "scripts")),
    fillLists: [json("content/week1-videos.json"), json("content/videos.json")],
    releases: [],
    runs: [],
    videos: [],
    youtubeError: null,
    secretNames: null,
    autopilot: parseAutopilot(null),
    autopilotLast: null,
    repo: "x/y",
    branch: "master",
  };
  const before = buildState(base);
  const when = (s: typeof before, code: string) => s.rows.find((r) => r.code === code)!.when;
  const a = when(before, "07a");
  const b = when(before, "09a");
  assert.ok(a && b && Date.parse(a) < Date.parse(b));
  const order = before.rows.filter((r) => !r.whenExact && r.when).map((r) => r.code);
  const swapped = order.map((c) => (c === "07a" ? "09a" : c === "09a" ? "07a" : c));
  const after = buildState({ ...base, queueOrder: swapped });
  assert.equal(when(after, "09a"), a);
  assert.equal(when(after, "07a"), b);
  assert.equal(when(after, "08a"), when(before, "08a"), "остальные на месте");
  assert.equal(after.rows.find((r) => r.code === "09a")!.whenExact, false);
});

test("прогресс запуска: этапы по шагам workflow, ожидание — медиана прошлых на ролик", () => {
  assert.equal(stageOf("Код репозитория"), "Подготовка");
  assert.equal(stageOf("Черновик сценария"), "Сценарий");
  assert.equal(stageOf("Пакет роликов"), "Озвучка и видео");
  assert.equal(stageOf("Релиз GitHub"), "Публикация");
  assert.equal(stageOf("Закоммитить сценарии и тексты для YouTube"), "Сохранение");
  assert.equal(stageOf("Черновик в артефакте (на случай, если пуш не прошёл)"), "Сохранение");
  const step = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion });
  const steps = [
    step("Set up job", "completed", "success"),
    step("Код репозитория", "completed", "success"),
    step("Зависимости (npm ci)", "completed", "success"),
    step("Черновик сценария", "completed", "skipped"),
    step("Пакет роликов", "in_progress"),
    step("Закоммитить сценарии и тексты для YouTube", "queued"),
    step("Уведомить телефон", "queued"),
  ];
  const p = runProgress(steps, "2026-10-09T20:00:00Z", 20 * 60_000);
  assert.deepEqual(
    p.stages.map((x) => [x.label, x.state]),
    [
      ["Подготовка", "done"],
      ["Озвучка и видео", "active"],
      ["Сохранение", "todo"],
    ],
  );
  assert.equal(p.stage, "Озвучка и видео");
  assert.deepEqual([p.stepsDone, p.stepsTotal], [2, 5]);
  const half = progressAt(p, Date.parse("2026-10-09T20:10:00Z"));
  assert.deepEqual(half, { percent: 50, elapsedMs: 600_000, leftMs: 600_000 });
  assert.equal(progressAt(p, Date.parse("2026-10-09T21:00:00Z")).percent, 97, "дольше обычного — не 100 %, пока идёт");
  assert.equal(minutesLabel(600_000), "10 мин");
  assert.equal(minutesLabel(20_000), "меньше минуты");
  assert.equal(minutesLabel(65 * 60_000), "1 ч 05 мин");
  // 2 ролика по 8 мин в истории, сейчас 3 ролика → 24 мин + подготовка.
  assert.equal(expectedMs("batch", 3, [{ kind: "batch", codes: 2, ms: 16 * 60_000 }, { kind: "draft", codes: 1, ms: 60 * 60_000 }]), 24 * 60_000 + 90_000);
  assert.equal(expectedMs("batch", 1, []), 9 * 60_000 + 90_000, "без истории — ориентир");
});

console.log(`\nВсе проверки очереди пройдены: ${passed}.`);
