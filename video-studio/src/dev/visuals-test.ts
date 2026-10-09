// Офлайн-проверка модуля визуала на подменённой сети: формы ответов Pexels,
// Pixabay и Cloudflare Workers AI — как в документации/клиентах (research/media.md).
// Запуск: npx tsx src/dev/visuals-test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VisualContext } from "../pipeline/contracts";
import { buildPlan, findVisual, pickRendition, resetVisualsState, VISUAL_PROVIDERS } from "../pipeline/visuals/index";
import type { ScriptScene } from "../types";

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "video-studio-visuals-test-"));
const logs: string[] = [];
const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };

let passed = 0;
let counter = 0;
async function test(name: string, fn: (dir: { publicDir: string; cacheDir: string }) => Promise<void> | void) {
  logs.length = 0;
  resetVisualsState();
  const base = path.join(tmpRoot, `t${++counter}`);
  try {
    await fn({ publicDir: path.join(base, "public"), cacheDir: path.join(base, "cache") });
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${logs.map((l) => `      | ${l}`).join("\n")}`);
    throw e;
  }
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: RequestInit["body"];
}
type Route = (call: Call, signal?: AbortSignal | null) => Response | Promise<Response> | null;

function mockFetch(route: Route) {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ?? null };
    calls.push(call);
    const r = await route(call, init?.signal);
    if (!r) throw new Error(`неожиданный запрос: ${call.url}`);
    return r;
  };
  return { fn, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (n: number, type = "video/mp4", fill = 7) => new Response(Buffer.alloc(n, fill), { status: 200, headers: { "content-type": type } });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);

const scene = (over: Partial<ScriptScene> = {}): ScriptScene => ({
  id: "s1",
  kind: "media",
  narration: "Лучше всего работают интервальные повторения.",
  onScreen: "День. Три дня. *Неделя.*",
  visualQuery: "calendar time lapse",
  imagePrompt: "minimal calendar pages flying in the air, motion blur, cinematic teal and orange",
  ...over,
});

const ctxFor = (publicDir: string, over: Partial<VisualContext> = {}): VisualContext => ({
  format: "shorts",
  publicDir,
  sceneIndex: 0,
  minDurationSec: 6,
  usedIds: new Set<string>(),
  ...over,
});

// Ответ Pexels /videos/search (структура — pexels@1.4.0 types.d.ts).
const pexelsVideo = (id: number, duration: number, files: [number | null, number | null, string][]) => ({
  id,
  width: 1080,
  height: 1920,
  url: `https://www.pexels.com/video/clip-${id}/`,
  image: `https://images.pexels.com/videos/${id}/poster.jpeg`,
  duration,
  user: { id: 1, name: `Author ${id}`, url: `https://www.pexels.com/@a${id}` },
  video_files: files.map(([w, h, q], i) => ({
    id: id * 10 + i,
    quality: q,
    file_type: q === "hls" ? "application/x-mpegURL" : "video/mp4",
    width: w,
    height: h,
    fps: 25,
    link: `https://videos.pexels.com/video-files/${id}/${id}-${q}_${w}_${h}_25fps.mp4`,
  })),
  video_pictures: [],
});

const pexelsPhoto = (id: number) => ({
  id,
  width: 4000,
  height: 6000,
  url: `https://www.pexels.com/photo/p-${id}/`,
  alt: "books",
  photographer: `Photographer ${id}`,
  photographer_url: `https://www.pexels.com/@p${id}`,
  src: {
    original: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`,
    large2x: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940`,
    portrait: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800`,
    landscape: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`,
  },
});

// Ответ Pixabay /api/videos (структура — fdddf/pixa types.go).
const pixabayHit = (id: number, duration: number, sizes: Partial<Record<"large" | "medium" | "small" | "tiny", [number, number]>>) => ({
  id,
  pageURL: `https://pixabay.com/videos/clip-${id}/`,
  type: "film",
  tags: "calendar, time",
  duration,
  videos: Object.fromEntries(
    (["large", "medium", "small", "tiny"] as const).map((k) => {
      const s = sizes[k];
      return [k, s ? { url: `https://cdn.pixabay.com/video/${id}/${k}.mp4`, width: s[0], height: s[1], size: s[0] * s[1], thumbnail: "" } : { url: "", width: 0, height: 0, size: 0, thumbnail: "" }];
    }),
  ),
  views: 1,
  downloads: 1,
  likes: 1,
  comments: 0,
  user_id: 42,
  user: `pixuser${id}`,
  userImageURL: "",
});

const noPart = (dir: string) => !existsSync(dir) || readdirSync(dir).every((f) => !f.endsWith(".part"));

console.log("Визуал: проверка без сети\n");

await test("pickRendition: лёгкий файл, закрывающий кадр, но не больше 1080p", () => {
  const f = (w: number, h: number) => ({ url: `u${w}x${h}`, width: w, height: h });
  assert.equal(pickRendition([f(2160, 3840), f(1080, 1920), f(540, 960)], "shorts")?.url, "u1080x1920");
  assert.equal(pickRendition([f(2160, 3840), f(720, 1280)], "shorts")?.url, "u720x1280", "4K не качаем, если есть ≤1080p");
  assert.equal(pickRendition([f(2160, 3840)], "shorts")?.url, "u2160x3840", "если есть только 4K — берём его");
  assert.equal(pickRendition([f(3840, 2160), f(1920, 1080), f(1280, 720)], "landscape")?.url, "u1920x1080");
  assert.equal(pickRendition([f(1080, 1920)], "landscape"), undefined, "чужая ориентация отбрасывается");
  assert.equal(pickRendition([f(1920, 1080), f(1280, 720)], "shorts", { strictOrientation: false, maxUpscale: 2 })?.url, "u1920x1080", "кроп без сильного апскейла");
});

await test("План этапов: сначала видео всех стоков, потом фото/кроп, потом AI", () => {
  const p = (name: string) => ({ provider: VISUAL_PROVIDERS[name], key: "k" });
  const plan = buildPlan([p("pexels"), p("pixabay"), p("cloudflare")], "shorts", false).map((s) => `${s.provider.name}:${s.stage.media}:${s.stage.rank}`);
  assert.deepEqual(plan, ["pexels:video:0", "pixabay:video:0", "pexels:image:1", "pixabay:video:1", "cloudflare:image:0"]);
  const ai = buildPlan([p("cloudflare"), p("pexels")], "landscape", false).map((s) => s.provider.name);
  assert.deepEqual(ai, ["cloudflare", "pexels", "pexels"], "AI первым, если так задано в VISUALS");
});

await test("Pexels: видео — пропуск usedIds и коротких, выбор 1080×1920, скачивание в visuals/s1.mp4", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://api.pexels.com/videos/search")) {
      return json(200, {
        page: 1,
        per_page: 15,
        total_results: 3,
        videos: [
          pexelsVideo(111, 20, [[1080, 1920, "hd"]]),
          pexelsVideo(222, 4, [[1080, 1920, "hd"]]),
          pexelsVideo(333, 15, [[2160, 3840, "uhd"], [1080, 1920, "hd"], [720, 1280, "sd"], [null, null, "hls"]]),
        ],
      });
    }
    if (c.url.includes("333-hd_1080_1920")) return bytes(1500);
    return null;
  });
  const ctx = ctxFor(publicDir, { usedIds: new Set(["pexels:video:111"]) });
  const r = await findVisual(scene(), ctx, { fetch: fn, env: { VISUALS: "pexels", PEXELS_API_KEY: "pexels-key" }, log, cacheDir });
  assert.deepEqual(r.visual, { type: "video", src: "visuals/s1.mp4", durationSec: 15, credit: "Pexels: Author 333" });
  assert.deepEqual(r.credit, { provider: "Pexels", author: "Author 333", url: "https://www.pexels.com/video/clip-333/" });
  const file = path.join(publicDir, "visuals", "s1.mp4");
  assert.equal(statSync(file).size, 1500);
  assert.ok(noPart(path.dirname(file)));
  assert.ok(ctx.usedIds.has("pexels:video:333"));
  const search = new URL(calls[0].url);
  assert.equal(calls[0].headers.authorization, "pexels-key", "ключ без Bearer");
  assert.equal(search.searchParams.get("orientation"), "portrait");
  assert.equal(search.searchParams.get("size"), "medium");
  assert.equal(search.searchParams.get("per_page"), "15");
  assert.equal(search.searchParams.get("query"), "calendar time lapse");
  assert.equal(calls[1].headers.authorization, undefined, "файл качается без ключа");
});

await test("Pexels: видео не нашлось → фото с точным кропом 1080×1920 → visuals/s2.jpg", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://api.pexels.com/videos/search")) return json(200, { videos: [] });
    if (c.url.startsWith("https://api.pexels.com/v1/search")) return json(200, { photos: [pexelsPhoto(77)] });
    if (c.url.startsWith("https://images.pexels.com/photos/77/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null;
  });
  const r = await findVisual(scene({ id: "s2", visualQuery: "old library books vintage" }), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "pexels", PEXELS_API_KEY: "k" }, log, cacheDir });
  assert.equal(r.visual.type, "image");
  assert.equal(r.visual.type === "image" && r.visual.src, "visuals/s2.jpg");
  const videoQueries = calls.filter((c) => c.url.includes("/videos/search")).map((c) => new URL(c.url).searchParams.get("query"));
  assert.deepEqual(videoQueries, ["old library books vintage", "old library"], "второй запрос — укороченный");
  const dl = new URL(calls[calls.length - 1].url);
  assert.equal(dl.searchParams.get("w"), "1080");
  assert.equal(dl.searchParams.get("h"), "1920");
  assert.equal(dl.searchParams.get("fit"), "crop");
});

await test("Pixabay: ориентации нет в API → проверка на клиенте, кэш 24 ч, кроп для Shorts", async ({ publicDir, cacheDir }) => {
  const hits = [
    pixabayHit(501, 14, { large: [3840, 2160], medium: [1920, 1080], small: [1280, 720] }),
    pixabayHit(502, 9, { medium: [1920, 1080], small: [1280, 720] }),
  ];
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://pixabay.com/api/videos/")) return json(200, { total: 2, totalHits: 2, hits });
    if (c.url.startsWith("https://cdn.pixabay.com/video/")) return bytes(900);
    return null;
  });
  const env = { VISUALS: "pixabay", PIXABAY_API_KEY: "secret-pixabay-key" };
  const ctx = ctxFor(publicDir);
  const r1 = await findVisual(scene({ id: "s3" }), ctx, { fetch: fn, env, log, cacheDir });
  assert.deepEqual(r1.visual, { type: "video", src: "visuals/s3.mp4", durationSec: 14, credit: "Pixabay: pixuser501" });
  const api = calls.filter((c) => c.url.startsWith("https://pixabay.com/api/"));
  assert.equal(api.length, 2, "строгий этап: 2 запроса; этап кропа взял ответ из кэша");
  const u = new URL(api[0].url);
  assert.equal(u.searchParams.get("key"), "secret-pixabay-key");
  assert.equal(u.searchParams.get("q"), "calendar time lapse");
  assert.ok(calls.some((c) => c.url === "https://cdn.pixabay.com/video/501/medium.mp4"), "1920×1080 — без 4K");
  const cacheFiles = readdirSync(path.join(cacheDir, "pixabay"));
  assert.equal(cacheFiles.length, 2);
  for (const f of cacheFiles) assert.ok(!readFileSync(path.join(cacheDir, "pixabay", f), "utf8").includes("secret-pixabay-key"), "ключ не попадает в кэш");

  const before = calls.length;
  const r2 = await findVisual(scene({ id: "s4" }), ctx, { fetch: fn, env, log, cacheDir });
  assert.equal(r2.credit?.url, "https://pixabay.com/videos/clip-502/", "клип 501 уже использован");
  assert.equal(calls.slice(before).filter((c) => c.url.startsWith("https://pixabay.com/api/")).length, 0, "повторный поиск — из кэша");

  // Через сутки кэш устаревает.
  const later = await findVisual(scene({ id: "s5" }), ctxFor(publicDir), { fetch: fn, env, log, cacheDir, now: () => Date.now() + 25 * 3600_000 });
  assert.equal(later.visual.type, "video");
  assert.ok(calls.filter((c) => c.url.startsWith("https://pixabay.com/api/")).length > 2);
});

await test("Cloudflare: FLUX.2 (multipart, 768×1344, стиль) упал → SDXL-Lightning PNG → visuals/s6.png", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.endsWith("/ai/run/@cf/black-forest-labs/flux-2-klein-4b")) return json(500, { success: false, errors: [{ code: 3043, message: "Internal error" }] });
    if (c.url.endsWith("/ai/run/@cf/bytedance/stable-diffusion-xl-lightning")) return new Response(PNG, { headers: { "content-type": "image/png" } });
    return null;
  });
  const env = { VISUALS: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acc123", CLOUDFLARE_API_TOKEN: "cf-token" };
  const r = await findVisual(scene({ id: "s6" }), ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  assert.deepEqual(r.visual, { type: "image", src: "visuals/s6.png", credit: "Cloudflare SDXL-Lightning" });
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-2-klein-4b");
  assert.equal(calls[0].headers.authorization, "Bearer cf-token");
  assert.ok(calls[0].body instanceof FormData, "FLUX.2 принимает multipart");
  const form = calls[0].body as FormData;
  assert.equal(form.get("width"), "768");
  assert.equal(form.get("height"), "1344");
  const prompt = String(form.get("prompt"));
  assert.ok(prompt.startsWith("minimal calendar pages flying"), prompt);
  assert.ok(prompt.includes("vertical 9:16") && prompt.includes("no text"), "стиль и ориентация добавлены");
  const sdxl = JSON.parse(String(calls[1].body)) as { width: number; height: number; prompt: string };
  assert.equal(sdxl.width, 768);
  assert.equal(sdxl.prompt, prompt, "один и тот же промпт");
  assert.ok(readFileSync(path.join(publicDir, "visuals", "s6.png")).subarray(0, 4).equals(PNG.subarray(0, 4)));
});

await test("Cloudflare: FLUX.2 JSON {result:{image: base64}} → png; landscape 1344×768", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch(() => json(200, { success: true, result: { image: PNG.toString("base64") }, errors: [], messages: [] }));
  const env = { VISUALS: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" };
  const r = await findVisual(scene({ id: "s7" }), ctxFor(publicDir, { format: "landscape" }), { fetch: fn, env, log, cacheDir });
  assert.equal(r.credit?.provider, "Cloudflare FLUX.2");
  assert.equal((calls[0].body as FormData).get("width"), "1344");
  assert.ok(String((calls[0].body as FormData).get("prompt")).includes("wide 16:9"));
  assert.ok(existsSync(path.join(publicDir, "visuals", "s7.png")));
});

await test("Нет ключей → тихий пропуск, одно сообщение на источник за запуск", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch(() => null);
  const r1 = await findVisual(scene(), ctxFor(publicDir), { fetch: fn, env: {}, log, cacheDir });
  const r2 = await findVisual(scene({ id: "s2" }), ctxFor(publicDir), { fetch: fn, env: {}, log, cacheDir });
  assert.deepEqual(r1, { visual: { type: "none" }, credit: null });
  assert.deepEqual(r2, { visual: { type: "none" }, credit: null });
  assert.equal(calls.length, 0);
  assert.equal(logs.length, 3, logs.join("\n"));
  assert.ok(logs[0].includes("Pexels пропущен") && logs[0].includes("PEXELS_API_KEY"));
  assert.ok(logs[2].includes("CLOUDFLARE_API_TOKEN"));
});

await test("VISUALS=none → без визуала и без запросов", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch(() => null);
  const r = await findVisual(scene(), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "none", PEXELS_API_KEY: "k" }, log, cacheDir });
  assert.equal(r.visual.type, "none");
  assert.equal(calls.length, 0);
});

await test("Лимит размера: большой файл прерывается, .part удаляется, сцена → none", async ({ publicDir, cacheDir }) => {
  const { fn } = mockFetch((c) => {
    if (c.url.includes("/videos/search")) return json(200, { videos: [pexelsVideo(901, 10, [[1080, 1920, "hd"]]), pexelsVideo(902, 10, [[1080, 1920, "hd"]])] });
    if (c.url.includes("901-hd")) return bytes(300_000); // без content-length — ловим по ходу чтения
    if (c.url.includes("902-hd")) return new Response(Buffer.alloc(10), { headers: { "content-length": "999999999" } });
    if (c.url.includes("/v1/search")) return json(200, { photos: [] });
    return null;
  });
  const r = await findVisual(scene(), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "pexels", PEXELS_API_KEY: "k", VISUALS_MAX_VIDEO_MB: "0.1" }, log, cacheDir });
  assert.equal(r.visual.type, "none");
  assert.ok(logs.some((l) => l.includes("больше лимита")), logs.join("\n"));
  const dir = path.join(publicDir, "visuals");
  assert.ok(noPart(dir), "временные файлы удалены");
  assert.ok(!existsSync(path.join(dir, "s1.mp4")));
});

await test("Таймаут API → не висим, сцена → none", async ({ publicDir, cacheDir }) => {
  const { fn } = mockFetch((_c, signal) => new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  const t0 = Date.now();
  const r = await findVisual(scene(), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "pexels", PEXELS_API_KEY: "k", VISUALS_TIMEOUT_MS: "60" }, log, cacheDir });
  assert.equal(r.visual.type, "none");
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(logs.some((l) => l.includes("нет ответа за")), logs.join("\n"));
});

await test("429 у Pexels → источник выключается до конца запуска, дальше Cloudflare", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://api.pexels.com/")) return json(429, { error: "Rate limit exceeded" });
    if (c.url.includes("api.cloudflare.com")) return json(200, { success: true, result: { image: PNG.toString("base64") } });
    return null;
  });
  const env = { VISUALS: "pexels,cloudflare", PEXELS_API_KEY: "k", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" };
  const r1 = await findVisual(scene({ id: "s1" }), ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  const r2 = await findVisual(scene({ id: "s2" }), ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  assert.equal(r1.credit?.provider, "Cloudflare FLUX.2");
  assert.equal(r2.credit?.provider, "Cloudflare FLUX.2");
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.pexels.com/")).length, 1, "после 429 Pexels больше не дёргаем");
  assert.ok(logs.some((l) => l.includes("Pexels выключен")));
});

await test("Pollinations — только по явному списку; картинка сохраняется", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => (c.url.startsWith("https://image.pollinations.ai/prompt/") ? new Response(JPG, { headers: { "content-type": "image/jpeg" } }) : null));
  const r = await findVisual(scene({ id: "s9" }), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "pollinations" }, log, cacheDir });
  assert.equal(r.visual.type === "image" && r.visual.src, "visuals/s9.jpg");
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("width"), "768");
  assert.equal(u.searchParams.get("nologo"), "true");
});

await test("Сцена без английского запроса и промпта → none без запросов к стокам", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch(() => null);
  const r = await findVisual(scene({ visualQuery: "календарь", imagePrompt: undefined }), ctxFor(publicDir), { fetch: fn, env: { PEXELS_API_KEY: "k", PIXABAY_API_KEY: "p" }, log, cacheDir });
  assert.equal(r.visual.type, "none");
  assert.equal(calls.length, 0);
});

await rm(tmpRoot, { recursive: true, force: true });
console.log(`\nВсе проверки пройдены: ${passed}.`);
