// Офлайн-проверка «новых названий»: чистка и проверка названий, файл content/title-ideas.json,
// промпт и генерация на подменённой сети (ремонт ответа, журнал расхода). Ключи и интернет не нужны.
// Запуск: npx tsx src/dev/title-ideas-test.ts

import assert from "node:assert/strict";
import { buildTitleUserPrompt, checkTitleIdeas, generateTitleIdeas, type TitleGenInput } from "../pipeline/script/title-gen";
import type { LlmCallInfo } from "../pipeline/script/usage-log";
import { cleanTitle, mergeTitleIdeas, parseTitleIdeas, titleProblem, usableIdeas, type TitleIdeasEntry } from "../pipeline/title-ideas";

process.env.LLM_BUSY_WAIT_MS = "1";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const chat = (content: string) =>
  json(200, { model: "gemini-test", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } });

function mockFetch(replies: Response[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    const r = replies.shift();
    if (!r) throw new Error(`неожиданный запрос №${calls.length}`);
    return r;
  };
  return { fn, calls };
}

const quiet = { info: () => {}, warn: () => {} };
const long = `Почему ${"очень ".repeat(20)}длинное название`;

await test("cleanTitle: кавычки вокруг, «<>», лишние пробелы", () => {
  assert.equal(cleanTitle("  «Почему   небо синее»  "), "Почему небо синее");
  assert.equal(cleanTitle('"Мозг <врёт> тебе"'), "Мозг врёт тебе");
  assert.equal(cleanTitle("Слово «в кавычках» внутри"), "Слово «в кавычках» внутри");
  assert.equal(cleanTitle("«Начало» и «конец»"), "«Начало» и «конец»", "кавычки внутри — не снимаем");
});

await test("titleProblem: пусто, длина в символах, угловые скобки", () => {
  assert.match(titleProblem("") ?? "", /пустое/);
  assert.equal(titleProblem("я".repeat(100)), null, "кириллица считается символами, а не байтами");
  assert.match(titleProblem("я".repeat(101)) ?? "", /длиннее 100/);
  assert.match(titleProblem("a < b") ?? "", /«<»/);
});

await test("usableIdeas: без повторов, без нынешнего названия, без негодных", () => {
  const got = usableIdeas(["Почему небо синее?", "почему  небо синее?", "Было так", long, 5, "Небо — фильтр света"], "было так");
  assert.deepEqual(got, ["Почему небо синее?", "Небо — фильтр света"]);
});

await test("title-ideas.json: битые записи пропускаются, новые заменяют прежние", () => {
  const file = parseTitleIdeas({
    items: [
      { code: "08a", at: "2026-10-08T10:00:00Z", current: "Старое", ideas: ["Новое 1", "Старое", "Новое 2"], model: "m" },
      { code: "bad", at: "2026-10-08T10:00:00Z", current: "x", ideas: ["y"] },
      { code: "09b", at: "не дата", current: "x", ideas: ["y"] },
      { code: "10a", at: "2026-10-08T10:00:00Z", current: "x", ideas: [] },
      { code: "08a", at: "2026-10-08T11:00:00Z", current: "Дубль", ideas: ["z"] },
    ],
  });
  assert.equal(file.items.length, 1);
  assert.deepEqual(file.items[0]!.ideas, ["Новое 1", "Новое 2"]);
  assert.equal(file.items[0]!.model, "m");
  assert.deepEqual(parseTitleIdeas(null).items, []);
  assert.deepEqual(parseTitleIdeas("мусор").items, []);
  const entry = (code: string, ideas: string[]): TitleIdeasEntry => ({ code, at: "2026-10-09T10:00:00Z", current: "Было", ideas, model: null });
  const merged = mergeTitleIdeas(file, [entry("12b", ["а", "б", "в"]), entry("08a", ["г", "д", "е"])]);
  assert.deepEqual(merged.items.map((i) => i.code), ["08a", "12b"]);
  assert.deepEqual(merged.items[0]!.ideas, ["г", "д", "е"]);
});

await test("checkTitleIdeas: от 3 годных — ок, меньше — ремонт с причинами", () => {
  const ok = checkTitleIdeas({ ideas: ["А почему?", "Б — это факт", "В за минуту", long] }, "Нынешнее");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value, ["А почему?", "Б — это факт", "В за минуту"]);
    assert.match(ok.warnings.join(), /отброшено вариантов: 1/);
  }
  const bad = checkTitleIdeas({ ideas: ["Нынешнее", "Один", long] }, "Нынешнее");
  assert.ok(!bad.ok);
  if (!bad.ok) assert.match(bad.problems.join("\n"), /длиннее 100[\s\S]*годных вариантов 1/);
  const empty = checkTitleIdeas({ titles: [] }, "x");
  assert.ok(!empty.ok);
});

const input: TitleGenInput = {
  code: "08a",
  current: "Почему цены заканчиваются на 99",
  topic: { title: "Почему цены заканчиваются на 99", hook: "99 рублей — это почти 100. Но мозг так не считает.", angle: "Эффект левой цифры.", pillarTitle: "Деньги и экономика" },
  description: "Почему 99 рублей кажутся дешевле 100.\n\n#shorts #деньги",
  suggestions: ["почему цены 99", "эффект левой цифры"],
  channel: { name: "Суть за минуту", audience: "Русскоязычные 14–45 лет" },
};

await test("промпт: нынешнее название, хук, рубрика, подсказки поиска, без хэштегов описания", () => {
  const p = buildTitleUserPrompt(input);
  assert.match(p, /Нынешнее название: «Почему цены заканчиваются на 99»/);
  assert.match(p, /Рубрика: Деньги и экономика/);
  assert.match(p, /хук\): 99 рублей/);
  assert.match(p, /«эффект левой цифры»/);
  assert.ok(!p.includes("#shorts"), "хэштеги описания в промпт не идут");
  assert.ok(!p.includes("Тема в плане"), "тема совпадает с названием — не повторяем");
});

await test("генерация: ответ с ошибками → ремонт → 3–5 вариантов, каждый запрос — в журнал", async () => {
  const { fn, calls } = mockFetch([
    chat(JSON.stringify({ ideas: ["Почему цены заканчиваются на 99", long, "Мозг видит 1 вместо 2"] })),
    chat("```json\n" + JSON.stringify({ ideas: ["«Мозг видит 1 вместо 2»", "99 ₽ — ловушка для мозга", "Эффект левой цифры за минуту", "Почему 99 кажется дешевле 100?"] }) + "\n```"),
  ]);
  const logged: LlmCallInfo[] = [];
  const r = await generateTitleIdeas(input, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log: quiet, onLlmCall: (c) => logged.push(c) });
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.url.includes("generativelanguage.googleapis.com"));
  const repair = (calls[1]!.body.messages as { role: string; content: string }[]).at(-1)!.content;
  assert.match(repair, /длиннее 100/);
  assert.deepEqual(r.ideas, ["Мозг видит 1 вместо 2", "99 ₽ — ловушка для мозга", "Эффект левой цифры за минуту", "Почему 99 кажется дешевле 100?"]);
  assert.equal(logged.length, 2);
  assert.ok(logged.every((c) => c.provider === "gemini" && c.ok));
});

console.log(`\nВсе проверки пройдены: ${passed}`);
