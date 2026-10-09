// Офлайн-проверка подсказок «Статистики»: слабый старт, лучшее время выхода, плейлисты рубрик
// и смена названия (тело videos.update, какие идеи показать). Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/insights-test.ts
import assert from "node:assert/strict";
import { parseTitleIdeas } from "../../src/pipeline/title-ideas";
import { median, releaseTiming, superiority, weakStarts } from "../lib/insights";
import { parsePlaylistsSetting, planPlaylistSync, playlistTitle, playlistsSettingText, quotaLabel, type SyncInput } from "../lib/playlists";
import type { VideoStat } from "../lib/stats";
import { allowedTitle, titleIdeaViews, titleUpdateBody } from "../lib/titles";

// Папка panel — CommonJS: верхнеуровневого await нет, проверки копим и запускаем в конце.
const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => void tests.push([name, fn]);
const sp = (s: string) => s.replace(/\s/gu, " ");

const now = new Date("2026-10-09T12:00:00Z"); // 15:00 МСК
const TZ = "Europe/Moscow";
const H = 3_600_000;
let seq = 0;
// Ролик, вышедший hoursAgo часов назад, с perDay просмотров в сутки.
function stat(hoursAgo: number, perDay: number, over: Partial<VideoStat> = {}): VideoStat {
  seq += 1;
  const days = Math.max(1, hoursAgo / 24);
  return {
    videoId: `vid${String(seq).padStart(8, "0")}`,
    code: null,
    title: `Ролик ${seq}`,
    pillar: null,
    pillarTitle: null,
    publishedAt: new Date(now.getTime() - hoursAgo * H).toISOString(),
    dateLabel: "",
    days,
    fresh: hoursAgo < 24,
    shorts: true,
    views: Math.round(perDay * days),
    likes: null,
    comments: null,
    perDay,
    viewsLabel: "",
    likesLabel: "",
    commentsLabel: "",
    perDayLabel: "",
    mark: null,
    thumbnailUrl: null,
    ...over,
  };
}
// Ровно в слот: «за d суток до 09.10 в hh:mm МСК».
const at = (daysAgo: number, hhmm: string, perDay: number) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const t = Date.UTC(2026, 9, 9 - daysAgo, h - 3, m);
  return stat((now.getTime() - t) / H, perDay);
};

test("медиана и доля выигранных пар", () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(superiority([3, 4], [1, 2]), 1);
  assert.equal(superiority([1, 2], [3, 4]), 0);
  assert.equal(superiority([2], [2]), 0.5);
  assert.equal(superiority([], [1]), 0.5);
});

test("слабый старт: меньше половины медианы остальных Shorts за 30 дней", () => {
  const pool = [stat(100, 100), stat(150, 200), stat(200, 300), stat(260, 400), stat(320, 500), stat(400, 600)];
  const weak = stat(30, 40, { code: "08a", title: "Слабый" });
  const fine = stat(50, 300, { code: "08b" });
  const half = stat(60, 150); // ровно половина медианы остальных — не флажок
  const other = [
    stat(10, 1), // младше суток
    stat(40, 1, { shorts: false }), // не Shorts
    stat(24 * 40, 1), // старше 30 дней — не сравниваем
  ];
  const r = weakStarts([...pool, weak, fine, half, ...other], now);
  assert.equal(r.candidates, 3);
  assert.equal(r.sample, 9);
  assert.ok(r.enough);
  assert.deepEqual(r.flagged.map((f) => f.code), ["08a"]);
  const f = r.flagged[0]!;
  assert.equal(f.ageLabel, "30 ч");
  assert.equal(f.baseline, 300); // медиана 8 остальных: 100,150,200,300,300,400,500,600
  assert.equal(f.percent, 13);
  assert.equal(r.baseline, 300);
});

test("слабый старт: меньше 5 роликов для сравнения — молчим", () => {
  const r = weakStarts([stat(100, 100), stat(150, 200), stat(200, 300), stat(260, 400), stat(30, 1, { code: "09a" })], now);
  assert.equal(r.flagged.length, 0);
  assert.ok(!r.enough);
  assert.equal(weakStarts([], now).baselineLabel, "—");
});

test("время выхода: мало данных — так и говорим, со счётом по слотам", () => {
  const vids = [at(3, "12:00", 100), at(4, "12:00", 120), at(3, "19:00", 300), at(5, "19:00", 280), at(6, "19:00", 260), at(1, "19:00", 999)];
  const r = releaseTiming(vids, ["12:00", "19:00"], TZ, now);
  assert.equal(r.eligible, 5, "младше 2 суток не берём");
  assert.deepEqual(r.slots.map((s) => [s.label, s.videos]), [["12:00", 2], ["19:00", 3]]);
  assert.equal(r.slotAdvice.confidence, "none");
  assert.equal(r.slotAdvice.confidenceLabel, "мало данных");
  assert.match(r.slotAdvice.text, /по 4 ролика.*12:00 — 2, 19:00 — 3/);
  assert.equal(r.weekdayAdvice.confidence, "none");
  assert.match(r.weekdayAdvice.text, /у самого редкого дня — 0 роликов/);
  assert.equal(releaseTiming([], ["12:00", "19:00"], TZ, now).slotAdvice.confidence, "none");
});

test("время выхода: явная разница и много роликов — уверенная подсказка", () => {
  const vids = [];
  for (let d = 2; d < 14; d++) vids.push(at(d, "12:00", 100 + d), at(d, "19:00", 300 + d));
  const r = releaseTiming(vids, ["12:00", "19:00"], TZ, now);
  assert.equal(r.slotAdvice.confidence, "high");
  assert.match(sp(r.slotAdvice.text), /Лучше заходят ролики в 19:00: медиана 308 в сутки в 19:00 против 107 в 12:00; в 100 % пар/);
  assert.match(r.slotAdvice.text, /channel\.json/);
  assert.equal(r.slots[1]!.share, 1);
  assert.ok(r.slots[0]!.share < 0.4);
  assert.equal(r.offSlot, 0);
});

test("время выхода: перемешано — «разницы почти нет»; вне слота — отдельно", () => {
  const vids = [];
  for (let d = 3; d < 9; d++) vids.push(at(d, "12:00", d % 2 ? 100 : 200), at(d, "19:00", d % 2 ? 200 : 100));
  vids.push(at(3, "14:30", 5000), at(4, "12:40", 150)); // 14:30 — не слот; 12:40 — ±1 ч от 12:00
  const r = releaseTiming(vids, ["12:00", "19:00"], TZ, now);
  assert.equal(r.offSlot, 1);
  assert.deepEqual(r.slots.map((s) => s.videos), [7, 6]);
  assert.match(r.slotAdvice.text, /^Разницы почти нет/);
  assert.equal(r.slotAdvice.confidence, "low");
  assert.equal(releaseTiming(vids, ["12:00"], TZ, now).slotAdvice.text, "Сравнивать не с чем: у канала один слот.");
});

test("время выхода: дни недели — в поясе канала, совет по лучшему и худшему дню", () => {
  // 05.10.2026 — понедельник; 23:30 UTC — уже вторник 02:30 по Москве.
  const tue = stat((now.getTime() - Date.UTC(2026, 9, 5, 23, 30)) / H, 10);
  assert.equal(releaseTiming([tue], ["12:00", "19:00"], TZ, now).weekdays.find((w) => w.key === "tue")!.videos, 1);
  const vids = [];
  for (let d = 2; d < 30; d++) vids.push(at(d, "12:00", new Date(Date.UTC(2026, 9, 9 - d)).getUTCDay() === 6 ? 500 + d : 100 + d));
  const r = releaseTiming(vids, ["12:00", "19:00"], TZ, now);
  assert.deepEqual(r.weekdays.map((w) => w.videos), [4, 4, 4, 4, 4, 4, 4]);
  assert.match(r.weekdayAdvice.text, /вышедшие в субботу, слабее — в /);
  assert.notEqual(r.weekdayAdvice.confidence, "none");
});

const pillars = [
  { id: "space", title: "Космос" },
  { id: "history", title: "История" },
  { id: "money", title: "Деньги и экономика" },
  { id: "mind", title: "Мозг и психология" },
];
const syncInput = (over: Partial<SyncInput> = {}): SyncInput => ({
  pillars,
  channelName: "Суть за минуту",
  setting: { auto: false, byPillar: { space: "PLspace00000", money: "PLgone000000" } },
  existing: [
    { id: "PLspace00000", title: "Космос — Суть за минуту" },
    { id: "PLhist000000", title: "история — суть за минуту" },
    { id: "PLother00000", title: "Что-то своё" },
  ],
  members: { PLspace00000: ["v1"], PLhist000000: [] },
  videos: [
    { videoId: "v2", code: "02a", pillar: "space" },
    { videoId: "v1", code: "01a", pillar: "space" },
    { videoId: "v3", code: "01b", pillar: "history" },
    { videoId: "v4", code: "03a", pillar: "money" },
    { videoId: "v5", code: "02b", pillar: "money" },
    { videoId: "v6", code: "04a", pillar: "unknown" },
  ],
  ...over,
});

test("плейлисты: настройка из переменной, название плейлиста", () => {
  assert.deepEqual(parsePlaylistsSetting(null), { auto: false, byPillar: {} });
  assert.deepEqual(parsePlaylistsSetting("мусор"), { auto: false, byPillar: {} });
  const s = parsePlaylistsSetting('{"auto":true,"byPillar":{"space":"PLspace00000","bad":"x","n":5}}');
  assert.deepEqual(s, { auto: true, byPillar: { space: "PLspace00000" } });
  assert.deepEqual(parsePlaylistsSetting(playlistsSettingText(s)), s);
  assert.equal(playlistTitle("Космос", "Суть <за> минуту"), "Космос — Суть за минуту");
  assert.equal([...playlistTitle("я".repeat(200), "Канал")].length, 150);
});

test("плейлисты: что создать, что добавить, что уже есть", () => {
  const p = planPlaylistSync(syncInput());
  assert.deepEqual(
    p.pillars.map((x) => [x.pillar, x.status, x.toAdd, x.already]),
    [
      ["space", "ok", 1, 1],
      ["history", "found", 1, 0],
      ["money", "create", 2, 0],
      ["mind", "empty", 0, 0],
    ],
  );
  assert.deepEqual(p.create.map((c) => c.title), ["Деньги и экономика — Суть за минуту"]);
  assert.deepEqual(p.add.map((a) => a.code), ["01b", "02a", "02b", "03a"], "по порядку плана");
  assert.equal(p.already, 1);
  assert.equal(p.deferred, 0);
  assert.equal(p.inserts, 5);
  assert.equal(p.units, 250);
  assert.deepEqual(p.byPillar, { space: "PLspace00000", history: "PLhist000000" });
  assert.ok(p.settingChanged, "пропавший плейлист денег и найденный по названию — сохранить");
  assert.equal(sp(quotaLabel(p.units)), "≈ 250 единиц из 10 000 в сутки");
});

test("плейлисты: лимит вставок за раз и повторный запуск", () => {
  const capped = planPlaylistSync(syncInput({ maxInserts: 3 }));
  assert.equal(capped.create.length, 1);
  assert.deepEqual(capped.add.map((a) => a.code), ["01b", "02a"]);
  assert.equal(capped.deferred, 2);
  assert.equal(capped.inserts, 3);
  // Всё уже разложено — делать нечего, настройка та же.
  const done = planPlaylistSync(
    syncInput({
      setting: { auto: true, byPillar: { space: "PLspace00000", history: "PLhist000000", money: "PLmoney00000" } },
      existing: [
        { id: "PLspace00000", title: "Космос — Суть за минуту" },
        { id: "PLhist000000", title: "История — Суть за минуту" },
        { id: "PLmoney00000", title: "Деньги и экономика — Суть за минуту" },
      ],
      members: { PLspace00000: ["v1", "v2"], PLhist000000: ["v3"], PLmoney00000: ["v4", "v5"] },
    }),
  );
  assert.equal(done.inserts, 0);
  assert.equal(done.already, 5);
  assert.ok(!done.settingChanged);
});

test("название: тело videos.update переносит описание, теги, категорию и язык", () => {
  const body = titleUpdateBody("vid1", { title: "Старое", description: "Описание", tags: ["a", "b"], categoryId: "27", defaultLanguage: "ru", defaultAudioLanguage: "ru" }, "  «Новое название»  ");
  assert.deepEqual(body, { id: "vid1", snippet: { title: "Новое название", categoryId: "27", description: "Описание", tags: ["a", "b"], defaultLanguage: "ru", defaultAudioLanguage: "ru" } });
  const bare = titleUpdateBody("vid1", { categoryId: "27" }, "Новое");
  assert.deepEqual(bare.snippet, { title: "Новое", categoryId: "27", description: "", tags: [] });
  assert.throws(() => titleUpdateBody("vid1", { description: "x" }, "Новое"), /категорию/);
  assert.throws(() => titleUpdateBody("vid1", { categoryId: "27" }, "я".repeat(101)), /длиннее 100/);
});

test("название: идеи для вышедших роликов, без нынешнего названия; применить можно только их", () => {
  const file = parseTitleIdeas({
    items: [
      { code: "08a", at: "2026-10-08T10:00:00Z", current: "Старое", ideas: ["Идея 1", "Идея 2", "Уже стоит"] },
      { code: "08b", at: "2026-09-01T10:00:00Z", current: "Давно", ideas: ["Старая идея"] },
      { code: "09a", at: "2026-10-09T10:00:00Z", current: "Не вышел", ideas: ["Идея"] },
    ],
  });
  const views = titleIdeaViews(
    file,
    [
      { videoId: "v8a", code: "08a", title: "уже стоит" },
      { videoId: "v8b", code: "08b", title: "Давно" },
      { videoId: "vx", code: null, title: "Чужое" },
    ],
    now,
    TZ,
  );
  assert.equal(views.length, 1, "08b — старше 14 дней, 09a — не вышел");
  assert.deepEqual(views[0], { code: "08a", videoId: "v8a", title: "уже стоит", before: "Старое", ideas: ["Идея 1", "Идея 2"], atLabel: "08.10, 13:00" });
  assert.equal(allowedTitle(file, "08a", " Идея 2 "), "Идея 2");
  assert.equal(allowedTitle(file, "08a", "Старое"), "Старое", "вернуть прежнее");
  assert.equal(allowedTitle(file, "08a", "Своё"), null);
  assert.equal(allowedTitle(file, "07a", "Идея 1"), null);
});

let passed = 0;
(async () => {
  for (const [name, fn] of tests) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}`);
      throw e;
    }
  }
  console.log(`\nВсе проверки пройдены: ${passed}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
