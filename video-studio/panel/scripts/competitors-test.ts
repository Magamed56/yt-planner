// Офлайн-проверка «Похожих каналов»: разбор списка каналов и подсчёт «выстреливших» роликов.
// Запуск из папки video-studio: npx tsx panel/scripts/competitors-test.ts
import assert from "node:assert/strict";
import { channelRef, median, parseCompetitors, perDay, summarize, type CompetitorVideo } from "../lib/competitors";

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

const now = new Date("2026-10-09T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const video = (id: string, views: number, ageDays: number, durationSec = 50): CompetitorVideo => ({
  id,
  title: id,
  publishedAt: daysAgo(ageDays),
  views,
  likes: null,
  comments: null,
  durationSec,
  perDay: perDay(views, daysAgo(ageDays), now),
  short: durationSec <= 180,
});

test("канал из @handle, ссылки и id", () => {
  assert.equal(channelRef("@sutzaminutu"), "@sutzaminutu");
  assert.equal(channelRef("sutzaminutu"), "@sutzaminutu");
  assert.equal(channelRef("https://www.youtube.com/@Науч_поп/shorts"), "@Науч_поп");
  assert.equal(channelRef("https://youtube.com/channel/UCabcdefghijklmnopqrstuv"), "UCabcdefghijklmnopqrstuv");
  assert.equal(channelRef("UCabcdefghijklmnopqrstuv"), "UCabcdefghijklmnopqrstuv");
  assert.equal(channelRef("https://example.com/x y"), null);
  assert.equal(channelRef("ab"), null);
});

test("список: мусор и повторы отброшены", () => {
  assert.deepEqual(parseCompetitors('["@a_channel", "A_CHANNEL", 5, "https://youtube.com/@b_channel"]'), ["@a_channel", "@b_channel"]);
  assert.deepEqual(parseCompetitors("не json"), []);
  assert.deepEqual(parseCompetitors(null), []);
});

test("просмотры в сутки: свежий ролик не «вирусный»", () => {
  assert.equal(perDay(1000, daysAgo(0.1), now), 1000); // меньше суток — как сутки
  assert.equal(perDay(1000, daysAgo(10), now), 100);
});

test("медиана", () => {
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("выстрелившие — в 3 раза больше обычного, только за 30 дней", () => {
  const videos = [
    ...Array.from({ length: 10 }, (_, i) => video(`norm${i}`, 1000, 10 + i)), // ~50–100 в сутки
    video("hit", 30_000, 5), // 6000 в сутки
    video("oldhit", 900_000, 60), // старый — не в «за 30 дней»
    video("long", 5_000, 3, 600),
  ];
  const r = summarize(videos, now);
  assert.deepEqual(r.hits.map((v) => v.id), ["hit", "long"]);
  assert.ok(!r.recent.some((v) => v.id === "hit"), "выстрелившие не повторяются в свежих");
  assert.ok(r.recent.length <= 5);
  assert.equal(r.uploadsPerWeek, 12 / 4); // за 28 дней: 10 обычных + hit + long
  assert.ok(r.shortsShare > 0.9 && r.shortsShare < 1);
});

console.log(`competitors-test: ${passed} ✓`);
