// Офлайн-проверка уведомлений панели: шифрование aes128gcm — по примеру из RFC 8291 (приложение A),
// подпись VAPID, список устройств, рассылка на подменённом fetch и утренняя сводка. Сеть не нужна.
// Запуск из папки video-studio: npx tsx panel/scripts/push-test.ts
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelVideo } from "../../src/pipeline/youtube-fill";
import type { GhRelease, GhRun } from "../lib/github";
import {
  deviceId,
  encryptPayload,
  isPushEndpoint,
  messageFromInput,
  notifyDevices,
  parseSubs,
  PUSH_MAX_DEVICES,
  PUSH_MAX_PLAINTEXT,
  PushInputError,
  safeUrl,
  subscriptionFromClient,
  upsertSub,
  vapidAuthorization,
  vapidSetup,
  type PushStore,
  type PushSub,
} from "../lib/push";
import { dailySummary } from "../lib/push-summary";
import { buildState, parseAutopilot, type StateInput } from "../lib/state";

const b = (s: string) => Buffer.from(s, "base64url");
const b64 = (x: Uint8Array) => Buffer.from(x).toString("base64url");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

// Получатель (браузер): расшифровать тело aes128gcm своим закрытым ключом — RFC 8291 §3.4 со стороны устройства.
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  assert.ok(record.length <= rs, "одна запись не длиннее rs");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(asPublic), auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, "разделитель последней записи — 0x02");
  return plain.subarray(0, end);
}

// RFC 8291, приложение A (входные данные) и раздел 5 (готовое тело запроса).
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

function device(endpoint: string, label: string): { sub: PushSub; priv: Buffer; auth: Buffer } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 37 + endpoint.length) & 255));
  return { sub: { endpoint, keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(auth) }, label, addedAt: "2026-10-01T10:00:00.000Z" }, priv: ecdh.getPrivateKey(), auth };
}

function vapidEnv(subject = "mailto:owner@example.com") {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = pair.privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), b(jwk.x!), b(jwk.y!)]);
  return { env: { VAPID_PUBLIC_KEY: b64(pub), VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: subject }, publicKey: pair.publicKey };
}

function memoryStore(list: PushSub[]): PushStore & { list: PushSub[]; saves: number } {
  const store = {
    list,
    saves: 0,
    load: async () => store.list.map((s) => ({ ...s })),
    save: async (next: PushSub[]) => {
      store.list = next;
      store.saves++;
    },
  };
  return store;
}

async function main() {
  console.log("Уведомления панели (без сети):");

  await test("RFC 8291, приложение A: тело запроса байт в байт как в стандарте", () => {
    const out = encryptPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: b(RFC.salt), serverPrivateKey: b(RFC.asPrivate) });
    assert.equal(out.subarray(0, 86).toString("base64url"), RFC.header, "заголовок: соль, rs = 4096, открытый ключ сервера");
    assert.equal(out.subarray(86).toString("base64url"), RFC.ciphertext, "зашифрованная запись");
    assert.equal(out.toString("base64url"), RFC.message);
    assert.equal(out.readUInt32BE(16), 4096);
    assert.equal(b64(out.subarray(21, 86)), RFC.asPublic);
    assert.equal(decrypt(out, b(RFC.uaPrivate), b(RFC.auth)).toString(), RFC.plaintext, "устройство расшифровывает");
  });

  await test("шифрование: новые соль и ключ сервера на каждое сообщение, устройство расшифровывает", () => {
    const d = device("https://web.push.apple.com/abc", "iPhone");
    const text = Buffer.from(JSON.stringify({ title: "Видео готово", body: "08a, 08b — загрузите в Studio", url: "/" }));
    const one = encryptPayload(text, d.sub.keys);
    const two = encryptPayload(text, d.sub.keys);
    assert.equal(one.length, 86 + text.length + 17);
    assert.notDeepEqual(one.subarray(0, 16), two.subarray(0, 16), "соль случайная");
    assert.notDeepEqual(one.subarray(21, 86), two.subarray(21, 86), "ключ сервера одноразовый");
    assert.deepEqual(decrypt(one, d.priv, d.auth), text);
    assert.deepEqual(decrypt(two, d.priv, d.auth), text);
    assert.throws(() => encryptPayload(Buffer.alloc(PUSH_MAX_PLAINTEXT + 1), d.sub.keys), /длиннее 3993/);
    assert.throws(() => encryptPayload(text, { p256dh: d.sub.keys.p256dh, auth: "AAAA" }), /auth/);
  });

  await test("VAPID: JWT ES256 для origin службы push, срок ≤ 24 ч, подпись сходится с открытым ключом", () => {
    const { env, publicKey } = vapidEnv();
    const { keys, problems } = vapidSetup(env);
    assert.deepEqual(problems, []);
    const now = Date.parse("2026-10-09T03:00:00Z");
    const header = vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH/abc?x=1", keys!, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    assert.ok(m, header);
    assert.deepEqual(JSON.parse(b(m[1]!).toString()), { typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(b(m[2]!).toString()) as { aud: string; exp: number; sub: string };
    assert.equal(claims.aud, "https://web.push.apple.com");
    assert.equal(claims.sub, "mailto:owner@example.com");
    assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 86400, `exp ${claims.exp}`);
    assert.equal(b(m[3]!).length, 64, "подпись r‖s, а не DER");
    assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b(m[3]!)));
    assert.equal(m[4], env.VAPID_PUBLIC_KEY);
  });

  await test("VAPID: что не так с ключами — понятным текстом, без падений", () => {
    assert.match(vapidSetup({}).problems.join(" "), /Не задано: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
    assert.equal(vapidSetup({}).keys, null);
    const a = vapidEnv().env;
    const other = vapidEnv().env;
    assert.match(vapidSetup({ ...a, VAPID_PUBLIC_KEY: other.VAPID_PUBLIC_KEY }).problems.join(" "), /из разных пар/);
    assert.match(vapidSetup({ ...a, VAPID_SUBJECT: "owner@example.com" }).problems.join(" "), /VAPID_SUBJECT/);
    assert.match(vapidSetup({ ...a, VAPID_PUBLIC_KEY: "abc" }).problems.join(" "), /VAPID_PUBLIC_KEY не похож/);
    assert.match(vapidSetup({ ...a, VAPID_PRIVATE_KEY: "abc" }).problems.join(" "), /VAPID_PRIVATE_KEY не похож/);
    assert.deepEqual(vapidSetup({ ...a, VAPID_SUBJECT: "https://example.com/contact" }).problems, []);
  });

  await test("подписка из браузера: только службы push браузеров, ключи на месте", () => {
    const d = device("https://web.push.apple.com/abc", "x");
    const sub = subscriptionFromClient({ endpoint: d.sub.endpoint, expirationTime: null, keys: d.sub.keys }, "  iPhone\n ", new Date("2026-10-09T05:00:00Z"));
    assert.deepEqual(sub, { endpoint: d.sub.endpoint, keys: d.sub.keys, label: "iPhone", addedAt: "2026-10-09T05:00:00.000Z" });
    for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://web.push.apple.com/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
      assert.ok(isPushEndpoint(ok), ok);
    }
    for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://evil.example/fcm.googleapis.com", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "javascript:alert(1)"]) {
      assert.equal(isPushEndpoint(bad), false, bad);
    }
    assert.throws(() => subscriptionFromClient({ endpoint: "https://evil.example/x", keys: d.sub.keys }, "x"), (e: unknown) => e instanceof PushInputError && /evil\.example/.test(e.message));
    assert.throws(() => subscriptionFromClient({ endpoint: d.sub.endpoint, keys: { p256dh: "", auth: "" } }, "x"), /ключей шифрования/);
    assert.throws(() => subscriptionFromClient(null, "x"), /адрес подписки/);
    assert.equal(subscriptionFromClient({ endpoint: d.sub.endpoint, keys: d.sub.keys }, 42).label, "Устройство");
  });

  await test("список устройств: не больше 10, новое — первым, повтор — с прежней датой, мусор отбрасывается", () => {
    const subs = Array.from({ length: PUSH_MAX_DEVICES + 1 }, (_, i) => ({ ...device(`https://fcm.googleapis.com/fcm/send/d${i}`, `d${i}`).sub, addedAt: `2026-10-0${(i % 9) + 1}T00:00:00.000Z` }));
    let list: PushSub[] = [];
    for (const s of subs) list = upsertSub(list, s);
    assert.equal(list.length, PUSH_MAX_DEVICES);
    assert.equal(list[0]!.label, "d10");
    assert.ok(!list.some((s) => s.label === "d0"), "самое давнее вытеснено");
    const again = upsertSub(list, { ...subs[5]!, label: "d5 снова", addedAt: "2026-10-09T00:00:00.000Z" });
    assert.equal(again.length, PUSH_MAX_DEVICES);
    assert.equal(again[0]!.label, "d5 снова");
    assert.equal(again[0]!.addedAt, subs[5]!.addedAt);
    assert.deepEqual(parseSubs(JSON.stringify(again)), again);
    assert.deepEqual(parseSubs("не json"), []);
    assert.deepEqual(parseSubs('{"a":1}'), []);
    assert.deepEqual(parseSubs(JSON.stringify([subs[1], subs[1], { endpoint: "https://evil.example/x", keys: subs[2]!.keys }, 7])), [subs[1]]);
    assert.match(deviceId(subs[0]!.endpoint), /^[\w-]{16}$/);
    assert.equal(deviceId(subs[0]!.endpoint), deviceId(subs[0]!.endpoint));
    assert.notEqual(deviceId(subs[0]!.endpoint), deviceId(subs[1]!.endpoint));
  });

  await test("рассылка: заголовки RFC 8030/8292, устройство расшифровывает; 410 — убрать из списка, 403 — понятная ошибка", async () => {
    const { env } = vapidEnv();
    const iphone = device("https://web.push.apple.com/one", "iPhone");
    const android = device("https://fcm.googleapis.com/fcm/send/two", "Android · Chrome");
    const firefox = device("https://updates.push.services.mozilla.com/wpush/v2/three", "Windows · Firefox");
    const store = memoryStore([iphone.sub, android.sub, firefox.sub]);
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/two")) return new Response("", { status: 410 });
      if (String(url).includes("/three")) return new Response('{"reason":"BadJwtToken"}', { status: 403 });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const msg = { title: "Видео готово", body: "08a — загрузите в Studio", url: "/", tag: "build" };
    const report = await notifyDevices(msg, { env, store, fetch: fakeFetch, ttl: 3600 });
    assert.equal(report.problem, null);
    assert.deepEqual([report.devices, report.sent, report.failed, report.removed], [3, 1, 2, 1]);
    assert.equal(report.errors.length, 2);
    assert.match(report.errors.join("\n"), /Android · Chrome: подписки больше нет/);
    assert.match(report.errors.join("\n"), /Windows · Firefox: .*VAPID \(403: \{"reason":"BadJwtToken"\}\)/);
    assert.deepEqual(store.list.map((s) => s.label), ["iPhone", "Windows · Firefox"]);
    assert.equal(store.saves, 1);
    const first = calls.find((c) => c.url === iphone.sub.endpoint)!;
    const headers = first.init.headers as Record<string, string>;
    assert.equal(first.init.method, "POST");
    assert.match(headers.Authorization!, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.equal(headers["Content-Encoding"], "aes128gcm");
    assert.equal(headers.TTL, "3600");
    assert.equal(headers.Urgency, "normal");
    assert.ok(first.init.signal, "есть таймаут");
    const payload = JSON.parse(decrypt(Buffer.from(first.init.body as Uint8Array), iphone.priv, iphone.auth).toString()) as unknown;
    assert.deepEqual(payload, msg);
  });

  await test("рассылка: «Проверить» — только одно устройство; без ключей и без списка — причина, а не исключение", async () => {
    const { env } = vapidEnv();
    const a = device("https://web.push.apple.com/a", "iPhone");
    const c = device("https://fcm.googleapis.com/fcm/send/c", "Mac · Chrome");
    const store = memoryStore([a.sub, c.sub]);
    const urls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const one = await notifyDevices({ title: "Проверка", body: "" }, { env, store, fetch: fakeFetch, only: c.sub.endpoint, urgency: "high" });
    assert.deepEqual([one.sent, one.failed, urls], [1, 0, [c.sub.endpoint]]);
    const nobody = await notifyDevices({ title: "Проверка", body: "" }, { env, store, fetch: fakeFetch, only: "https://web.push.apple.com/zzz" });
    assert.match(nobody.problem ?? "", /не подписано/);
    const noKeys = await notifyDevices({ title: "x", body: "" }, { env: {}, store, fetch: fakeFetch });
    assert.match(noKeys.problem ?? "", /не настроены: Не задано: VAPID_PUBLIC_KEY/);
    const broken: PushStore = { load: async () => Promise.reject(new Error("GitHub, переменная PANEL_PUSH_SUBS: у токена не хватает прав")), save: async () => {} };
    const noList = await notifyDevices({ title: "x", body: "" }, { env, store: broken, fetch: fakeFetch });
    assert.match(noList.problem ?? "", /Список устройств не прочитан: GitHub/);
    const empty = await notifyDevices({ title: "x", body: "" }, { env, store: memoryStore([]), fetch: fakeFetch });
    assert.deepEqual([empty.problem, empty.devices, empty.sent], [null, 0, 0]);
    assert.equal(urls.length, 1, "лишних запросов не было");
  });

  await test("сообщение от машин (/api/notify): title обязателен, длина и ссылка — под контролем", () => {
    assert.equal(messageFromInput({ body: "без заголовка" }), null);
    assert.equal(messageFromInput("строка"), null);
    assert.deepEqual(messageFromInput({ title: " Видео готово ", body: "08a, 08b", url: "/runs" }), { title: "Видео готово", body: "08a, 08b", url: "/runs" });
    const long = messageFromInput({ title: "я".repeat(300), body: "б".repeat(1000) })!;
    assert.equal(long.title.length, 100);
    assert.equal(long.body.length, 400);
    assert.ok(long.title.endsWith("…"));
    assert.ok(Buffer.byteLength(JSON.stringify(long)) < PUSH_MAX_PLAINTEXT, "влезает в одну запись");
    assert.equal(safeUrl("//evil.example/x"), "/");
    assert.equal(safeUrl("/\\evil.example"), "/");
    assert.equal(safeUrl("javascript:alert(1)"), "/");
    assert.equal(safeUrl("http://github.com/x"), "/");
    assert.equal(safeUrl("https://github.com/x/y/actions/runs/1"), "https://github.com/x/y/actions/runs/1");
    assert.equal(safeUrl(undefined), "/");
  });

  // ---- утренняя сводка: настоящие plan.json и channel.json, подставные YouTube, релизы, запуски ----
  const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const json = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;
  const now = new Date("2026-10-08T12:00:00Z"); // чт 08.10, 15:00 МСК
  const video = (code: string, over: Partial<ChannelVideo> = {}): ChannelVideo => ({
    videoId: `v${code}${over.publishAt ?? ""}`,
    title: `${code} черновик`,
    description: "",
    fileName: `${code}-test.mp4`,
    durationSec: 55,
    uploadStatus: "processed",
    privacyStatus: "private",
    publishAt: null,
    embeddable: true,
    license: "youtube",
    publicStatsViewable: true,
    tags: [],
    categoryId: "27",
    publishedAt: "2026-10-07T10:00:00Z",
    thumbnailUrl: null,
    ...over,
  });
  const release = (id: number, code: string): GhRelease => ({
    id,
    tag_name: `video-${code}`,
    name: code,
    html_url: `https://github.com/x/y/releases/tag/video-${code}`,
    created_at: "2026-10-08T08:00:00Z",
    draft: false,
    assets: [{ id: id * 10, name: `${code}-x.mp4`, size: 1 }],
  });
  const failedRun: GhRun = {
    id: 3,
    name: "video-studio: YouTube",
    display_title: "youtube-fill: 01a (проверка)",
    path: ".github/workflows/video-studio-youtube-fill.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-10-08T11:30:00Z",
    updated_at: "2026-10-08T11:35:00Z",
    html_url: "https://github.com/x/y/actions/runs/3",
  };
  // Расписание без пропусков до ср 14.10 19:00 МСК: чужие ролики (без кода темы) на всех слотах.
  const fullSlots = ["2026-10-08T16:00:00Z", ...["09", "10", "11", "12", "13", "14"].flatMap((d) => [`2026-10-${d}T09:00:00Z`, `2026-10-${d}T16:00:00Z`])];
  const full = fullSlots.map((iso, i) => video(`other${i}`, { publishAt: iso }));
  const base: StateInput = {
    now,
    planJson: json("content/plan.json"),
    channelJson: json("channel.json"),
    scriptFiles: [],
    fillLists: [],
    releases: [release(1, "08a"), release(2, "08b")],
    runs: [],
    videos: full,
    youtubeError: null,
    secretNames: null,
    autopilot: parseAutopilot(null),
    autopilotLast: null,
    repo: "x/y",
    branch: "master",
  };
  const summary = (over: Partial<StateInput> = {}) => dailySummary(buildState({ ...base, ...over }));

  await test("сводка: загрузить в Studio + запас расписания — одной строкой", () => {
    assert.deepEqual(summary(), { title: "Дела на сегодня", body: "Загрузите в Studio: 08a, 08b · расписание до 14.10", url: "/", tag: "daily", badge: 0 });
  });

  await test("сводка: упавший запуск и ролик в Studio без времени — «Нужно внимание», ссылка на «Запуски»", () => {
    const msg = summary({ runs: [failedRun], videos: [...full, video("09a")] });
    assert.deepEqual(msg, {
      title: "Нужно внимание",
      // Порядок — как в карточке «Сейчас»: срочное, важное, остальное.
      body: "Не удался запуск «youtube-fill: 01a (проверка)» · в Studio без времени выхода: 09a · загрузите в Studio: 08a, 08b · расписание до 14.10",
      url: "/runs",
      tag: "daily",
      badge: 2,
    });
  });

  await test("сводка: делать нечего и расписания хватает — не беспокоим", () => {
    assert.equal(summary({ releases: [] }), null);
  });

  await test("сводка: пустой слот меньше чем через двое суток или расписание пусто — пишем, даже если больше делать нечего", () => {
    assert.deepEqual(summary({ releases: [], videos: [video("01a", { publishAt: "2026-10-09T09:00:00Z" })] }), {
      title: "Нужно внимание",
      body: "Пустой слот чт, 08.10 19:00 — встанет 01b",
      url: "/?v=01b", // одно видео в главном деле — сразу его карточка
      tag: "daily",
      badge: 1,
    });
    assert.equal(summary({ releases: [], videos: [] })?.body, "Расписание пусто");
    assert.equal(summary({ releases: [], videos: [] })?.url, "/", "без ролика — главная");
    assert.equal(summary({ releases: [release(1, "08a")], videos: full })?.url, "/?v=08a");
    // Без пропусков на 60 дней — так и пишем.
    const grid = buildState({ ...base, releases: [], videos: [] }).slotGrid.map((c) => c.iso);
    assert.equal(summary({ videos: grid.map((iso, i) => video(`other${i}`, { publishAt: iso })) })?.body, "Загрузите в Studio: 08a, 08b · расписание без пропусков на 60 дней");
  });

  await test("сводка: YouTube недоступен, дубли загрузки, длинный список кодов", () => {
    assert.deepEqual(summary({ videos: null, youtubeError: "квота" }), {
      title: "Нужно внимание",
      body: "YouTube недоступен — расписание не проверено · загрузите в Studio: 08a, 08b",
      url: "/",
      tag: "daily",
      badge: 1,
    });
    const dup = summary({ releases: [], videos: [...full, video("07a"), video("07a", { videoId: "v07a-2" })] });
    assert.match(dup?.body ?? "", /^Проблемы с загрузкой в Studio: 07a · /);
    const many = ["02a", "02b", "03a", "03b", "04a", "04b", "05a", "05b"].map((c, i) => release(10 + i, c));
    assert.match(summary({ releases: many })?.body ?? "", /^Загрузите в Studio: 02a, 02b, 03a, 03b, 04a, 04b и ещё 2 · расписание до 14\.10$/);
  });

  console.log(`\nВсе проверки уведомлений пройдены: ${passed}.`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
