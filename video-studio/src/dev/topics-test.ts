// Офлайн-проверка подбора тем (npm run topic-ideas) и поиска материала к теме (research.ts):
// разбор ответа LLM, замер спроса YouTube на подменённом fetch, порядок списка.
// Ключи и интернет не нужны. Запуск: npx tsx src/dev/topics-test.ts
import assert from "node:assert/strict";
import { checkIdeas, fmtViews, median, rankIdeas, youtubeDemand, DemandError, type TopicIdea } from "../pipeline/script/topic-ideas";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const idea = (over: Partial<TopicIdea>): TopicIdea => ({
  title: "Тема",
  format: "shorts",
  genre: "story",
  pillar: "history",
  query: "тема",
  hook: "Загадка?",
  why: "Интересно.",
  interest: "Reddit — 10 тыс. голосов",
  interestUrl: "https://www.reddit.com/r/todayilearned/x",
  ...over,
});

await test("ответ LLM: повторы канала и друг друга выброшены, формат и жанр приведены, ссылка интереса — чистая", () => {
  const raw = {
    items: [
      { title: "Эму-война: как армия проиграла птицам", format: "shorts", genre: "story", pillar: "history", query: "эму война", hook: "Армия против птиц?", why: "Абсурд.", interest: "Reddit", interestUrl: "https://reddit.com/r/x" },
      { title: "Как «Титаник» мог спастись", format: "Разбор", genre: "история", pillar: "history", query: "«Титаник» спасение", hook: "Айсберг заметили за 37 секунд.", why: "Все знают Титаник.", interest: "Википедия — топ недели", interestUrl: "(см. https://ru.wikipedia.org/wiki/Титаник)", fresh: "true" },
      { title: "Как «Титаник» мог спастись", format: "long", genre: "story", pillar: "history", query: "титаник", hook: "x", why: "y", interest: "z", interestUrl: "https://a.b/c" },
      { title: "Без полей" },
      { title: "Почему у акул нет костей", format: "shorts", genre: "explainer", pillar: "unknown", query: "акулы скелет", hook: "У акулы нет ни одной кости.", why: "Акулы.", interest: "Пикабу", interestUrl: "https://pikabu.ru/story/x" },
    ],
  };
  const v = checkIdeas(raw, { existing: ["Эму-война: как армия Австралии проиграла птицам"], pillars: ["history", "nature"] });
  assert.ok(v.ok);
  const ideas = v.value.ideas;
  assert.deepEqual(ideas.map((i) => i.title), ["Как «Титаник» мог спастись", "Почему у акул нет костей"]);
  assert.equal(ideas[0]!.format, "long");
  assert.equal(ideas[0]!.genre, "story");
  assert.equal(ideas[0]!.query, "титаник спасение");
  assert.equal(ideas[0]!.interestUrl, "https://ru.wikipedia.org/wiki/%D0%A2%D0%B8%D1%82%D0%B0%D0%BD%D0%B8%D0%BA");
  assert.equal(ideas[0]!.fresh, true);
  assert.equal(ideas[1]!.pillar, "history", "неизвестная рубрика → первая рубрика канала");
  assert.ok(v.value.notes.some((n) => /похожа на «Эму-война/.test(n)));
  assert.ok(v.value.notes.some((n) => /Без полей/.test(n)));
  assert.equal(checkIdeas({ items: [] }, { existing: [], pillars: [] }).ok, false);
});

await test("спрос YouTube: регион RU, Shorts — короткие ролики, медиана и миллионники; квота и права — стоп", async () => {
  const urls: string[] = [];
  const fetchOk = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/search?")) return new Response(JSON.stringify({ items: ["a", "b", "c", "d"].map((videoId) => ({ id: { videoId } })) }), { status: 200 });
    return new Response(
      JSON.stringify({
        items: [
          { id: "a", snippet: { title: "A" }, statistics: { viewCount: "2500000" }, contentDetails: { duration: "PT45S" } },
          { id: "b", snippet: { title: "B" }, statistics: { viewCount: "300000" }, contentDetails: { duration: "PT58S" } },
          { id: "c", snippet: { title: "C" }, statistics: { viewCount: "90000" }, contentDetails: { duration: "PT1M10S" } },
          { id: "d", snippet: { title: "D — длинный" }, statistics: { viewCount: "9000000" }, contentDetails: { duration: "PT12M" } },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const d = await youtubeDemand("эму война", "shorts", { token: "t", fetch: fetchOk });
  assert.match(urls[0]!, /regionCode=RU/);
  assert.match(urls[0]!, /videoDuration=short/);
  assert.deepEqual([d.videos, d.median, d.max, d.hits1m], [3, 300000, 2500000, 1], "длинный ролик в спрос Shorts не входит");
  assert.equal(d.sample[0]!.id, "a");
  const long = await youtubeDemand("эму война", "long", { token: "t", fetch: fetchOk });
  assert.deepEqual([long.videos, long.max], [1, 9000000]);
  const quota = (async () => new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(youtubeDemand("x", "shorts", { token: "t", fetch: quota }), (e: unknown) => e instanceof DemandError && e.stop);
});

await test("порядок: свежее первым, дальше — по медиане просмотров; числа — «1,2 млн», «450 тыс.»", () => {
  const d = (m: number) => ({ query: "q", videos: 10, median: m, max: m * 3, hits1m: m >= 1_000_000 ? 1 : 0, sample: [] });
  const list = rankIdeas([idea({ title: "мало", demand: d(5000) }), idea({ title: "нет данных", demand: null }), idea({ title: "много", demand: d(1_200_000) }), idea({ title: "новость", fresh: true, demand: d(100) })]);
  assert.deepEqual(list.map((i) => i.title), ["новость", "много", "мало", "нет данных"]);
  assert.equal(fmtViews(1_234_567), "1,2 млн");
  assert.equal(fmtViews(450_400), "450 тыс.");
  assert.equal(fmtViews(980), "980");
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 3);
  assert.equal(median([]), 0);
});

console.log(`Темы и материал: все проверки пройдены (${passed}).`);
