// Офлайн-проверка публикации: channel.json → умолчания, слоты расписания
// (12:00/19:00 МСК, переход на зимнее время), подвал описания YouTube,
// publishAt, подпись Reels и вся цепочка Instagram (контейнер → rupload →
// статус → media_publish) на подменённом fetch. Сеть и ключи не нужны.
// Запуск: npx tsx src/dev/publish-test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyChannelDefaults, channelFromJson, nthSlot, parseScheduleStart, upcomingSlots, zonedTimeToUtc, type ChannelConfig } from "../pipeline/channel";
import { loadChannel } from "../pipeline/channel-file";
import { coverFrame } from "../pipeline/cover";
import { buildInstagramCaption, instagramConfig, instagramHashtags, publishReel, publishRunDir, writeInstagramAssets, type InstagramConfig } from "../pipeline/instagram";
import { DESCRIPTION_MAX_BYTES, buildYoutubeMeta } from "../pipeline/meta";
import { uploadToYoutube } from "../pipeline/youtube";
import { applyUpdate, fillItemsOf, listChannelVideos, matchVideos, parseIsoDuration, planUpdates, updateBody, upsertFillItem, type ChannelVideo, type FillItem } from "../pipeline/youtube-fill";
import { parseUploadTargets, resolvePublishAt, scheduleArgsFrom, takenSlots } from "../cli/publish-options";
import type { VideoScript } from "../types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const demo = JSON.parse(fs.readFileSync(path.join(root, "examples", "demo-ru.json"), "utf8")) as VideoScript;

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

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Канал без зависимости от окружения разработчика.
const env: NodeJS.ProcessEnv = {};
const channel: ChannelConfig = loadChannel({ file: path.join(root, "channel.json"), env });

// ---- channel.json ----

await test("channel.json: имя, голос, расписание, хэштеги; CHANNEL_NAME из окружения сильнее", () => {
  assert.equal(channel.name, "Суть за минуту");
  assert.equal(channel.voice.name, "Charon");
  assert.deepEqual(channel.schedule.publishTimesLocal, ["12:00", "19:00"]);
  assert.equal(channel.schedule.timezone, "Europe/Moscow");
  assert.ok(channel.hashtags.brand.includes("#сутьзаминуту"));
  assert.equal(channel.theme, "midnight");
  assert.equal(loadChannel({ file: path.join(root, "channel.json"), env: { CHANNEL_NAME: "Другой" } }).name, "Другой");
  assert.deepEqual(loadChannel({ file: path.join(root, "channel.json"), env: { PUBLISH_TIMES: "9:30, 21:00" } }).schedule.publishTimesLocal, ["09:30", "21:00"]);
  const none = loadChannel({ file: null, env: {} });
  assert.equal(none.name, null);
  assert.deepEqual(none.schedule.publishTimesLocal, ["12:00", "19:00"]);
  const bad = path.join(tmp("vs-ch-"), "channel.json");
  fs.writeFileSync(bad, "{ name: ");
  assert.throws(() => loadChannel({ file: bad, env: {} }), /битый JSON/);
  assert.throws(() => loadChannel({ file: null, env: { PUBLISH_TZ: "Mars/Olympus" } }), /не распознан/);
});

await test("умолчания канала: голос Gemini и «облачко» — только если не заданы", () => {
  const e: NodeJS.ProcessEnv = { GEMINI_TTS_STYLE: "свой стиль" };
  const applied = applyChannelDefaults(channel, e);
  assert.equal(e.GEMINI_TTS_VOICE, "Charon");
  assert.equal(e.GEMINI_TTS_STYLE, "свой стиль");
  assert.equal(e.CTA_COMMENT, channel.cta.onScreenComment);
  assert.deepEqual(applied.sort(), ["CTA_COMMENT", "GEMINI_TTS_VOICE"]);
  assert.equal(e.TTS_PROVIDER, undefined, "провайдер не навязываем — auto");
});

// ---- слоты ----

await test("слоты 12:00/19:00 МСК: ближайший, запас 30 мин, пропуск занятых, N-й", () => {
  const s = channel.schedule;
  // 11:00 МСК → 12:00 МСК (09:00Z)
  assert.deepEqual(upcomingSlots(s, 3, { from: new Date("2026-10-07T08:00:00Z") }).map(iso), ["2026-10-07T09:00:00Z", "2026-10-07T16:00:00Z", "2026-10-08T09:00:00Z"]);
  // 11:45 МСК — до 12:00 меньше 30 минут → 19:00
  assert.equal(iso(upcomingSlots(s, 1, { from: new Date("2026-10-07T08:45:00Z") })[0]!), "2026-10-07T16:00:00Z");
  // занятый слот пропускается
  assert.equal(iso(upcomingSlots(s, 1, { from: new Date("2026-10-07T08:00:00Z"), taken: ["2026-10-07T09:00:00Z"] })[0]!), "2026-10-07T16:00:00Z");
  assert.equal(iso(nthSlot(s, 4, { from: new Date("2026-10-07T20:00:00Z") })), "2026-10-09T16:00:00Z");
  assert.throws(() => nthSlot(s, 0), /от 1/);
  assert.equal(iso(parseScheduleStart("2026-10-14", "Europe/Moscow")), "2026-10-13T21:00:00Z");
});

await test("слоты: переход на зимнее время (Берлин) и пояс западнее UTC (Нью-Йорк)", () => {
  const berlin = { perDay: 1, publishTimesLocal: ["12:00"], timezone: "Europe/Berlin" };
  const b = upcomingSlots(berlin, 3, { from: new Date("2026-10-24T05:00:00Z"), minLeadMinutes: 0 }).map(iso);
  assert.deepEqual(b, ["2026-10-24T10:00:00Z", "2026-10-25T11:00:00Z", "2026-10-26T11:00:00Z"]);
  const ny = { perDay: 1, publishTimesLocal: ["21:00"], timezone: "America/New_York" };
  // 20:30 по Нью-Йорку 7 октября = 00:30Z 8 октября: слот — сегодня (по местной дате) в 21:00
  assert.equal(iso(upcomingSlots(ny, 1, { from: new Date("2026-10-08T00:30:00Z"), minLeadMinutes: 0 })[0]!), "2026-10-08T01:00:00Z");
  assert.equal(zonedTimeToUtc(2026, 3, 29, 12, 0, "Europe/Moscow"), Date.parse("2026-03-29T09:00:00Z"));
});

await test("--schedule / --schedule-slot / --publish-at: разбор и итоговое время", () => {
  assert.deepEqual([...parseUploadTargets("youtube,instagram")], ["youtube", "instagram"]);
  assert.deepEqual([...parseUploadTargets("both")], ["youtube", "instagram"]);
  assert.equal(parseUploadTargets("none").size, 0);
  assert.throws(() => parseUploadTargets("tiktok"), /youtube, instagram/);
  assert.throws(() => scheduleArgsFrom({ schedule: true, "publish-at": "2026-10-10T09:00:00Z" }), /что-то одно/);
  assert.throws(() => scheduleArgsFrom({ "schedule-slot": "0" }), /от 1/);
  const out = tmp("vs-out-");
  // соседняя папка уже заняла ближайший слот
  const first = upcomingSlots(channel.schedule, 2);
  fs.mkdirSync(path.join(out, "a"));
  fs.writeFileSync(path.join(out, "a", "youtube-result.json"), JSON.stringify({ videoId: "X", publishAt: iso(first[0]!) }));
  assert.deepEqual(takenSlots(out), [iso(first[0]!)]);
  assert.equal(resolvePublishAt({ schedule: true }, channel, out), iso(first[1]!));
  assert.equal(resolvePublishAt({ scheduleSlot: 1 }, channel, out), iso(first[0]!), "N-й слот не смотрит на занятые — номер задаёт пакет");
  assert.equal(resolvePublishAt({}, channel, out), null);
  assert.throws(() => resolvePublishAt({ publishAt: "2020-01-01T00:00:00Z" }, channel, out), /уже прошло/);
  // начало отсчёта пакета в прошлом: слот №1 прошёл → ближайший свободный
  const logs: string[] = [];
  const r = resolvePublishAt({ scheduleSlot: 1, scheduleStart: "2026-01-01" }, channel, out, (m) => logs.push(m));
  assert.equal(r, iso(first[1]!));
  assert.ok(logs.some((l) => l.includes("уже прошёл")));
});

// ---- YouTube ----

await test("описание YouTube с каналом: призыв, подписка, Instagram, хэштеги бренда, дисклеймер в конце", () => {
  const m = buildYoutubeMeta({ script: demo, format: "shorts", visualCredits: [], musicCredit: null, voiceProvider: "gemini", channel });
  const d = m.description;
  assert.ok(d.startsWith(demo.description));
  assert.match(d, /💬 Напиши в комментариях, что думаешь 👇/);
  assert.match(d, /🔔 Подпишись — каждый день новая суть за минуту\n/);
  assert.match(d, /📱 Мы есть и в Instagram — ищи «Суть за минуту»/);
  assert.doesNotMatch(d, /https?:\/\/|www\./, "в описании нет ссылок");
  const tagLine = d.split("\n").find((l) => l.startsWith("#"))!;
  const tags = tagLine.split(" ");
  assert.equal(tags[0], "#сутьзаминуту");
  assert.ok(tags.includes("#shorts") && tags.includes("#память") && tags.includes("#факты"), tagLine);
  assert.ok(tags.length <= 8, tagLine);
  assert.ok(d.trimEnd().endsWith(channel.disclaimer!), "дисклеймер — последней строкой");
  assert.ok(m.tags.includes("суть за минуту"));
  assert.equal(m.tags.filter((t) => t === "shorts").length, 1);
  // Длинное описание урезается, а подвал канала остаётся.
  const long = buildYoutubeMeta({ script: { ...demo, description: "Очень длинный текст. ".repeat(400) }, format: "shorts", visualCredits: [], musicCredit: null, voiceProvider: "edge", channel });
  assert.ok(Buffer.byteLength(long.description) <= DESCRIPTION_MAX_BYTES);
  assert.ok(long.description.includes("🔔 Подпишись") && long.description.trimEnd().endsWith(channel.disclaimer!));
  // Без канала — описание как раньше.
  assert.doesNotMatch(buildYoutubeMeta({ script: demo, format: "shorts", visualCredits: [], musicCredit: null, voiceProvider: "edge" }).description, /sutzaminutu/);
});

await test("YouTube: publishAt → privacyStatus=private и status.publishAt; прошедшее время отвергается", async () => {
  const dir = tmp("vs-yt-");
  const file = path.join(dir, "video.mp4");
  fs.writeFileSync(file, Buffer.alloc(300 * 1024, 1));
  const at = iso(upcomingSlots(channel.schedule, 1)[0]!);
  let initBody: { status: Record<string, unknown> } | null = null;
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      initBody = JSON.parse(String(init.body));
      return new Response(null, { status: 200, headers: { Location: "https://upload.example/s" } });
    }
    return new Response(JSON.stringify({ id: "VID9", status: { privacyStatus: "private", uploadStatus: "uploaded", publishAt: at } }), { status: 200 });
  }) as typeof fetch;
  const meta = buildYoutubeMeta({ script: demo, format: "shorts", visualCredits: [], musicCredit: null, voiceProvider: "edge", channel });
  const auth = { getAccessToken: async () => ({ token: "T" }) } as never;
  const r = await uploadToYoutube({ videoFile: file, meta, privacy: "public", publishAt: at, fetch: fakeFetch, auth, log: () => {} });
  assert.equal(initBody!.status.privacyStatus, "private");
  assert.equal(initBody!.status.publishAt, at);
  assert.equal(initBody!.status.containsSyntheticMedia, true);
  assert.equal(r.publishAt, at);
  await assert.rejects(uploadToYoutube({ videoFile: file, meta, privacy: "private", publishAt: "2020-01-01T00:00:00Z", fetch: fakeFetch, auth, log: () => {} }), /уже прошло/);
});

// ---- Instagram: подпись ----

await test("подпись Reels: хук первой строкой, суть, призыв, 5–8 хэштегов, без ссылок и #shorts", () => {
  const c = buildInstagramCaption({ ...demo, description: demo.description + " Подробнее: https://example.com/x" }, channel);
  const lines = c.split("\n");
  assert.equal(lines[0], demo.scenes[0]!.narration);
  assert.match(c, /Кривая забывания Эббингауза/);
  assert.match(c, /💬 Напиши в комментариях, что думаешь 👇/);
  assert.match(c, /🔔 Подпишись — каждый день новая суть за минуту/);
  assert.doesNotMatch(c, /https?:\/\/|www\./);
  assert.doesNotMatch(c, /#shorts/i);
  const tags = c.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  assert.ok(tags.length >= 5 && tags.length <= 8, tags.join(" "));
  assert.equal(tags[0], "#сутьзаминуту");
  assert.ok(Array.from(c).length <= 2200);
  assert.deepEqual(instagramHashtags({ tags: ["мозг учёба", "shorts", "космос"] }, null), ["#космос"]);
  const own = buildInstagramCaption({ ...demo, description: "Одно предложение. #shorts #космос" }, channel);
  assert.doesNotMatch(own, /#shorts/i);
  assert.match(own, /\n\nОдно предложение\.\n\n/);
  const huge = buildInstagramCaption({ ...demo, description: "А".repeat(5000) }, channel);
  assert.ok(Array.from(huge).length <= 2200);
});

await test("кадр обложки — конец хука до перехода", () => {
  const props = {
    transitionFrames: 12,
    durationInFrames: 900,
    scenes: [
      { kind: "hook", startFrame: 0, durationInFrames: 90, audioStartFrame: 8 },
      { kind: "stat", startFrame: 78, durationInFrames: 120, audioStartFrame: 8 },
    ],
  } as unknown as Parameters<typeof coverFrame>[0];
  assert.equal(coverFrame(props), 90 - 12 - 2);
});

// ---- Instagram: публикация ----

const cfg: InstagramConfig = { userId: "17841400000000001", token: "EAAtest", host: "graph.facebook.com", version: "v26.0", uploadHost: "rupload.facebook.com" };

interface Call {
  method: string;
  url: URL;
  params: URLSearchParams;
  headers: Headers;
  bodyBytes: number;
}

function mockGraph(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let params = new URLSearchParams(url.search);
    let bodyBytes = 0;
    if (typeof init?.body === "string") params = new URLSearchParams(init.body);
    else if (init?.body instanceof Uint8Array) bodyBytes = init.body.byteLength;
    const call = { method, url, params, headers, bodyBytes };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { f, calls };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noSleep = async () => {};
const video = path.join(tmp("vs-ig-"), "video.mp4");
fs.writeFileSync(video, Buffer.alloc(64 * 1024, 3));

await test("Instagram: контейнер → rupload → опрос статуса → media_publish → ссылка", async () => {
  let polls = 0;
  const { f, calls } = mockGraph((c) => {
    const p = c.url.pathname;
    if (c.url.hostname === "rupload.facebook.com") return json({ success: true, message: "Upload successful" });
    if (p.endsWith("/media") && c.method === "GET") return json({ data: [] });
    if (p.endsWith("/content_publishing_limit")) return json({ data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (p.endsWith("/media") && c.method === "POST") return json({ id: "CONT1", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/CONT1" });
    if (p.endsWith("/CONT1")) return json({ id: "CONT1", status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" });
    if (p.endsWith("/media_publish")) return json({ id: "MEDIA1" });
    if (p.endsWith("/MEDIA1")) return json({ id: "MEDIA1", permalink: "https://www.instagram.com/reel/abc/", timestamp: "2026-10-07T09:00:00+0000" });
    return json({ error: { message: `неожиданный запрос ${c.method} ${p}`, code: 100 } }, 400);
  });
  const logs: string[] = [];
  const r = await publishReel({ videoPath: video, caption: "Хук\n\n#сутьзаминуту", thumbOffsetMs: 2533, config: cfg, fetch: f, sleep: noSleep, prepare: false, log: (m) => logs.push(m) });
  assert.equal(r.mediaId, "MEDIA1");
  assert.equal(r.permalink, "https://www.instagram.com/reel/abc/");
  assert.equal(r.duplicate, false);
  assert.deepEqual(r.quota, { usage: 3, total: 100 });
  const create = calls.find((c) => c.method === "POST" && c.url.pathname === "/v26.0/17841400000000001/media")!;
  assert.equal(create.url.hostname, "graph.facebook.com");
  assert.equal(create.params.get("media_type"), "REELS");
  assert.equal(create.params.get("upload_type"), "resumable");
  assert.equal(create.params.get("share_to_feed"), "true");
  assert.equal(create.params.get("thumb_offset"), "2533");
  assert.equal(create.params.get("is_ai_generated"), "true");
  assert.equal(create.params.get("access_token"), "EAAtest");
  assert.equal(create.params.get("caption"), "Хук\n\n#сутьзаминуту");
  const up = calls.find((c) => c.url.hostname === "rupload.facebook.com")!;
  assert.equal(up.url.pathname, "/ig-api-upload/v26.0/CONT1");
  assert.equal(up.headers.get("authorization"), "OAuth EAAtest");
  assert.equal(up.headers.get("offset"), "0");
  assert.equal(up.headers.get("file_size"), String(64 * 1024));
  assert.equal(up.bodyBytes, 64 * 1024);
  assert.equal(polls, 3);
  const pub = calls.find((c) => c.url.pathname.endsWith("/media_publish"))!;
  assert.equal(pub.params.get("creation_id"), "CONT1");
  // Токен — только Meta: никаких запросов на чужие хосты.
  assert.ok(calls.every((c) => ["graph.facebook.com", "rupload.facebook.com"].includes(c.url.hostname)));
});

await test("Instagram: uri загрузки с чужим хостом игнорируется (токен туда не уходит)", async () => {
  const { f, calls } = mockGraph((c) => {
    const p = c.url.pathname;
    if (c.url.hostname === "rupload.facebook.com") return json({ success: true });
    if (p.endsWith("/media") && c.method === "GET") return json({ data: [] });
    if (p.endsWith("/content_publishing_limit")) return json({ data: [] });
    if (p.endsWith("/media") && c.method === "POST") return json({ id: "C2", uri: "https://evil.example/steal" });
    if (p.endsWith("/C2")) return json({ status_code: "FINISHED" });
    if (p.endsWith("/media_publish")) return json({ id: "M2" });
    return json({ id: "M2" });
  });
  await publishReel({ videoPath: video, caption: "x", config: cfg, fetch: f, sleep: noSleep, prepare: false, log: () => {} });
  assert.ok(!calls.some((c) => c.url.hostname === "evil.example"));
});

await test("Instagram: ERROR контейнера (2207026), истёкший токен (190/463), нет прав (10) — русские подсказки", async () => {
  const base = (over: (c: Call) => Response | null) =>
    mockGraph((c) => {
      const o = over(c);
      if (o) return o;
      const p = c.url.pathname;
      if (c.url.hostname === "rupload.facebook.com") return json({ success: true });
      if (p.endsWith("/media") && c.method === "GET") return json({ data: [] });
      if (p.endsWith("/content_publishing_limit")) return json({ data: [] });
      if (p.endsWith("/media") && c.method === "POST") return json({ id: "C3" });
      return json({ status_code: "FINISHED" });
    }).f;
  await assert.rejects(
    publishReel({ videoPath: video, caption: "x", config: cfg, sleep: noSleep, prepare: false, log: () => {}, fetch: base((c) => (c.url.hostname === "graph.facebook.com" && c.url.pathname.endsWith("/C3") ? json({ status_code: "ERROR", status: "Error: Media upload has failed with error code 2207026" }) : null)) }),
    /не подходит для Reels: нужен MP4/,
  );
  const expired = json({ error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } }, 400);
  await assert.rejects(
    publishReel({ videoPath: video, caption: "x", config: cfg, sleep: noSleep, prepare: false, log: () => {}, fetch: base(() => expired.clone()) }),
    /токен IG_ACCESS_TOKEN истёк.*instagram-token/s,
  );
  const perm = json({ error: { message: "Application does not have permission for this action", code: 10 } }, 403);
  await assert.rejects(
    publishReel({ videoPath: video, caption: "x", config: cfg, sleep: noSleep, prepare: false, log: () => {}, fetch: base((c) => (c.method === "POST" && c.url.pathname.endsWith("/media") ? perm.clone() : null)) }),
    /нет нужного разрешения.*instagram_content_publish/s,
  );
  await assert.rejects(publishReel({ videoPath: video, caption: "x".repeat(2201), config: cfg, fetch: base(() => null), prepare: false, log: () => {} }), /не больше 2200/);
});

await test("Instagram: API не знает is_ai_generated → повтор без пометки; 2207027 «не готово» → повтор публикации", async () => {
  let creates = 0;
  let publishes = 0;
  const { f, calls } = mockGraph((c) => {
    const p = c.url.pathname;
    if (c.url.hostname === "rupload.facebook.com") return json({ success: true });
    if (p.endsWith("/media") && c.method === "GET") return json({ data: [] });
    if (p.endsWith("/content_publishing_limit")) return json({ data: [] });
    if (p.endsWith("/media") && c.method === "POST") {
      creates++;
      if (c.params.has("is_ai_generated")) return json({ error: { message: "(#100) Invalid parameter is_ai_generated", code: 100 } }, 400);
      return json({ id: "C4" });
    }
    if (p.endsWith("/C4")) return json({ status_code: "FINISHED" });
    if (p.endsWith("/media_publish")) return ++publishes < 2 ? json({ error: { message: "The media is not ready for publishing, please wait for a moment", code: 9007, error_subcode: 2207027 } }, 400) : json({ id: "M4" });
    return json({ id: "M4", permalink: "https://www.instagram.com/reel/m4/" });
  });
  const logs: string[] = [];
  const r = await publishReel({ videoPath: video, caption: "x", config: cfg, fetch: f, sleep: noSleep, prepare: false, log: (m) => logs.push(m) });
  assert.equal(creates, 2);
  assert.equal(publishes, 2);
  assert.equal(r.mediaId, "M4");
  assert.ok(logs.some((l) => l.includes("is_ai_generated")));
  assert.ok(!calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/media")).at(-1)!.params.has("is_ai_generated"));
});

await test("Instagram: без дублей — тот же текст уже опубликован; потерянный ответ media_publish → PUBLISHED", async () => {
  const caption = "Хук\n\nсуть  #сутьзаминуту";
  const dup = mockGraph((c) => (c.url.pathname.endsWith("/media") && c.method === "GET" ? json({ data: [{ id: "OLD", caption: "Хук\nсуть #сутьзаминуту", permalink: "https://www.instagram.com/reel/old/", timestamp: new Date().toISOString() }] }) : json({ error: { message: "не должно быть", code: 1 } }, 500)));
  const r = await publishReel({ videoPath: video, caption, config: cfg, fetch: dup.f, sleep: noSleep, prepare: false, log: () => {} });
  assert.equal(r.duplicate, true);
  assert.equal(r.mediaId, "OLD");
  assert.ok(!dup.calls.some((c) => c.method === "POST"));

  let mediaGets = 0;
  const lost = mockGraph((c) => {
    const p = c.url.pathname;
    if (c.url.hostname === "rupload.facebook.com") return json({ success: true });
    if (p.endsWith("/media") && c.method === "GET") return json({ data: ++mediaGets > 1 ? [{ id: "NEW", caption, permalink: "https://www.instagram.com/reel/new/" }] : [] });
    if (p.endsWith("/content_publishing_limit")) return json({ data: [] });
    if (p.endsWith("/media") && c.method === "POST") return json({ id: "C5" });
    if (p.endsWith("/C5")) return json({ status_code: c.params.get("fields") === "status_code" ? "PUBLISHED" : "FINISHED" });
    if (p.endsWith("/media_publish")) throw new TypeError("fetch failed");
    return json({});
  });
  const r2 = await publishReel({ videoPath: video, caption, config: cfg, fetch: lost.f, sleep: noSleep, prepare: false, log: () => {} });
  assert.equal(r2.mediaId, "NEW");
  assert.equal(lost.calls.filter((c) => c.url.pathname.endsWith("/media_publish")).length, 1, "публикацию вслепую не повторяли");
});

await test("Instagram: папка ролика — instagram.txt главнее, повторная публикация только с --force", async () => {
  const dir = tmp("vs-run-");
  fs.copyFileSync(video, path.join(dir, "video.mp4"));
  writeInstagramAssets(dir, { caption: "из json", thumbOffsetMs: 1500, shareToFeed: true, cover: "cover.jpg" });
  fs.writeFileSync(path.join(dir, "instagram.txt"), "﻿Правка человека\n");
  let sentCaption = "";
  let sentThumb = "";
  const { f } = mockGraph((c) => {
    const p = c.url.pathname;
    if (c.url.hostname === "rupload.facebook.com") return json({ success: true });
    if (p.endsWith("/media") && c.method === "GET") return json({ data: [] });
    if (p.endsWith("/content_publishing_limit")) return json({ data: [] });
    if (p.endsWith("/media") && c.method === "POST") {
      sentCaption = c.params.get("caption") ?? "";
      sentThumb = c.params.get("thumb_offset") ?? "";
      return json({ id: "C6" });
    }
    if (p.endsWith("/C6")) return json({ status_code: "FINISHED" });
    if (p.endsWith("/media_publish")) return json({ id: "M6" });
    return json({ permalink: "https://www.instagram.com/reel/m6/" });
  });
  const r = await publishRunDir(dir, { config: cfg, fetch: f, sleep: noSleep, prepare: false, log: () => {} });
  assert.equal(sentCaption, "Правка человека");
  assert.equal(sentThumb, "1500");
  assert.ok(fs.existsSync(r.resultFile));
  await assert.rejects(publishRunDir(dir, { config: cfg, fetch: f, sleep: noSleep, prepare: false, log: () => {} }), /уже опубликован.*--force/s);
});

await test("Instagram: настройки — числовой IG_USER_ID, токен Instagram Login (IG…) отвергается с объяснением", () => {
  assert.throws(() => instagramConfig({}), /IG_USER_ID, IG_ACCESS_TOKEN/);
  assert.throws(() => instagramConfig({ IG_USER_ID: "@sutzaminutu", IG_ACCESS_TOKEN: "EAA1" }), /числовой id/);
  assert.throws(() => instagramConfig({ IG_USER_ID: "1784", IG_ACCESS_TOKEN: "IGAAbc" }), /Facebook Login for Business/);
  const c = instagramConfig({ IG_USER_ID: "1784", IG_ACCESS_TOKEN: "EAA1", IG_API_VERSION: "25.0" });
  assert.equal(c.version, "v25.0");
  assert.equal(c.host, "graph.facebook.com");
});

await test("подпись Reels: «до н. э.», «т. е.» и инициалы не рвут предложение", () => {
  const script = { ...demo, description: "Пирамиду построили около 2560 года до н. э., Клеопатра умерла в 30 году до н. э., а Луна — в 1969-м. Это т. е. урок от А. С. Пушкина. Третье." };
  const cap = buildInstagramCaption(script, channel);
  assert.match(cap, /до н\. э\., Клеопатра умерла в 30 году до н\. э\., а Луна — в 1969-м\.\nЭто т\. е\. урок от А\. С\. Пушкина\./);
});

// ---- youtube-fill: ролики, загруженные в Studio руками ----

const week1 = (JSON.parse(fs.readFileSync(path.join(root, "content", "week1-videos.json"), "utf8")) as { videos: FillItem[] }).videos;
const vid = (over: Partial<ChannelVideo> & { videoId: string }): ChannelVideo => ({
  title: "",
  description: "",
  fileName: null,
  durationSec: 30,
  uploadStatus: "processed",
  privacyStatus: "private",
  publishAt: null,
  embeddable: null,
  license: null,
  publicStatsViewable: null,
  tags: [],
  categoryId: null,
  ...over,
});

await test("youtube-fill: список недели 1 — 14 роликов, коды по порядку, тексты в лимитах YouTube", () => {
  assert.deepEqual(week1.map((v) => v.id), ["01a", "01b", "02a", "02b", "03a", "03b", "04a", "04b", "05a", "05b", "06a", "06b", "07a", "07b"]);
  for (const v of week1) {
    assert.ok(v.file.startsWith(`${v.id}-`), v.id);
    assert.ok(v.title.length <= 100 && Buffer.byteLength(v.description) <= 5000, v.id);
    assert.ok(v.tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + v.tags.length - 1 <= 500, `${v.id}: теги`);
    assert.equal(v.categoryId, "27");
    assert.equal(v.containsSyntheticMedia, true);
    assert.doesNotMatch(v.description, /12:00|19:00|МСК|по Москве/, `${v.id}: время выхода в описании`);
    assert.doesNotMatch(v.description, /https?:\/\/|www\./, `${v.id}: ссылка в описании`);
  }
  assert.equal(parseIsoDuration("PT1M4S"), 64);
  assert.equal(parseIsoDuration("PT54S"), 54);
  assert.equal(parseIsoDuration("P0D"), null);
  assert.equal(parseIsoDuration(undefined), null);
});

await test("youtube-fill: находим по имени файла, по заголовку-черновику, по уже проставленному названию и по однозначной длительности", () => {
  const [a, b, c, d, e] = week1 as [FillItem, FillItem, FillItem, FillItem, FillItem];
  const videos = [
    vid({ videoId: "V1", fileName: `${a.file}.mp4`, title: a.file }),
    vid({ videoId: "V2", fileName: "IMG_2041.MOV", title: `${b.id} ${b.title}` }), // код в названии
    vid({ videoId: "V3", fileName: "4b41f984.mp4", title: c.title }), // повторный запуск: название уже наше
    vid({ videoId: "V4", fileName: "video (3).mp4", title: "video (3)", durationSec: Math.round(week1.find((v) => v.id === "05b")!.durationSec) }), // 49 с — одна такая
    vid({ videoId: "V5", fileName: "random.mp4", title: "Мой влог", durationSec: 600 }), // чужое видео — не трогаем
    vid({ videoId: "V6", fileName: `${d.file}.mp4`, uploadStatus: "failed" }),
    vid({ videoId: "V7", fileName: `${e.file}.mp4` }),
    vid({ videoId: "V8", fileName: `${e.file} (1).mp4` }), // загружен дважды
    vid({ videoId: "V9", fileName: `${week1[6]!.file}.mp4`, durationSec: null }), // 04a ещё загружается
  ];
  const r = matchVideos(week1, videos);
  const by = Object.fromEntries(r.matches.map((m) => [m.item.id, `${m.video.videoId}/${m.by}`]));
  assert.deepEqual(by, { "01a": "V1/файл", "01b": "V2/название", "02a": "V3/название", "05b": "V4/длительность" });
  assert.deepEqual(r.broken.map((x) => x.item.id), ["02b"]);
  assert.deepEqual(r.duplicates.map((x) => [x.item.id, x.videos.map((v) => v.videoId)]), [["03a", ["V7", "V8"]]]);
  assert.ok(!r.matches.some((m) => m.video.videoId === "V5"));
  assert.deepEqual(r.pending.map((x) => x.item.id), ["04a"]);
  assert.equal(r.missing.length, 14 - 4 - 1 - 1 - 1);
  // Две одинаково подходящие длительности (56,94 и 57,41 с) — не гадаем.
  const amb = matchVideos(week1, [vid({ videoId: "X", durationSec: 57 })]);
  assert.equal(matchVideos(week1, [vid({ videoId: "Y" })]).matches.length, 0); // 30 с — нет такого ролика
  // По длительности — только нетронутый черновик: видео с описанием, временем выхода или кодом другой недели не берём.
  const d49 = Math.round(week1.find((v) => v.id === "05b")!.durationSec);
  for (const other of [
    vid({ videoId: "W1", title: "Мой влог", description: "текст", durationSec: d49 }),
    vid({ videoId: "W2", title: "clip", fileName: "clip.mp4", publishAt: "2026-11-01T09:00:00Z", durationSec: d49 }),
    vid({ videoId: "W3", title: "08a-drugoy", fileName: "08a-drugoy.mp4", durationSec: d49 }),
  ]) assert.equal(matchVideos(week1, [other]).matches.length, 0, other.videoId);
  assert.equal(amb.matches.length, 0);
});

await test("youtube-fill: расписание — 2 в день по слотам, прежнее время не сдвигаем, опубликованные не трогаем", () => {
  const now = new Date("2026-10-08T15:00:00Z"); // 18:00 МСК — ближайший слот 19:00
  const items = week1.slice(0, 5);
  const videos = [
    vid({ videoId: "A", fileName: `${items[0]!.file}.mp4` }),
    vid({ videoId: "B", fileName: `${items[1]!.file}.mp4`, publishAt: "2026-10-09T09:00:00Z" }), // уже стоит на 12:00 завтра
    vid({ videoId: "C", fileName: `${items[2]!.file}.mp4` }),
    // Теги YouTube возвращает в своём порядке — это не повод переписывать ролик.
    vid({ videoId: "D", fileName: `${items[3]!.file}.mp4`, privacyStatus: "public", title: items[3]!.title, description: items[3]!.description, tags: [...items[3]!.tags].reverse(), categoryId: "27" }),
    vid({ videoId: "E", fileName: `${items[4]!.file}.mp4`, embeddable: false, license: "creativeCommon", publicStatsViewable: false }),
  ];
  const plan = planUpdates(matchVideos(items, videos), { schedule: channel.schedule, mode: "slots", now });
  const at = Object.fromEntries(plan.map((p) => [p.match.video.videoId, p.publishAt]));
  assert.deepEqual(at, { A: "2026-10-08T16:00:00Z", B: "2026-10-09T09:00:00Z", C: "2026-10-09T16:00:00Z", D: null, E: "2026-10-10T09:00:00Z" });
  // Слот, занятый другим роликом канала (не из списка), пропускается.
  const busy = planUpdates(matchVideos(items.slice(0, 1), videos.slice(0, 1)), { schedule: channel.schedule, mode: "slots", now, taken: ["2026-10-08T16:00:00Z"] });
  assert.equal(busy[0]!.publishAt, "2026-10-09T09:00:00Z");
  // Unlisted — только тексты: publishAt YouTube у него не примет.
  const unl = planUpdates(matchVideos(items.slice(0, 1), [vid({ videoId: "U", fileName: `${items[0]!.file}.mp4`, privacyStatus: "unlisted" })]), { schedule: channel.schedule, mode: "slots", now });
  assert.deepEqual([unl[0]!.privacyStatus, unl[0]!.publishAt], ["unlisted", null]);
  assert.equal(plan.find((p) => p.match.video.videoId === "B")!.keptPublishAt, true);
  assert.equal(plan.find((p) => p.match.video.videoId === "D")!.skip, true); // опубликован и тексты уже наши
  const body = updateBody(plan.find((p) => p.match.video.videoId === "E")!) as { id: string; snippet: Record<string, unknown>; status: Record<string, unknown> };
  assert.equal(body.id, "E");
  assert.equal(body.snippet.title, items[4]!.title);
  assert.equal(body.snippet.categoryId, "27");
  assert.equal(body.snippet.defaultAudioLanguage, "ru");
  assert.deepEqual(body.status, {
    privacyStatus: "private",
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: true,
    embeddable: false,
    license: "creativeCommon",
    publicStatsViewable: false,
    publishAt: "2026-10-10T09:00:00Z",
  });
  // С даты старта и без расписания.
  const fromStart = planUpdates(matchVideos(items.slice(0, 1), videos.slice(0, 1)), { schedule: channel.schedule, mode: "slots", now, start: parseScheduleStart("2026-10-12", "Europe/Moscow") });
  assert.equal(fromStart[0]!.publishAt, "2026-10-12T09:00:00Z");
  const none = planUpdates(matchVideos(items.slice(0, 1), videos.slice(0, 1)), { schedule: channel.schedule, mode: "none", now });
  assert.equal(none[0]!.publishAt, null);
  assert.equal(none[0]!.privacyStatus, "private");
  assert.equal(none[0]!.skip, false); // тексты ещё не наши
});

await test("youtube-fill: Data API — канал → «Загрузки» + поиск → videos.list → videos.update; время не принято — предупреждение", async () => {
  const auth = { getAccessToken: async () => ({ token: "tok" }) };
  const calls: { method: string; url: string; body?: string }[] = [];
  const item = week1[0]!;
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ method: init?.method ?? "GET", url: u, body: init?.body as string | undefined });
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.includes("/channels?")) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUx" } } }] });
    if (u.includes("/playlistItems?") && !u.includes("pageToken")) return json({ items: [{ contentDetails: { videoId: "v1" } }], nextPageToken: "p2" });
    if (u.includes("/playlistItems?")) return json({ items: [{ contentDetails: { videoId: "v2" } }] });
    if (u.includes("/search?")) return json({ items: [{ id: { videoId: "v3" } }, { id: { videoId: "v1" } }] });
    if (u.includes("/videos?part=snippet%2Cstatus%2CcontentDetails%2CfileDetails")) {
      assert.match(u, /id=v3%2Cv1%2Cv2/); // найденные поиском (свежие) — первыми
      return json({
        items: [
          { id: "v1", snippet: { title: item.file }, status: { uploadStatus: "processed", privacyStatus: "private" }, contentDetails: { duration: "PT54S" }, fileDetails: { fileName: `${item.file}.mp4` } },
          { id: "v2", snippet: { title: "Чужое" }, status: { privacyStatus: "public" }, contentDetails: { duration: "PT10M" } },
          { id: "v3", snippet: { title: "Ещё" }, status: { privacyStatus: "private" }, contentDetails: { duration: "PT3S" } },
        ],
      });
    }
    if (init?.method === "PUT") return json({ id: "v1", status: { privacyStatus: "private" } }); // publishAt не вернулся
    throw new Error(`неожиданный запрос ${u}`);
  }) as typeof fetch;
  const videos = await listChannelVideos({ auth, fetch: f, log: () => {} });
  assert.deepEqual(videos.map((v) => [v.videoId, v.durationSec]), [["v1", 54], ["v2", 600], ["v3", 3]]);
  const plan = planUpdates(matchVideos([item], videos), { schedule: channel.schedule, mode: "slots", now: new Date("2026-10-08T15:00:00Z") });
  const r = await applyUpdate({ auth, fetch: f }, plan[0]!);
  const put = calls.find((c) => c.method === "PUT")!;
  assert.equal(put.url, "https://www.googleapis.com/youtube/v3/videos?part=snippet,status");
  const sent = JSON.parse(put.body!) as { id: string; snippet: { title: string; tags: string[] }; status: { publishAt: string } };
  assert.equal(sent.id, "v1");
  assert.equal(sent.snippet.title, item.title);
  assert.deepEqual(sent.snippet.tags, item.tags);
  assert.equal(sent.status.publishAt, "2026-10-08T16:00:00Z");
  assert.match(r.warning ?? "", /не принял время выхода.*Запланировать/);
  // 403 без нужного права — понятная подсказка.
  const denied = (async () => new Response(JSON.stringify({ error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } }), { status: 403 })) as typeof fetch;
  await assert.rejects(listChannelVideos({ auth, fetch: denied }), /не хватает прав.*youtube-auth/s);
});

await test("youtube-fill для панели: список без поиска (100 единиц квоты), publishedAt; список текстов — замена по коду, порядок по коду", async () => {
  const auth = { getAccessToken: async () => ({ token: "tok" }) };
  const urls: string[] = [];
  const f = (async (url: string | URL) => {
    const u = String(url);
    urls.push(u);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes("/channels?")) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUx" } } }] });
    if (u.includes("/playlistItems?")) return json({ items: [{ contentDetails: { videoId: "v1" } }] });
    if (u.includes("/videos?")) return json({ items: [{ id: "v1", snippet: { title: "A", publishedAt: "2026-10-08T09:00:00Z" }, status: { privacyStatus: "public" }, contentDetails: { duration: "PT50S" } }] });
    throw new Error(`неожиданный запрос ${u}`);
  }) as typeof fetch;
  const videos = await listChannelVideos({ auth, fetch: f }, 200, { search: false });
  assert.ok(!urls.some((u) => u.includes("/search?")));
  assert.equal(videos[0]!.publishedAt, "2026-10-08T09:00:00Z");

  const [a, b] = week1 as [FillItem, FillItem];
  const list = upsertFillItem(upsertFillItem([], { ...b, id: "08b" }), { ...a, id: "08a" });
  assert.deepEqual(list.map((i) => i.id), ["08a", "08b"]);
  const again = upsertFillItem(list, { ...a, id: "08b", title: "Пересобран" });
  assert.deepEqual(again.map((i) => [i.id, i.title]), [["08a", a.title], ["08b", "Пересобран"]]);
  assert.equal(fillItemsOf({ about: "x", videos: list }).length, 2);
  assert.deepEqual(fillItemsOf(null), []);
});

await test("channel.json, прочитанный панелью из GitHub, = channel.json с диска", () => {
  const file = path.join(root, "channel.json");
  assert.deepEqual(channelFromJson(JSON.parse(fs.readFileSync(file, "utf8")), env, file), loadChannel({ file, env }));
  assert.deepEqual(channelFromJson(null).schedule, { perDay: 2, publishTimesLocal: ["12:00", "19:00"], timezone: "Europe/Moscow" });
});

console.log(`\nВсе проверки публикации пройдены: ${passed}.`);
