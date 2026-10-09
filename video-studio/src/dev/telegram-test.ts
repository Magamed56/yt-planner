// Офлайн-проверка кросспостинга в Telegram: настройки (токен, id канала), подпись до 1024
// символов, sendVideo на подменённом fetch (multipart, размеры, обложка, 429 с retry_after,
// обрывы связи), отметка telegram-result.json против дублей и проверка бота (telegram-check).
// Сеть и ключи не нужны. Запуск: npx tsx src/dev/telegram-test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUploadTargets } from "../cli/publish-options";
import { loadChannel } from "../pipeline/channel-file";
import { buildInstagramCaption } from "../pipeline/instagram";
import {
  TG_CAPTION_MAX,
  TG_RESULT_FILE,
  TelegramError,
  checkTelegram,
  normalizeChatId,
  probeVideo,
  publishTelegramRunDir,
  sendVideo,
  telegramAlreadySent,
  telegramCaption,
  telegramConfig,
  telegramVideoKbps,
  type TelegramConfig,
  type Transcode,
} from "../pipeline/telegram";
import type { VideoScript } from "../types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const demo = JSON.parse(fs.readFileSync(path.join(root, "examples", "demo-ru.json"), "utf8")) as VideoScript;
const channel = loadChannel({ file: path.join(root, "channel.json"), env: {} });

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

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const TOKEN = "123456789:AAHtestTokenTestTokenTestTokenTest12";
const cfg: TelegramConfig = { token: TOKEN, chatId: "@sutzaminutu", host: "api.telegram.org" };

interface Call {
  method: string; // метод Bot API: sendVideo, getMe…
  url: URL;
  form: FormData | null;
  json: Record<string, unknown> | null;
}

function mockBot(handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body;
    const call: Call = {
      method: url.pathname.split("/").pop() ?? "",
      url,
      form: body instanceof FormData ? body : null,
      json: typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { f, calls };
}

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "Content-Type": "application/json" } });
const bad = (status: number, description: string, parameters?: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) }), { status, headers: { "Content-Type": "application/json" } });
const posted = (id = 42) => ok({ message_id: id, date: 1791560000, chat: { id: -1001234567890, type: "channel", title: "Суть за минуту", username: "sutzaminutu" } });
const netError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const info = { width: 1080, height: 1920, durationSec: 57.6 };
// Ошибка промиса — как TelegramError (успех — провал проверки).
const failure = (p: Promise<unknown>) =>
  p.then(
    () => assert.fail("должна быть ошибка"),
    (e: unknown) => e as TelegramError,
  );

const dir0 = tmp("vs-tg-");
const video = path.join(dir0, "video.mp4");
fs.writeFileSync(video, Buffer.alloc(64 * 1024, 7));
const cover = path.join(dir0, "cover.jpg");
fs.writeFileSync(cover, Buffer.alloc(2048, 9));

// ---- настройки ----

await test("настройки: оба ключа обязательны, токен и id канала проверяются, ссылки t.me понимаются", () => {
  assert.throws(() => telegramConfig({}), /TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID/);
  assert.throws(() => telegramConfig({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "@sutzaminutu" }), /@BotFather/);
  assert.throws(() => telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "https://t.me/+AbCdEf123" }), /приглашение не подходит.*telegram-check/s);
  const c = telegramConfig({ TELEGRAM_BOT_TOKEN: ` bot${TOKEN} `, TELEGRAM_CHAT_ID: "https://t.me/sutzaminutu" });
  assert.equal(c.token, TOKEN, "«bot» из адреса API отрезается");
  assert.equal(c.chatId, "@sutzaminutu");
  assert.equal(c.host, "api.telegram.org");
  assert.equal(normalizeChatId("-1001234567890"), "-1001234567890");
  assert.equal(normalizeChatId("t.me/c/1234567890/15"), "-1001234567890", "ссылка на пост закрытого канала → id");
  assert.equal(normalizeChatId("sutzaminutu"), "@sutzaminutu");
  assert.equal(normalizeChatId("Суть за минуту"), null);
});

await test("--to / --upload: telegram и tg; both/all — по-прежнему YouTube + Instagram", () => {
  assert.deepEqual([...parseUploadTargets("youtube,telegram")], ["youtube", "telegram"]);
  assert.deepEqual([...parseUploadTargets("tg")], ["telegram"]);
  assert.deepEqual([...parseUploadTargets("all")], ["youtube", "instagram"]);
  assert.throws(() => parseUploadTargets("vk"), /youtube, instagram, telegram/);
});

// ---- подпись ----

await test("подпись: короткая не меняется (BOM и \\r\\n убираются), подпись Reels из make влезает", () => {
  assert.equal(telegramCaption("\uFEFFХук\r\n\r\n\r\nСуть  \r\n\r\n#сутьзаминуту\r\n"), "Хук\n\nСуть\n\n#сутьзаминуту");
  const ig = buildInstagramCaption(demo, channel);
  assert.ok(ig.length <= TG_CAPTION_MAX, `подпись Reels демо-ролика ${ig.length} символов`);
  assert.equal(telegramCaption(ig), ig);
});

await test("подпись длиннее 1024: целые абзацы по порядку, хэштеги в конце, эмодзи не рвутся", () => {
  const hook = "Почему мы забываем 70 % выученного за сутки? 🧠";
  const value = "Суть. ".repeat(200).trim(); // ≈ 1200 символов — не влезает целиком
  const cta = "💬 Напиши в комментариях, что запомнил 👇\n🔔 Подпишись";
  const tags = "#сутьзаминуту #память #мозг #наука";
  const c = telegramCaption([hook, value, cta, tags].join("\n\n"));
  assert.ok(c.length <= TG_CAPTION_MAX);
  assert.equal(c, [hook, cta, tags].join("\n\n"), "не влезший абзац пропущен, призыв и хэштеги остались");
  // Один огромный абзац из эмодзи (по 2 единицы UTF-16) — режется с «…», без половинок символа.
  const emoji = telegramCaption("😀".repeat(700));
  assert.ok(emoji.length <= TG_CAPTION_MAX && emoji.endsWith("…"));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji), "нет оборванных суррогатных пар");
  // Длинный хук — обрезается по слову, хэштеги не съедают больше четверти лимита.
  const many = telegramCaption(`${"слово ".repeat(400)}\n\n${Array.from({ length: 60 }, (_, i) => `#тег${i}`).join(" ")}`);
  assert.ok(many.length <= TG_CAPTION_MAX);
  const lastPara = many.split("\n\n").pop()!;
  assert.match(lastPara, /^#тег0 #тег1/);
  assert.ok(lastPara.length <= TG_CAPTION_MAX / 4);
  assert.match(many.split("\n\n")[0]!, /слово…$/);
});

// ---- отправка ----

await test("sendVideo: multipart с видео, размерами, обложкой и подписью → ссылка на пост", async () => {
  const { f, calls } = mockBot(() => posted(42));
  const logs: string[] = [];
  const r = await sendVideo({ videoPath: video, caption: "Хук\n\n#сутьзаминуту", coverPath: cover, info, config: cfg, fetch: f, log: (m) => logs.push(m) });
  assert.equal(calls.length, 1);
  const c = calls[0]!;
  assert.equal(c.url.hostname, "api.telegram.org");
  assert.equal(c.url.pathname, `/bot${TOKEN}/sendVideo`);
  const form = c.form!;
  assert.equal(form.get("chat_id"), "@sutzaminutu");
  assert.equal(form.get("supports_streaming"), "true");
  assert.equal(form.get("width"), "1080");
  assert.equal(form.get("height"), "1920");
  assert.equal(form.get("duration"), "58");
  assert.equal(form.get("caption"), "Хук\n\n#сутьзаминуту");
  const file = form.get("video") as File;
  assert.equal(file.name, "video.mp4");
  assert.equal(file.type, "video/mp4");
  assert.equal(file.size, 64 * 1024);
  assert.equal(form.get("cover"), "attach://cover_file");
  assert.equal((form.get("cover_file") as File).size, 2048);
  assert.equal(form.get("thumbnail"), null, "thumbnail (≤320×320, ≤200 КБ) не шлём — cover.jpg для него велик");
  assert.equal(r.messageId, 42);
  assert.equal(r.url, "https://t.me/sutzaminutu/42");
  assert.equal(r.chatId, "-1001234567890");
  assert.equal(r.withCover, true);
  assert.equal(r.postedAt, new Date(1791560000 * 1000).toISOString());
  assert.ok(!logs.join("\n").includes(TOKEN), "токен в лог не попадает");
});

await test("sendVideo: без размеров (не разобрали MP4) и без обложки — отправляет как есть; закрытый канал → t.me/c/…", async () => {
  const { f, calls } = mockBot(() => ok({ message_id: 7, chat: { id: -1009876543210, type: "channel", title: "Закрытый" } }));
  const r = await sendVideo({ videoPath: video, caption: "", coverPath: path.join(dir0, "нет.jpg"), probe: async () => null, config: cfg, fetch: f, log: () => {} });
  const form = calls[0]!.form!;
  assert.equal(form.get("width"), null);
  assert.equal(form.get("duration"), null);
  assert.equal(form.get("caption"), null);
  assert.equal(form.get("cover"), null);
  assert.equal(r.url, "https://t.me/c/9876543210/7");
});

await test("битрейт копии под лимит бота: 57,6 с → ≈ 6,3 Мбит/с; короткий — не выше 8, длинный — не ниже 1", () => {
  assert.equal(telegramVideoKbps(57.6), 6294);
  assert.equal(telegramVideoKbps(20), 8000);
  assert.equal(telegramVideoKbps(900), 1000);
  // Копия с этим битрейтом и звуком 128k влезает в 50 МБ с запасом.
  assert.ok((((telegramVideoKbps(57.6) + 128) * 1000) / 8) * 57.6 < 50 * 1024 * 1024 * 0.95);
});

await test("sendVideo: больше 50 МБ — копия пережимается до отправки; не вышло — понятная ошибка без запроса", async () => {
  const big = path.join(tmp("vs-tg-big-"), "video.mp4");
  fs.writeFileSync(big, "");
  fs.truncateSync(big, 80 * 1024 * 1024); // как шорт на 57 с при VIDEO_QUALITY=high
  const runs: { input: string; kbps: number }[] = [];
  const shrink: Transcode = async (input, output, kbps) => {
    runs.push({ input, kbps });
    fs.writeFileSync(output, Buffer.alloc(runs.length === 1 ? 51 * 1024 * 1024 : 300 * 1024, 1)); // 1-я копия «перелетела»
  };
  const { f, calls } = mockBot(() => posted(46));
  const logs: string[] = [];
  const r = await sendVideo({ videoPath: big, info, config: cfg, fetch: f, transcode: shrink, log: (m) => logs.push(m) });
  assert.deepEqual(runs.map((x) => x.input), [big, big]);
  assert.equal(runs[0]!.kbps, telegramVideoKbps(57.6));
  assert.ok(runs[1]!.kbps < runs[0]!.kbps, "вторая попытка — с меньшим битрейтом");
  assert.equal((calls[0]!.form!.get("video") as File).size, 300 * 1024, "уходит копия, а не исходник");
  assert.equal(calls[0]!.form!.get("width"), "1080");
  assert.deepEqual([r.video.transcoded, r.video.bytes, r.video.originalBytes], [true, 300 * 1024, 80 * 1024 * 1024]);
  assert.match(logs.join("\n"), /80\.0 МБ.*пережимаю копию/);

  const before = calls.length;
  const broken: Transcode = async () => {
    throw new Error("Unknown encoder 'libx264'");
  };
  assert.match((await failure(sendVideo({ videoPath: big, info, config: cfg, fetch: f, transcode: broken, log: () => {} }))).message, /80\.0 МБ.*не больше 50 МБ.*пережать не вышло.*libx264.*VIDEO_QUALITY=standard/s);
  assert.match((await failure(sendVideo({ videoPath: big, info: null, config: cfg, fetch: f, transcode: shrink, log: () => {} }))).message, /длительность ролика узнать не удалось/);
  assert.match((await failure(sendVideo({ videoPath: big, info, config: cfg, fetch: f, transcode: false, log: () => {} }))).message, /не больше 50 МБ/);
  const tiny = path.join(tmp("vs-tg-tiny-"), "video.mp4");
  fs.writeFileSync(tiny, "x");
  await assert.rejects(sendVideo({ videoPath: tiny, info, config: cfg, fetch: f, log: () => {} }), /почти пустой/);
  assert.equal(calls.length, before, "ни одного запроса к Telegram");
});

await test("sendVideo: меньше 50 МБ, а Telegram ответил «слишком большой» — пережимает копию и повторяет", async () => {
  const near = path.join(tmp("vs-tg-near-"), "video.mp4");
  fs.writeFileSync(near, "");
  fs.truncateSync(near, 49 * 1024 * 1024); // у границы: точный лимит Bot API не документирован
  const runs: number[] = [];
  const shrink: Transcode = async (_input, output, kbps) => {
    runs.push(kbps);
    fs.writeFileSync(output, Buffer.alloc(200 * 1024, 1));
  };
  const markers: string[] = [];
  const tooBig = mockBot((_c, n) => (n === 1 ? new Response("<html>413 Request Entity Too Large</html>", { status: 413 }) : posted(47)));
  const logs: string[] = [];
  const r = await sendVideo({ videoPath: near, info, config: cfg, fetch: tooBig.f, transcode: shrink, beforeSend: () => markers.push("sending"), log: (m) => logs.push(m) });
  assert.equal(runs.length, 1, "пережато один раз — после отказа");
  assert.equal(tooBig.calls.length, 2);
  assert.equal((tooBig.calls[0]!.form!.get("video") as File).size, 49 * 1024 * 1024, "сначала — исходник");
  assert.equal((tooBig.calls[1]!.form!.get("video") as File).size, 200 * 1024, "потом — копия");
  assert.deepEqual([r.messageId, r.video.transcoded], [47, true]);
  assert.match(logs.join("\n"), /не принял видео 49\.0 МБ как слишком большое.*пережимаю/s);
  assert.ok(markers.length >= 1);

  // Пережимать нечем — понятная ошибка, «пост не вышел» (повторять можно).
  const again = mockBot(() => bad(413, "Request Entity Too Large"));
  const e = await failure(sendVideo({ videoPath: near, info, config: cfg, fetch: again.f, transcode: false, log: () => {} }));
  assert.match(e.message, /не больше 50 МБ/);
  assert.equal(e.maybeSent, false);
  assert.equal(again.calls.length, 1);
  // Копия тоже не прошла — второй отказ уходит наверх, без бесконечных повторов.
  const always = mockBot(() => bad(413, "Request Entity Too Large"));
  await assert.rejects(sendVideo({ videoPath: near, info, config: cfg, fetch: always.f, transcode: shrink, log: () => {} }), /не больше 50 МБ/);
  assert.equal(always.calls.length, 2);
});

await test("sendVideo: 429 — ждёт retry_after и повторяет; слишком долгое ожидание — ошибка с подсказкой", async () => {
  const waits: number[] = [];
  const { f, calls } = mockBot((_c, n) => (n === 1 ? bad(429, "Too Many Requests: retry after 7", { retry_after: 7 }) : posted(43)));
  const r = await sendVideo({ videoPath: video, info, config: cfg, fetch: f, sleep: async (ms) => void waits.push(ms), log: () => {} });
  assert.equal(r.messageId, 43);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [8000]);
  const long = mockBot(() => bad(429, "Too Many Requests: retry after 3600", { retry_after: 3600 }));
  await assert.rejects(sendVideo({ videoPath: video, info, config: cfg, fetch: long.f, sleep: async () => {}, log: () => {} }), /подождать 3600 с/);
  assert.equal(long.calls.length, 1);
});

await test("sendVideo: обложку не приняли — повтор без неё", async () => {
  const { f, calls } = mockBot((c) => (c.form?.get("cover") ? bad(400, "Bad Request: can't parse cover") : posted(44)));
  const logs: string[] = [];
  const r = await sendVideo({ videoPath: video, coverPath: cover, info, config: cfg, fetch: f, log: (m) => logs.push(m) });
  assert.equal(calls.length, 2);
  assert.equal(r.withCover, false);
  assert.ok(logs.some((l) => l.includes("без неё")));
});

await test("sendVideo: русские подсказки — бот не в канале, канал не найден, токен отозван; токена в тексте нет", async () => {
  const cases: [Response, RegExp][] = [
    [bad(403, "Forbidden: bot is not a member of the channel chat"), /добавьте его администратором/],
    [bad(400, "Bad Request: need administrator rights in the channel chat"), /нет права публиковать/],
    [bad(400, "Bad Request: chat not found"), /-100.*telegram-check/s],
    [bad(401, "Unauthorized"), /@BotFather/],
    [bad(400, "Bad Request: group chat was upgraded to a supergroup chat", { migrate_to_chat_id: -1005550001 }), /-1005550001/],
  ];
  for (const [res, re] of cases) {
    const { f } = mockBot(() => res.clone());
    const e = await failure(sendVideo({ videoPath: video, info, config: cfg, fetch: f, log: () => {} }));
    assert.ok(e instanceof TelegramError);
    assert.match(e.message, re);
    assert.equal(e.maybeSent, false);
    assert.ok(!e.message.includes(TOKEN));
  }
});

await test("sendVideo: нет соединения — повтор; обрыв/таймаут/5xx во время отправки — без повтора, «неизвестно, вышел ли пост»", async () => {
  const waits: number[] = [];
  const refused = mockBot((_c, n) => (n === 1 ? Promise.reject(netError("ECONNREFUSED")) : posted(45)));
  assert.equal((await sendVideo({ videoPath: video, info, config: cfg, fetch: refused.f, sleep: async (ms) => void waits.push(ms), log: () => {} })).messageId, 45);
  assert.deepEqual(waits, [5000]);

  const down = mockBot(() => Promise.reject(netError("ENOTFOUND")));
  const e1 = await failure(sendVideo({ videoPath: video, info, config: cfg, fetch: down.f, sleep: async () => {}, log: () => {} }));
  assert.match(e1.message, /нет связи с api\.telegram\.org/);
  assert.equal(e1.maybeSent, false);
  assert.equal(down.calls.length, 3);

  for (const fail of [
    () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
    () => Promise.reject(netError("ECONNRESET")),
    () => Promise.resolve(new Response("<html>Bad Gateway</html>", { status: 502 })),
  ]) {
    const m = mockBot(fail);
    const e = await failure(sendVideo({ videoPath: video, info, config: cfg, fetch: m.f, sleep: async () => {}, log: () => {} }));
    assert.ok(e instanceof TelegramError);
    assert.equal(e.maybeSent, true);
    assert.match(e.message, /неизвестно, вышел ли пост.*telegram-published\.json/s);
    assert.equal(m.calls.length, 1, "вслепую не повторяем — был бы дубль");
  }
});

// ---- папка ролика ----

await test("папка ролика: telegram.txt главнее instagram.txt; отметка «sending» до запроса; второй раз — только с --force", async () => {
  const dir = tmp("vs-tg-run-");
  fs.copyFileSync(video, path.join(dir, "video.mp4"));
  fs.copyFileSync(cover, path.join(dir, "cover.jpg"));
  fs.writeFileSync(path.join(dir, "instagram.txt"), "Подпись Reels\n");
  fs.writeFileSync(path.join(dir, "telegram.txt"), "\uFEFFСвоя подпись для канала\n");
  const marker = path.join(dir, TG_RESULT_FILE);
  const seen: string[] = [];
  const { f, calls } = mockBot(() => {
    seen.push((JSON.parse(fs.readFileSync(marker, "utf8")) as { status: string }).status);
    return posted(50);
  });
  const r = await publishTelegramRunDir(dir, { config: cfg, fetch: f, info, log: () => {} });
  assert.deepEqual(seen, ["sending"], "отметка пишется до отправки");
  assert.equal(calls[0]!.form!.get("caption"), "Своя подпись для канала");
  assert.equal(r.resultFile, marker);
  const saved = JSON.parse(fs.readFileSync(marker, "utf8")) as { status: string; messageId: number; url: string };
  assert.equal(saved.status, "posted");
  assert.equal(saved.messageId, 50);
  await assert.rejects(publishTelegramRunDir(dir, { config: cfg, fetch: f, info, log: () => {} }), /уже отправлен.*t\.me\/sutzaminutu\/50.*npm run upload -- .+ --to telegram --force/s);
  assert.match(telegramAlreadySent(dir) ?? "", /уже отправлен/, "upload и make узнают об отметке до отправки");
  assert.equal(calls.length, 1);
  const again = await publishTelegramRunDir(dir, { force: true, config: cfg, fetch: f, info, log: () => {} });
  assert.equal(again.messageId, 50);
  assert.equal(calls.length, 2);

  // Без telegram.txt — instagram.txt.
  fs.rmSync(path.join(dir, "telegram.txt"));
  fs.rmSync(marker);
  await publishTelegramRunDir(dir, { config: cfg, fetch: f, info, log: () => {} });
  assert.equal(calls[2]!.form!.get("caption"), "Подпись Reels");
});

await test("папка ролика: обрыв — отметка «uncertain», повтор только с --force; точный отказ — отметка как была", async () => {
  const dir = tmp("vs-tg-run2-");
  fs.copyFileSync(video, path.join(dir, "video.mp4"));
  fs.writeFileSync(path.join(dir, "instagram.txt"), "Подпись\n");
  const marker = path.join(dir, TG_RESULT_FILE);

  const reset = mockBot(() => Promise.reject(netError("ECONNRESET")));
  await assert.rejects(publishTelegramRunDir(dir, { config: cfg, fetch: reset.f, info, log: () => {} }), /неизвестно, вышел ли пост/);
  const rec = JSON.parse(fs.readFileSync(marker, "utf8")) as { status: string; error: string };
  assert.equal(rec.status, "uncertain");
  assert.ok(!rec.error.includes(TOKEN));
  await assert.rejects(publishTelegramRunDir(dir, { config: cfg, fetch: reset.f, info, log: () => {} }), /оборвалась.*--force/s);
  assert.equal(reset.calls.length, 1);

  const forbidden = mockBot(() => bad(403, "Forbidden: bot is not a member of the channel chat"));
  const uncertain = fs.readFileSync(marker, "utf8");
  await assert.rejects(publishTelegramRunDir(dir, { force: true, config: cfg, fetch: forbidden.f, info, log: () => {} }), /администратором/);
  assert.equal(fs.readFileSync(marker, "utf8"), uncertain, "отказ после --force — отметка как была");
  fs.rmSync(marker);
  await assert.rejects(publishTelegramRunDir(dir, { config: cfg, fetch: forbidden.f, info, log: () => {} }), /администратором/);
  assert.equal(fs.existsSync(marker), false, "точно не ушло — отметки нет, можно повторить без --force");
  assert.equal(telegramAlreadySent(dir), null);

  // --force поверх прошлого поста: ошибка до отправки (не пережали) отметку о том посте не трогает.
  const okBot = mockBot(() => posted(60));
  await publishTelegramRunDir(dir, { config: cfg, fetch: okBot.f, info, log: () => {} });
  const before = fs.readFileSync(marker, "utf8");
  fs.truncateSync(path.join(dir, "video.mp4"), 60 * 1024 * 1024);
  await assert.rejects(publishTelegramRunDir(dir, { force: true, config: cfg, fetch: okBot.f, info, transcode: false, log: () => {} }), /не больше 50 МБ/);
  assert.equal(fs.readFileSync(marker, "utf8"), before);
  // …и отказ Telegram после отметки «sending» тоже возвращает её как было.
  fs.truncateSync(path.join(dir, "video.mp4"), 64 * 1024);
  await assert.rejects(publishTelegramRunDir(dir, { force: true, config: cfg, fetch: forbidden.f, info, log: () => {} }), /администратором/);
  assert.equal(fs.readFileSync(marker, "utf8"), before);
  assert.equal(okBot.calls.length, 1);

  const empty = tmp("vs-tg-run3-");
  await assert.rejects(publishTelegramRunDir(empty, { config: cfg, fetch: forbidden.f, log: () => {} }), /нет video\.mp4/);
});

// ---- проверка бота ----

await test("telegram-check: бот, канал и право публиковать; без id — каналы из последних событий", async () => {
  const good = mockBot((c) => {
    if (c.method === "getMe") return ok({ id: 555, is_bot: true, first_name: "Суть", username: "sut_bot" });
    if (c.method === "getChat") return ok({ id: -1001234567890, type: "channel", title: "Суть за минуту", username: "sutzaminutu" });
    if (c.method === "getChatMember") return ok({ status: "administrator", can_post_messages: true, user: { id: 555 } });
    return bad(404, "Not Found");
  });
  const r = await checkTelegram({ token: TOKEN, chatId: "@sutzaminutu", fetch: good.f });
  assert.deepEqual(r.problems, []);
  assert.equal(r.bot?.username, "sut_bot");
  assert.equal(r.chat?.id, "-1001234567890");
  assert.deepEqual(r.member, { status: "administrator", canPost: true });
  assert.deepEqual(good.calls.find((c) => c.method === "getChatMember")!.json, { chat_id: "@sutzaminutu", user_id: 555 });

  const member = mockBot((c) => (c.method === "getMe" ? ok({ id: 555, username: "sut_bot" }) : c.method === "getChat" ? ok({ id: -1001, type: "channel", title: "К" }) : ok({ status: "member" })));
  const m = await checkTelegram({ token: TOKEN, chatId: "-1001", fetch: member.f });
  assert.equal(m.member?.canPost, false);
  assert.match(m.problems.join("\n"), /администратором с правом «Публикация сообщений»/);

  const updates = mockBot((c) =>
    c.method === "getMe"
      ? ok({ id: 555, username: "sut_bot" })
      : ok([
          { update_id: 1, my_chat_member: { chat: { id: -1001234567890, type: "channel", title: "Суть за минуту" } } },
          { update_id: 2, channel_post: { chat: { id: -1001234567890, type: "channel", title: "Суть за минуту" } } },
          { update_id: 3, message: { chat: { id: 99, type: "private" } } },
        ]),
  );
  const u = await checkTelegram({ token: TOKEN, fetch: updates.f });
  assert.deepEqual(u.foundChats, [{ id: "-1001234567890", type: "channel", title: "Суть за минуту" }]);
  assert.equal(updates.calls[1]!.json!.offset, undefined, "без offset — события не «съедаются»");

  const hook = mockBot((c) => (c.method === "getMe" ? ok({ id: 555 }) : bad(409, "Conflict: can't use getUpdates method while webhook is active")));
  assert.match((await checkTelegram({ token: TOKEN, fetch: hook.f })).problems.join(), /webhook/);

  const revoked = mockBot(() => bad(401, "Unauthorized"));
  const rv = await checkTelegram({ token: TOKEN, chatId: "@x_channel", fetch: revoked.f });
  assert.equal(rv.bot, null);
  assert.match(rv.problems.join(), /@BotFather/);
  assert.equal(revoked.calls.length, 1);
});

await test("размеры видео: не MP4 — null (отправка пойдёт без width/height)", async () => {
  assert.equal(await probeVideo(video), null);
});

console.log(`\nВсе проверки Telegram пройдены: ${passed}.`);
