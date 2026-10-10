// Офлайн-проверка модуля визуала на подменённой сети: формы ответов Pexels,
// Pixabay и Cloudflare Workers AI — как в документации/клиентах (research/media.md).
// Запуск: npx tsx src/dev/visuals-test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VisualContext } from "../pipeline/contracts";
import { buildYoutubeMeta } from "../pipeline/meta";
import { buildPlan, findVisual, pickRendition, realFirstForPillar, resetVisualsState, VISUAL_PROVIDERS, visualsJudgeStats } from "../pipeline/visuals/index";
import { judgeConfig, parseVerdict } from "../pipeline/visuals/judge";
import { PICK_RULES_VERSION, visualKey } from "../pipeline/visuals/manifest";
import { authorText, htmlToText, licenseFamily } from "../pipeline/visuals/providers/open-licenses";
import { rankOpenverse } from "../pipeline/visuals/providers/openverse";
import { rankCommonsPages } from "../pipeline/visuals/providers/wikimedia";
import { nonPhotoKind, photoFit, photoQueries, slugText, stockFit, subjectCategories, topicAnchors, visualQuery } from "../pipeline/visuals/relevance";
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

// Ответ Pexels /videos/search (структура — pexels@1.4.0 types.d.ts). Описания
// у видео нет — сюжет только в адресе страницы (/video/<сюжет>-<id>/).
const pexelsVideo = (id: number, duration: number, files: [number | null, number | null, string][], slug = "calendar-pages-time-lapse") => ({
  id,
  width: 1080,
  height: 1920,
  url: `https://www.pexels.com/video/${slug}-${id}/`,
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
  assert.deepEqual(r.credit, { provider: "Pexels", author: "Author 333", url: "https://www.pexels.com/video/calendar-pages-time-lapse-333/" });
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
  // Только источники с ключами (реальные фото ключа не требуют — их тест ниже).
  const env = { VISUALS: "pexels,pixabay,cloudflare" };
  const r1 = await findVisual(scene(), ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  const r2 = await findVisual(scene({ id: "s2" }), ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
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

// ---- Реальные фото: Wikimedia Commons и Openverse ----

// Страница ответа Commons (action=query&generator=search&prop=imageinfo, formatversion=2).
const commonsPage = (
  pageid: number,
  index: number,
  title: string,
  over: { width?: number; height?: number; mime?: string; license?: string; short?: string; artist?: string; restrictions?: string; description?: string; categories?: string } = {},
) => ({
  pageid,
  ns: 6,
  title: `File:${title}.jpg`,
  index,
  imageinfo: [
    {
      width: over.width ?? 4000,
      height: over.height ?? 3000,
      mime: over.mime ?? "image/jpeg",
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${pageid}.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title.replace(/ /g, "_"))}.jpg`,
      thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${pageid}.jpg/1280px-${pageid}.jpg?utm_source=commons.wikimedia.org`,
      thumbwidth: 1280,
      thumbheight: 960,
      extmetadata: {
        License: { value: over.license ?? "cc-by-sa-4.0" },
        LicenseShortName: { value: over.short ?? "CC BY-SA 4.0" },
        Artist: { value: over.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Foo" title="User:Foo">Foo &amp; Bar</a>' },
        ...(over.restrictions ? { Restrictions: { value: over.restrictions } } : {}),
        ...(over.description ? { ImageDescription: { value: over.description } } : {}),
        ...(over.categories ? { Categories: { value: over.categories } } : {}),
      },
    },
  ],
});

await test("Лицензии и автор: семейства, HTML автора → текст", () => {
  assert.equal(licenseFamily("cc-by-sa-4.0"), "cc-by-sa");
  assert.equal(licenseFamily("cc-by-2.0"), "cc-by");
  assert.equal(licenseFamily("by"), "cc-by", "Openverse пишет без cc-");
  assert.equal(licenseFamily("pd"), "pd");
  assert.equal(licenseFamily("pdm"), "pd");
  assert.equal(licenseFamily("cc0"), "cc0");
  assert.equal(licenseFamily("cc-by-nc-sa-4.0"), null, "NC — нельзя");
  assert.equal(licenseFamily("cc-by-nd-4.0"), null, "ND — нельзя");
  assert.equal(licenseFamily("gfdl"), null);
  assert.equal(licenseFamily(""), null);
  assert.equal(htmlToText('<a href="x">Ivan&#160;Petrov</a>'), "Ivan Petrov");
  assert.equal(htmlToText("<span>Unknown author</span>Unknown author"), "Unknown author");
  assert.equal(authorText("<span>Unknown author</span>Unknown author"), null, "неизвестный автор — не автор");
  assert.equal(authorText("Uncredited"), null);
  assert.equal(authorText('<a href="//x">NASA/JPL</a>'), "NASA/JPL");
});

await test("Wikimedia: только свободные лицензии без ограничений, мусор мимо, атрибуция и User-Agent", async ({ publicDir, cacheDir }) => {
  const pages = [
    commonsPage(5, 5, "Giza pyramids at dawn portrait", { width: 3000, height: 4000, license: "pd", short: "Public domain", artist: "NASA" }),
    commonsPage(1, 1, "Giza pyramid NC", { license: "cc-by-nc-sa-4.0", short: "CC BY-NC-SA 4.0" }),
    commonsPage(2, 2, "Giza pyramid with tourist", { restrictions: "personality" }),
    commonsPage(3, 3, "Pyramids of Egypt (Page 130)", { license: "pd", short: "Public domain" }),
    commonsPage(6, 6, "Giza sunset panorama", { width: 9000, height: 2000 }),
    commonsPage(7, 7, "Sunset over Dulmen", {}),
    commonsPage(8, 0, "Giza pyramid in a workshop", { license: "pd", artist: "Uncredited", description: "<p>Plate 16. The pyramid model</p>" }),
    commonsPage(10, 8, "Desert pyramid scan", { license: "pd", categories: "Pyramids|Book scans" }),
    commonsPage(11, 1, "Giza", { width: 3000, height: 4000, license: "cc0", short: "CC0" }), // одно совпавшее слово из трёх
    commonsPage(4, 4, "Giza pyramid complex", {}),
  ];
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/w/api.php")) return json(200, { batchcomplete: true, query: { pages } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null;
  });
  const ctx = ctxFor(publicDir);
  const r = await findVisual(scene({ id: "s1", visualQuery: "giza pyramid desert" }), ctx, { fetch: fn, env: { VISUALS: "wikimedia" }, log, cacheDir });
  // NC, «права личности», скан страницы, панорама и закат без слова из запроса — пропущены.
  assert.deepEqual(r.visual, { type: "image", src: "visuals/s1.jpg", credit: "Wikimedia Commons: Foo & Bar (CC BY-SA 4.0)", fit: "contain" });
  assert.deepEqual(r.credit, { provider: "Wikimedia Commons", author: "Foo & Bar (CC BY-SA 4.0)", url: "https://commons.wikimedia.org/wiki/File:Giza_pyramid_complex.jpg" });
  assert.ok(ctx.usedIds.has("wikimedia:4"));
  const api = new URL(calls[0].url);
  assert.equal(api.searchParams.get("generator"), "search");
  assert.equal(api.searchParams.get("gsrnamespace"), "6");
  assert.equal(api.searchParams.get("gsrsearch"), "giza pyramid desert filetype:bitmap filew:>1079 fileh:>1079", "только растровые файлы от 1080 px по короткой стороне");
  assert.ok(api.searchParams.get("iiextmetadatafilter")!.includes("Categories"), "категории — тем же запросом");
  assert.equal(api.searchParams.get("iiurlwidth"), "1280");
  assert.ok(calls[0].headers["user-agent"]?.startsWith("video-studio/"), "понятный User-Agent обязателен");
  assert.ok(calls[1].url.startsWith("https://thumb.wikimedia.org/"), "качаем миниатюру из API, а не оригинал");
  assert.ok(calls[1].headers["user-agent"]?.startsWith("video-studio/"), "и при скачивании");
  assert.equal(readFileSync(path.join(publicDir, "visuals", "s1.jpg")).length, JPG.length);

  // Следующая сцена: №4 уже в ролике → портретное PD-фото, на весь кадр (cover).
  const r2 = await findVisual(scene({ id: "s2", visualQuery: "giza pyramid desert" }), ctx, { fetch: fn, env: { VISUALS: "wikimedia" }, log, cacheDir });
  assert.deepEqual(r2.visual, { type: "image", src: "visuals/s2.jpg", credit: "Wikimedia Commons: NASA (общественное достояние)" });

  // Описание ролика: автор, лицензия и страница файла.
  const meta = buildYoutubeMeta({
    script: { title: "Пирамиды", description: "Текст.", tags: [], language: "ru", format: "shorts", scenes: [] },
    format: "shorts",
    visualCredits: [r.credit, r2.credit],
    musicCredit: null,
    voiceProvider: "edge",
  });
  assert.ok(meta.description.includes("Wikimedia Commons — Foo & Bar (CC BY-SA 4.0) https://commons.wikimedia.org/wiki/File:Giza_pyramid_complex.jpg"), meta.description);
  assert.ok(meta.description.includes("NASA (общественное достояние)"), meta.description);

  // WIKIMEDIA_LICENSES=pd,cc0 — BY-SA больше не берём.
  const r3 = await findVisual(scene({ id: "s3", visualQuery: "giza pyramid desert" }), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "wikimedia", WIKIMEDIA_LICENSES: "pd,cc0" }, log, cacheDir });
  assert.equal(r3.credit?.author, "NASA (общественное достояние)");
});

await test("Реальные фото первыми: realFirst и рубрики VISUALS_REAL_PILLARS", async ({ publicDir, cacheDir }) => {
  const p = (name: string) => ({ provider: VISUAL_PROVIDERS[name], key: "k" });
  const all = [p("pexels"), p("pixabay"), p("wikimedia"), p("openverse"), p("cloudflare")];
  const plain = buildPlan(all, "shorts", false).map((s) => `${s.provider.name}:${s.stage.media}`);
  assert.deepEqual(plain, ["pexels:video", "pixabay:video", "pexels:image", "pixabay:video", "wikimedia:image", "openverse:image", "cloudflare:image"]);
  const real = buildPlan(all, "shorts", false, true).map((s) => s.provider.name);
  assert.deepEqual(real, ["wikimedia", "openverse", "pexels", "pixabay", "pexels", "pixabay", "cloudflare"]);

  assert.equal(realFirstForPillar("history", {}), true);
  assert.equal(realFirstForPillar("nature", {}), true);
  assert.equal(realFirstForPillar("money", {}), false);
  assert.equal(realFirstForPillar(null, {}), false);
  assert.equal(realFirstForPillar("tech", { VISUALS_REAL_PILLARS: "history,tech" }), true);
  assert.equal(realFirstForPillar("history", { VISUALS_REAL_PILLARS: "none" }), false);

  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { query: { pages: [commonsPage(9, 1, "Viking helmet Gjermundbu", { width: 3000, height: 4000 })] } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null; // Pexels не должен понадобиться
  });
  const env = { VISUALS: "pexels,wikimedia", PEXELS_API_KEY: "k" };
  const r = await findVisual(scene({ visualQuery: "viking helmet museum" }), { ...ctxFor(publicDir), realFirst: true }, { fetch: fn, env, log, cacheDir });
  assert.equal(r.credit?.provider, "Wikimedia Commons");
  assert.ok(!calls.some((c) => c.url.includes("pexels")), "до стока дело не дошло");
});

await test("Без ключей вообще: реальные фото всё равно находятся (VISUALS по умолчанию)", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { query: { pages: [] } });
    if (c.url.startsWith("https://api.openverse.org/v1/images/")) {
      return json(200, {
        result_count: 3,
        results: [
          { id: "a1", title: "Octopus on reef", url: "https://live.staticflickr.com/1/a1_b.jpg", foreign_landing_url: "https://www.flickr.com/photos/x/1", creator: "", license: "by", license_version: "2.0", source: "flickr", width: 1024, height: 768 },
          { id: "a2", title: "Octopus small", url: "https://live.staticflickr.com/1/a2.jpg", creator: "Ann", license: "by", license_version: "2.0", source: "flickr", width: 500, height: 375 },
          { id: "a3", title: "Common octopus", url: "https://inaturalist-open-data.s3.amazonaws.com/photos/3/original.jpeg", foreign_landing_url: "https://www.inaturalist.org/photos/3", creator: "Maria", license: "by", license_version: "4.0", source: "inaturalist", width: 2048, height: 1536 },
        ],
      });
    }
    if (c.url.startsWith("https://inaturalist-open-data.s3.amazonaws.com/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null;
  });
  const r = await findVisual(scene({ visualQuery: "octopus coral reef" }), ctxFor(publicDir), { fetch: fn, env: {}, log, cacheDir });
  // a1 — CC BY без автора (атрибуция неполная), a2 — слишком мелкое.
  assert.deepEqual(r.credit, { provider: "iNaturalist", author: "Maria (CC BY 4.0)", url: "https://www.inaturalist.org/photos/3" });
  const ov = new URL(calls.find((c) => c.url.startsWith("https://api.openverse.org/"))!.url);
  assert.equal(ov.searchParams.get("license"), "by,by-sa,cc0,pdm");
  assert.equal(ov.searchParams.get("excluded_source"), "wikimedia");
  assert.ok(calls.every((c) => !c.url.includes("pexels") && !c.url.includes("pixabay") && !c.url.includes("cloudflare")));
});

// ---- «По теме»: правила relevance.ts на настоящих данных ----

// Запросы сцен роликов 10a, 11a, 12b (scripts/sut-…json) — для «предмета ролика».
const Q10A = ["cat sniffing cake", "dna model laboratory", "cat tongue close up", "tiger walking grass", "cat eyes dark", "sea lion rocks", "person petting cat", ""];
const Q10B = ["human eye macro iris", "eye retina examination doctor", "face profile temple closeup", "old book candle desk", "person covering one eye", "", "brain model blue light", "city street through window", ""];
const Q11A = ["rocket launch night", "vintage computer panel buttons", "old circuit board closeup", "hand holding smartphone night", "astronaut spacecraft cockpit", "hands weaving copper wire", "moon surface footprint", ""];
const Q11B = ["blue sky ocean horizon", "sunlight prism rainbow", "old physics book desk", "clear blue sky clouds", "red sunset horizon city", "purple twilight sky", "human eye close up", ""];
const Q12A = ["wrinkled fingertips water bath", "hand soaking water bowl", "old hospital doctor notebook", "fingertip blood vessels macro", "tire tread wet road", "wet hands holding stones", "fingers bathtub bubbles", ""];
const Q12B = ["old university stone building", "stone pyramid temple ruins", "old manuscript candle desk", "lake city aerial mountains", "aztec stone carving", "hourglass sand wooden table", "", ""];

await test("Подборы роликов 10a–12b (логи CI 09.10.2026): случайные совпадения слова — мимо, удачные — остаются", () => {
  // [запросы ролика, visualQuery сцены, название файла Commons, который тогда попал в ролик, брать ли теперь]
  const cases: [string[], string, string, boolean][] = [
    [Q10A, "cat tongue close up", "Tongue of the forest", false],
    [Q10B, "old book candle desk", "Print, Ein façonirter Schreib-Tisch,… (Writing Desk and Chair), ca. 1720 (CH 18416713)", false],
    [Q10B, "person covering one eye", "DSC 8251 A narrow street scene at sunset with decorative chef statues standing on a fence beside a small restaurant motorbikes riding down the lane and green vines covering the wall on the right", false],
    [Q10B, "face profile temple closeup", "Full face and profile - geograph.org.uk - 6611409", false],
    [Q10B, "city street through window", "Through The Window Into The Canal (53045628)", false],
    [Q11A, "vintage computer panel buttons", "IBM 5155 vintage portable computer, IBM PC DOS, ValorosoIT", false],
    [Q11A, "old circuit board closeup", "The old banking at the former Brooklands racing circuit - geograph.org.uk - 4794210", false],
    [Q11A, "hands weaving copper wire", "Hands weaving palaspas", false],
    [Q11A, "hand holding smartphone night", "DZ3 0627 A night market stall in Sattahip Thailand - vendors weigh durians as a young buyer uses his phone to scan or pay while another customer captures the scene on their smartphone", false],
    [Q11B, "old physics book desk", "Old Physics Conference and Gallery", false],
    [Q12A, "hand soaking water bowl", "Fresh strawberries soaking in water next to a hand making a peace sign by the window in bright daylight", false],
    [Q12A, "old hospital doctor notebook", "Ellis Island hospital window mural (01897)", false],
    [Q12A, "fingertip blood vessels macro", "Blood lancet", false],
    [Q12A, "wet hands holding stones", "Toddler boy standing next to his toy car covered with wet sand and showing his dirty hands (51154030954)", false],
    [Q12B, "old university stone building", "Old Main cornerstone, University of Findlay", false],
    [Q12B, "stone pyramid temple ruins", "0011122 Bastar Shiv Temple Chhattisgarh 031", false],
    [Q12B, "old manuscript candle desk", "Primbon, old manuscripts of Indonesia", false],
    [Q12B, "lake city aerial mountains", "Aerial view of Newfoundland Mountains from the south dllu", false],
    // Удачные подборы тех же роликов не теряем.
    [Q10A, "sea lion rocks", "Lion resting on rocks in the Serengeti", false], // не тот «lion» (придуманный пример)
    [Q10A, "sea lion rocks", "Sea Lion, Sea Lion Rocks, 2006 (01)", true],
    [Q10A, "cat sniffing cake", "Tabby cat lying on the grass-Dichohecho-01", true],
    [Q10A, "dna model laboratory", "Template from Crick and Watson’s DNA molecular model, 1953. (9660573227)", true],
    [Q10A, "tiger walking grass", "Bengal tiger walking on the grass", true],
    [Q10A, "cat eyes dark", "Tuxedo cat with yellow eyes wearing a harness and bell 06", true],
    [Q10A, "person petting cat", "Young child and an old person are petting grey cute cat - 51622977008", true],
    [Q10B, "human eye macro iris", "Iris of the Human Eye", true],
    [Q10B, "eye retina examination doctor", "Eye (Retina + Sclera)", true],
    [Q10B, "brain model blue light", "Brain model 12", true],
    [Q11A, "rocket launch night", "NASA’s Evolved SLS Block 1B Crew Rocket - Night Launch (B1B Crew Night Launch)", true],
    [Q11A, "astronaut spacecraft cockpit", "Cockpit of the Gemini spacecraft", true],
    [Q11A, "moon surface footprint", "Buzz Aldrin's Footprint on the Surface of the Moon MET DP-15797-013", true],
    [Q11B, "blue sky ocean horizon", "The Horizon vs The Blue Skies", true],
    [Q11B, "sunlight prism rainbow", "Ripples dispersing sunlight into underwater rainbows in Brofjorden", true],
    [Q11B, "clear blue sky clouds", "Leaning trees over the grassy hillock of Nodong-ri tombs clouds and blue sky in Gyeongju South Korea", true],
    [Q11B, "red sunset horizon city", "Red Sunset (177370067)", true],
    [Q11B, "purple twilight sky", "A vivid twilight sky fades from deep purple to fiery orange, casting a warm glow across the horizon", true],
    [Q11B, "human eye close up", "Human eye close up, anterior view", true],
    [Q12A, "tire tread wet road", "Tire tread", true],
    [Q12B, "aztec stone carving", "Piedra del Sol (Aztec Sun Stone) - México", true],
    [Q12B, "hourglass sand wooden table", "Hourglass with sand", true],
  ];
  for (const [topicQueries, q, title, ok] of cases) {
    const fit = photoFit(visualQuery({ visualQuery: q }, { topicQueries }), { title });
    assert.equal(fit.ok, ok, `«${q}» → «${title}»: ${fit.why}`);
  }
  // Все 39 кадров из логов CI (без придуманного «Lion resting…»): 18 мимо, 21 остаётся.
  const real = cases.filter(([, , t]) => !t.startsWith("Lion resting"));
  assert.deepEqual([real.length, real.filter((c) => !c[3]).length], [39, 18]);
  assert.deepEqual([...topicAnchors(Q10A)], ["cat"], "предмет ролика про кошек");
  assert.deepEqual([...topicAnchors(Q10B)], ["eye"]);
  assert.deepEqual([...topicAnchors(Q11B)], [], "«horizon» в 2 сценах из 7 — ещё не тема ролика");
});

await test("Запросы к Commons: предмет кадра без стиля; имя собственное из imagePrompt — первым", () => {
  assert.deepEqual(photoQueries(visualQuery({ visualQuery: "cat tongue close up" })), ["cat tongue"], "«close up» только сужает поиск");
  assert.deepEqual(photoQueries(visualQuery({ visualQuery: "old book candle desk" })), ["book candle desk", "book candle"]);
  assert.deepEqual(
    photoQueries(visualQuery({ visualQuery: "rocket launch night", imagePrompt: "cinematic low angle shot of a giant Saturn V style rocket on a launch pad at night, floodlights" })),
    ["saturn rocket launch", "rocket launch"],
    "Saturn V из промпта → настоящие запуски «Аполлона»",
  );
  // Имя собственное: первое слово с заглавной среди строчных запросов ролика.
  const q = visualQuery({ visualQuery: "Tenochtitlan model" }, { topicQueries: [...Q12B, "Tenochtitlan model"] });
  assert.deepEqual(q.proper, ["tenochtitlan"]);
  assert.equal(q.terms[0]!.weight, 2);
  assert.deepEqual(visualQuery({ visualQuery: "Old university building" }, { topicQueries: ["Old university building", "Stone ruins", "Aztec stone"] }).proper, [], "все запросы с заглавной — это стиль, а не имена");
  assert.deepEqual(visualQuery({ visualQuery: "Apollo Guidance Computer DSKY" }).proper, ["apollo", "guidance", "computer", "dsky"]);
});

await test("Не фото: гравюра, карта, схема, логотип, скан — мимо, если запрос сам их не просит", () => {
  const q = visualQuery({ visualQuery: "old book candle desk" });
  assert.match(nonPhotoKind(q, { title: "Print, Ein façonirter Schreib-Tisch (Writing Desk), ca. 1720" }) ?? "", /гравюра/);
  assert.match(nonPhotoKind(q, { title: "Candle and book", categories: "Engravings by Johann Balthasar Probst|Prints in the Cooper Hewitt" }) ?? "", /гравюра/);
  assert.match(nonPhotoKind(q, { title: "Desk with books", description: "Etching on laid paper, 1750" }) ?? "", /гравюра/);
  assert.match(nonPhotoKind(q, { title: "Old book trade district map, Paris 1890" }) ?? "", /карта/);
  assert.match(nonPhotoKind(q, { title: "Candle flame diagram" }) ?? "", /схема/);
  assert.match(nonPhotoKind(q, { title: "Book candle logo" }) ?? "", /логотип/);
  assert.match(nonPhotoKind(q, { title: "Candle making (page 12)" }) ?? "", /скан/);
  assert.match(nonPhotoKind(q, { title: "Old desk", author: "Internet Archive Book Images" }) ?? "", /скан/);
  assert.equal(nonPhotoKind(q, { title: "Old book and burning candle on a wooden desk", categories: "Candles|Books|Quality images" }), null);
  assert.equal(nonPhotoKind(visualQuery({ visualQuery: "Edme Mariotte portrait" }), { title: "Edme Mariotte, engraving" }), null, "портрет просили — гравюра годится");
  assert.equal(nonPhotoKind(visualQuery({ visualQuery: "old map of Oxford" }), { title: "Map of Oxford, 1850" }), null, "карту просили");
});

// Реалистичный ответ Commons (generator=search, prop=imageinfo, formatversion=2) для «old book candle desk».
const deskPages = () => [
  commonsPage(101, 1, "Print, Ein façonirter Schreib-Tisch,… (Writing Desk and Chair), ca. 1720 (CH 18416713)", {
    license: "pd",
    short: "Public domain",
    artist: "Engraved by Johann Balthasar Probst",
    description: "Print, Ein façonirter Schreib-Tisch… Engraving on paper",
    categories: "Prints in the Cooper Hewitt, Smithsonian Design Museum|Engravings by Johann Balthasar Probst|Writing desks",
  }),
  commonsPage(102, 2, "Old book shops and candle makers map, Paris (1890)", { license: "pd", short: "Public domain", artist: "Unknown", categories: "Old maps of Paris|Bookshops in Paris" }),
  { ...commonsPage(103, 3, "Candle flame and book desk diagram", { categories: "Diagrams of candles" }), title: "File:Candle flame and book desk diagram.png" },
  commonsPage(104, 4, "Old book and candle on a desk", { width: 800, height: 600 }),
  commonsPage(105, 5, "Desk lamp in the office", {}),
  commonsPage(107, 7, "Old book with a candle on a desk", { width: 1200, height: 900 }),
  commonsPage(106, 6, "Old book and burning candle on a wooden desk", {
    width: 5000,
    height: 3333,
    description: "<p>An old open book next to a burning candle on a wooden desk</p>",
    categories: "Candles|Books on desks|Quality images",
  }),
];
// PNG у страницы 103 — mime тоже PNG.
const pngFix = (pages: ReturnType<typeof deskPages>) => pages.map((p) => (p.title.endsWith(".png") ? { ...p, imageinfo: p.imageinfo.map((ii) => ({ ...ii, mime: "image/png" })) } : p));

await test("Wikimedia: из гравюры, карты, схемы, мелкого и чужого фото выбирается фото по теме", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/w/api.php")) return json(200, { batchcomplete: true, query: { pages: pngFix(deskPages()) } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null;
  });
  const ctx = { ...ctxFor(publicDir), topicQueries: Q10B, topic: "В каждом твоём глазу есть дыра" };
  const r = await findVisual(scene({ id: "s4", visualQuery: "old book candle desk", imagePrompt: "17th century scholar desk with quill, parchment and a candle" }), ctx, { fetch: fn, env: { VISUALS: "wikimedia" }, log, cacheDir });
  assert.equal(r.credit?.url, "https://commons.wikimedia.org/wiki/File:Old_book_and_burning_candle_on_a_wooden_desk.jpg");
  assert.ok(logs.some((l) => l.includes("«Old book and burning candle on a wooden desk»")), "в логе — название файла");
  assert.equal(new URL(calls[0]!.url).searchParams.get("gsrsearch"), "book candle desk filetype:bitmap filew:>1079 fileh:>1079");
  assert.equal(calls.filter((c) => c.url.includes("api.php")).length, 1, "нашлось с первого запроса");

  // Каждого «плохого» кандидата отсекает своё правило.
  const q = visualQuery({ visualQuery: "old book candle desk" }, { topicQueries: Q10B });
  const ranked = rankCommonsPages(pngFix(deskPages()), q, { ctx: ctxFor(publicDir), deps: { fetch: fn, env: {}, log, cacheDir, now: Date.now } });
  assert.deepEqual(ranked.map((c) => c.id), ["wikimedia:106"], "гравюра, карта, схема, мелкие (800×600, 1200×900) и «Desk lamp» — мимо");
  assert.ok((ranked[0]!.meta?.score ?? 0) > 1, "фото по теме: высокий балл (+ Quality images)");
  // Порог можно ослабить: VISUALS_MIN_PHOTO_PX=600 пускает 1200×900, но не 800×600 (уже кадра Shorts).
  const loose = rankCommonsPages(pngFix(deskPages()), q, { ctx: ctxFor(publicDir), deps: { fetch: fn, env: { VISUALS_MIN_PHOTO_PX: "600" }, log, cacheDir, now: Date.now } });
  assert.deepEqual(loose.map((c) => c.id), ["wikimedia:106", "wikimedia:107"]);
});

await test("Wikimedia: ничего по теме → до трёх запросов, затем Openverse, затем моушен-графика (без картинки)", async ({ publicDir, cacheDir }) => {
  const offTopic = [
    commonsPage(201, 1, "The old banking at the former Brooklands racing circuit - geograph.org.uk - 4794210"),
    commonsPage(202, 2, "Circuit de Spa-Francorchamps, aerial", { categories: "Race tracks in Belgium" }),
    commonsPage(203, 3, "Printed circuit board layout diagram", { categories: "Diagrams" }),
  ];
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/w/api.php")) return json(200, { query: { pages: offTopic } });
    if (c.url.startsWith("https://api.openverse.org/")) return json(200, { results: [{ id: "x1", title: "Racing circuit at night", url: "https://live.staticflickr.com/1/x1_b.jpg", creator: "Ann", license: "by", license_version: "2.0", source: "flickr", width: 2048, height: 1536 }] });
    return null;
  });
  const r = await findVisual(scene({ id: "s3", visualQuery: "old circuit board closeup", imagePrompt: "macro shot of a 1960s circuit board with tiny components" }), { ...ctxFor(publicDir), topicQueries: Q11A }, { fetch: fn, env: {}, log, cacheDir });
  assert.deepEqual(r, { visual: { type: "none" }, credit: null }, "лучше моушен-графика, чем гоночная трасса");
  const searches = calls.filter((c) => c.url.includes("commons.wikimedia.org")).map((c) => new URL(c.url).searchParams.get("gsrsearch")!.split(" filetype")[0]);
  assert.deepEqual(searches, ["circuit board"], "один точный запрос: «old» и «closeup» не сужают поиск");
  assert.ok(logs.some((l) => l.includes("ни одного фото по теме")), logs.join("\n"));
  assert.ok(logs.some((l) => l.includes("по теме не нашлось")), logs.join("\n"));
  assert.ok(!calls.some((c) => c.url.includes("staticflickr")), "Openverse «Racing circuit» тоже не скачан");
});

await test("Стоки тоже проверяются: явный промах по сюжету мимо; имя собственное — только с совпадением", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://api.pexels.com/videos/search")) {
      return json(200, { videos: [pexelsVideo(401, 20, [[1080, 1920, "hd"]], "woman-doing-yoga-at-home"), pexelsVideo(402, 20, [[1080, 1920, "hd"]], "close-up-of-a-cat-licking-its-paw")] });
    }
    if (c.url.includes("402-hd")) return bytes(700);
    return null;
  });
  const r = await findVisual(scene({ id: "s3", visualQuery: "cat tongue close up" }), { ...ctxFor(publicDir), topicQueries: Q10A }, { fetch: fn, env: { VISUALS: "pexels", PEXELS_API_KEY: "k" }, log, cacheDir });
  assert.equal(r.credit?.url, "https://www.pexels.com/video/close-up-of-a-cat-licking-its-paw-402/", "йога пропущена");
  assert.ok(!calls.some((c) => c.url.includes("401-hd")));

  // «Tenochtitlan model»: сток покажет любые руины — берём Commons с настоящим макетом.
  resetVisualsState();
  const { fn: fn2, calls: calls2 } = mockFetch((c) => {
    if (c.url.startsWith("https://api.pexels.com/videos/search")) return json(200, { videos: [pexelsVideo(501, 20, [[1080, 1920, "hd"]], "ancient-ruins-in-the-jungle")] });
    if (c.url.startsWith("https://api.pexels.com/v1/search")) return json(200, { photos: [{ ...pexelsPhoto(77), alt: "Model of an ancient city" }] });
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { query: { pages: [commonsPage(301, 1, "Model of Tenochtitlan, Museo Nacional de Antropología")] } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null;
  });
  const topicQueries = [...Q12B.slice(0, 3), "Tenochtitlan model", ...Q12B.slice(4)];
  const r2 = await findVisual(scene({ id: "s4", visualQuery: "Tenochtitlan model" }), { ...ctxFor(publicDir), topicQueries }, { fetch: fn2, env: { VISUALS: "pexels,wikimedia", PEXELS_API_KEY: "k" }, log, cacheDir });
  assert.equal(r2.credit?.provider, "Wikimedia Commons");
  assert.ok(!calls2.some((c) => c.url.includes("videos.pexels.com") || c.url.includes("images.pexels.com")), "клипы и фото Pexels без «Tenochtitlan» не скачивались");
});

// Ответ Messages API (как его отдаёт api.anthropic.com).
const claudeReply = (text: string, usage = { input_tokens: 1200, output_tokens: 2 }) =>
  json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage });

await test("Судья Claude (VISUALS_JUDGE=claude): выбирает среди прошедших правила, «0» — ни один", async ({ publicDir, cacheDir }) => {
  const pages = [
    commonsPage(601, 1, "Old manuscripts of Indonesia on a desk with a candle", { categories: "Manuscripts of Indonesia" }),
    commonsPage(602, 2, "Medieval manuscript and candle on a desk, Bodleian Library, Oxford", { categories: "Bodleian Library|Manuscripts" }),
  ];
  const answers = ["2", "0"];
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { query: { pages } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    if (c.url === "https://api.anthropic.com/v1/messages") return claudeReply(answers.shift() ?? "0");
    return null;
  });
  const env = { VISUALS: "wikimedia", VISUALS_JUDGE: "claude", ANTHROPIC_API_KEY: "sk-test" };
  const sc = scene({ id: "s3", visualQuery: "old manuscript candle desk", narration: "Сам Оксфорд пишет: преподавание здесь шло уже с тысяча девяносто шестого года.", onScreen: "Учили уже в *1096*" });
  const ctx = { ...ctxFor(publicDir), topicQueries: Q12B, topic: "Оксфорд старше империи ацтеков" };
  const r = await findVisual(sc, ctx, { fetch: fn, env, log, cacheDir });
  assert.ok(r.credit?.url?.includes("File:Medieval_manuscript_and_candle_on_a_desk"), `судья выбрал №2 — про Оксфорд: ${r.credit?.url}`);
  const call = calls.find((c) => c.url === "https://api.anthropic.com/v1/messages")!;
  assert.equal(call.headers["x-api-key"], "sk-test");
  const body = JSON.parse(String(call.body)) as { model: string; max_tokens: number; temperature?: number; system: string; messages: { content: string }[] };
  assert.equal(body.model, "claude-haiku-4-5", "самая дешёвая модель проекта");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 16);
  assert.ok(body.system.includes("Лучше ни одного"));
  const user = body.messages[0]!.content;
  assert.ok(user.includes("Оксфорд старше империи ацтеков") && user.includes("тысяча девяносто шестого") && user.includes("1. Old manuscripts of Indonesia"), user);
  const stats = visualsJudgeStats();
  assert.equal(stats.calls, 1);
  assert.ok(stats.costUsd > 0.001 && stats.costUsd < 0.002, `≈ $0.0012 за вызов: ${stats.costUsd}`);

  // «0» — ни один не подходит: картинки нет.
  const r2 = await findVisual({ ...sc, id: "s9" }, ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  assert.equal(r2.visual.type, "none");
  assert.ok(logs.some((l) => l.includes("судья Claude — ни один")), logs.join("\n"));
});

await test("Судья Claude: без ключа или с неверным ключом — подбор по правилам, без падения", async ({ publicDir, cacheDir }) => {
  const pages = [commonsPage(701, 1, "Hourglass with sand")];
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { query: { pages } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    if (c.url === "https://api.anthropic.com/v1/messages") return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    return null;
  });
  const sc = scene({ id: "s6", visualQuery: "hourglass sand wooden table" });
  const r1 = await findVisual(sc, ctxFor(publicDir), { fetch: fn, env: { VISUALS: "wikimedia", VISUALS_JUDGE: "claude" }, log, cacheDir });
  assert.equal(r1.credit?.provider, "Wikimedia Commons");
  assert.ok(logs.some((l) => l.includes("не задан ANTHROPIC_API_KEY")), logs.join("\n"));
  assert.ok(!calls.some((c) => c.url.includes("anthropic")), "без ключа не ходим");

  resetVisualsState();
  const env = { VISUALS: "wikimedia", VISUALS_JUDGE: "claude", ANTHROPIC_API_KEY: "bad" };
  const r2 = await findVisual({ ...sc, id: "s7" }, ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  const r3 = await findVisual({ ...sc, id: "s8" }, ctxFor(publicDir), { fetch: fn, env, log, cacheDir });
  assert.equal(r2.credit?.provider, "Wikimedia Commons", "401 → лучший по правилам");
  assert.equal(r3.credit?.provider, "Wikimedia Commons");
  assert.equal(calls.filter((c) => c.url.includes("anthropic")).length, 1, "после 401 судью больше не спрашиваем");
  assert.ok(logs.some((l) => l.includes("до конца запуска подбираю по бесплатным правилам")), logs.join("\n"));
});

await test("Судья Claude: ответ модели разбирается строго", () => {
  assert.deepEqual(parseVerdict("2", 3), { kind: "pick", index: 1 });
  assert.deepEqual(parseVerdict("Ответ: 0", 3), { kind: "none" });
  assert.equal(parseVerdict("7", 3), null, "номера нет в списке");
  assert.equal(parseVerdict("не знаю", 3), null);
  assert.deepEqual(judgeConfig({}), { config: null, problem: null }, "по умолчанию выключен");
  assert.equal(judgeConfig({ VISUALS_JUDGE: "claude", ANTHROPIC_API_KEY: "k", VISUALS_JUDGE_MODEL: "claude-haiku-5-5" }).config?.model, "claude-haiku-5-5");
});

await test("Манифест: новая версия правил отбора — старые подборы подбираются заново", () => {
  const sc = scene();
  const key = visualKey(sc, "shorts", {});
  assert.ok(key.includes(`"rules":${PICK_RULES_VERSION}`), key);
  assert.notEqual(visualKey(sc, "shorts", { VISUALS_JUDGE: "claude" }), key, "включили судью — подобрать заново");
  assert.equal(visualKey(sc, "shorts", { VISUALS_JUDGE: "off" }), key);
});

// ---- Ревью: обходы правил и лишние отказы ----

await test("Имя — определение к предмету: «Greenland shark» без акулы не берём, у стоков тоже", () => {
  const lowerQs = ["cat sniffing cake", "dna model laboratory", "tiger walking grass", "sea lion rocks"];
  const vq = (text: string) => visualQuery({ visualQuery: text }, { topicQueries: [...lowerQs, text] });
  const shark = vq("Greenland shark");
  assert.deepEqual([shark.proper, shark.heads], [["greenland"], ["shark"]]);
  // Поиск Commons находит и по описанию — «shark» в описании ледника не спасает.
  const ice = photoFit(shark, { title: "Ilulissat Icefjord, Greenland", description: "Icebergs; a Greenland shark was caught nearby" });
  assert.equal(ice.ok, false, ice.why);
  assert.ok(photoFit(shark, { title: "Somniosus microcephalus (Greenland shark)" }).ok);
  assert.equal(photoFit(vq("Bengal tiger walking"), { title: "Bengal cat lying on a sofa", categories: "Bengal cats" }).ok, false, "бенгальская кошка ≠ тигр");
  assert.ok(photoFit(vq("Bengal tiger walking"), { title: "Bengal tiger walking in Ranthambore" }).ok);
  // Макет по-испански: предмет в категории — годится; только руины — нет.
  const model = vq("Tenochtitlan model");
  assert.ok(photoFit(model, { title: "Maqueta de Tenochtitlan", categories: "Scale models of Tenochtitlan" }).ok);
  assert.equal(photoFit(model, { title: "Templo Mayor ruins, Tenochtitlan", categories: "Templo Mayor" }).ok, false);
  // portrait — вид изображения, а не предмет; аббревиатура (DNA) — сама предмет.
  assert.deepEqual(vq("Edme Mariotte portrait").heads, []);
  assert.ok(photoFit(vq("Edme Mariotte portrait"), { title: "Edme Mariotte" }).ok);
  assert.deepEqual(vq("DNA model laboratory").heads, []);
  // Имя — предмет всего ролика: «Saturn rings» в ролике про Сатурн — сам Сатурн годится.
  const saturnQs = ["Saturn rings close", "saturn planet space", "saturn moon titan", "bathtub water", "saturn cassini"];
  const rings = visualQuery({ visualQuery: "Saturn rings close" }, { topicQueries: saturnQs });
  assert.deepEqual(rings.heads, []);
  assert.ok(photoFit(rings, { title: "Saturn during Equinox", categories: "Photographs of Saturn by Cassini" }).ok);
  // Стоки: имя есть, предмета нет — мимо.
  assert.equal(stockFit(shark, "greenland landscape aerial").ok, false);
  assert.ok(stockFit(shark, "greenland shark swimming under ice").ok);
});

await test("Стоки с ключами: синоним-составное слово проходит, чужой предмет и одно действие — нет", () => {
  const slug = (s: string) => slugText(`https://www.pexels.com/video/${s}-1000001/`);
  const phone = visualQuery({ visualQuery: "hand holding smartphone night" });
  // Раньше «mobile phone» на «smartphone» считался промахом — терялись нужные клипы.
  assert.ok(stockFit(phone, slug("person-using-a-mobile-phone-in-the-dark")).ok);
  assert.ok(stockFit(visualQuery({ visualQuery: "sunlight prism rainbow" }), slug("light-refracting-through-a-glass")).ok);
  assert.ok(stockFit(visualQuery({ visualQuery: "fingers bathtub bubbles" }), slug("bath-with-foam-and-fingers")).ok);
  // Совпало только действие («holding») — это не сюжет сцены.
  assert.equal(stockFit(phone, slug("person-holding-a-cup-of-coffee")).ok, false);
  // Предмет ролика обязателен: в ролике про кошек собака не годится.
  const pet = visualQuery({ visualQuery: "person petting cat" }, { topicQueries: Q10A });
  assert.equal(stockFit(pet, slug("woman-petting-a-dog-on-the-couch")).ok, false);
  assert.ok(stockFit(pet, slug("person-petting-a-ginger-cat")).ok);
  // Одно слово обстановки — ещё не сюжет: Pixabay отдаёт клипы и по одному слову
  // запроса. Небо и океан — по теме, одно небо — нет (синонимы вроде sea/ocean не сводим).
  const sky = visualQuery({ visualQuery: "blue sky ocean horizon" });
  assert.ok(stockFit(sky, slug("blue-sky-over-the-ocean")).ok);
  assert.equal(stockFit(sky, slug("white-clouds-in-blue-sky")).ok, false);
  assert.ok(stockFit(phone, "").ok, "без описания — доверяем поиску стока");
});

// Настоящие подборы Pixabay из прогона CI 10.10 (12a, 11a; новый код, ключ Pixabay): теги — как в
// логе (обрезаны до 100 символов). До правки по одному общему слову брались 8 клипов не по теме из 10.
await test("Стоки: клип по одному общему слову (water, road, hand) — мимо, главный предмет — берём", () => {
  const q12 = ["wrinkled fingertips water bath", "hand soaking water bowl", "old hospital doctor notebook", "fingertip blood vessels macro", "tire tread wet road", "wet hands holding stones", "fingers bathtub bubbles"];
  const q11 = ["rocket launch night", "vintage computer panel buttons", "old circuit board closeup", "hand holding smartphone night", "astronaut spacecraft cockpit", "hands weaving copper wire", "moon surface footprint"];
  const fit = (topic: string[], query: string, tags: string) => stockFit(visualQuery({ visualQuery: query }, { topicQueries: topic }), tags).ok;
  // Мимо: совпало одно слово обстановки или не главный предмет.
  assert.equal(fit(q12, "wrinkled fingertips water bath", "waterfall, rocks, landscape, nature, flowing water, falls, swimming hole, pool, water, scenery, pict"), false);
  assert.equal(fit(q12, "tire tread wet road", "rainy, rain, night, summer, colorful, reflection, wet, weather, road, puddles, street, couple, live "), false);
  assert.equal(fit(q11, "vintage computer panel buttons", "stereo, tuner, music, technology, sound, radio, audio, equipment, entertainment, volume, button, dia"), false);
  assert.equal(fit(q11, "hand holding smartphone night", "sunflower, flower, hand, nature, yellow, summer, field, holding, beauty, floral, plant, bloom, close"), false);
  assert.equal(fit(q11, "hands weaving copper wire", "sand, hand, beach, dessert, sea, live wallpaper"), false);
  // По теме — остаются.
  assert.ok(fit(q12, "hand soaking water bowl", "washing hands, coronavirus, stop the spread, covid 19, water, hands, female, hygiene, cleanliness, t"));
  assert.ok(fit(q12, "old hospital doctor notebook", "female doctor, hospital, doctor, nurse, clinic, female, medical, healthcare, health, woman, patient"));
  assert.ok(fit(q11, "rocket launch night", "rocket, thrusters, nasa, space shuttle, endeavor, atlantis, discovery, space ship, rocket launch, sp"));
  assert.ok(fit(q11, "old circuit board closeup", "mother board, electronic, computer, electronics, loop, board, components, chips, tech, technology, m"));
  // Прогон после правки (38022757599): черепаха с тегом «wrinkled» прошла — причастие сочли
  // главным предметом. Главный — «fingertips»; клип с пальцами по-прежнему берём.
  assert.equal(fit(q12, "wrinkled fingertips water bath", "tortoise, reptile, grass, winks, to wink, folds, wrinkled, nature, old, eye"), false);
  assert.ok(fit(q12, "wrinkled fingertips water bath", "wrinkled fingers, skin, water, hands, close up"));
  // Прогон 38063702244: на «iron helmet artifact» (06a) прошло ущелье Iron Gates — совпал материал.
  // Материал перед предметом — признак: главный здесь «helmet».
  const q06 = ["viking helmet museum", "archaeology excavation site", "iron helmet artifact", "old oil painting", "opera stage theater", "film reel projector", "bronze age artifact"];
  assert.equal(fit(q06, "iron helmet artifact", "iron gates gorge, danube river, romania, dubova, natural scenery, rocky cliffs, lush greenery, windi"), false);
  assert.ok(fit(q06, "iron helmet artifact", "helmet, viking, iron, armor, museum"));
  assert.ok(fit(q06, "film reel projector", "movie projector, animation, reel, film, retro, nostalgia, theater, wheel, roll, motion, vintage, cla"));
  // Материал без предмета следом — сам предмет: «wet hands holding stones» по-прежнему ищет камни.
  assert.ok(fit(q12, "wet hands holding stones", "stones, hands, water, wet"));
});

// Сцены media в рубриках «настоящих фото» оставлены с Commons первым: прогон CI 38063702244
// с видео стока первым дал на 3 таких сцены 2 промаха — человек на поле вместо тигра в траве
// (совпало «grass»), ущелье Железные Ворота вместо шлема викинга (совпало «iron»).
await test("realFirst: сцена media тоже сначала ищет реальные фото", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { query: { pages: [commonsPage(812, 1, "Tiger walking through grass", { width: 3000, height: 4000 })] } });
    if (c.url.startsWith("https://thumb.wikimedia.org/")) return new Response(JPG, { headers: { "content-type": "image/jpeg" } });
    return null;
  });
  const env = { VISUALS: "pixabay,wikimedia", PIXABAY_API_KEY: "k" };
  const r = await findVisual(scene({ id: "s4", kind: "media", visualQuery: "tiger walking grass" }), { ...ctxFor(publicDir), realFirst: true, topicQueries: Q10A }, { fetch: fn, env, log, cacheDir });
  assert.equal(r.credit?.provider, "Wikimedia Commons");
  assert.ok(!calls.some((c) => c.url.startsWith("https://pixabay.com/")), "до стока дело не дошло");
});

await test("Служебные категории Commons и слова-омонимы не отсекают нормальные фото", () => {
  const giza = visualQuery({ visualQuery: "giza pyramid desert" });
  const fields = { title: "Great Pyramid of Giza from the desert", categories: "Great Pyramid of Giza|Pages with maps|Media with locations|Self-published work|CC-BY-SA-4.0" };
  assert.equal(nonPhotoKind(giza, fields), null, "«Pages with maps» — геометка, а не карта");
  assert.ok(photoFit(giza, fields).ok);
  assert.equal(subjectCategories(fields.categories), "Great Pyramid of Giza");
  // Слово «pages» из служебной категории не совпадение для «book pages».
  assert.equal(photoFit(visualQuery({ visualQuery: "old history book pages" }), { title: "Antique cottage", categories: "Pages with maps|Houses in Kent" }).evidence, 0);
  assert.equal(nonPhotoKind(visualQuery({ visualQuery: "rocket launch night" }), { title: "Atlas V 401 rocket launch at night" }), null, "Atlas V — ракета, не атлас");
  assert.match(nonPhotoKind(visualQuery({ visualQuery: "old harbour town" }), { title: "Atlas of the harbours of Europe, 1850" }) ?? "", /карта/);
  assert.equal(nonPhotoKind(visualQuery({ visualQuery: "eye retina examination doctor" }), { title: "Retina scan at an eye doctor" }), null, "медицинский снимок, не скан книги");
  assert.match(nonPhotoKind(visualQuery({ visualQuery: "old desk candle" }), { title: "Book scan of an old desk catalogue" }) ?? "", /скан/);
  // Длинное название-предложение со словом запроса мимоходом — мимо, причём по своему правилу.
  const durian = photoFit(visualQuery({ visualQuery: "hand holding smartphone night" }), {
    title: "DZ3 0627 A night market stall in Sattahip Thailand - vendors weigh durians as a young buyer uses his phone to scan or pay while another customer captures the scene on their smartphone",
  });
  assert.equal(durian.ok, false);
  assert.match(durian.why, /мимоходом/);
  // Название без слов («IMG 4821»), всё в категориях — берём.
  assert.ok(photoFit(visualQuery({ visualQuery: "cat tongue close up" }, { topicQueries: Q10A }), { title: "IMG 4821", categories: "Cat tongues|Tabby cats|Pages with maps" }).ok);
});

await test("Commons: ошибка API видна в логе, пустая выдача тоже; Openverse без запроса сцены не тратит лимит", async ({ publicDir, cacheDir }) => {
  const { fn, calls } = mockFetch((c) => {
    if (c.url.startsWith("https://commons.wikimedia.org/")) return json(200, { error: { code: "badvalue", info: "Unrecognized value for parameter" } });
    return null;
  });
  const r = await findVisual(scene({ id: "s2", visualQuery: "hourglass sand" }), ctxFor(publicDir), { fetch: fn, env: { VISUALS: "wikimedia" }, log, cacheDir });
  assert.equal(r.visual.type, "none");
  assert.ok(logs.some((l) => l.includes("ошибка API badvalue")), logs.join("\n"));
  assert.equal(calls.length, 1, "после ошибки API дальше не спрашиваем");

  resetVisualsState();
  logs.length = 0;
  const { fn: fn2 } = mockFetch((c) => (c.url.startsWith("https://commons.wikimedia.org/") ? json(200, { batchcomplete: true }) : null));
  await findVisual(scene({ id: "s3", visualQuery: "hourglass sand wooden table" }), ctxFor(publicDir), { fetch: fn2, env: { VISUALS: "wikimedia" }, log, cacheDir });
  assert.ok(logs.some((l) => l.includes("ни одного фото от 1080 px")), logs.join("\n"));

  // Сцена без visualQuery: проверять «по теме» не с чем — Openverse не спрашиваем.
  resetVisualsState();
  const { fn: fn3, calls: calls3 } = mockFetch(() => json(200, { results: [] }));
  const r3 = await findVisual(scene({ id: "s4", visualQuery: undefined }), ctxFor(publicDir), { fetch: fn3, env: { VISUALS: "openverse" }, log, cacheDir });
  assert.equal(r3.visual.type, "none");
  assert.equal(calls3.length, 0);
});

await test("Openverse: машинные теги («illustration» с accuracy) не делают фото рисунком", () => {
  const q = visualQuery({ visualQuery: "hourglass sand" });
  const base = { id: "a1", title: "Hourglass with sand", url: "https://live.staticflickr.com/1/a1_b.jpg", creator: "Ann", license: "by", license_version: "2.0", source: "flickr", width: 1600, height: 2400 };
  const deps = { fetch: (() => Promise.reject(new Error("сеть не нужна"))) as never, env: {}, log, cacheDir: tmpRoot, now: Date.now };
  const ctx = ctxFor(tmpRoot);
  const machine = rankOpenverse([{ ...base, tags: [{ name: "hourglass", accuracy: null }, { name: "illustration", accuracy: 0.93 }] }], q, { ctx, deps });
  assert.deepEqual(machine.map((c) => c.id), ["openverse:a1"]);
  const author = rankOpenverse([{ ...base, tags: [{ name: "illustration", accuracy: null }] }], q, { ctx, deps });
  assert.deepEqual(author, [], "тег автора «illustration» — верим");
});

await rm(tmpRoot, { recursive: true, force: true });
console.log(`\nВсе проверки пройдены: ${passed}.`);
