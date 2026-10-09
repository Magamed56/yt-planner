// Офлайн-проверка удержания (YouTube Analytics) и первого комментария: запрос отчёта, разбор
// таблицы, отказы (нет права, API выключен), отметка слабого досмотра, среднее по каналу, порог
// монетизации по засчитанным просмотрам; черновик комментария по плану и сценарию, поиск своего
// комментария, запросы на подменённом fetch (сколько их и в каком порядке). Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/analytics-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan } from "../../src/pipeline/plan";
import type { ChannelVideo } from "../../src/pipeline/youtube-fill";
import {
  analyticsProblem,
  analyticsRange,
  durationText,
  engagedRejected,
  parseRetention,
  retentionOverview,
  retentionQuery,
  videoRetention,
  type Retention,
} from "../lib/analytics";
import {
  buildFirstComment,
  COMMENT_MAX,
  commentBlocker,
  commentProblem,
  commentSources,
  commentThreadBody,
  ctaQuestion,
  ownTopLevelComment,
} from "../lib/first-comment";
import { buildStats, type StatsInput } from "../lib/stats";
import { channelRetention, commentCheck, postComment } from "../lib/youtube";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;

// Папка panel — CommonJS (верхнеуровневого await нет): проверки копим и запускаем в конце.
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => void tests.push([name, fn]);

// 09.10.2026, 15:00 МСК = 05:00 по Калифорнии.
const now = new Date("2026-10-09T12:00:00Z");
const TZ = "Europe/Moscow";

// ---- отчёт Analytics ----

test("запрос: channel==MINE, по роликам, сортировка по просмотрам, 200 строк, engagedViews — по флагу", () => {
  const q = new URLSearchParams(retentionQuery({ startDate: "2026-08-31", endDate: "2026-10-09" }, true));
  assert.equal(q.get("ids"), "channel==MINE");
  assert.equal(q.get("dimensions"), "video");
  assert.equal(q.get("metrics"), "views,engagedViews,averageViewDuration,averageViewPercentage");
  assert.equal(q.get("sort"), "-views");
  assert.equal(q.get("maxResults"), "200");
  assert.equal(q.get("startDate"), "2026-08-31");
  assert.equal(q.get("endDate"), "2026-10-09");
  assert.equal(new URLSearchParams(retentionQuery({ startDate: "2026-08-31", endDate: "2026-10-09" }, false)).get("metrics"), "views,averageViewDuration,averageViewPercentage");
});

test("даты: с первой загрузки по сегодня, сутки — по тихоокеанскому времени; роликов нет — не спрашиваем", () => {
  // 01.09 03:00 UTC — в Калифорнии ещё 31.08; «сегодня» там — 09.10 (05:00).
  const range = analyticsRange([{ publishedAt: "2026-09-20T09:00:00Z" }, { publishedAt: "2026-09-01T03:00:00Z" }, { publishedAt: null }], now);
  assert.deepEqual(range, { startDate: "2026-08-31", endDate: "2026-10-09" });
  assert.equal(analyticsRange([], now), null);
  assert.equal(analyticsRange([{ publishedAt: "мусор" }], now), null);
  // Загрузка «из будущего» (часы сбиты) — не позже конца.
  assert.deepEqual(analyticsRange([{ publishedAt: "2026-10-12T00:00:00Z" }], now), { startDate: "2026-10-09", endDate: "2026-10-09" });
});

test("разбор таблицы: колонки по имени, числа строками, битые строки пропускаем, engagedViews может не быть", () => {
  const table = {
    kind: "youtubeAnalytics#resultTable",
    columnHeaders: [
      { name: "video", columnType: "DIMENSION" },
      { name: "averageViewPercentage", columnType: "METRIC" },
      { name: "views", columnType: "METRIC" },
      { name: "engagedViews", columnType: "METRIC" },
      { name: "averageViewDuration", columnType: "METRIC" },
    ],
    rows: [
      ["vidA", 82.5, 1200, 700, 45],
      ["vidB", "41.2", "300", null, "23"],
      ["", 50, 1, 1, 1],
      ["vidC", 50, -1, 1, 1],
      "мусор",
    ],
  };
  const m = parseRetention(table);
  assert.deepEqual([...m.keys()], ["vidA", "vidB"]);
  assert.deepEqual(m.get("vidA"), { views: 1200, engagedViews: 700, avgDurationSec: 45, avgPercent: 82.5 });
  assert.deepEqual(m.get("vidB"), { views: 300, engagedViews: null, avgDurationSec: 23, avgPercent: 41.2 });
  const noEngaged = parseRetention({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }], rows: [["v", 10, 30, 60]] });
  assert.equal(noEngaged.get("v")?.engagedViews, null);
  // Нет нужной колонки или ответа — пусто, без исключений.
  assert.equal(parseRetention({ columnHeaders: [{ name: "video" }, { name: "views" }], rows: [["v", 1]] }).size, 0);
  assert.equal(parseRetention(null).size, 0);
  assert.equal(parseRetention({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }] }).size, 0);
});

const scopeBody = JSON.stringify({
  error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }], details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] },
});
const activation = "https://console.developers.google.com/apis/api/youtubeanalytics.googleapis.com/overview?project=42";
const disabledBody = JSON.stringify({
  error: {
    code: 403,
    message: `YouTube Analytics API has not been used in project 42 before or it is disabled. Enable it by visiting ${activation} then retry.`,
    errors: [{ reason: "accessNotConfigured" }],
    details: [{ reason: "SERVICE_DISABLED", metadata: { activationUrl: activation } }],
  },
});
const engagedBody = JSON.stringify({ error: { code: 400, message: "Unknown identifier (engagedViews) given in field parameters.metrics.", errors: [{ reason: "badRequest" }] } });

test("отказы: нет права → карточка с youtube-auth; API выключен → ссылка включения; прочее — текстом", () => {
  assert.deepEqual(analyticsProblem(403, scopeBody), { kind: "scope", text: "у ключа YouTube нет права на YouTube Analytics", activationUrl: null });
  const off = analyticsProblem(403, disabledBody);
  assert.equal(off.kind, "disabled");
  assert.equal(off.activationUrl, activation);
  const other = analyticsProblem(500, JSON.stringify({ error: { message: "Backend Error", errors: [{ reason: "backendError" }] } }));
  assert.equal(other.kind, "error");
  assert.match(other.text, /HTTP 500 backendError — Backend Error/);
  assert.ok(engagedRejected(400, engagedBody));
  assert.ok(engagedRejected(400, JSON.stringify({ error: { message: "The query is not supported." } })));
  assert.ok(!engagedRejected(400, JSON.stringify({ error: { message: "Invalid value for startDate" } })));
  assert.ok(!engagedRejected(403, engagedBody));
});

test("досмотр ролика: подписи, слабый — меньше 50 % у Shorts (30 % у длинных) при 20+ просмотрах", () => {
  assert.equal(durationText(37), "0:37");
  assert.equal(durationText(605), "10:05");
  assert.equal(durationText(59.6), "1:00");
  assert.equal(durationText(-3), "0:00");
  const r = (avgPercent: number, views = 100): Retention => ({ views, engagedViews: null, avgDurationSec: 30, avgPercent });
  const weak = videoRetention(r(45), true)!;
  assert.equal(weak.percentLabel, "45 %");
  assert.equal(weak.durationLabel, "0:30");
  assert.equal(weak.weak, true);
  assert.equal(videoRetention(r(45, 10), true)!.weak, false); // по 10 просмотрам выводов не делаем
  assert.equal(videoRetention(r(35), false)!.weak, false); // длинный ролик: 35 % — нормально
  assert.equal(videoRetention(r(25), false)!.weak, true);
  assert.equal(videoRetention(r(112.4), true)!.percentLabel, "112 %"); // повторы Shorts
  assert.equal(videoRetention(undefined, true), null);
});

test("среднее по каналу — с весом по просмотрам; данных нет — null", () => {
  const a = videoRetention({ views: 300, engagedViews: 200, avgDurationSec: 40, avgPercent: 80 }, true);
  const b = videoRetention({ views: 100, engagedViews: null, avgDurationSec: 20, avgPercent: 40 }, true);
  const o = retentionOverview([a, b, null, undefined])!;
  assert.equal(o.videos, 2);
  assert.equal(o.percentLabel, "70 %");
  assert.equal(o.durationLabel, "0:35");
  assert.equal(o.weak, 1);
  assert.equal(o.engaged, true);
  assert.equal(retentionOverview([null]), null);
  assert.equal(retentionOverview([videoRetention({ views: 0, engagedViews: 0, avgDurationSec: 0, avgPercent: 0 }, true)]), null);
});

const vid = (videoId: string, daysAgo: number, viewCount: number, over: Partial<ChannelVideo> = {}): ChannelVideo => ({
  videoId,
  title: `Ролик ${videoId}`,
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
  publishedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  viewCount,
  likeCount: 1,
  commentCount: 0,
  ...over,
});

const baseInput = (over: Partial<StatsInput> = {}): StatsInput => ({
  now,
  timezone: TZ,
  videos: [vid("v1", 10, 5000), vid("v2", 5, 900), vid("v3", 3, 400), vid("v4", 0.2, 50)],
  channel: { subscriberCount: 120, viewCount: 6350, videoCount: 4 },
  youtubeError: null,
  topics: [],
  pillars: [],
  runs: [],
  runsError: null,
  usageText: null,
  usageError: null,
  ...over,
});

test("«Статистика»: удержание у роликов, среднее, порог монетизации по засчитанным; без Analytics — как раньше", () => {
  const plain = buildStats(baseInput());
  assert.equal(plain.retention, null);
  assert.equal(plain.retentionProblem, null);
  assert.equal(plain.monetization.engaged, false);
  assert.equal(plain.monetization.views90, 6350);
  assert.ok(plain.videos.every((v) => v.retention === null));

  const rows = new Map<string, Retention>([
    ["v1", { views: 5200, engagedViews: 3000, avgDurationSec: 41, avgPercent: 74 }],
    ["v2", { views: 950, engagedViews: 500, avgDurationSec: 22, avgPercent: 40 }],
    ["v3", { views: 420, engagedViews: 260, avgDurationSec: 35, avgPercent: 63 }],
    // v4 вышел 5 часов назад — в Analytics его ещё нет.
  ]);
  const s = buildStats(baseInput({ retention: rows }));
  const by = new Map(s.videos.map((v) => [v.videoId, v]));
  assert.equal(by.get("v1")!.retention!.percentLabel, "74 %");
  assert.equal(by.get("v2")!.retention!.weak, true);
  assert.equal(by.get("v3")!.retention!.weak, false);
  assert.equal(by.get("v4")!.retention, null);
  assert.equal(s.retention!.videos, 3);
  assert.equal(s.retention!.weak, 1);
  // (74·5200 + 40·950 + 63·420) / 6570 ≈ 68,1
  assert.equal(s.retention!.percentLabel, "68 %");
  // Засчитанные у трёх + обычные у свежего v4: 3000 + 500 + 260 + 50.
  assert.equal(s.monetization.engaged, true);
  assert.equal(s.monetization.views90, 3810);

  const problem = analyticsProblem(403, scopeBody);
  const failed = buildStats(baseInput({ retention: null, retentionProblem: problem }));
  assert.equal(failed.retention, null);
  assert.equal(failed.retentionProblem?.kind, "scope");
  assert.equal(failed.videos.length, 4); // остальная статистика на месте
});

// ---- первый комментарий ----

test("вопрос из призыва сценария (речь, иначе надпись); нет призыва — null", () => {
  assert.equal(ctaQuestion(json("scripts/sut-01a-golos-na-zapisi.json")), "А тебе нравится свой голос на записи?");
  assert.equal(ctaQuestion({ scenes: [{ kind: "cta", narration: "Подпишись!", onScreen: "Ты боишься *щекотки*?" }] }), "Ты боишься щекотки?");
  assert.equal(ctaQuestion({ scenes: [{ kind: "hook", narration: "Почему так?" }] }), null);
  assert.equal(ctaQuestion(null), null);
  assert.equal(ctaQuestion({ scenes: "нет" }), null);
});

test("источники: по одному на факт, без ссылок назад, расчётов и продолжений; длинные — по слову", () => {
  const plan = parsePlan(json("content/plan.json"));
  const item = (id: string) => plan.items.find((i) => i.id === id)!;
  const a = commentSources(item("01a").keyFacts);
  assert.equal(a.length, 2);
  assert.match(a[0]!, /^Pörschmann C\. Influences of bone conduction/);
  assert.match(a[1]!, /^Holzman P\. S\., Rousey C\. The voice as a percept/);
  assert.deepEqual(commentSources([{ source: "Stenfelt & Goode 2005 (см. выше); Pörschmann 2000" }, { source: "Арифметика (расстояние по ортодромии)" }, { source: "Coe & Coe 1996" }]), []);
  // Короткая, но полная запись (есть название работы) — источник.
  assert.deepEqual(commentSources([{ source: "Pilon M. The Monopolists. Bloomsbury, 2015; Pilon 2015" }]), ["Pilon M. The Monopolists. Bloomsbury, 2015"]);
  assert.deepEqual(commentSources([{ source: "Hanke S. H., Krus N. World Hyperinflations. Cato Working Paper No. 8 (2012); In: Routledge Handbook, 2013" }], 3), [
    "Hanke S. H., Krus N. World Hyperinflations. Cato Working Paper No. 8 (2012)",
  ]);
  // Один и тот же источник в двух фактах — один раз; не хватило первых — берём вторые из записи.
  assert.deepEqual(commentSources([{ source: "NASA, «ISS Facts»; ESA, «Sleeping in space»" }, { source: "NASA, «ISS Facts»" }]), ["NASA, «ISS Facts»", "ESA, «Sleeping in space»"]);
  // Тот же источник без адреса в скобках или короче — тоже повтор (02a, 18a, 25b плана).
  assert.deepEqual(
    commentSources([{ source: "NASA NSSDC, Venus Fact Sheet (nssdc.gsfc.nasa.gov)" }, { source: "NASA NSSDC, Venus Fact Sheet; NASA Science, «Venus: Facts»" }]),
    ["NASA NSSDC, Venus Fact Sheet (nssdc.gsfc.nasa.gov)", "NASA Science, «Venus: Facts»"],
  );
  assert.deepEqual(commentSources([{ source: "Smithsonian Ocean, «Octopuses»" }, { source: "Smithsonian Ocean" }]), ["Smithsonian Ocean, «Octopuses»"]);
  // Ссылка назад с «et al.» и пояснением в скобках, «математика»/«любой учебник» — не источники (06b, 22b).
  assert.deepEqual(
    commentSources([{ source: "Nielsen et al. 2016 (со ссылкой на мечение: Hansen P. M. 1963)" }, { source: "Математика сложных процентов; любой учебник финансовой математики" }]),
    [],
  );
  // На всём плане два источника черновика — всегда разные.
  for (const it of plan.items) {
    const [x, y] = commentSources(it.keyFacts);
    if (x && y) assert.ok(!x.toLowerCase().startsWith(y.toLowerCase().replace(/\s*\([^()]*\)$/, "")), it.id);
  }
  const long = commentSources([{ source: `${"Очень длинное название работы ".repeat(10)}(2020)` }])[0]!;
  assert.ok(long.length <= 180 && long.endsWith("…") && !long.endsWith(" …"));
  assert.deepEqual(commentSources([]), []);
});

test("черновик: вопрос, пустая строка, «Источники:» списком; без призыва — название с «?» или общий вопрос", () => {
  const plan = parsePlan(json("content/plan.json"));
  const it = plan.items.find((i) => i.id === "01a")!;
  const text = buildFirstComment({ question: ctaQuestion(json(it.script!)), title: it.title, facts: it.keyFacts });
  const lines = text.split("\n");
  assert.equal(lines[0], "А тебе нравится свой голос на записи?");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "Источники:");
  assert.ok(lines[3]!.startsWith("• Pörschmann") && lines[4]!.startsWith("• Holzman"));
  assert.equal(
    buildFirstComment({ question: null, title: "Сахар делает детей гиперактивными?", facts: [{ source: "Wolraich M. L. et al. JAMA 274(20), 1995" }] }),
    "Сахар делает детей гиперактивными?\n\nИсточник:\n• Wolraich M. L. et al. JAMA 274(20), 1995",
  );
  assert.equal(buildFirstComment({ question: null, title: "Кошки не чувствуют сладкое", facts: [] }), "А ты знал об этом раньше?");
  // На всём плане: вопрос в начале, не длиннее предела, у тем с фактами — хотя бы один источник.
  for (const item of plan.items) {
    const t = buildFirstComment({ question: null, title: item.title, facts: item.keyFacts });
    assert.ok(t.length <= COMMENT_MAX && /\?$/.test(t.split("\n")[0]!), item.id);
    if (item.keyFacts.length) assert.match(t, /\n\nИсточник(и)?:\n• /, item.id);
  }
});

test("свой верхний комментарий: по каналу автора, чужие и пустые — мимо; кнопку блокирует, если нельзя", () => {
  const page = {
    items: [
      { id: "t1", snippet: { topLevelComment: { id: "c1", snippet: { authorChannelId: { value: "UCother" }, textOriginal: "класс" } } } },
      { id: "t2", snippet: { topLevelComment: { id: "c2", snippet: { authorChannelId: { value: "UCme" }, textOriginal: "Источники: …" } } } },
    ],
  };
  assert.deepEqual(ownTopLevelComment(page, "UCme", "vid1"), { id: "c2", text: "Источники: …", url: "https://www.youtube.com/watch?v=vid1&lc=c2" });
  assert.equal(ownTopLevelComment(page, "UCnobody", "vid1"), null);
  assert.equal(ownTopLevelComment({}, "UCme", "vid1"), null);
  assert.equal(ownTopLevelComment(page, "", "vid1"), null);

  const video = { videoId: "vid1", channelId: "UCme", privacyStatus: "public" };
  assert.equal(commentBlocker({ channelId: "UCme", video, existing: null }), null);
  assert.match(commentBlocker({ channelId: null, video, existing: null })!, /youtube-auth/);
  assert.match(commentBlocker({ channelId: "UCme", video: null, existing: null })!, /не найден/);
  assert.match(commentBlocker({ channelId: "UCme", video: { ...video, channelId: "UCother" }, existing: null })!, /не найден/);
  assert.match(commentBlocker({ channelId: "UCme", video: { ...video, privacyStatus: "private" }, existing: null })!, /после выхода/);
  assert.match(commentBlocker({ channelId: "UCme", video, existing: { id: "c2", text: "", url: "" } })!, /уже есть/);

  assert.deepEqual(commentThreadBody("vid1", "UCme", "  Привет?  "), { snippet: { channelId: "UCme", videoId: "vid1", topLevelComment: { snippet: { textOriginal: "Привет?" } } } });
  assert.match(commentProblem("   ")!, /пустой/);
  assert.match(commentProblem("я".repeat(COMMENT_MAX + 1))!, /длиннее/);
  assert.equal(commentProblem("Вопрос?"), null);
});

// ---- сеть на подменённом fetch ----

type Call = { url: string; method: string; body: string | null };
const calls: Call[] = [];
let route: (u: string, init: RequestInit) => Response = () => new Response("{}", { status: 500 });
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function stubNetwork() {
  process.env.YT_CLIENT_ID = "id";
  process.env.YT_CLIENT_SECRET = "secret";
  process.env.YT_REFRESH_TOKEN = "refresh";
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return reply(200, { access_token: "tok", expires_in: 3600 });
    calls.push({ url: u, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null });
    return route(u, init);
  }) as typeof fetch;
}

const table = { columnHeaders: [{ name: "video" }, { name: "views" }, { name: "engagedViews" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }], rows: [["v1", 10, 8, 30, 60]] };
const range = { startDate: "2026-08-31", endDate: "2026-10-09" };

test("Analytics: один запрос с токеном; нет права и обрыв связи — карточка, а не исключение", async () => {
  stubNetwork();
  calls.length = 0;
  route = (u) => (u.startsWith("https://youtubeanalytics.googleapis.com/v2/reports?") ? reply(200, table) : reply(404, "{}"));
  const ok = await channelRetention(range);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /metrics=views%2CengagedViews%2CaverageViewDuration%2CaverageViewPercentage/);
  assert.equal(ok.problem, null);
  assert.equal(ok.rows.get("v1")?.avgPercent, 60);

  route = () => reply(403, scopeBody);
  const denied = await channelRetention(range);
  assert.equal(denied.problem?.kind, "scope");
  assert.equal(denied.rows.size, 0);

  route = () => reply(403, disabledBody);
  assert.equal((await channelRetention(range)).problem?.activationUrl, activation);

  route = () => {
    throw new TypeError("fetch failed");
  };
  const offline = await channelRetention(range);
  assert.equal(offline.problem?.kind, "error");
  assert.match(offline.problem!.text, /нет связи с YouTube Analytics/);

  route = () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  assert.match((await channelRetention(range)).problem!.text, /не ответил за 10 с/);
});

test("Analytics: срок 10 с общий на запрос и повтор; чужая ошибка 400 не отключает engagedViews навсегда", async () => {
  stubNetwork();
  // Первый ответ (отказ из-за engagedViews) пришёл через 11 с — повтор уже не шлём, страница не ждёт ещё 10 с.
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    calls.length = 0;
    route = () => {
      shift += 11_000;
      return reply(400, engagedBody);
    };
    const late = await channelRetention(range);
    assert.equal(calls.length, 1);
    assert.match(late.problem!.text, /не ответил за 10 с/);
  } finally {
    Date.now = realNow;
  }
  // 400 не про метрику: повтор без неё тоже отказ — в следующий раз снова спрашиваем engagedViews.
  calls.length = 0;
  route = () => reply(400, JSON.stringify({ error: { code: 400, message: "The query is not supported.", errors: [{ reason: "badRequest" }] } }));
  assert.equal((await channelRetention(range)).problem?.kind, "error");
  assert.equal(calls.length, 2);
  calls.length = 0;
  route = () => reply(200, table);
  await channelRetention(range);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.includes("engagedViews"));
});

test("Analytics: engagedViews не принят — повтор без неё, дальше сразу без неё (один запрос)", async () => {
  stubNetwork();
  calls.length = 0;
  route = (u) => (u.includes("engagedViews") ? reply(400, engagedBody) : reply(200, { ...table, columnHeaders: table.columnHeaders.filter((h) => h.name !== "engagedViews"), rows: [["v1", 10, 30, 60]] }));
  const r = await channelRetention(range);
  assert.equal(calls.length, 2);
  assert.equal(r.problem, null);
  assert.equal(r.rows.get("v1")?.engagedViews, null);
  calls.length = 0;
  await channelRetention(range);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0]!.url.includes("engagedViews"));
});

test("комментарий: проверка ≈ 3 единицы (канал, ролик, комментарии), свой найден — дальше не листаем; приватный — без списка", async () => {
  stubNetwork();
  calls.length = 0;
  const pages: Record<string, unknown> = {
    "": { items: [{ id: "t1", snippet: { topLevelComment: { id: "c1", snippet: { authorChannelId: { value: "UCx" }, textOriginal: "привет" } } } }], nextPageToken: "p2" },
    p2: { items: [{ id: "t9", snippet: { topLevelComment: { id: "c9", snippet: { authorChannelId: { value: "UCme" }, textOriginal: "Вопрос?" } } } }], nextPageToken: "p3" },
  };
  let privacy = "public";
  route = (u) => {
    const url = new URL(u);
    if (url.pathname.endsWith("/channels")) return reply(200, { items: [{ id: "UCme" }] });
    if (url.pathname.endsWith("/videos")) return reply(200, { items: [{ id: "vid1", snippet: { channelId: "UCme" }, status: { privacyStatus: privacy } }] });
    if (url.pathname.endsWith("/commentThreads")) return reply(200, pages[url.searchParams.get("pageToken") ?? ""] ?? { items: [] });
    return reply(404, "{}");
  };
  const found = await commentCheck("vid1");
  assert.equal(found.existing?.id, "c9");
  const listed = calls.filter((c) => c.url.includes("/commentThreads?"));
  assert.equal(listed.length, 2); // p3 не запрашивали
  assert.match(listed[0]!.url, /videoId=vid1/);
  assert.match(listed[0]!.url, /maxResults=100/);

  calls.length = 0;
  privacy = "private";
  const hidden = await commentCheck("vid1");
  assert.equal(hidden.existing, null);
  assert.match(commentBlocker(hidden)!, /после выхода/);
  assert.equal(calls.filter((c) => c.url.includes("/commentThreads")).length, 0);
});

test("комментарий: отправка — commentThreads.insert с текстом; комментарии выключены — понятная ошибка", async () => {
  stubNetwork();
  calls.length = 0;
  route = (u, init) =>
    u.startsWith("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet") && init.method === "POST"
      ? reply(200, { id: "t5", snippet: { topLevelComment: { id: "c5" } } })
      : reply(404, "{}");
  assert.equal(await postComment("vid1", "UCme", "Вопрос?\n\nИсточник:\n• X"), "c5");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]!.body!), { snippet: { channelId: "UCme", videoId: "vid1", topLevelComment: { snippet: { textOriginal: "Вопрос?\n\nИсточник:\n• X" } } } });

  route = () => reply(403, { error: { code: 403, message: "The video has disabled comments.", errors: [{ reason: "commentsDisabled" }] } });
  await assert.rejects(postComment("vid1", "UCme", "x"), /выключены комментарии/);
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
  console.log(`\nВсе проверки удержания и первого комментария пройдены: ${tests.length}.`);
})().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
