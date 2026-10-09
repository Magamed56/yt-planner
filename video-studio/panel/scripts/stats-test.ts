// Офлайн-проверка экрана «Статистика»: числа по-русски, ролики, монетизация, рубрики, хэштеги,
// минуты Actions, usage.jsonl, statistics в youtube-fill и значок просмотров у очереди.
// Сеть и ключи не нужны. Запуск из папки video-studio: npx tsx panel/scripts/stats-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listChannel, listChannelVideos, type ChannelVideo } from "../../src/pipeline/youtube-fill";
import { buildState, parseAutopilot } from "../lib/state";
import { dropTomorrow, etaLabel, kpiTrends } from "../lib/trends";
import {
  actionsMinutes,
  buildStats,
  formatCount,
  formatRate,
  formatUsd,
  hashtagRanking,
  hashtagsOf,
  monetization,
  parseUsage,
  pillarRanking,
  usageSummary,
  videoStats,
  type Pillar,
  type RunTiming,
  type Topic,
} from "../lib/stats";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;
// Intl ставит неразрывные пробелы («1,2 тыс.», «12 345») — в проверках сравниваем с обычными.
const sp = (s: string | null | undefined) => (s ?? "").replace(/\s/gu, " ");

// Папка panel — CommonJS (в её package.json нет "type": "module"), верхнеуровневого await нет:
// проверки копим и запускаем по очереди в конце файла.
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => void tests.push([name, fn]);

// 09.10.2026, 15:00 МСК (05:00 по Калифорнии).
const now = new Date("2026-10-09T12:00:00Z");
const TZ = "Europe/Moscow";
const video = (over: Partial<ChannelVideo> & { videoId: string }): ChannelVideo => ({
  title: `Ролик ${over.videoId}`,
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
  publishedAt: null,
  thumbnailUrl: null,
  viewCount: 0,
  likeCount: 0,
  commentCount: 0,
  ...over,
});
const videos: ChannelVideo[] = [
  // 8,125 суток назад — 1000 в сутки
  video({ videoId: "v1", publishedAt: "2026-10-01T09:00:00Z", viewCount: 8125, likeCount: 300, commentCount: 12, durationSec: 58, description: "#shorts #космос #факты #луна" }),
  // 1,125 суток — 400 в сутки
  video({ videoId: "v2", publishedAt: "2026-10-08T09:00:00Z", viewCount: 450, likeCount: 20, commentCount: 1, durationSec: 45, description: "#shorts #космос #история" }),
  // 3 часа назад — свежий, в сравнения не идёт
  video({ videoId: "v3", publishedAt: "2026-10-09T09:00:00Z", viewCount: 300, durationSec: 50, description: "#shorts #деньги" }),
  // запланирован — не вышел
  video({ videoId: "v4", privacyStatus: "private", publishAt: "2026-10-10T09:00:00Z", publishedAt: "2026-10-07T10:00:00Z", viewCount: 2 }),
  // не из плана, длинный и старше 90 дней — 500 в сутки, но в порог Shorts не входит
  video({ videoId: "v5", publishedAt: "2026-07-01T12:00:00Z", viewCount: 50_000, durationSec: 600, description: "#shorts #история #деньги" }),
  // 4,125 суток — ≈ 499,9 в сутки; лайки скрыты
  video({ videoId: "v6", publishedAt: "2026-10-05T09:00:00Z", viewCount: 2062, likeCount: null, commentCount: 3, durationSec: 60, description: "#Shorts, #деньги! #факты" }),
];
const topics: Topic[] = [
  { videoId: "v1", code: "01a", pillar: "why" },
  { videoId: "v2", code: "01b", pillar: "history" },
  { videoId: "v3", code: "02a", pillar: "space" },
  { videoId: "v4", code: "02b", pillar: "mind" },
  { videoId: "v6", code: "03a", pillar: "why" },
];
const plan = json("content/plan.json") as { pillars: Pillar[] };
const pillars = plan.pillars.map((p) => ({ id: p.id, title: p.title }));

test("тренды: 7 дней к прошлым 7, «вчера / обычно», короткая история — «считаю с …», вышло из слотов", () => {
  const TZ = "Europe/Moscow";
  const now = new Date("2026-10-20T09:00:00Z");
  const day = (n: number) => new Date(Date.UTC(2026, 9, 20 - n)).toISOString().slice(0, 10);
  // 20 дней: подписчики +2 в день; просмотры +100 в день первые 13 дней, потом +150.
  const ch = Array.from({ length: 21 }, (_, i) => {
    const n = 20 - i;
    const views = 1000 + Math.min(i, 13) * 100 + Math.max(0, i - 13) * 150;
    return [day(n), 600 + i * 2, views, 10] as [string, number, number, number];
  });
  const h = { v: 1 as const, ch, t: [], vid: {} };
  const published = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => new Date(now.getTime() - d * 0.6 * 86_400_000).toISOString());
  const t = kpiTrends(h, published, 2, 640, now, TZ);
  const [subs, views, yest, out] = t.tiles;
  assert.equal(subs!.delta, "▲ +14 за 7 дн.");
  assert.equal(subs!.sparkLabel, "подписчики за 21 дн.: с 600 до 640");
  const nb = (x: string | null | undefined) => x?.replace(/\s/gu, " ");
  assert.equal(nb(views!.value), "1 050");
  assert.equal(views!.delta, "▲ +50 % к прошлым 7", "7 дней по 150 = 1 050 против 7 по 100 = 700");
  assert.equal(yest!.value, "≈ 150");
  assert.equal(yest!.delta, "обычно 100");
  assert.equal(out!.value, "10 из 14");
  assert.equal(t.subsPerDay, 2);
  assert.equal(nb(t.milestone), "1 000 подписчиков — осталось 360, ≈ 180 дней");
  // Три дня истории: процента нет, «считаю с …».
  const short = kpiTrends({ ...h, ch: ch.slice(-3) }, [], 2, 640, now, TZ);
  assert.equal(short.tiles[1]!.delta, null);
  assert.equal(short.tiles[1]!.note, "считаю с 18.10 · есть 2 из 7 дней");
  assert.equal(short.subsPerDay, null, "меньше 3 дней — темп не считаем");
  // Пусто: работает только «Вышло».
  const none = kpiTrends({ v: 1, ch: [], t: [], vid: {} }, published, 2, 640, now, TZ);
  assert.deepEqual(
    none.tiles.map((x) => x.delta !== null),
    [false, false, false, true],
  );
});

test("темп до цели: дата и дни; рост остановился; больше 2 лет; выпадет из окна 90 дней", () => {
  const now = new Date("2026-10-20T09:00:00Z");
  assert.equal(etaLabel(466, 500, 2, now, "Europe/Moscow"), "≈ 2 в день → 500 к 06.11 (17 дней)");
  assert.equal(etaLabel(466, 500, 0, now, "Europe/Moscow"), "рост остановился — при нынешнем темпе цель не достигается");
  assert.equal(etaLabel(10, 10_000, 1, now, "Europe/Moscow"), "при нынешнем темпе — больше 2 лет");
  assert.equal(etaLabel(600, 500, 2, now, "Europe/Moscow"), null, "цель уже есть");
  assert.equal(etaLabel(466, 500, null, now, "Europe/Moscow"), null);
  const at = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  assert.equal(
    dropTomorrow(
      [
        { publishedAt: at(89.5), views: 1200, shorts: true },
        { publishedAt: at(88), views: 999, shorts: true },
        { publishedAt: at(89.2), views: 5000, shorts: false },
      ],
      now,
    ),
    1200,
  );
});

test("числа по-русски: как на YouTube — с отбрасыванием («999 тыс.», а не «1 млн»)", () => {
  assert.equal(formatCount(999), "999");
  assert.equal(sp(formatCount(1234)), "1,2 тыс.");
  assert.equal(sp(formatCount(1299)), "1,2 тыс.");
  assert.equal(sp(formatCount(12_345)), "12 тыс.");
  assert.equal(sp(formatCount(999_999)), "999 тыс.");
  assert.equal(sp(formatCount(1_500_000)), "1,5 млн");
  assert.equal(formatRate(0.54), "0,5");
  assert.equal(sp(formatRate(1234.5)), "1,2 тыс.");
  assert.equal(sp(formatUsd(1.234)), "1,23 $");
  assert.equal(sp(formatUsd(0.004)), "< 0,01 $");
});

test("youtube-fill: statistics в том же videos.list, цифры канала — из channels.list; CLI-список без изменений", async () => {
  const auth = { getAccessToken: async () => ({ token: "tok" }) };
  const urls: string[] = [];
  const fake = (channelStats: unknown, videoStats: unknown) =>
    (async (url: string | URL) => {
      const u = String(url);
      urls.push(u);
      const res = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (u.includes("/channels?")) return res({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUx" } }, statistics: channelStats }] });
      if (u.includes("/playlistItems?")) return res({ items: [{ contentDetails: { videoId: "v1" } }] });
      if (u.includes("/videos?")) {
        return res({ items: [{ id: "v1", snippet: { title: "A", publishedAt: "2026-10-08T09:00:00Z" }, status: { privacyStatus: "public" }, contentDetails: { duration: "PT50S" }, statistics: videoStats }] });
      }
      throw new Error(`неожиданный запрос ${u}`);
    }) as typeof fetch;

  const r = await listChannel({ auth, fetch: fake({ viewCount: "61000", subscriberCount: "620", hiddenSubscriberCount: false, videoCount: "15" }, { viewCount: "1234", likeCount: "56", commentCount: "7" }) }, 200, { search: false });
  assert.deepEqual(r.channel, { subscriberCount: 620, viewCount: 61000, videoCount: 15 });
  assert.deepEqual([r.videos[0]!.viewCount, r.videos[0]!.likeCount, r.videos[0]!.commentCount], [1234, 56, 7]);
  assert.ok(urls.some((u) => u.includes("/channels?part=contentDetails,statistics&mine=true")));
  assert.ok(urls.some((u) => u.includes("/videos?part=snippet%2Cstatus%2CcontentDetails%2CfileDetails%2Cstatistics")));
  assert.ok(!urls.some((u) => u.includes("/search?"))); // без поиска: он стоит 100 единиц квоты

  // Подписчики скрыты, у видео нет statistics (лайки скрыты, комментарии выключены) — null, не 0.
  const hidden = await listChannel({ auth, fetch: fake({ viewCount: "10", subscriberCount: "0", hiddenSubscriberCount: true }, { viewCount: "5" }) }, 200, { search: false });
  assert.equal(hidden.channel?.subscriberCount, null);
  assert.equal(hidden.channel?.videoCount, null);
  assert.deepEqual([hidden.videos[0]!.viewCount, hidden.videos[0]!.likeCount, hidden.videos[0]!.commentCount], [5, null, null]);
  const bare = await listChannel({ auth, fetch: fake(undefined, undefined) }, 200, { search: false });
  assert.equal(bare.channel, null);
  assert.equal(bare.videos[0]!.viewCount, null);

  // Старый вход для CLI youtube-fill — тот же список роликов.
  const list = await listChannelVideos({ auth, fetch: fake(undefined, { viewCount: "1" }) }, 200, { search: false });
  assert.deepEqual(list.map((v) => [v.videoId, v.durationSec, v.viewCount]), [["v1", 50, 1]]);
});

test("ролики: только вышедшие, просмотры в сутки (свежий — как за сутки), лучший и худший — среди старше суток", () => {
  const list = videoStats(videos, topics, pillars, now, TZ);
  assert.deepEqual(list.map((v) => v.videoId), ["v5", "v1", "v6", "v2", "v3"]); // по просмотрам; v4 не вышел
  const v = (id: string) => list.find((x) => x.videoId === id)!;
  assert.equal(v("v1").perDay, 1000);
  assert.equal(v("v2").perDay, 400);
  assert.equal(v("v3").perDay, 300); // 3 часа — делим на сутки, а не на 0,125
  assert.equal(v("v3").fresh, true);
  assert.equal(v("v1").code, "01a");
  assert.equal(v("v1").pillarTitle, "Почему так?");
  assert.equal(v("v5").code, null); // не из плана
  assert.equal(v("v5").shorts, false);
  assert.equal(v("v6").likesLabel, "—");
  assert.equal(v("v1").mark, "best");
  assert.equal(v("v2").mark, "worst");
  assert.equal(v("v3").mark, null); // 300 в сутки, но свежий — не «худший»
  assert.match(v("v1").dateLabel, /01\.10/);
});

test("монетизация: ≈ просмотры Shorts за 90 дней, подписчики, начальный уровень — ещё и 3 ролика за 90 дней", () => {
  const list = videoStats(videos, topics, pillars, now, TZ);
  const m = monetization({ subscriberCount: 620, viewCount: 61_000, videoCount: 6 }, list, now);
  assert.equal(m.views90, 8125 + 450 + 300 + 2062); // v5 — длинный и старше 90 дней
  assert.equal(m.videos90, 4);
  const [full, lower] = m.tiers;
  assert.equal(full!.goals[0]!.percent, 62);
  assert.equal(full!.goals[0]!.done, false);
  assert.equal(full!.goals[1]!.approx, true);
  assert.match(sp(full!.goals[1]!.haveLabel), /^≈ 10 937$/);
  assert.equal(sp(full!.goals[1]!.needLabel), "10 млн");
  assert.equal(full!.done, false);
  assert.equal(lower!.goals[0]!.done, true); // 620 из 500
  assert.equal(lower!.goals[2]!.done, true); // 4 ролика из 3
  assert.equal(lower!.done, false); // просмотров не хватает
  const unknown = monetization(null, [], now);
  assert.equal(unknown.tiers[0]!.goals[0]!.haveLabel, "нет данных");
  assert.equal(unknown.tiers[0]!.goals[0]!.percent, 0);
});

test("рубрики: средние просмотры в сутки, лучшие первыми, без роликов — в конце в порядке плана", () => {
  const settled = videoStats(videos, topics, pillars, now, TZ).filter((v) => !v.fresh);
  const r = pillarRanking(settled, pillars);
  assert.deepEqual(r.slice(0, 2).map((p) => [p.id, p.videos]), [["why", 2], ["history", 1]]);
  assert.ok(Math.abs(r[0]!.perDay! - (1000 + 2062 / 4.125) / 2) < 1e-9);
  assert.equal(r[0]!.share, 1);
  assert.ok(Math.abs(r[1]!.share - 400 / r[0]!.perDay!) < 1e-9);
  // space — только свежий ролик, mind — только запланированный: «нет данных», порядок плана
  assert.deepEqual(r.slice(2).map((p) => p.id), ["mind", "body", "space", "nature", "tech", "money"]);
  assert.equal(r[2]!.perDay, null);
  assert.equal(r[2]!.perDayLabel, "—");
  // Рубрики нет в списке — всё равно в рейтинге (название = id).
  const extra = pillarRanking([{ pillar: "misc", perDay: 5, views: 5 }, { pillar: null, perDay: 99, views: 99 }], [{ id: "why", title: "Почему так?" }]);
  assert.deepEqual(extra.map((p) => [p.id, p.title, p.videos]), [["misc", "misc", 1], ["why", "Почему так?", 0]]);
});

test("хэштеги: разбор, без ссылок и чисел, регистр не важен; средние просмотры от 2 роликов, лучшие и худшие не пересекаются", () => {
  assert.deepEqual(hashtagsOf("Текст #Голос, #почемутак!\nhttps://site.ru/page#part #1 #shorts #голос #2026год"), ["#голос", "#почемутак", "#shorts", "#2026год"]);
  const r = hashtagRanking([
    { description: "#shorts #космос #факты #луна", views: 1000 },
    { description: "#shorts #космос #история", views: 3000 },
    { description: "#shorts #история #деньги", views: 500 },
    { description: "#Shorts #деньги #факты", views: 100 },
  ]);
  assert.deepEqual(r.everywhere, ["#shorts"]);
  assert.deepEqual(r.best.map((t) => [t.tag, t.avgViews]), [["#космос", 2000], ["#история", 1750]]);
  assert.deepEqual(r.worst.map((t) => [t.tag, t.avgViews]), [["#деньги", 300], ["#факты", 550]]);
  assert.equal(r.rare, 1); // #луна — один ролик
  assert.equal(sp(r.best[0]!.avgLabel), "2 тыс.");
  const few = hashtagRanking([{ description: "#a #b", views: 1 }]);
  assert.deepEqual([few.best, few.worst, few.everywhere], [[], [], []]);
});

test("GitHub Actions: минуты с 1-го числа (UTC), каждый запуск — вверх до минуты, идущий — до «сейчас»", () => {
  const runs: RunTiming[] = [
    { id: 1, status: "completed", createdAt: "2026-09-30T23:50:00Z", startedAt: "2026-09-30T23:50:00Z", updatedAt: "2026-10-01T00:20:00Z" }, // прошлый месяц
    { id: 2, status: "completed", createdAt: "2026-10-02T10:00:00Z", startedAt: "2026-10-02T10:00:30Z", updatedAt: "2026-10-02T10:09:31Z" }, // 9 мин 1 с → 10
    { id: 3, status: "completed", createdAt: "2026-10-03T10:00:00Z", startedAt: null, updatedAt: "2026-10-03T10:00:40Z" }, // 40 с → 1
    { id: 4, status: "in_progress", createdAt: "2026-10-09T11:55:00Z", startedAt: "2026-10-09T11:55:00Z", updatedAt: "2026-10-09T11:56:00Z" }, // 5
    { id: 5, status: "queued", createdAt: "2026-10-09T11:59:00Z", startedAt: null, updatedAt: "2026-10-09T11:59:00Z" }, // 0
    { id: 6, status: "completed", createdAt: "2026-10-04T10:00:00Z", startedAt: "2026-10-04T10:05:00Z", updatedAt: "2026-10-04T10:00:00Z" }, // кривые времена → 0
  ];
  const a = actionsMinutes(runs, now);
  assert.deepEqual([a.minutes, a.runs, a.limit], [16, 5, 2000]);
  assert.equal(a.percent, 0.8);
  assert.equal(a.monthLabel, "октябрь");
});

const usageLines = [
  { at: "2026-10-09T08:00:00Z", kind: "script", code: "08a", provider: "claude", model: "claude-x", inputTokens: 1000, outputTokens: 2000, costUsd: 0.05, calls: 1, chars: null, runId: "1" },
  { at: "2026-10-01T00:30:00Z", kind: "script", code: "07a", provider: "claude", model: null, inputTokens: null, outputTokens: null, costUsd: 0.1, calls: 1, chars: null, runId: null },
  { at: "2026-09-30T21:30:00Z", kind: "script", code: "06a", provider: "Anthropic", model: null, inputTokens: null, outputTokens: null, costUsd: 0.2, calls: 1, chars: null, runId: 42 }, // 00:30 МСК 1 октября
  { at: "2026-09-30T20:30:00Z", kind: "script", code: "05a", provider: "claude", model: null, inputTokens: null, outputTokens: null, costUsd: 1, calls: 1, chars: null, runId: null }, // 23:30 МСК 30 сентября
  { at: "2026-10-05T10:00:00Z", kind: "script", code: "05b", provider: "claude", model: null, inputTokens: null, outputTokens: null, costUsd: null, calls: 1, chars: null, runId: null },
  { at: "2026-10-09T06:30:00Z", kind: "tts", code: "08a", provider: "gemini", model: null, inputTokens: null, outputTokens: null, costUsd: 0, calls: 1, chars: 900, runId: null }, // 23:30 8 октября по Калифорнии
  { at: "2026-10-09T07:30:00Z", kind: "tts", code: "08a", provider: "gemini", model: null, inputTokens: null, outputTokens: null, costUsd: 0, calls: 1, chars: 900, runId: null },
  { at: "2026-10-09T10:00:00Z", kind: "tts", code: "08b", provider: "gemini", model: null, inputTokens: null, outputTokens: null, costUsd: 0, calls: 2, chars: 900, runId: null },
  { at: "2026-10-09T10:30:00Z", kind: "tts", code: "09a", provider: "gemini", model: null, inputTokens: null, outputTokens: null, costUsd: null, calls: null, chars: null, runId: null },
  { at: "2026-10-09T11:00:00Z", kind: "tts", code: "09b", provider: "edge", model: null, inputTokens: null, outputTokens: null, costUsd: 0, calls: 1, chars: 900, runId: null },
];
const usageText = [
  ...usageLines.slice(0, 3).map((l) => JSON.stringify(l)),
  "{oops",
  "",
  "[]",
  "null",
  JSON.stringify({ at: "вчера", kind: "tts", provider: "gemini" }),
  ...usageLines.slice(3).map((l) => JSON.stringify(l)),
].join("\r\n");

test("usage.jsonl: битые строки пропускаем и считаем; Claude — месяц и сегодня по МСК; Gemini — сутки Google", () => {
  const parsed = parseUsage(usageText);
  assert.equal(parsed.records.length, usageLines.length);
  assert.equal(parsed.bad, 4);
  assert.equal(parsed.records[2]!.provider, "anthropic");
  assert.equal(parsed.records[2]!.runId, "42");
  const u = usageSummary(parsed.records, now, TZ, parsed.bad);
  assert.ok(Math.abs(u.claude.monthUsd - 0.35) < 1e-9); // 0,05 + 0,10 + 0,20; 30 сентября по МСК — не в счёт
  assert.ok(Math.abs(u.claude.todayUsd - 0.05) < 1e-9);
  assert.equal(u.claude.monthRequests, 4);
  assert.equal(u.claude.unpriced, 1);
  assert.equal(sp(u.claude.monthUsdLabel), "0,35 $");
  assert.equal(u.gemini.today, 4); // 1 + 2 + (нет calls → 1); 06:30 UTC — ещё вчера по Калифорнии; Edge не в счёт
  assert.equal(u.gemini.limit, 10);
  assert.equal(u.gemini.percent, 40);
  assert.equal(u.gemini.resetLabel, "10:00"); // полночь PDT = 07:00 UTC = 10:00 МСК
  assert.equal(usageSummary([], new Date("2026-12-09T12:00:00Z"), TZ).gemini.resetLabel, "11:00"); // зимой — PST
  assert.equal(u.bad, 4);
});

test("всё вместе: свежие не в сравнениях; YouTube недоступен и usage.jsonl нет — секции без данных, без падения", () => {
  const runs: RunTiming[] = [{ id: 1, status: "completed", createdAt: "2026-10-02T10:00:00Z", startedAt: "2026-10-02T10:00:00Z", updatedAt: "2026-10-02T10:07:10Z" }];
  const s = buildStats({ now, timezone: TZ, videos, channel: { subscriberCount: 620, viewCount: 61_000, videoCount: 6 }, youtubeError: null, topics, pillars, runs, runsError: null, usageText, usageError: null });
  assert.equal(sp(s.channel?.viewsLabel), "61 000");
  assert.equal(s.channel?.publishedLabel, "5 роликов");
  assert.equal(s.fresh, 1);
  assert.equal(s.videos.length, 5);
  assert.equal(s.pillars[0]!.id, "why");
  // хэштеги — только у роликов старше суток: #деньги есть у v5 и v6 (v3 свежий)
  assert.deepEqual(s.hashtags.everywhere, ["#shorts"]);
  assert.deepEqual(
    [...s.hashtags.best, ...s.hashtags.worst].map((t) => t.tag).sort(),
    ["#деньги", "#история", "#космос", "#факты"],
  );
  assert.equal(s.actions?.minutes, 8);
  assert.equal(s.usage?.gemini.today, 4);

  const offline = { now, timezone: TZ, videos: null, channel: null, youtubeError: "квота", topics: [], pillars, runs: null, runsError: "HTTP 403", usageText: null, usageError: null };
  const down = buildStats(offline);
  assert.equal(down.channel, null);
  assert.deepEqual(down.videos, []);
  assert.equal(down.monetization.views90, 0);
  assert.equal(down.pillars.length, pillars.length);
  assert.equal(down.actions, null);
  assert.equal(down.actionsError, "HTTP 403");
  assert.equal(down.usage, null); // экран: «нет данных — появятся после следующей сборки»
  assert.equal(buildStats({ ...offline, usageText: "  \n" }).usage, null); // файл пустой
  assert.equal(buildStats({ ...offline, usageText: "{oops\n" }).usage, null); // одни битые строки
});

test("очередь: у ролика на YouTube — просмотры, лайки, комментарии и подпись для значка; без statistics — null", () => {
  const week1 = (json("content/week1-videos.json") as { videos: { id: string; file: string; title: string; description: string; durationSec: number; tags: string[]; categoryId: string }[] }).videos;
  const onYoutube = (i: number, over: Partial<ChannelVideo>): ChannelVideo =>
    video({ videoId: `y${i}`, title: week1[i]!.title, description: week1[i]!.description, fileName: `${week1[i]!.file}.mp4`, durationSec: week1[i]!.durationSec, tags: week1[i]!.tags, ...over });
  const state = buildState({
    now,
    planJson: json("content/plan.json"),
    channelJson: json("channel.json"),
    scriptFiles: [],
    fillLists: [json("content/week1-videos.json")],
    releases: [],
    runs: [],
    videos: [
      onYoutube(0, { publishedAt: "2026-10-08T09:00:00Z", viewCount: 1234, likeCount: 56, commentCount: null }),
      onYoutube(1, { privacyStatus: "private", publishAt: "2026-10-10T09:00:00Z", viewCount: 0 }),
      onYoutube(2, { privacyStatus: "private", publishAt: "2026-10-10T16:00:00Z", viewCount: null }),
    ],
    youtubeError: null,
    secretNames: null,
    autopilot: parseAutopilot(null),
    autopilotLast: null,
    repo: "x/y",
    branch: "master",
  });
  const row = (code: string) => state.rows.find((r) => r.code === code)!;
  assert.equal(row("01a").stage, "published");
  assert.equal(sp(row("01a").stats?.viewsLabel), "1,2 тыс.");
  assert.deepEqual([row("01a").stats?.likes, row("01a").stats?.comments, row("01a").stats?.commentsLabel], [56, null, null]);
  assert.equal(row("01b").stats?.views, 0);
  assert.equal(row("02a").stats, null);
  assert.equal(row("09a").stats, null); // нет на YouTube
});

void (async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}`);
      throw e;
    }
  }
  console.log(`\nВсе проверки статистики пройдены: ${tests.length}.`);
})().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
