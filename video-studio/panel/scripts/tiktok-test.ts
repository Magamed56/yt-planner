// Офлайн-проверка TikTok в панели: разбор ответов Display API, цифры экрана, сопоставление с
// темами плана, шифрование ключей и подпись state. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/tiktok-test.ts
import assert from "node:assert/strict";
import { authorizeUrl, newState, openTokens, sealTokens, stateValid, type TikTokTokens } from "../lib/tiktok";
import { matchCode, normText, parseUser, parseVideos, tiktokApiError, tiktokStats } from "../lib/tiktok-data";

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

process.env.SESSION_SECRET = "s".repeat(40);
process.env.TIKTOK_CLIENT_KEY = "awkey123";
process.env.TIKTOK_CLIENT_SECRET = "secret-abc";

test("ответы API: профиль, ролики, ошибки с подсказкой", () => {
  const user = parseUser({ data: { user: { open_id: "o1", display_name: "Суть", username: "sut", avatar_url: "a.jpg", follower_count: 1234, likes_count: 9000, video_count: 12 } }, error: { code: "ok" } });
  assert.deepEqual(user, { openId: "o1", displayName: "Суть", username: "sut", avatar: "a.jpg", followers: 1234, following: null, likes: 9000, videos: 12 });
  assert.equal(parseUser({ data: {} }), null);
  const r = parseVideos({
    data: {
      videos: [
        { id: "7300000000000000001", title: "Почему цены заканчиваются на 99 #shorts", create_time: 1_760_000_000, duration: 58, view_count: 1500, like_count: 90, comment_count: 4, share_count: 7, share_url: "https://tiktok.com/x" },
        { id: "bad" }, // без даты — пропускаем
      ],
      cursor: 1_759_999_000_000,
      has_more: true,
    },
    error: { code: "ok" },
  });
  assert.equal(r.videos.length, 1);
  assert.equal(r.videos[0]!.createdAt, new Date(1_760_000_000_000).toISOString());
  assert.deepEqual([r.cursor, r.hasMore], [1_759_999_000_000, true]);
  assert.equal(tiktokApiError({ error: { code: "ok" } }, 200), null);
  assert.match(tiktokApiError({ error: { code: "access_token_invalid" } }, 401)!, /подключите TikTok заново/);
  assert.match(tiktokApiError({ error: { code: "scope_not_authorized" } }, 403)!, /права/);
  assert.match(tiktokApiError(null, 500)!, /HTTP 500/);
});

test("ролик ↔ тема: название в подписи, без регистра, ё и знаков; две подходящие — не угадываем", () => {
  assert.equal(normText("Ёжик — #shorts Почему?!"), "ежик почему");
  const topics = [
    { code: "08a", titles: ["Почему цены заканчиваются на 99: эффект левой цифры"] },
    { code: "08b", titles: ["Почему утром ты выше, чем вечером"] },
  ];
  assert.equal(matchCode("ПОЧЕМУ ЦЕНЫ заканчиваются на 99 — эффект левой цифры! #психология", topics), "08a");
  assert.equal(matchCode("какой-то другой ролик", topics), null);
  assert.equal(matchCode("Почему утром ты выше чем вечером", [...topics, { code: "09z", titles: ["Почему утром ты выше, чем вечером"] }]), null);
  assert.equal(matchCode("", topics), null);
});

test("экран: цифры, сортировка по просмотрам, Creator Rewards по роликам за 30 дней", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const day = 86_400;
  const at = (d: number) => new Date(now.getTime() - d * day * 1000).toISOString();
  const s = tiktokStats(
    { openId: "o", displayName: "Суть", username: "sut", avatar: null, followers: 2500, following: 1, likes: 40_000, videos: 3 },
    [
      { id: "1", title: "Почему цены заканчиваются на 99", cover: null, url: null, createdAt: at(2), durationSec: 58, views: 1000, likes: 50, comments: 5, shares: 5 },
      { id: "2", title: "x", cover: null, url: null, createdAt: at(10), durationSec: 75, views: 30_000, likes: 900, comments: 60, shares: 40 },
      { id: "3", title: "y", cover: null, url: null, createdAt: at(40), durationSec: 50, views: 500_000, likes: 1, comments: 0, shares: 0 },
    ],
    [{ code: "08a", titles: ["Почему цены заканчиваются на 99"] }],
    now,
    "Europe/Moscow",
  );
  assert.deepEqual(
    s.videos.map((v) => v.id),
    ["3", "2", "1"],
  );
  assert.equal(s.videos.find((v) => v.id === "1")!.code, "08a");
  assert.equal(s.videos.find((v) => v.id === "1")!.perDayLabel, "500");
  assert.equal(s.views30Label.replace(/\s/g, " "), "≈ 31 тыс.");
  assert.deepEqual(
    s.rewards.map((g) => [g.label, g.done]),
    [
      ["Подписчики", false],
      ["Просмотры за 30 дней", false],
      ["Ролики дольше минуты за 30 дней", true],
    ],
  );
  assert.equal(Math.round(s.rewards[0]!.percent), 25);
});

test("ключи TikTok: шифруются, не читаются другим секретом и после порчи", () => {
  const t: TikTokTokens = { openId: "o", scope: "user.info.basic,video.list", accessToken: "act.1", accessUntil: 1, refreshToken: "rft.1", refreshUntil: 2, connectedAt: "2026-10-10T00:00:00Z" };
  const sealed = sealTokens(t);
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok(!sealed.includes("act.1") && !sealed.includes("rft.1"), "в переменной нет ключей открытым текстом");
  assert.deepEqual(openTokens(sealed), t);
  assert.equal(openTokens(sealed, "другой секрет"), null);
  const broken = sealed.slice(0, -3) + (sealed.endsWith("AAA") ? "BBB" : "AAA");
  assert.equal(openTokens(broken), null);
  assert.notEqual(sealTokens(t), sealed, "каждый раз новый iv");
});

test("вход: state подписан и живёт 15 минут, адрес авторизации с нужными правами", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  const st = newState(now);
  assert.ok(stateValid(st, now + 60_000));
  assert.ok(!stateValid(st, now + 16 * 60_000), "устарел");
  assert.ok(!stateValid(st.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now), "подпись не сходится");
  assert.ok(!stateValid(null, now));
  const url = new URL(authorizeUrl("https://panel.example", st));
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("client_key"), "awkey123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://panel.example/api/tiktok/callback");
  assert.equal(url.searchParams.get("scope"), "user.info.basic,user.info.profile,user.info.stats,video.list");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), st);
});

console.log(`\nВсе проверки TikTok пройдены: ${passed}.`);
