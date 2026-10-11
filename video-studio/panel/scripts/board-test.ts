// Офлайн-проверка «Доски» (/board) на фикстуре lib/board-fixture.ts (её же показывает демо-страница
// app/board/demo): статусы по зонам, YouTube не ответил, английские названия, «загрузил» в Instagram
// и TikTok (PANEL_BOARD), запас и первая дыра, раскладка полотна, вид и время отметки; переменная
// PANEL_BOARD целиком — отметки, раскладка (места зон, сдвиги карточек) и стикеры не стирают друг
// друга, лимиты (100 стикеров, 280 знаков, 48 КБ) и мусор во входе. Свой
// channels/en.json — из фикстуры: тест не зависит от настоящих файлов канала. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/board-test.ts
import assert from "node:assert/strict";
import {
  BOARD_FIRST_DAY,
  BOARD_VAR,
  boardData,
  boardStateText,
  boardWithLayout,
  boardWithMark,
  boardWithSticker,
  buildBoard,
  CARD_W,
  COLS,
  GAP,
  layoutBoard,
  parseBoardState,
  ROW,
  withBoardMark,
  type BoardWrite,
  type BoardZone,
} from "../lib/board";
import { applyLayout, BOARD_BYTES_MAX, boardBounds, cardKey, COORD_MAX, patchLayout, STICKER_MAX, STICKER_TEXT_MAX, utf8Bytes, type Sticker } from "../lib/board-state";
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
  boardData({ now: fx.now, state: fx.state, enName: "Gist in a Minute", enJson: fx.enJson, enVideos: langVideosOf(fx.releases, "en"), enMarks: fx.enMarks, board: fx.board });
const zonesOf = (fx = boardFixture()) =>
  buildBoard({
    now: fx.now,
    ru: fx.state,
    en: { name: "Gist in a Minute", json: fx.enJson, released: langVideosOf(fx.releases, "en").map((v) => ({ code: v.code, title: v.texts?.title ?? "", cover: null })), marks: fx.enMarks },
    marks: fx.board.marks,
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

test("EN: отметка в Studio без релиза (удалён) — слот занят, не «пусто» и не дыра", () => {
  const fx = boardFixture();
  const z = buildBoard({ now: fx.now, ru: fx.state, en: { name: "EN", json: fx.enJson, released: [], marks: { "05a": Date.parse("2026-10-11T16:00:00Z") } }, marks: fx.board.marks });
  assert.equal(zone(z, "en").runway.text, "запас до 11.10 (0 дней)");
  assert.ok(!zone(z, "en").empty.some((e) => e.at === "2026-10-11T16:00:00Z"));
});

test("EN: нет английского названия — русское", () => {
  const fx = boardFixture();
  const z = buildBoard({ now: fx.now, ru: fx.state, en: { name: "EN", json: fx.enJson, released: [{ code: "01a", title: "", cover: null }], marks: {} }, marks: fx.board.marks });
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
  const fx = boardFixture();
  const z = buildBoard({ now: fx.now, ru: fx.state, en: { name: "EN", json: fx.enJson, released: [], marks: {} }, marks: null });
  assert.equal(card(z, "instagram", "09b")?.marked, undefined);
  assert.match(zone(z, "tiktok").runway.text, new RegExp(`неизвестен.*${BOARD_VAR}`));
});

test("отметки PANEL_BOARD: только instagram и tiktok, снятие убирает код", () => {
  const m = parseBoardState('{"instagram":{"08A":"2026-10-11T16:00:00Z"},"youtube":{"08a":"2026-10-11T16:00:00Z"},"tiktok":"мусор"}').marks;
  assert.deepEqual(Object.keys(m), ["instagram"]);
  assert.equal(m.instagram?.["08a"], Date.parse("2026-10-11T16:00:00Z"));
  assert.deepEqual(parseBoardState(studioMarksText(withBoardMark(m, "instagram", "08a", null))).marks, {});
  assert.deepEqual(withBoardMark(m, "youtube", "08a", 1), m);
});

// ---- PANEL_BOARD целиком: отметки, раскладка, стикеры ----

const textOf = (w: BoardWrite) => {
  assert.ok("text" in w, "error" in w ? w.error : "");
  return w.text;
};
const errorOf = (w: BoardWrite) => {
  assert.ok("error" in w, "ожидали ошибку");
  return w.error;
};
const sticker = (id: string, over: Partial<Sticker> = {}): Sticker => ({ id, x: 10, y: 20, text: "заметка", color: "yellow", ...over });
const FULL = JSON.stringify({
  instagram: { "08a": "2026-10-12T09:00:00Z" },
  tiktok: { "07b": "2026-10-11T16:00:00Z" },
  layout: { zones: { ru: { x: 0, y: 80 } }, cards: { "instagram:08a": { dx: 10, dy: -20 } } },
  stickers: [sticker("a1"), sticker("b2", { color: "pink", text: "второй" })],
});

test("PANEL_BOARD: один разбор на весь объект — отметки, раскладка, стикеры", () => {
  const st = parseBoardState(FULL);
  assert.equal(st.marks.instagram?.["08a"], Date.parse("2026-10-12T09:00:00Z"));
  assert.deepEqual(st.layout, { zones: { ru: { x: 0, y: 80 } }, cards: { "instagram:08a": { dx: 10, dy: -20 } } });
  assert.deepEqual(
    st.stickers.map((s) => s.id),
    ["a1", "b2"],
  );
  // Запись и разбор — туда и обратно без потерь.
  assert.deepEqual(parseBoardState(boardStateText(st)), st);
});

test("«загрузил» не стирает раскладку и стикеры", () => {
  const before = parseBoardState(FULL);
  const after = parseBoardState(textOf(boardWithMark(FULL, "tiktok", "08a", Date.parse("2026-10-12T09:00:00Z"))));
  assert.equal(after.marks.tiktok?.["08a"], Date.parse("2026-10-12T09:00:00Z"));
  assert.deepEqual(after.layout, before.layout);
  assert.deepEqual(after.stickers, before.stickers);
  const off = parseBoardState(textOf(boardWithMark(FULL, "instagram", "08a", null)));
  assert.equal(off.marks.instagram, undefined);
  assert.deepEqual(off.layout, before.layout);
  assert.deepEqual(off.stickers, before.stickers);
});

test("раскладка и стикеры не стирают отметки", () => {
  const before = parseBoardState(FULL);
  const moved = parseBoardState(textOf(boardWithLayout(FULL, { zones: { tiktok: { x: 2000.4, y: -30 } }, cards: { "RU:09B": { dx: 5, dy: 0 }, "instagram:08a": null } })));
  assert.deepEqual(moved.marks, before.marks);
  assert.deepEqual(moved.stickers, before.stickers);
  assert.deepEqual(moved.layout.zones, { ru: { x: 0, y: 80 }, tiktok: { x: 2000, y: -30 } }, "координаты — целые");
  assert.deepEqual(moved.layout.cards, { "ru:09b": { dx: 5, dy: 0 } }, "ключ — через normCode, null убирает");
  const withSticker = parseBoardState(textOf(boardWithSticker(FULL, { op: "put", sticker: sticker("c3") })));
  assert.deepEqual(withSticker.marks, before.marks);
  assert.deepEqual(withSticker.layout, before.layout);
  assert.equal(withSticker.stickers.length, 3);
  const edited = parseBoardState(textOf(boardWithSticker(FULL, { op: "put", sticker: sticker("a1", { text: "новый текст", color: "blue", x: -40 }) })));
  assert.deepEqual(edited.stickers[0], sticker("a1", { text: "новый текст", color: "blue", x: -40 }), "тот же id — правка на месте");
  const deleted = parseBoardState(textOf(boardWithSticker(FULL, { op: "delete", id: "a1" })));
  assert.deepEqual(
    deleted.stickers.map((s) => s.id),
    ["b2"],
  );
  assert.deepEqual(deleted.marks, before.marks);
});

test("«По датам»: раскладка — пустая, стикеры и отметки остаются", () => {
  const before = parseBoardState(FULL);
  const reset = parseBoardState(textOf(boardWithLayout(FULL, { reset: true })));
  assert.deepEqual(reset.layout, { zones: {}, cards: {} });
  assert.deepEqual(reset.stickers, before.stickers);
  assert.deepEqual(reset.marks, before.marks);
  // Откат «По датам» — reset с прежними местами.
  assert.deepEqual(patchLayout(reset.layout, { reset: true, ...before.layout }), before.layout);
});

test("лимиты: 100 стикеров, 280 знаков, 48 КБ — ошибка и ничего не пишем", () => {
  const many = JSON.stringify({ stickers: Array.from({ length: STICKER_MAX }, (_, i) => sticker(`s${i}`, { text: "" })) });
  assert.equal(parseBoardState(many).stickers.length, STICKER_MAX);
  assert.match(errorOf(boardWithSticker(many, { op: "put", sticker: sticker("new") })), /уже 100/);
  // Правка существующего при полном списке — можно.
  assert.ok("text" in boardWithSticker(many, { op: "put", sticker: sticker("s5", { text: "ок" }) }));
  assert.match(errorOf(boardWithSticker(FULL, { op: "put", sticker: sticker("long", { text: "я".repeat(STICKER_TEXT_MAX + 1) }) })), /до 280 знаков/);
  assert.ok("text" in boardWithSticker(FULL, { op: "put", sticker: sticker("long", { text: "я".repeat(STICKER_TEXT_MAX) }) }));
  // 100 стикеров по 280 кириллических знаков (≈ 56 КБ в UTF-8) в переменную не помещаются.
  let raw = "{}";
  let problem: string | null = null;
  for (let i = 0; i < STICKER_MAX && !problem; i++) {
    const w = boardWithSticker(raw, { op: "put", sticker: sticker(`big${i}`, { text: "ж".repeat(STICKER_TEXT_MAX) }) });
    if ("error" in w) problem = w.error;
    else raw = w.text;
  }
  assert.match(problem ?? "", /не помещается.*48/);
  assert.ok(utf8Bytes(raw) <= BOARD_BYTES_MAX, "записанное — не больше 48 КБ");
  assert.ok("text" in boardWithSticker(raw, { op: "delete", id: "big0" }), "удалить из полной — можно");
  // Переменная без 5 байт полная: отметка (≈ 44 байта) не влезает — ошибка, а не обрезанный JSON.
  const cards = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`ru:${String((i % 99) + 1).padStart(2, "0")}${"abcdef"[Math.floor(i / 99)]}`, { dx: 99999, dy: -99999 }]));
  const empty = Array.from({ length: STICKER_MAX }, (_, i) => sticker(`p${i}`, { text: "" }));
  let extra = BOARD_BYTES_MAX - 5 - utf8Bytes(boardStateText({ marks: {}, layout: { zones: {}, cards }, stickers: empty }));
  const padded = empty.map((s) => {
    const n = Math.min(STICKER_TEXT_MAX, Math.max(0, extra));
    extra -= n;
    return { ...s, text: "a".repeat(n) };
  });
  const nearFull = boardStateText({ marks: {}, layout: { zones: {}, cards }, stickers: padded });
  assert.equal(utf8Bytes(nearFull), BOARD_BYTES_MAX - 5);
  assert.match(errorOf(boardWithMark(nearFull, "instagram", "08a", Date.parse("2026-10-12T09:00:00Z"))), /не помещается/);
  assert.ok("text" in boardWithLayout(nearFull, { cards: { "ru:01a": null } }), "убрать сдвиг — можно");
});

test("мусор во входе: битый JSON, чужие ключи, не числа, кривые коды — пропускаем", () => {
  assert.deepEqual(parseBoardState("не json"), { marks: {}, layout: { zones: {}, cards: {} }, stickers: [] });
  assert.deepEqual(parseBoardState("[1,2]"), { marks: {}, layout: { zones: {}, cards: {} }, stickers: [] });
  const junk = parseBoardState(
    JSON.stringify({
      layout: {
        zones: { ru: { x: "1", y: 2 }, youtube: { x: 1, y: 2 }, en: { x: 1e9, y: -1e9 } },
        cards: { "ru:8a": { dx: 1, dy: 1 }, "tg:08a": { dx: 1, dy: 1 }, "en:L01": { dx: 0, dy: 0 }, "en:l02": { dx: 3.6, dy: null }, "en:l03": { dx: 3.6, dy: -2.2 } },
      },
      stickers: [{ id: "ok", x: 1, y: 2, text: "т".repeat(400), color: "чёрный" }, { id: "ok", x: 5, y: 5 }, { id: "плохой id", x: 1, y: 1 }, { x: 1, y: 1 }, "строка", null],
    }),
  );
  assert.deepEqual(junk.layout, { zones: { en: { x: COORD_MAX, y: -COORD_MAX } }, cards: { "en:L03": { dx: 4, dy: -2 } } });
  assert.equal(junk.stickers.length, 1, "повтор id и кривые — прочь");
  assert.equal(junk.stickers[0]!.text.length, STICKER_TEXT_MAX, "длинный текст из переменной — обрезан");
  assert.equal(junk.stickers[0]!.color, "yellow", "чужой цвет — жёлтый");
  // Вход действий строже: непонятное — ошибка, переменная не меняется.
  assert.ok("error" in boardWithLayout(FULL, { zones: { youtube: { x: 1, y: 1 } } }));
  assert.ok("error" in boardWithLayout(FULL, { cards: { "ru:08a:x": { dx: 1, dy: 1 } } }));
  assert.ok("error" in boardWithLayout(FULL, { cards: { "ru:08a": { dx: "1", dy: 1 } } }));
  assert.ok("error" in boardWithLayout(FULL, "мусор"));
  assert.ok("error" in boardWithSticker(FULL, { op: "put", sticker: { ...sticker("x"), color: "чёрный" } }));
  assert.ok("error" in boardWithSticker(FULL, { op: "put", sticker: { ...sticker("x"), x: Number.NaN } }));
  assert.ok("error" in boardWithSticker(FULL, { op: "move" }));
  assert.equal(cardKey("Instagram:08A"), "instagram:08a");
  assert.equal(cardKey("ru:L01"), "ru:L01");
  assert.equal(cardKey("ru"), null);
});

test("раскладка на полотне: зона — свой угол, карточка — сдвиг от места по дате; рамка — со стикерами", () => {
  const plan = layoutBoard(zones, "2026-10-11");
  const tt = plan.zones.find((z) => z.key === "tiktok")!;
  const c = tt.cards.find((x) => x.code === "06b")!;
  const moved = applyLayout(plan, { zones: { tiktok: { x: -500, y: 300 } }, cards: { "tiktok:06b": { dx: 30, dy: -10 } } });
  const mt = moved.zones.find((z) => z.key === "tiktok")!;
  assert.deepEqual([mt.x, mt.y], [-500, 300]);
  const mc = mt.cards.find((x) => x.code === "06b")!;
  assert.deepEqual([mc.x, mc.y], [c.x + 30, c.y - 10]);
  assert.equal(moved.days, plan.days, "строки дней — общие, по датам");
  assert.equal(applyLayout(plan, { zones: {}, cards: {} }), plan);
  const b = boardBounds(moved, [{ x: 5000, y: -200 }]);
  assert.equal(b.x, -500);
  assert.equal(b.y, -200);
  assert.ok(b.x + b.w >= 5000 + 200);
});

test("фикстура: раскладка и пара стикеров для демо; PANEL_BOARD не прочиталась — двигать нельзя", () => {
  const d = dataOf();
  assert.equal(d.boardOk, true);
  assert.ok(d.layout.zones.tiktok);
  assert.equal(d.stickers.length, 2);
  const fx = boardFixture();
  const none = boardData({ now: fx.now, state: fx.state, enName: "EN", enJson: fx.enJson, enVideos: [], enMarks: fx.enMarks, board: null });
  assert.equal(none.boardOk, false);
  assert.deepEqual(none.stickers, []);
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
