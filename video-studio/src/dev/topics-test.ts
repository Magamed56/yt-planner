// Офлайн-проверка подбора тем (npm run topic-ideas) и поиска материала к теме (research.ts):
// разбор ответа LLM, замер спроса YouTube на подменённом fetch, порядок списка.
// Ключи и интернет не нужны. Запуск: npx tsx src/dev/topics-test.ts
import assert from "node:assert/strict";
import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AnthropicLike } from "../pipeline/script/llm/claude";
import { planNotes } from "../pipeline/plan";
import { buildShortsPrompt, buildSystemPrompt, shortsSeconds, shortsTargets, STORY_SECONDS } from "../pipeline/script/prompt";
import { buildResearchPrompt, checkResearch, researchNotes, researchTopic } from "../pipeline/script/research";
import { buildIdeasPrompt, buildIdeasSystemPrompt, checkIdeas, fmtViews, lastFullMonth, median, rankIdeas, readersScore, wikiMonthlyReaders, wikiTop, youtubeDemand, DemandError, type TopicIdea } from "../pipeline/script/topic-ideas";

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
      { title: "Как «Титаник» мог спастись", format: "Разбор", genre: "история", pillar: "history", query: "«Титаник» спасение", hook: "Айсберг заметили за 37 секунд.", why: "Все знают Титаник.", interest: "Википедия — топ недели", interestUrl: "(см. https://ru.wikipedia.org/wiki/Титаник)", fresh: "true", wiki: "https://ru.wikipedia.org/wiki/%D0%A2%D0%B8%D1%82%D0%B0%D0%BD%D0%B8%D0%BA_(%D0%BB%D0%B0%D0%B9%D0%BD%D0%B5%D1%80)", wikiEn: "" },
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
  assert.equal(ideas[0]!.wiki, "Титаник (лайнер)", "ссылка на статью → её название");
  assert.equal(ideas[0]!.wikiEn, undefined);
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
  const d = await youtubeDemand("эму война", "shorts", { access: { token: "t" }, fetch: fetchOk });
  assert.match(urls[0]!, /regionCode=RU/);
  assert.match(urls[0]!, /videoDuration=short/);
  assert.deepEqual([d.videos, d.median, d.max, d.hits1m], [3, 300000, 2500000, 1], "длинный ролик в спрос Shorts не входит");
  assert.equal(d.sample[0]!.id, "a");
  const long = await youtubeDemand("эму война", "long", { access: { token: "t" }, fetch: fetchOk });
  assert.deepEqual([long.videos, long.max], [1, 9000000]);
  const quota = (async () => new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(youtubeDemand("x", "shorts", { access: { key: "k" }, fetch: quota }), (e: unknown) => e instanceof DemandError && e.stop);
});

await test("порядок: сначала то, о чём больше читают в Википедии (ru + en/5), затем просмотры YouTube; числа — «1,2 млн»", () => {
  const d = (m: number) => ({ query: "q", videos: 10, median: m, max: m * 3, hits1m: m >= 1_000_000 ? 1 : 0, sample: [] });
  const list = rankIdeas([
    idea({ title: "мало читают", readers: { ru: 3000, en: null }, demand: d(2_000_000) }),
    idea({ title: "не измерено", readers: null }),
    idea({ title: "много читают", readers: { ru: 90_000, en: 400_000 } }),
    idea({ title: "только en", readers: { ru: null, en: 100_000 }, fresh: true }),
    idea({ title: "мало, но YouTube больше", readers: { ru: 3000, en: null }, demand: d(5_000_000) }),
  ]);
  assert.deepEqual(list.map((i) => i.title), ["много читают", "только en", "мало, но YouTube больше", "мало читают", "не измерено"]);
  assert.equal(readersScore({ ru: 1000, en: 5000 }), 2000);
  assert.equal(fmtViews(1_234_567), "1,2 млн");
  assert.equal(fmtViews(450_400), "450 тыс.");
  assert.equal(fmtViews(980), "980");
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 3);
  assert.equal(median([]), 0);
});

await test("Википедия: топ месяца без служебных страниц; читатели статьи — через редирект, среднее за 12 месяцев", async () => {
  const urls: string[] = [];
  const wiki = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    assert.match(String((init?.headers as Record<string, string>)["user-agent"]), /video-studio/);
    if (url.includes("/top/ru.wikipedia/all-access/2026/09/all-days")) {
      return Response.json({ items: [{ articles: [{ article: "Заглавная_страница", views: 9e6 }, { article: "Служебная:Поиск", views: 5e6 }, { article: "Титаник", views: 120000 }, { article: "Эму-война", views: 40000 }] }] });
    }
    if (url.includes("ru.wikipedia.org/w/api.php")) {
      assert.match(url, /redirects=1/);
      if (url.includes("%D0%9D%D0%B5%D1%82")) return Response.json({ query: { pages: { "-1": { title: "Нет", missing: "" } } } });
      return Response.json({ query: { redirects: [{ from: "Эму война", to: "Эму-война" }], pages: { "123": { pageid: 123, title: "Эму-война" } } } });
    }
    if (url.includes("/per-article/ru.wikipedia/all-access/user/")) {
      assert.match(url, /%D0%AD%D0%BC%D1%83-%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0\/monthly\/2025100100\/2026093000$/, "редирект развёрнут, 12 полных месяцев");
      return Response.json({ items: [{ views: 30000 }, { views: 50000 }] });
    }
    return new Response("нет", { status: 404 });
  }) as unknown as typeof fetch;
  const now = new Date("2026-10-24T12:00:00Z");
  assert.deepEqual(lastFullMonth(now).toISOString().slice(0, 7), "2026-09");
  const top = await wikiTop("ru", lastFullMonth(now), 10, { fetch: wiki, env: {} });
  assert.deepEqual(top.map((t) => t.title), ["Титаник", "Эму-война"]);
  assert.equal(await wikiMonthlyReaders("ru", "Эму война", now, { fetch: wiki, env: {} }), 40000);
  assert.equal(await wikiMonthlyReaders("ru", "Нет", now, { fetch: wiki, env: {} }), null);
  const prompt = buildIdeasPrompt({ channel: { name: "Суть за минуту" }, shorts: 2, long: 1, existing: ["Эму-война"], top: { ru: top, en: [], month: "09.2026" } });
  assert.match(prompt, /Самые читаемые статьи Википедии за 09\.2026[\s\S]*Титаник — 120 тыс\./);
  assert.match(buildIdeasSystemPrompt([{ id: "history", title: "История" }], true), /Свежие новости — не больше пятой части/);
});

const quiet = { info: () => {}, warn: () => {} };
const known = [{ claim: "Операция шла со 2 ноября по 10 декабря 1932 года, командовал майор Мередит.", source: "https://en.wikipedia.org/wiki/Emu_War" }];

await test("материал: пункт без ссылки и повтор известного — выброшены; мало нового — в ремонт", () => {
  const raw = {
    genre: "история",
    story: "Загадка → завязка → развязка.",
    facts: [
      { claim: "Операция шла со 2 ноября по 10 декабря 1932 года, командовал майор Мередит.", source: "https://en.wikipedia.org/wiki/Emu_War" },
      { claim: "Около 20 000 эму пришли на пшеничные поля после сезона гнездования.", source: "Википедия: https://en.wikipedia.org/wiki/Emu_War." },
      { claim: "Мередит сравнил эму с танками.", source: "без ссылки" },
      { claim: "Фермерами были ветераны Первой мировой.", url: "https://www.nationalgeographic.com/history/article/emu" },
    ],
  };
  const v = checkResearch(raw, { known, minNew: 2 });
  assert.ok(v.ok);
  assert.equal(v.value.genre, "story");
  assert.deepEqual(v.value.facts.map((f) => f.source), ["https://en.wikipedia.org/wiki/Emu_War", "https://www.nationalgeographic.com/history/article/emu"]);
  assert.equal(v.value.notes.length, 2);
  const few = checkResearch(raw, { known, minNew: 3 });
  assert.ok(!few.ok && /нужно минимум 3/.test(few.problems[0]!));
  assert.match(buildResearchPrompt({ topic: "Эму-война", facts: known }, 6), /НЕ повторяй[\s\S]*майор Мередит[\s\S]*Найди 6 новых/);
});

function claudeMessage(content: unknown[]): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 20000, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null, server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 }, service_tier: null, iterations: null },
  } as unknown as BetaMessage;
}

await test("материал через Claude с веб-поиском: факты плана + найденные, жанр, ссылки из выдачи без проверки сетью", async () => {
  const calls: BetaMessageStreamParams[] = [];
  const answer = {
    genre: "story",
    story: "Армия против птиц: почему пулемёты проиграли.",
    facts: [
      { claim: "Около 20 000 эму пришли на пшеничные поля.", source: "https://en.wikipedia.org/wiki/Emu_War" },
      { claim: "Мередит сравнил эму с танками: «они могут противостоять пулям с неуязвимостью танков».", source: "https://www.smithsonianmag.com/x" },
      { claim: "Пулемёт заклинило у водопоя.", source: "https://www.nationalgeographic.com/y" },
      { claim: "Операция шла со 2 ноября по 10 декабря 1932 года, командовал майор Мередит.", source: "https://en.wikipedia.org/wiki/Emu_War" },
    ],
  };
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(body) {
          calls.push(structuredClone(body));
          return {
            finalMessage: async () =>
              claudeMessage([
                { type: "web_search_tool_result", tool_use_id: "t", content: [{ type: "web_search_result", url: "https://www.smithsonianmag.com/x", title: "S", encrypted_content: "e", page_age: null }, { type: "web_search_result", url: "https://www.nationalgeographic.com/y", title: "N", encrypted_content: "e", page_age: null }] },
                { type: "text", text: JSON.stringify(answer), citations: null },
              ]),
          };
        },
      },
    },
  };
  const noNet = (async () => {
    throw new Error("сеть не нужна: ссылки из выдачи поиска");
  }) as unknown as typeof fetch;
  const seen: string[] = [];
  const r = await researchTopic({ topic: "Эму-война", facts: known }, { env: { LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test", LLM_FALLBACKS: "none" }, anthropic: client, fetch: noNet, log: { info: (m) => seen.push(m), warn: (m) => seen.push(m) } });
  assert.ok(r);
  assert.equal(calls.length, 1);
  const p0 = calls[0] as unknown as Record<string, unknown>;
  assert.deepEqual(p0.tools, [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]);
  assert.equal(r.genre, "story");
  assert.equal(r.added, 3, "повтор известного выброшен");
  assert.equal(r.facts.length, 4);
  assert.equal(r.facts[0], known[0], "факты плана — первыми");
  assert.ok(r.usage[0]!.costUsd > 0);
  const notes = researchNotes(r);
  assert.match(notes, /Линия рассказа по источникам: Армия против птиц/);
  assert.match(notes, /smithsonianmag/);
  // Без Claude искать нечем — null, сценарий пишется по фактам плана.
  assert.equal(await researchTopic({ topic: "x" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: noNet, log: quiet }), null);
});

await test("рассказ: история — около минуты, хук плана — идея, а не готовая фраза; арка в запросе", () => {
  assert.equal(shortsSeconds({ genre: "story" }), STORY_SECONDS);
  assert.equal(shortsSeconds({ genre: "story", quiz: true }), 42);
  assert.equal(shortsSeconds({ genre: "explainer" }), 42);
  const notes = planNotes({ hook: "В 1932 году армия проиграла птицам.", angle: "Развязка: 10 патронов на птицу.", keyFacts: known, story: "Линия." });
  assert.match(notes, /Идея хука \(перепиши сильнее/);
  assert.ok(!/Первая фраза — хук/.test(notes));
  assert.match(notes, /Линия рассказа по источникам: Линия\./);
  const t = shortsTargets(STORY_SECONDS);
  const story = buildShortsPrompt({ topic: "Эму-война", format: "shorts", genre: "story", cinematic: true }, t);
  assert.match(story, /около 58 секунд/);
  assert.match(story, /Завязка — кто, где, когда/);
  assert.match(story, /Поворот — момент, которого зритель не ждал/);
  assert.match(story, /footage — живое видео со стоков/);
  const explain = buildShortsPrompt({ topic: "Почему небо голубое", format: "shorts", genre: "explainer" }, shortsTargets(42));
  assert.match(explain, /как на самом деле: по шагам/);
  const system = buildSystemPrompt();
  assert.match(system, /Рассказ — история, а не список фактов/);
  assert.ok(!/Короткие предложения \(до 12 слов\)/.test(system), "телеграфный стиль больше не требуем");
});

console.log(`Темы и материал: все проверки пройдены (${passed}).`);
