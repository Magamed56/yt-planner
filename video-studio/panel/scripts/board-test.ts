// Офлайн-проверка «Доски» (/board) на фикстуре lib/board-fixture.ts (её же показывает демо-страница
// app/board/demo): статусы по зонам, YouTube не ответил, английские названия, «загрузил» в Instagram
// и TikTok (PANEL_BOARD), запас и первая дыра, раскладка полотна, вид и время отметки. Свой
// channels/en.json — из фикстуры: тест не зависит от настоящих файлов канала. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/board-test.ts
import assert from "node:assert/strict";
import { BOARD_FIRST_DAY, BOARD_VAR, boardData, buildBoard, CARD_W, COLS, GAP, layoutBoard, parseBoardMarks, ROW, withBoardMark, type BoardZone } from "../lib/board";
import { boardFixture, FIXTURE_EN_JSON, FIXTURE_NOW } from "../lib/board-fixture";
import { cardVisible, markTime, parseSelected, READABLE_K, restoreView, storeView, wheelAction } from "../lib/board-view";
import { studioMarksText } from "../lib/lang-plan";
import { langVideosOf } from "../lib/lang-videos";

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

const dataOf = (fx = boardFixture()) =>
  boardData({ now: fx.now, state: fx.state, enName: "Gist in a Minute", enJson: fx.enJson, enVideos: langVideosOf(fx.releases, "en"), enMarks: fx.enMarks, boardMarks: fx.boardMarks });
const zonesOf = (fx = boardFixture()) =>
  buildBoard({
    now: fx.now,
    ru: fx.state,
    en: { name: "Gist in a Minute", json: fx.enJson, released: langVideosOf(fx.releases, "en").map((v) => ({ code: v.code, title: v.texts?.title ?? "", cover: null })), marks: fx.enMarks },
    marks: fx.boardMarks,
  });
const zone = (zones: BoardZone[], key: string) => zones.find((z) => z.key === key)!;
const card = (zones: BoardZone[], key: string, code: string) => zone(zones, key).items.find((i) => i.code === code);

const zones = zonesOf();

test("зоны — RU, EN, Instagram, TikTok; тема без сценария (12b) на доске не стоит", () => {
  assert.deepEqual(
    zones.map((z) => z.key),
    ["ru", "en", "instagram", "tiktok"],
  );
  assert.equal(card(zones, "ru", "12b"), undefined);
});

test("RU: статус по этапу очереди, время с YouTube — точное, остальное — ориентир", () => {
  assert.equal(card(zones, "ru", "01a")?.status, "published");
  assert.equal(card(zones, "ru", "06b")?.status, "scheduled");
  assert.equal(card(zones, "ru", "06b")?.exact, true);
  assert.equal(card(zones, "ru", "08b")?.status, "studio");
  assert.equal(card(zones, "ru", "09b")?.status, "ready");
  assert.equal(card(zones, "ru", "09b")?.exact, false);
  assert.equal(card(zones, "ru", "11a")?.status, "script");
  assert.equal(card(zones, "ru", "10a")?.note, "ждёт пересборки");
  assert.equal(card(zones, "ru", "L01")?.long, true);
  assert.equal(card(zones, "ru", "06b")?.dateLabel, "11.10");
  assert.equal(card(zones, "ru", "06b")?.time, "19:00");
  assert.ok(card(zones, "ru", "01a")?.cover?.startsWith("data:image/svg+xml"), "обложка с YouTube");
});

test("RU: запас и первая дыра — из coverage() очереди, как у кольца", () => {
  const ru = zone(zones, "ru");
  assert.equal(ru.runway.text, "запас до 13.10 (2 дня)");
  assert.deepEqual(ru.runway.gap, { at: "2026-10-13T16:00:00Z", label: "13.10 19:00" });
  // На дыре 13.10 19:00 стоит ориентир 08b (загружен в Studio без времени).
  assert.equal(card(zones, "ru", "08b")?.at, "2026-10-13T16:00:00Z");
});

test("EN: план от schedule.start своего en.json, английское название, точное — только отмеченное", () => {
  assert.equal(FIXTURE_EN_JSON.schedule.start, "2026-10-09");
  assert.equal(card(zones, "en", "01a")?.title, "Why your voice sounds weird on recordings");
  assert.equal(card(zones, "en", "01a")?.status, "published");
  assert.equal(card(zones, "en", "03a")?.status, "scheduled");
  assert.equal(card(zones, "en", "03a")?.exact, true);
  assert.equal(card(zones, "en", "03b")?.status, "ready");
  assert.equal(card(zones, "en", "03b")?.exact, false, "время по плану — ориентир (≈)");
  assert.equal(card(zones, "en", "03a")?.time, "12:00", "по Нью-Йорку");
  assert.equal(card(zones, "en", "01a")?.marked, undefined, "кнопки «загрузил» у EN на карточке нет");
  assert.equal(zone(zones, "en").runway.text, "запас до 11.10 (0 дней)");
  assert.equal(zone(zones, "en").runway.gap?.label, "11.10 19:00");
});

test("EN: нет английского названия — русское", () => {
  const fx = boardFixture();
  const z = buildBoard({ now: fx.now, ru: fx.state, en: { name: "EN", json: fx.enJson, released: [{ code: "01a", title: "", cover: null }], marks: {} }, marks: fx.boardMarks });
  assert.equal(card(z, "en", "01a")?.title, "Почему свой голос на записи звучит чужим");
});

test("Instagram и TikTok: Shorts из релизов, отметка — вышел/запланирован, точное время — только у отмеченных", () => {
  assert.equal(card(zones, "instagram", "01a")?.status, "published");
  assert.equal(card(zones, "instagram", "01a")?.exact, true);
  assert.equal(card(zones, "instagram", "06b")?.status, "scheduled");
  assert.equal(card(zones, "instagram", "06b")?.marked, true);
  assert.equal(card(zones, "instagram", "05a")?.status, "ready");
  assert.equal(card(zones, "instagram", "05a")?.exact, false);
  assert.equal(card(zones, "instagram", "05a")?.note, "не выложен");
  assert.equal(card(zones, "instagram", "09b")?.marked, false);
  assert.equal(card(zones, "instagram", "10a")?.marked, undefined, "ждёт пересборки — кнопки нет");
  assert.equal(card(zones, "instagram", "11a"), undefined, "без видео в релизе — нечего грузить");
  assert.equal(card(zones, "instagram", "L01"), undefined, "«Разборы» 16:9 — не для Reels");
  assert.equal(zone(zones, "instagram").runway.text, "запас до 11.10 (0 дней)");
  assert.equal(zone(zones, "instagram").runway.gap?.label, "12.10 12:00");
  assert.equal(zone(zones, "tiktok").runway.text, "запаса нет — ближайший слот пуст");
  assert.equal(zone(zones, "tiktok").runway.gap?.label, "11.10 19:00");
});

test("YouTube не ответил: запас неизвестен, у неотмеченных нет «загрузил» и «не выложен», полоса над полотном", () => {
  const fx = boardFixture({ youtubeError: "квота" });
  const z = zonesOf(fx);
  assert.match(zone(z, "ru").runway.text, /неизвестен — YouTube не ответил/);
  assert.equal(zone(z, "ru").empty.length, 0, "без YouTube пустых слотов не показываем");
  assert.equal(card(z, "ru", "01a")?.exact, false);
  const ig = zone(z, "instagram");
  assert.ok(ig.items.filter((i) => i.marked === false).length === 0, "у неотмеченных кнопки нет");
  assert.ok(ig.items.every((i) => i.note !== "не выложен"));
  assert.equal(card(z, "instagram", "01a")?.marked, true, "отмеченные снять можно");
  assert.equal(dataOf(fx).youtubeError, "квота");
});

test("PANEL_BOARD не прочиталась — кнопок нет, запас неизвестен", () => {
  const fx = { ...boardFixture(), boardMarks: null };
  const z = buildBoard({ now: fx.now, ru: fx.state, en: { name: "EN", json: fx.enJson, released: [], marks: {} }, marks: null });
  assert.equal(card(z, "instagram", "09b")?.marked, undefined);
  assert.match(zone(z, "tiktok").runway.text, new RegExp(`неизвестен.*${BOARD_VAR}`));
});

test("отметки PANEL_BOARD: только instagram и tiktok, снятие убирает код", () => {
  const m = parseBoardMarks('{"instagram":{"08A":"2026-10-11T16:00:00Z"},"youtube":{"08a":"2026-10-11T16:00:00Z"},"tiktok":"мусор"}');
  assert.deepEqual(Object.keys(m), ["instagram"]);
  assert.equal(m.instagram?.["08a"], Date.parse("2026-10-11T16:00:00Z"));
  assert.deepEqual(parseBoardMarks(studioMarksText(withBoardMark(m, "instagram", "08a", null))), {});
  assert.deepEqual(withBoardMark(m, "youtube", "08a", 1), m);
});

test("время отметки: прошло или ориентир — «сейчас»; впереди и точное — выбор", () => {
  const now = FIXTURE_NOW.getTime();
  assert.deepEqual(markTime({ at: "2026-10-10T09:00:00Z", exact: true }, now), { kind: "now" });
  assert.deepEqual(markTime({ at: "2026-10-14T16:00:00Z", exact: false }, now), { kind: "now" });
  assert.deepEqual(markTime({ at: "2026-10-14T16:00:00Z", exact: true }, now), { kind: "choose", at: "2026-10-14T16:00:00Z" });
  // Instagram: без отметки время — ориентир (≈), но слот точный — русский 07a стоит на 12.10 12:00.
  const ig07a = card(zones, "instagram", "07a")!;
  assert.equal(ig07a.exact, false);
  assert.equal(ig07a.fixedSlot, true);
  assert.deepEqual(markTime(ig07a, now), { kind: "choose", at: "2026-10-12T09:00:00Z" });
  // 09b — ориентир и в русской очереди: «загрузил» — сейчас.
  assert.deepEqual(markTime(card(zones, "instagram", "09b")!, now), { kind: "now" });
});

test("раскладка: зоны рядом без нахлёста, строки — от первого дня канала, день — на одной высоте во всех зонах", () => {
  const plan = layoutBoard(zones, "2026-10-11");
  for (let i = 1; i < plan.zones.length; i++) assert.ok(plan.zones[i]!.x >= plan.zones[i - 1]!.x + plan.zones[i - 1]!.w);
  assert.equal(plan.days[0]!.key, BOARD_FIRST_DAY);
  const at = (key: string, code: string) => plan.zones.find((z) => z.key === key)!.cards.find((c) => c.code === code)!;
  assert.equal(at("ru", "06a").y, at("instagram", "06a").y);
  assert.equal(at("ru", "06a").y, plan.todayY);
  // 12:00 и 19:00 одного дня — рядом, слева направо.
  assert.equal(at("ru", "07b").y, at("ru", "07a").y);
  assert.equal(at("ru", "07b").x - at("ru", "07a").x, CARD_W + GAP);
  // Строки — от постоянной даты: убрали ролик из обычного дня (два слота) — «сегодня» на месте.
  // Выше становится только день, где роликов больше слотов («Разбор» третьим), — вид всё равно
  // хранится от строки «сегодня» (lib/board-view.ts).
  const fewer = zones.map((z) => ({ ...z, items: z.items.filter((i) => i.code !== "01a") }));
  assert.equal(layoutBoard(fewer, "2026-10-11").days[0]!.key, BOARD_FIRST_DAY);
  assert.equal(layoutBoard(fewer, "2026-10-11").todayY, plan.todayY);
});

test("раскладка: «Разбор» третьим в дне — вторая строка этого дня во всех зонах, зона не шире двух карточек", () => {
  const plan = layoutBoard(zones, "2026-10-11");
  const ru = plan.zones[0]!;
  const day = plan.days.find((d) => d.key === "2026-10-13")!; // вт: 08a 12:00, 08b 19:00, L02 21:00
  assert.equal(day.h, 2 * ROW);
  const l02 = ru.cards.find((c) => c.code === "L02")!;
  assert.equal(l02.y, day.y + ROW);
  assert.equal(ru.w, 2 * 14 + COLS * CARD_W + (COLS - 1) * GAP);
  assert.equal(plan.days.find((d) => d.key === "2026-10-12")!.h, ROW);
});

test("пустые слоты и первая дыра: рамка «пусто», дыра — красным на ролике или пустом слоте", () => {
  const plan = layoutBoard(zones, "2026-10-11");
  const ru = plan.zones[0]!;
  assert.equal(ru.cards.find((c) => c.code === "08b")?.gap, true, "ориентир 08b стоит на первой дыре");
  assert.equal(ru.empty.filter((e) => e.dateKey === "2026-10-18").length, 2, "18.10: 12:00 и 19:00 пусты");
  const tt = plan.zones.find((z) => z.key === "tiktok")!;
  // В TikTok 11.10 19:00 — ролик 06b без отметки: дыра — на нём.
  assert.equal(tt.cards.find((c) => c.code === "06b")?.gap, true);
  assert.deepEqual(ru.counts, { published: 12, scheduled: 5, ready: 3 }); // готовы 09b, 10a (ждёт пересборки), 10b
});

test("вид полотна: сдвиг по высоте — от строки «сегодня», другой день — как «Сегодня»", () => {
  const base = (k: number) => 48 - 500 * k;
  const stored = storeView({ x: -120, y: base(1) - 300, k: 1 }, "2026-10-11", base);
  assert.deepEqual(stored, { k: 1, x: -120, dy: -300, day: "2026-10-11" });
  assert.deepEqual(restoreView(JSON.stringify(stored), "2026-10-11", base), { k: 1, x: -120, y: base(1) - 300 });
  assert.deepEqual(restoreView(JSON.stringify(stored), "2026-10-12", base), { k: 1, x: -120, y: base(1) });
  assert.equal(restoreView("мусор", "2026-10-11", base), null);
  assert.equal(restoreView(JSON.stringify({ ...stored, k: 9 }), "2026-10-11", base), null);
  assert.ok(READABLE_K === 0.8);
});

test("колесо: шаг ограничен ±60, щипок тачпада и мышь — масштаб, два пальца — сдвиг", () => {
  const big = wheelAction({ deltaX: 0, deltaY: 1000, deltaMode: 0, ctrlKey: true, metaKey: false });
  const max = wheelAction({ deltaX: 0, deltaY: 60, deltaMode: 0, ctrlKey: true, metaKey: false });
  assert.deepEqual(big, max);
  assert.ok("zoom" in big && big.zoom < 1 && big.zoom > 0.4);
  assert.ok("zoom" in wheelAction({ deltaX: 0, deltaY: 120, deltaMode: 0, ctrlKey: false, metaKey: false, wheelDeltaY: -120 }));
  assert.deepEqual(wheelAction({ deltaX: 4, deltaY: 7, deltaMode: 0, ctrlKey: false, metaKey: false, wheelDeltaY: -21 }), { pan: [-4, -7] });
});

test("фильтры и адрес листа", () => {
  const f = { notUploaded: true, week: false };
  assert.equal(cardVisible({ status: "ready", dateKey: "2026-10-12" }, f, "2026-10-11", "2026-10-17"), true);
  assert.equal(cardVisible({ status: "published", dateKey: "2026-10-12" }, f, "2026-10-11", "2026-10-17"), false);
  assert.equal(cardVisible({ status: "ready", dateKey: "2026-10-30" }, { notUploaded: false, week: true }, "2026-10-11", "2026-10-17"), false);
  assert.deepEqual(parseSelected("instagram:08A", ["ru", "instagram"]), { zone: "instagram", code: "08a" });
  assert.deepEqual(parseSelected("ru:l01", ["ru"]), { zone: "ru", code: "L01" });
  assert.equal(parseSelected("youtube:08a", ["ru"]), null);
  assert.equal(parseSelected("ru:08a:x", ["ru"]), null);
});

test("данные страницы: английские ролики с текстами, пояс канала, отметки EN читаются", () => {
  const d = dataOf();
  assert.equal(d.en.timezone, "America/New_York");
  assert.equal(d.en.canMark, true);
  assert.equal(d.en.videos.find((v) => v.code === "01a")?.texts?.title, "Why your voice sounds weird on recordings");
  assert.equal(d.plan.card.w, CARD_W);
  assert.equal(d.todayKey, "2026-10-11");
});

console.log(`\nboard-test: ${passed} проверок прошло`);
