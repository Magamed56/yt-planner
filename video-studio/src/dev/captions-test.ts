// Офлайн-проверка перевода субтитров (npm run captions-translate): разбор и запись .srt без
// сдвига таймингов, проверка ответа LLM (число реплик, непереведённое), ремонтный запрос на
// подменённом fetch, captions.insert (multipart) и понятная ошибка без права force-ssl.
// Сеть и ключи не нужны. Запуск: npx tsx src/dev/captions-test.ts

import assert from "node:assert/strict";
import { CAPTIONS_SCOPE, CaptionsScopeError, captionsMultipart, existingTrack, hasCaptionsScope, insertCaption, listCaptions, pickCaptionRelease, tokenScopes } from "../pipeline/captions";
import { captionFileName, captionTrackName } from "../pipeline/lang";
import { checkCueTranslation, translateCues } from "../pipeline/script/translate";
import { captionsToSrt, parseSrt, sameTimings, serializeSrt, srtLineWidth, withCueTexts } from "../pipeline/srt";
import { YT_SCOPES } from "../pipeline/youtube";
import type { TimelineCaption } from "../types";

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

const log = { info: () => {}, warn: () => {} };

// Слова таймлинии → .srt так же, как make.ts пишет captions.srt.
const words = (text: string, startMs: number, stepMs = 320): TimelineCaption[] =>
  text.split(" ").map((w, i) => ({ text: w, startMs: startMs + i * stepMs, endMs: startMs + i * stepMs + 280, timestampMs: null, confidence: null }));
const ruSrt = captionsToSrt(
  [
    ...words("Девяносто девять рублей кажутся дешевле ста.", 0),
    ...words("Мозг попался.", 2400),
    ...words("Разница всего один рубль, но мозг читает цену слева и цепляется за первую цифру.", 4000),
  ],
  { maxLineChars: 32 },
);

// ---- .srt ----

await test(".srt: разбор и запись без изменений; BOM и CRLF не мешают", () => {
  const cues = parseSrt(ruSrt);
  assert.ok(cues.length >= 3);
  assert.equal(serializeSrt(cues), ruSrt);
  assert.equal(cues[0]!.startMs, 0);
  assert.match(cues[0]!.timing, /^00:00:00,000 --> 00:00:0\d,\d{3}$/);
  const crlf = "﻿" + ruSrt.replace(/\n/g, "\r\n");
  assert.ok(sameTimings(parseSrt(crlf), cues));
  // Реплика без номера и с точкой в миллисекундах — тоже srt.
  const loose = parseSrt("00:00:01.5 --> 00:00:02.250\nПривет\n\n");
  assert.equal(loose[0]!.startMs, 1500);
  assert.equal(loose[0]!.endMs, 2250);
  assert.throws(() => parseSrt("1\nне время\nтекст\n"), /нет строки времени/);
  assert.throws(() => parseSrt(""), /пустой файл/);
});

await test("перевод в те же реплики: номера и время — байт в байт, строки — по ширине оригинала", () => {
  const cues = parseSrt(ruSrt);
  assert.equal(srtLineWidth(cues), 32);
  const texts = cues.map((_, i) => `Translated cue number ${i + 1} with a few more words to wrap it`);
  const out = withCueTexts(cues, texts);
  assert.ok(sameTimings(cues, out));
  assert.ok(sameTimings(parseSrt(serializeSrt(out)), cues));
  assert.ok(out.every((c) => c.text.split("\n").length <= 2));
  assert.throws(() => withCueTexts(cues, texts.slice(1)), /реплик/);
  assert.equal(captionFileName("EN"), "captions.en.srt");
  assert.equal(captionTrackName("en"), "English (AI)");
  assert.equal(captionTrackName("kk"), "Қазақша (AI)");
});

// ---- проверка ответа LLM ----

await test("ответ LLM: число реплик, номера, кириллица в английском, дословный русский в казахском", () => {
  const src = ["Девяносто девять рублей кажутся дешевле ста.", "Мозг попался.", "Разница всего один рубль."];
  const good = { cues: [{ n: 1, text: "Ninety-nine rubles feel cheaper than a hundred." }, { n: 2, text: "Your brain fell for it." }, { n: 3, text: "The difference is just one ruble." }] };
  const ok = checkCueTranslation(src, good, "en");
  assert.ok(ok.ok && ok.value.length === 3);
  const fewer = checkCueTranslation(src, { cues: good.cues.slice(0, 2) }, "en");
  assert.ok(!fewer.ok && fewer.problems.some((p) => /ровно 3/.test(p)));
  const cyr = checkCueTranslation(src, { cues: [good.cues[0], { n: 2, text: "Мозг попался." }, good.cues[2]] }, "en");
  assert.ok(!cyr.ok && cyr.problems.some((p) => /реплика 2: осталась кириллица/.test(p)));
  const order = checkCueTranslation(src, { cues: [good.cues[1], good.cues[0], good.cues[2]] }, "en");
  assert.ok(!order.ok && order.problems.some((p) => /номер/.test(p)));
  const kkSame = checkCueTranslation(src, { cues: src.map((t, i) => ({ n: i + 1, text: t })) }, "kk");
  assert.ok(!kkSame.ok && kkSame.problems.some((p) => /совпадают с русским/.test(p)));
  // Номера с учётом смещения части (длинный ролик переводится кусками).
  const part = checkCueTranslation(src.slice(0, 1), { cues: [{ n: 61, text: "Ninety-nine rubles." }] }, "en", 60);
  assert.ok(part.ok);
});

// ---- перевод на подменённом fetch: ошибка → ремонтный запрос → успех ----

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const chat = (content: string) => json(200, { model: "gemini-test", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });

await test("translateCues: неверное число реплик → один ремонтный запрос → перевод; расход в onLlmCall", async () => {
  const src = ["Мозг попался.", "Разница всего один рубль."];
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const replies = [
    chat(JSON.stringify({ cues: [{ n: 1, text: "Your brain fell for it. The difference is one ruble." }] })),
    chat(JSON.stringify({ cues: [{ n: 1, text: "Your brain fell for it." }, { n: 2, text: "The difference is one ruble." }] })),
  ];
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = replies.shift();
    if (!r) throw new Error("лишний запрос");
    return r;
  };
  const calls: unknown[] = [];
  const res = await translateCues(src, "en", { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fetchMock, log, onLlmCall: (c) => calls.push(c) });
  assert.deepEqual(res.texts, ["Your brain fell for it.", "The difference is one ruble."]);
  assert.equal(bodies.length, 2);
  const repair = bodies[1]!.messages.at(-1)!.content;
  assert.match(repair, /не прошёл проверку/);
  assert.match(repair, /ровно 2/);
  assert.equal(calls.length, 2);
  assert.match(bodies[0]!.messages.find((m) => m.role === "user")!.content, /English \(en\)/);
});

await test("translateCues: длинные субтитры — по частям, номера сквозные, контекст из прошлой части", async () => {
  const src = Array.from({ length: 12 }, (_, i) => `Реплика номер ${i + 1}.`);
  const users: string[] = [];
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    const user = body.messages.find((m) => m.role === "user")!.content;
    users.push(user);
    const list = (JSON.parse(user.slice(user.indexOf("{"))) as { cues: { n: number }[] }).cues;
    return chat(JSON.stringify({ cues: list.map((c) => ({ n: c.n, text: `Cue ${c.n}.` })) }));
  };
  const res = await translateCues(src, "en", { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fetchMock, log, chunk: 5 });
  assert.equal(res.texts.length, 12);
  assert.equal(res.texts[11], "Cue 12.");
  assert.equal(users.length, 3);
  assert.match(users[1]!, /номера 6–10/);
  assert.match(users[1]!, /Cue 4\.[\s\S]*Cue 5\./);
});

// ---- YouTube captions ----

const auth = { getAccessToken: async () => ({ token: "ya29.test" }) };

await test("captions.insert: multipart (snippet + .srt), язык и название дорожки", async () => {
  const mp = captionsMultipart({ videoId: "vid1", language: "en", name: "English (AI)" }, "1\n00:00:00,000 --> 00:00:01,000\nHi\n", "BOUND");
  assert.equal(mp.contentType, "multipart/related; boundary=BOUND");
  assert.match(mp.body, /^--BOUND\r\nContent-Type: application\/json; charset=UTF-8\r\n\r\n\{"snippet":\{"videoId":"vid1","language":"en","name":"English \(AI\)","isDraft":false\}\}\r\n--BOUND\r\nContent-Type: application\/x-subrip/);
  assert.ok(mp.body.endsWith("\r\n--BOUND--\r\n"));
  const seen: { url: string; ct: string; body: string; method: string }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), ct: new Headers(init?.headers).get("content-type") ?? "", body: String(init?.body ?? ""), method: init?.method ?? "GET" });
    return json(200, { id: "cap123", snippet: { language: "en" } });
  }) as typeof fetch;
  const r = await insertCaption({ auth, fetch: f }, { videoId: "vid1", language: "en", name: "English (AI)", srt: "1\n00:00:00,000 --> 00:00:01,000\nHi\n" });
  assert.equal(r.id, "cap123");
  assert.equal(seen[0]!.method, "POST");
  assert.match(seen[0]!.url, /^https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/captions\?uploadType=multipart&part=snippet$/);
  assert.match(seen[0]!.ct, /^multipart\/related; boundary=/);
  assert.match(seen[0]!.body, /"videoId":"vid1"/);
});

await test("нет права force-ssl: 403 insufficientPermissions → подсказка выпустить ключ заново (GitHub, Vercel, второй ПК)", async () => {
  const denied = (async () =>
    json(403, { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } })) as unknown as typeof fetch;
  const err = await insertCaption({ auth, fetch: denied }, { videoId: "v", language: "en", name: "English (AI)", srt: "x" }).catch((e: unknown) => e);
  assert.ok(err instanceof CaptionsScopeError);
  assert.match((err as Error).message, /youtube\.force-ssl/);
  assert.match((err as Error).message, /npm run youtube-auth/);
  assert.match((err as Error).message, /Vercel/);
  assert.match((err as Error).message, /втором компьютере/);
  await assert.rejects(listCaptions({ auth, fetch: denied }, "v"), CaptionsScopeError);
});

await test("права токена: tokeninfo; нет связи — null (решит сам запрос); YT_SCOPES с force-ssl", async () => {
  const info = (async () => json(200, { scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube" })) as unknown as typeof fetch;
  const scopes = await tokenScopes({ auth, fetch: info });
  assert.ok(scopes && !hasCaptionsScope(scopes));
  assert.ok(hasCaptionsScope([...scopes!, CAPTIONS_SCOPE]));
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assert.equal(await tokenScopes({ auth, fetch: offline }), null);
  assert.ok(YT_SCOPES.includes(CAPTIONS_SCOPE));
  assert.ok(YT_SCOPES.includes("https://www.googleapis.com/auth/youtube.upload"));
  // Удержание в «Статистике» панели — YouTube Analytics API: право выдаётся при youtube-auth.
  assert.ok(YT_SCOPES.includes("https://www.googleapis.com/auth/yt-analytics.readonly"));
  assert.equal(new Set(YT_SCOPES).size, YT_SCOPES.length);
});

await test("дорожки: своя того же языка — пропуск, автосубтитры YouTube не в счёт; список на подменённом fetch", async () => {
  const f = (async () =>
    json(200, { items: [{ id: "a", snippet: { language: "en", name: "", trackKind: "asr" } }, { id: "b", snippet: { language: "kk", name: "Қазақша (AI)", trackKind: "standard" } }] })) as unknown as typeof fetch;
  const tracks = await listCaptions({ auth, fetch: f }, "v");
  assert.equal(existingTrack(tracks, "en"), null);
  assert.equal(existingTrack(tracks, "kk")?.id, "b");
  assert.equal(existingTrack([{ id: "c", language: "en-US", name: "English", trackKind: "standard" }], "en")?.id, "c");
});

await test("релиз с русскими субтитрами: самый свежий «08a-….mp4» + captions.srt; переводы и черновики — мимо", () => {
  const releases = [
    { tag_name: "video-en-08a", published_at: "2026-10-09T10:00:00Z", assets: [{ id: 1, name: "en-08a-why-prices.mp4" }, { id: 2, name: "captions.srt" }] },
    { tag_name: "video-08a-old", published_at: "2026-10-01T10:00:00Z", assets: [{ id: 3, name: "08a-pochemu.mp4" }, { id: 4, name: "captions.srt" }] },
    { tag_name: "video-08a-new", published_at: "2026-10-05T10:00:00Z", assets: [{ id: 5, name: "08a-pochemu.mp4" }, { id: 6, name: "captions.srt" }] },
    { tag_name: "video-08a-draft", draft: true, published_at: "2026-10-08T10:00:00Z", assets: [{ id: 7, name: "08a-pochemu.mp4" }, { id: 8, name: "captions.srt" }] },
    { tag_name: "video-08b", published_at: "2026-10-09T10:00:00Z", assets: [{ id: 9, name: "08b-x.mp4" }] },
  ];
  assert.deepEqual(pickCaptionRelease(releases, "08a"), { tag: "video-08a-new", assetId: 6 });
  assert.equal(pickCaptionRelease(releases, "08b"), null);
  assert.equal(pickCaptionRelease(releases, "09a"), null);
});

console.log(`\ncaptions-test: ${passed} проверок пройдено`);
