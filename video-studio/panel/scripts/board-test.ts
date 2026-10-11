// Офлайн-проверка «Доски» (/board): статусы по зонам, «загрузил» в Instagram и TikTok (PANEL_BOARD),
// запас «до ДД.ММ (N дней)» и раскладка полотна. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/board-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { channelFromJson, upcomingSlots } from "../../src/pipeline/channel";
import { BOARD_VAR, buildBoard, CARD_W, GAP, layoutBoard, parseBoardMarks, withBoardMark, type BoardInput } from "../lib/board";
import { studioMarksText } from "../lib/lang-plan";

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

// 11.10.2026, 13:00 по Москве: ближайшие слоты — 11.10 19:00, 12.10 12:00, 12.10 19:00.
const now = new Date("2026-10-11T10:00:00Z");
const schedule = channelFromJson(readJson("channel.json")).schedule;
const slots = upcomingSlots(schedule, 6, { from: now }).map((d) => d.toISOString());
const slotGrid = slots.map((iso) => ({ iso, dateKey: "", dateLabel: "", time: "", occupant: null as string | null }));
const row = (code: string, stage: BoardInput["ru"]["rows"][number]["stage"], when: string | null, extra: Partial<BoardInput["ru"]["rows"][number]> = {}) => ({
  code,
  title: `Тема ${code}`,
  stage,
  when,
  whenExact: stage === "published" || stage === "scheduled",
  release: stage === "video" || stage === "published" || stage === "scheduled" ? {} : null,
  ...extra,
});
const input = (marks: BoardInput["marks"]): BoardInput => ({
  now,
  ru: {
    channelName: "Суть за минуту",
    timezone: "Europe/Moscow",
    slotGrid,
    coverage: [{ level: "scheduled", untilIso: slots[1]!, untilLabel: "", slots: 2 }],
    runwayDays: 1,
    youtubeError: null,
    rows: [
      row("07a", "published", "2026-10-10T09:00:00Z"),
      row("08a", "scheduled", slots[0]!),
      row("08b", "video", slots[1]!),
      row("09a", "script", slots[2]!),
      row("09b", "topic", slots[3]!),
      row("10a", "video", slots[4]!, { hold: { reason: "", since: "", sinceLabel: "", rebuilding: false } }),
      row("L01", "video", "2026-10-13T18:00:00Z", { long: true }),
    ],
  },
  en: { name: "Gist in a Minute", json: readJson("channels/en.json"), released: ["01a", "01b", "02a"], marks: { "01a": Date.parse("2026-10-12T16:00:00Z") } },
  marks,
});
const zone = (zones: ReturnType<typeof buildBoard>, key: string) => zones.find((z) => z.key === key)!;
const card = (zones: ReturnType<typeof buildBoard>, key: string, code: string) => zone(zones, key).items.find((i) => i.code === code);

const marks = { instagram: { "07a": Date.parse("2026-10-10T12:00:00Z"), "08a": Date.parse(slots[0]!) } };
const zones = buildBoard(input(marks));

test("зоны — RU, EN, Instagram, TikTok; темы без сценария на доске нет", () => {
  assert.deepEqual(
    zones.map((z) => z.key),
    ["ru", "en", "instagram", "tiktok"],
  );
  assert.equal(card(zones, "ru", "09b"), undefined);
});

test("RU: статусы цветом по этапу очереди, запас — из coverage() очереди", () => {
  assert.equal(card(zones, "ru", "07a")?.status, "published");
  assert.equal(card(zones, "ru", "08a")?.status, "scheduled");
  assert.equal(card(zones, "ru", "08b")?.status, "ready");
  assert.equal(card(zones, "ru", "09a")?.status, "script");
  assert.equal(card(zones, "ru", "L01")?.long, true);
  assert.equal(card(zones, "ru", "08a")?.dateLabel, "11.10");
  assert.equal(card(zones, "ru", "08a")?.time, "19:00");
  assert.equal(zone(zones, "ru").runway.text, "запас до 12.10 (1 день)");
});

test("EN: план от schedule.start, отмеченный в Studio — запланирован; запас по отметкам", () => {
  assert.equal(card(zones, "en", "01a")?.status, "scheduled");
  assert.equal(card(zones, "en", "01b")?.status, "ready");
  assert.equal(card(zones, "en", "01a")?.time, "12:00"); // по Нью-Йорку
  assert.equal(card(zones, "en", "01a")?.marked, undefined); // кнопки на доске у EN нет
  assert.equal(zone(zones, "en").runway.text, "запас до 12.10 (1 день)");
});

test("Instagram и TikTok: Shorts из релизов, «загрузил» — запланирован / вышел, кнопка", () => {
  assert.equal(card(zones, "instagram", "07a")?.status, "published");
  assert.equal(card(zones, "instagram", "08a")?.status, "scheduled");
  assert.equal(card(zones, "instagram", "08a")?.marked, true);
  assert.equal(card(zones, "instagram", "08b")?.status, "ready");
  assert.equal(card(zones, "instagram", "08b")?.marked, false);
  assert.equal(card(zones, "instagram", "09a"), undefined, "без видео в релизе — нечего грузить");
  assert.equal(card(zones, "instagram", "L01"), undefined, "«Разборы» 16:9 — не для Reels");
  assert.equal(card(zones, "instagram", "10a")?.marked, undefined, "ждёт пересборки — кнопки нет");
  assert.equal(card(zones, "tiktok", "08a")?.status, "ready");
  assert.equal(zone(zones, "instagram").runway.text, "запас до 11.10 (0 дней)");
  assert.equal(zone(zones, "tiktok").runway.text, "запаса нет — ближайший слот пуст");
});

test("PANEL_BOARD не прочиталась — кнопок нет, запас неизвестен", () => {
  const z = buildBoard(input(null));
  assert.equal(card(z, "instagram", "08b")?.marked, undefined);
  assert.match(zone(z, "tiktok").runway.text, new RegExp(`неизвестен.*${BOARD_VAR}`));
});

test("отметки PANEL_BOARD: только instagram и tiktok, снятие убирает код", () => {
  const m = parseBoardMarks('{"instagram":{"08A":"2026-10-11T16:00:00Z"},"youtube":{"08a":"2026-10-11T16:00:00Z"},"tiktok":"мусор"}');
  assert.deepEqual(Object.keys(m), ["instagram"]);
  assert.equal(m.instagram?.["08a"], Date.parse("2026-10-11T16:00:00Z"));
  assert.deepEqual(parseBoardMarks(studioMarksText(withBoardMark(m, "instagram", "08a", null))), {});
  assert.deepEqual(withBoardMark(m, "youtube", "08a", 1), m);
});

test("раскладка: зоны рядом без нахлёста, один день — на одной высоте, ролики дня — слева направо", () => {
  const plan = layoutBoard(zones, "2026-10-11");
  for (let i = 1; i < plan.zones.length; i++) assert.ok(plan.zones[i]!.x >= plan.zones[i - 1]!.x + plan.zones[i - 1]!.w);
  const y = (key: string, code: string) => plan.zones.find((z) => z.key === key)!.cards.find((c) => c.code === code)!.y;
  assert.equal(y("ru", "08a"), y("instagram", "08a"));
  assert.equal(y("ru", "08a"), plan.todayY);
  const ru = plan.zones[0]!.cards;
  const [b, s] = [ru.find((c) => c.code === "08b")!, ru.find((c) => c.code === "09a")!]; // 12.10: 12:00 и 19:00
  assert.equal(b.y, s.y);
  assert.equal(s.x - b.x, CARD_W + GAP);
  // Дни подряд, без пропусков: от самого раннего ролика (10.10) и не меньше недели вперёд.
  assert.equal(plan.days[0]!.key, "2026-10-09");
  assert.equal(plan.days.at(-1)!.key, "2026-10-18");
  assert.ok(plan.days.every((d, i) => i === 0 || d.y > plan.days[i - 1]!.y));
});

console.log(`\nboard-test: ${passed} проверок прошло`);
