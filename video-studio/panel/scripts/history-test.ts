// Офлайн-проверка истории цифр канала (lib/history.ts): 120 дней по 2 ролика и 12 открытий
// панели в день укладываются в лимит переменной GitHub; повтор снимка ничего не меняет;
// просмотры ролика «через N часов» — с интерполяцией. Сеть не нужна.
// Запуск из папки video-studio: npx tsx panel/scripts/history-test.ts
import assert from "node:assert/strict";
import type { ChannelVideo } from "../../src/pipeline/youtube-fill";
import { emptyHistory, HISTORY_MAX_CHARS, parseHistory, recordSnapshot, seriesSince, serializeHistory, snapshotDue, trimHistory, viewsAt, type StatsHistory } from "../lib/history";

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

const TZ = "Europe/Moscow";
const H = 3_600_000;
const start = Date.parse("2026-06-01T09:00:00Z"); // 12:00 МСК
const video = (i: number, publishedMs: number, views: number): ChannelVideo => ({
  videoId: `vid${String(i).padStart(8, "0")}`,
  title: `ролик ${i}`,
  description: "",
  fileName: null,
  durationSec: 55,
  uploadStatus: "processed",
  privacyStatus: "public",
  publishAt: null,
  embeddable: true,
  license: "youtube",
  publicStatsViewable: true,
  tags: [],
  categoryId: "27",
  publishedAt: new Date(publishedMs).toISOString(),
  thumbnailUrl: null,
  viewCount: views,
  likeCount: 0,
  commentCount: 0,
});

console.log("История статистики (без сети):");

test("мусор в переменной — пустая история, кривые строки пропускаются", () => {
  assert.deepEqual(parseHistory(null), emptyHistory());
  assert.deepEqual(parseHistory("{oops"), emptyHistory());
  assert.deepEqual(parseHistory(JSON.stringify({ v: 2 })), emptyHistory());
  const h = parseHistory(JSON.stringify({ v: 1, ch: [["2026-10-01", 10, 100, 2], ["bad", 1, 1, 1], ["2026-10-02", "x", 1, 1]], t: [[1, 2, null], [1, "a", 3]], vid: { a: { p: 5, s: [[0, 1], ["x", 2]] }, b: { s: [] } } }));
  assert.deepEqual(h, { v: 1, ch: [["2026-10-01", 10, 100, 2]], t: [[1, 2, null]], vid: { a: { p: 5, s: [[0, 1]] } } });
});

test("120 дней × 2 ролика × 12 открытий в день — JSON ≤ 40 000 знаков, повтор снимка ничего не меняет", () => {
  let h = emptyHistory();
  let raw = serializeHistory(h);
  let writes = 0;
  const vids: { i: number; at: number }[] = [];
  let last: { now: Date; videos: ChannelVideo[] } | null = null;
  for (let day = 0; day < 120; day++) {
    vids.push({ i: day * 2, at: start + day * 24 * H }, { i: day * 2 + 1, at: start + day * 24 * H + 7 * H });
    for (let k = 0; k < 12; k++) {
      const now = new Date(start + day * 24 * H + k * 1.25 * H + 30 * 60_000);
      const videos = vids.filter((v) => v.at <= now.getTime()).map((v) => video(v.i, v.at, Math.round(40 * Math.sqrt((now.getTime() - v.at) / H + 1))));
      if (!snapshotDue(h, now)) continue;
      const next = serializeHistory(trimHistory(recordSnapshot(h, videos, { subscriberCount: 10 + day, viewCount: null, videoCount: null }, now, TZ), undefined, now));
      if (next !== raw) writes++;
      raw = next;
      h = parseHistory(raw);
      last = { now, videos };
    }
  }
  assert.ok(raw.length <= HISTORY_MAX_CHARS, `${raw.length} знаков`);
  assert.equal(h.ch.length, 120, "по строке на день");
  assert.ok(Object.keys(h.vid).length >= 28, "ролики последних двух недель");
  assert.ok(writes > 1000, `записей ${writes}`);
  // Повтор того же снимка — байт в байт.
  const again = serializeHistory(trimHistory(recordSnapshot(h, last!.videos, { subscriberCount: 129, viewCount: null, videoCount: null }, last!.now, TZ), undefined, last!.now));
  assert.equal(again, raw);
  console.log(`    (${raw.length} знаков, ${h.t.length} точек за неделю, ${Object.keys(h.vid).length} роликов)`);
});

test("две загрузки за час — одна запись; через 55 минут — новая точка", () => {
  const now = new Date("2026-10-08T09:00:00Z");
  const v = [video(1, now.getTime() - 5 * H, 500)];
  const h1 = recordSnapshot(emptyHistory(), v, { subscriberCount: 40, viewCount: null, videoCount: null }, now, TZ);
  assert.equal(snapshotDue(h1, new Date(now.getTime() + 20 * 60_000)), false);
  assert.equal(snapshotDue(h1, new Date(now.getTime() + 55 * 60_000)), true);
  const h2 = recordSnapshot(h1, [video(1, now.getTime() - 5 * H, 520)], { subscriberCount: 41, viewCount: null, videoCount: null }, new Date(now.getTime() + 20 * 60_000), TZ);
  assert.equal(h2.t.length, 1, "в течение часа точку не добавляем");
  assert.deepEqual(h2.ch, [["2026-10-08", 41, 520, 1]], "строка дня — последние цифры");
});

test("кривая ролика: по часу первые 48 ч, дальше раз в сутки, после 14 дней и удалённые — выпадают", () => {
  const pub = Date.parse("2026-10-01T09:00:00Z");
  let h: StatsHistory = emptyHistory();
  for (let hr = 0; hr <= 15 * 24; hr += 1) {
    const now = new Date(pub + hr * H + 10 * 60_000);
    h = recordSnapshot(h, [video(1, pub, hr * 10), video(2, pub, hr)], null, now, TZ);
    if (hr === 100) {
      const s = h.vid.vid00000001!.s;
      assert.equal(s.filter((p) => p[0] < 48).length, 48);
      assert.deepEqual(
        s.filter((p) => p[0] >= 48).map((p) => p[0]),
        [48, 72, 96],
      );
    }
  }
  assert.equal(h.vid.vid00000001, undefined, "старше 14 дней — не храним");
  const fresh = recordSnapshot(emptyHistory(), [video(1, pub, 5), video(2, pub, 5)], null, new Date(pub + 3 * H), TZ);
  const gone = recordSnapshot(fresh, [video(1, pub, 9)], null, new Date(pub + 4 * H), TZ);
  assert.deepEqual(Object.keys(gone.vid), ["vid00000001"], "удалённый ролик выпал");
});

test("просмотры через N часов: точно, по прямой между точками, null — если точек рядом нет", () => {
  const e = { s: [[0, 0], [1, 100], [2, 180], [48, 2000], [72, 2600]] as [number, number][] };
  assert.deepEqual(viewsAt(e, 1), { views: 100, approx: false });
  assert.deepEqual(viewsAt(e, 60), { views: 2300, approx: true });
  assert.equal(viewsAt(e, 24), null, "ближайшая точка в 22 ч от 24 — больше четверти возраста");
  assert.equal(viewsAt(e, 200), null);
  assert.equal(viewsAt({ s: [] }, 5), null);
});

test("сжатие: сначала самые старые ролики, точки за неделю — для графика", () => {
  const h: StatsHistory = { v: 1, ch: [["2026-10-01", 1, 1, 1]], t: [[100, 1, 1], [200, 2, 2], [300, 3, 3]], vid: { old: { p: 1, s: [[0, 1]] }, mid: { p: 2, s: [[0, 1]] }, new: { p: 3, s: [[0, 1]] } } };
  const small = trimHistory(h, JSON.stringify(h).length - 10);
  assert.deepEqual(Object.keys(small.vid), ["mid", "new"]);
  assert.deepEqual(
    seriesSince(h, new Date(200 * 60_000)).map((p) => p[0]),
    [200, 300],
  );
});

console.log(`\nВсе проверки истории пройдены: ${passed}.`);
