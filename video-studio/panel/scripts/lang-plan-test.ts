// Офлайн-проверка плана выхода канала другого языка (/lang/en): schedule.start из channels/en.json,
// слоты подряд по порядку кодов, переход США на зимнее время, отметки «запланирован в Studio»,
// битый schedule — понятная причина вместо падения. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/lang-plan-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDay, planFromStart, startPlanOf, type StartPlan } from "../../src/pipeline/channel";
import { langChannelJson } from "../lib/lang-channels";
import { langPlanOf, parseStudioMarks, STUDIO_MARKS_MAX, studioMarksText, withStudioMark } from "../lib/lang-plan";
import { nextToUpload, slotLabel, zoneLabel } from "../lib/lang-slots";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;

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

const NY = { start: "2026-10-12", timezone: "America/New_York", publishTimesLocal: ["12:00", "19:00"] };
const file = (schedule: Record<string, unknown> = NY) => ({ name: "Gist in a Minute", schedule });
const planOf = (json: unknown): StartPlan => {
  const { plan, problem } = startPlanOf(json);
  assert.ok(plan, `план не разобрался: ${problem}`);
  return plan;
};
const iso = (m: Map<string, { at: Date }>, code: string) => m.get(code)?.at.toISOString().replace(".000Z", "Z");
// 01a, 01b, 02a … — коды подряд, как в плане тем.
const codesUpTo = (days: number) => Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, "0")).flatMap((d) => [`${d}a`, `${d}b`]);

test("channels/en.json: старт 12.10.2026, 12:00 и 19:00 по Нью-Йорку; панель вшила тот же файл", () => {
  const plan = planOf(readJson("channels/en.json"));
  assert.equal(plan.start, "2026-10-12");
  assert.equal(plan.schedule.timezone, "America/New_York");
  assert.deepEqual(plan.schedule.publishTimesLocal, ["12:00", "19:00"]);
  assert.deepEqual(langChannelJson("en"), readJson("channels/en.json"));
  assert.equal(langChannelJson("de"), null);
});

test("слоты подряд от старта по порядку кодов: 01a 12:00, 01b 19:00, 02a — следующий день", () => {
  const m = planFromStart(planOf(file()), ["02a", "01b", "01a", "01A", "мусор", "02a"]);
  assert.deepEqual([...m.keys()], ["01a", "01b", "02a"], "порядок — по коду, повторы и мусор отброшены");
  assert.equal(iso(m, "01a"), "2026-10-12T16:00:00Z", "12:00 по Нью-Йорку летом = 16:00 UTC");
  assert.equal(iso(m, "01b"), "2026-10-12T23:00:00Z");
  assert.equal(iso(m, "02a"), "2026-10-13T16:00:00Z");
  assert.ok([...m.values()].every((s) => !s.fixed));
  // Пропуска в кодах слоты не держат: следующий ролик встаёт в следующий слот.
  const gap = planFromStart(planOf(file()), ["01a", "03a"]);
  assert.equal(iso(gap, "03a"), "2026-10-12T23:00:00Z");
  assert.equal(planFromStart(planOf(file()), []).size, 0);
});

test("переход США на зимнее время (1 ноября): 12:00 и 19:00 остаются местными", () => {
  const m = planFromStart(planOf(file()), codesUpTo(23));
  // 12.10 — день 01, значит 31.10 — 20, 01.11 — 21, 03.11 — 23.
  assert.equal(iso(m, "20a"), "2026-10-31T16:00:00Z", "ещё летнее время, UTC−4");
  assert.equal(iso(m, "20b"), "2026-10-31T23:00:00Z");
  assert.equal(iso(m, "21a"), "2026-11-01T17:00:00Z", "уже зимнее, UTC−5");
  assert.equal(iso(m, "21b"), "2026-11-02T00:00:00Z", "19:00 по Нью-Йорку — полночь UTC следующего дня");
  assert.equal(iso(m, "22a"), "2026-11-02T17:00:00Z");
  assert.equal(iso(m, "23b"), "2026-11-04T00:00:00Z");
  for (const c of ["20a", "21a", "22a", "23a"]) assert.match(slotLabel(m.get(c)!.at, "America/New_York"), /, 12:00$/, c);
  for (const c of ["20b", "21b", "22b", "23b"]) assert.match(slotLabel(m.get(c)!.at, "America/New_York"), /, 19:00$/, c);
  assert.equal(slotLabel(m.get("21b")!.at, "America/New_York"), "1 нояб, 19:00");
  // Телефон в Бишкеке (UTC+6, без перехода): тот же слот на час позже, чем неделей раньше.
  assert.equal(slotLabel(m.get("20a")!.at, "Asia/Bishkek"), "31 окт, 22:00");
  assert.equal(slotLabel(m.get("21a")!.at, "Asia/Bishkek"), "1 нояб, 23:00");
  assert.equal(slotLabel(m.get("21b")!.at, "Asia/Bishkek"), "2 нояб, 06:00", "по телефону — уже следующий день");
});

test("время в Studio закреплено: ролик на своём месте, его слот другим не достаётся", () => {
  const plan = planOf(file());
  // 01b выложен на своё время, потом его релиз удалили — слот всё равно занят.
  const m = planFromStart(plan, ["01a", "02a"], { "01b": Date.parse("2026-10-12T23:00:00Z") });
  assert.equal(iso(m, "01a"), "2026-10-12T16:00:00Z");
  assert.equal(iso(m, "02a"), "2026-10-13T16:00:00Z", "занятый 01b слот пропущен");
  assert.equal(m.has("01b"), false, "в ответе — только запрошенные коды");
  // Отмеченный ролик стоит на своём времени, даже не на слоте; остальные идут подряд.
  const own = planFromStart(plan, ["01a", "01b", "02a"], { "01a": Date.parse("2026-10-12T20:30:00Z") });
  assert.deepEqual(own.get("01a"), { at: new Date("2026-10-12T20:30:00Z"), fixed: true });
  assert.equal(iso(own, "01b"), "2026-10-12T16:00:00Z", "первый свободный слот");
  assert.equal(iso(own, "02a"), "2026-10-12T23:00:00Z");
});

test("«Разборы» (L01) — в свои слоты: вт/чт/сб 21:00 по поясу канала", () => {
  const m = planFromStart(planOf(file()), ["L01", "01a", "L02"]);
  assert.equal(iso(m, "01a"), "2026-10-12T16:00:00Z", "Shorts на «Разборы» не смотрят");
  assert.equal(iso(m, "L01"), "2026-10-14T01:00:00Z", "12.10 — понедельник; вторник 21:00 по Нью-Йорку");
  assert.equal(iso(m, "L02"), "2026-10-16T01:00:00Z", "четверг");
});

test("битый schedule: причина словами, ничего не бросает", () => {
  const problem = (json: unknown) => startPlanOf(json).problem ?? "";
  assert.match(problem({ name: "x" }), /нет schedule\.start/);
  assert.match(problem(null), /нет schedule\.start/);
  assert.match(problem("строка"), /нет schedule\.start/);
  assert.match(problem(readJson("channels/kk.json")), /нет schedule\.start/, "заготовки kk/uz — без плана");
  assert.match(problem(file({ ...NY, start: "12.10.2026" })), /«12\.10\.2026» — не дата/);
  assert.match(problem(file({ ...NY, start: "2026-02-30" })), /не дата/, "несуществующий день");
  assert.match(problem(file({ ...NY, start: 20261012 })), /не дата/);
  assert.match(problem(file({ start: "2026-10-12", publishTimesLocal: ["12:00"] })), /нет schedule\.timezone/, "пояс не угадываем — Москва дала бы чужое время");
  assert.match(problem(file({ ...NY, timezone: "Mars/Olympus" })), /«Mars\/Olympus».*не распознан/);
  assert.match(problem(file({ ...NY, publishTimesLocal: ["полдень", "25:00"] })), /publishTimesLocal/);
  assert.match(problem(file({ ...NY, publishTimesLocal: undefined })), /publishTimesLocal/);
  assert.equal(problem(file({ start: "2026-10-12", timezone: "America/New_York", publishTimeLocal: "12:00" })), "", "старый вид — одно время, как в channelFromJson");
  assert.equal(problem(file()), "");
  assert.deepEqual(parseDay(" 2026-10-12 "), { y: 2026, m: 10, d: 12 });
  assert.equal(parseDay("2026-13-01"), null);
});

test("страница: время, «прошло», ближайший к загрузке, порядок выхода", () => {
  const json = readJson("channels/en.json");
  const codes = ["03a", "01a", "02b", "01b", "02a"];
  // До старта: ничего не прошло, первым грузить 01a.
  const before = langPlanOf(json, codes, {}, Date.parse("2026-10-11T12:00:00Z"));
  assert.equal(before.problem, null);
  assert.equal(before.zone, "по Нью-Йорку");
  assert.equal(before.start, "12 окт");
  assert.deepEqual(before.order, ["01a", "01b", "02a", "02b", "03a"]);
  assert.deepEqual(before.slots["01a"], { at: "2026-10-12T16:00:00.000Z", label: "12 окт, 12:00", past: false, inStudio: false });
  assert.equal(before.slots["01b"]!.label, "12 окт, 19:00");
  assert.equal(before.next, "01a");
  assert.equal(before.marks, true);

  // 13.10 днём: 01a, 01b и 02a прошли; 01a и 01b отмечены, 02a — нет («прошло» видно, порядок тот же).
  const marks = { "01a": Date.parse("2026-10-12T16:00:00Z"), "01b": Date.parse("2026-10-12T23:00:00Z") };
  const later = langPlanOf(json, codes, marks, Date.parse("2026-10-13T18:00:00Z"));
  assert.deepEqual(later.order, ["01a", "01b", "02a", "02b", "03a"], "прошедшие слоты не съезжают");
  assert.deepEqual(
    later.order.map((c) => [c, later.slots[c]!.past, later.slots[c]!.inStudio]),
    [
      ["01a", true, true],
      ["01b", true, true],
      ["02a", true, false],
      ["02b", false, false],
      ["03a", false, false],
    ],
  );
  assert.equal(later.next, "02b", "прошедший 02a уже не поставить на его время — следующий 02b");
  // Нажали «Запланирован в Studio» у 02b — подсветка сразу у 03a, до обновления страницы.
  assert.equal(nextToUpload(later.order, later.slots, (c) => c === "02b" || later.slots[c]!.inStudio), "03a");
  assert.equal(nextToUpload(later.order, later.slots, () => true), null);

  // Отметки не прочитались — время по плану, кнопку прячем.
  const noMarks = langPlanOf(json, codes, null, Date.parse("2026-10-11T12:00:00Z"));
  assert.equal(noMarks.marks, false);
  assert.equal(noMarks.next, "01a");
});

test("страница с битым или пустым schedule не падает: время не показываем, причина есть", () => {
  for (const json of [null, {}, { schedule: "x" }, file({ ...NY, start: "скоро" }), file({ ...NY, timezone: "Nowhere/City" })]) {
    const p = langPlanOf(json, ["01a"], {}, Date.now());
    assert.ok(p.problem, JSON.stringify(json));
    assert.deepEqual(p.order, []);
    assert.deepEqual(p.slots, {});
    assert.equal(p.next, null);
  }
  assert.deepEqual(langPlanOf(readJson("channels/en.json"), [], {}, Date.now()).order, [], "роликов нет — пустой план");
});

test("подписи: «12 окт, 12:00», город по-русски, незнакомый пояс — как есть", () => {
  assert.equal(slotLabel(new Date("2026-10-12T16:00:00Z"), "America/New_York"), "12 окт, 12:00");
  assert.equal(slotLabel(new Date("2026-05-05T09:05:00Z"), "UTC"), "5 мая, 09:05");
  assert.equal(zoneLabel("America/New_York"), "по Нью-Йорку");
  assert.equal(zoneLabel("Europe/Moscow"), "по Москве");
  assert.equal(zoneLabel("Pacific/Fiji"), "по поясу Pacific/Fiji");
});

test("отметки «запланирован в Studio»: разбор, запись, снятие, мусор", () => {
  assert.deepEqual(parseStudioMarks(null), {});
  assert.deepEqual(parseStudioMarks("не json"), {});
  assert.deepEqual(parseStudioMarks("[1,2]"), {});
  const raw = JSON.stringify({ en: { "01a": "2026-10-12T16:00:00Z", "01B": "2026-10-12T23:00:00Z", bad: "2026-10-12T16:00:00Z", "02a": "когда-нибудь", "02b": 5 }, "../x": { "01a": "2026-10-12T16:00:00Z" }, kk: {} });
  assert.deepEqual(parseStudioMarks(raw), { en: { "01a": Date.parse("2026-10-12T16:00:00Z"), "01b": Date.parse("2026-10-12T23:00:00Z") } });

  let m = withStudioMark({}, "en", "01a", Date.parse("2026-10-12T16:00:00Z"));
  m = withStudioMark(m, "en", "L01", Date.parse("2026-10-14T01:00:00Z"));
  const text = studioMarksText(m);
  assert.equal(text, '{"en":{"01a":"2026-10-12T16:00:00Z","L01":"2026-10-14T01:00:00Z"}}');
  assert.deepEqual(parseStudioMarks(text), m, "туда и обратно — то же самое");
  m = withStudioMark(m, "en", "01a", null);
  assert.deepEqual(Object.keys(m.en!), ["L01"]);
  assert.deepEqual(withStudioMark(m, "en", "L01", null), {}, "последняя снята — языка нет");
  assert.deepEqual(withStudioMark({}, "en", "мусор", 1), {});
  assert.deepEqual(withStudioMark({}, "../en", "01a", 1), {});

  // Лишние уходят самые ранние: переменная GitHub не бесконечная.
  let many = {};
  // 01a…99a, 01b…99b, … — кодов больше, чем держим.
  const days = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0"));
  const codes = ["a", "b", "c", "d", "e"].flatMap((l) => days.map((d) => `${d}${l}`));
  assert.ok(codes.length > STUDIO_MARKS_MAX);
  codes.forEach((c, i) => (many = withStudioMark(many, "en", c, Date.UTC(2026, 9, 12) + i * 3_600_000)));
  const kept = parseStudioMarks(studioMarksText(many)).en!;
  assert.equal(Object.keys(kept).length, STUDIO_MARKS_MAX);
  assert.ok(!("01a" in kept) && codes.at(-1)! in kept);
  assert.ok(studioMarksText(many).length < 40_000);
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
