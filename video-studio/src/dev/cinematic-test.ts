// Офлайн-проверка кинорежима (mode "cinematic"): контракт и валидация планов,
// раскладка планов внутри сцены, синхронность звука и субтитров, промпты с
// общим стилем, кэш кадров (манифест) на подменённой сети, слои без текста и
// затемнения, движения камеры без открытых краёв. Внешних API не вызывает.
// Запуск: npx tsx src/dev/cinematic-test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fade } from "@remotion/transitions/fade";
import type { VoiceResult } from "../pipeline/contracts";
import { buildVideoProps } from "../pipeline/props";
import { ScriptValidationError, coerceScriptCandidate, completePromptLints, creepyShot, lintScript, promptSimilarity, storyboardLints, styleLints, validateScript } from "../pipeline/script/validate";
import { resetVisualsState } from "../pipeline/visuals/index";
import { readVisualsManifest, visualKey, writeVisualsManifest, type ManifestEntry } from "../pipeline/visuals/manifest";
import { APPEAL, DEFAULT_STYLE, aiPromptFor, imagePromptFor, styleText } from "../pipeline/visuals/query";
import { capNewFrames, findShotVisuals, resolveReuse, shotId, shotScene, shotVisualKey } from "../pipeline/visuals/shots";
import { cleanBox, parseAnswer, reviewConfig, reviewFrames, type ReviewClient, type ReviewItem } from "../pipeline/visuals/review";
import { sceneCues } from "../remotion/lib/cues";
import { buildFixtureProps, estimateWords } from "../remotion/fixtures/buildFixture";
import { CAMERA_MOVES, FPS, MIN_SHOT_FRAMES, SHOT_LIMITS, findBeat, layoutShots, renderShots, type CameraMove, type RenderScene, type SceneShot, type SceneVisual, type VideoScript } from "../types";
import { cameraState, coversFrame } from "../remotion/lib/camera";
import { specialLayout } from "../remotion/lib/cues";
import { shotLayers } from "../remotion/lib/shots";
import { pickTransition } from "../remotion/lib/transitions";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")) as unknown;
const OLD_FILE = "scripts/sut-30a-murashki-po-kozhe-zachem-oni-nuzhny-cheloveku.json";
const NEW_FILE = "examples/cinematic-30a.json";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  resetVisualsState();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

const problemsOf = (json: unknown): string[] => {
  try {
    validateScript(json);
    return [];
  } catch (e) {
    if (e instanceof ScriptValidationError) return e.problems;
    throw e;
  }
};

// Голос сцен «как у TTS» без звука: длина и тайминги слов — по темпу русской речи.
function fakeVoices(script: VideoScript): VoiceResult[] {
  return script.scenes.map((s) => {
    const { words, durationMs } = estimateWords(s.narration);
    return { file: `voice/${s.id}.wav`, durationMs, words } as VoiceResult;
  });
}

const img = (src: string): SceneVisual => ({ type: "image", src });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const oldScript = validateScript(readJson(OLD_FILE));
const newScript = validateScript(readJson(NEW_FILE));

// ---- Контракт и валидация ----

await test("старый сценарий 30a: проходит проверку как раньше, без режима и планов", () => {
  assert.equal(oldScript.mode, undefined);
  assert.equal(oldScript.style, undefined);
  assert.ok(oldScript.scenes.every((s) => s.shots === undefined));
  assert.ok(!lintScript(oldScript).some((w) => /план|кинорежим/.test(w)), "у старого сценария нет замечаний кинорежима");
});

await test("копия 30a в кинорежиме: режим, стиль и планы сохраняются; в остальном — тот же сценарий", () => {
  assert.equal(newScript.mode, "cinematic");
  assert.equal(newScript.style?.realism, "photorealistic, clean and polished");
  const withShots = newScript.scenes.filter((s) => s.shots?.length);
  assert.equal(withShots.length, newScript.scenes.length - 1, "планы у всех сцен, кроме финала");
  assert.ok(withShots.every((s) => s.shots!.length >= 2), "в каждой сцене несколько планов");
  const stripped = clone(newScript) as VideoScript;
  delete stripped.mode;
  delete stripped.style;
  for (const s of stripped.scenes) delete s.shots;
  assert.deepEqual(stripped, oldScript, "копия отличается от 30a только полями кинорежима");
  const lint = lintScript(newScript);
  assert.ok(!lint.some((w) => /почти одинаковые|не найден|мелькает|одной крупности|media|жутк|мрачн/.test(w)), `лишние замечания: ${lint.join(" | ")}`);
});

await test("валидация: длина плана 1–10 с, только известные движения камеры, промпт по-английски", () => {
  const base = readJson(NEW_FILE) as { scenes: { shots?: Record<string, unknown>[] }[] };
  const variant = (patch: Record<string, unknown>) => {
    const j = clone(base);
    Object.assign(j.scenes[1]!.shots![0]!, patch);
    return problemsOf(j);
  };
  assert.deepEqual(variant({}), []);
  assert.ok(variant({ seconds: 0.4 }).some((p) => p.includes("seconds")), "слишком короткий план");
  assert.ok(variant({ seconds: 12 }).some((p) => p.includes("seconds")), "слишком длинный план");
  assert.ok(variant({ camera: "spin" }).some((p) => p.includes("camera")), "неизвестное движение");
  assert.ok(variant({ framing: "cowboy" }).some((p) => p.includes("framing")), "неизвестная крупность");
  assert.ok(variant({ prompt: "кот в снегу" }).some((p) => /prompt должен быть на английском/.test(p)), "кириллица в промпте");
  for (const camera of CAMERA_MOVES) assert.deepEqual(variant({ camera }), [], camera);
  const many = clone(base);
  many.scenes[1]!.shots = Array.from({ length: 7 }, () => ({ prompt: "a cat" }));
  assert.ok(problemsOf(many).some((p) => p.includes("shots")), "не больше 6 планов на сцену");
});

await test("кинорежим: сцена без планов — ошибка (кроме финала cta)", () => {
  const j = clone(readJson(NEW_FILE)) as { scenes: { kind: string; shots?: unknown }[] };
  delete j.scenes[2]!.shots;
  assert.ok(problemsOf(j).some((p) => /сцена №3.*нужны планы shots/.test(p)));
  const k = clone(readJson(NEW_FILE)) as { scenes: { kind: string; shots?: unknown }[] };
  assert.equal(k.scenes.at(-1)!.kind, "cta");
  assert.equal(k.scenes.at(-1)!.shots, undefined);
  assert.deepEqual(problemsOf(k), []);
});

await test("ответ модели: вольности в планах чинятся, в обычном режиме поля кино убираются", () => {
  const raw = clone(readJson(NEW_FILE)) as Record<string, unknown> & { scenes: { shots?: Record<string, unknown>[] }[] };
  raw.scenes[1]!.shots![0] = { prompt: "a cat", camera: "Zoom In", framing: "Close Up", seconds: "2,5s" };
  const cin = coerceScriptCandidate(clone(raw), { format: "shorts", language: "ru", cinematic: true }) as typeof raw;
  assert.deepEqual(cin.scenes[1]!.shots![0], { prompt: "a cat", camera: "push-in", framing: "close-up", seconds: 2.5 });
  assert.equal(cin.mode, "cinematic");
  const classic = coerceScriptCandidate(clone(raw), { format: "shorts", language: "ru" }) as typeof raw;
  assert.equal(classic.mode, undefined);
  assert.equal(classic.style, undefined);
  assert.ok(classic.scenes.every((s) => s.shots === undefined));
});

await test("замечания: почти одинаковые планы подряд, фраза склейки мимо текста, планы без режима", () => {
  const dup = clone(newScript);
  dup.scenes[2]!.shots = [
    { prompt: "a fluffy cat with puffed fur sitting in snow", framing: "wide" },
    { prompt: "a fluffy cat with puffed fur sitting in the snow", framing: "wide", beat: "совсем другие слова" },
  ];
  const lint = lintScript(dup);
  assert.ok(lint.some((w) => /планы 1 и 2 почти одинаковые/.test(w)), lint.join(" | "));
  assert.ok(lint.some((w) => /beat «совсем другие слова» не найден/.test(w)));
  assert.ok(promptSimilarity("a cat in snow", "a dog on a beach") < 0.2);
  const noMode = clone(newScript);
  delete noMode.mode;
  assert.ok(lintScript(noMode).some((w) => /mode не "cinematic"/.test(w)));
});

await test("жуть заранее: макро кожи, пор и «срезов», испуганные лица и тёмный стиль помечаются; кадры копии 30a — нет", () => {
  // Промпты первой контрольной сборки 30a (10.2026): на видео вышли волдыри, «паук» из поры и грозди пузырей.
  const creepy: Record<string, unknown>[] = [
    { framing: "detail", prompt: "human forearm skin covered in goosebumps, tiny hairs standing upright" },
    { framing: "medium", prompt: "a young woman shivering and hugging herself in a cold dark room" },
    { framing: "close-up", prompt: "microscopic cross-section of human skin with a single hair follicle and a tiny muscle attached to it" },
    { framing: "detail", prompt: "the tiny muscle contracting and pulling the hair upright out of the skin, microscope view" },
    { framing: "close-up", prompt: "luminous stem cells clustered at the base of a hair follicle, fluorescence microscopy" },
    { framing: "detail", prompt: "new hair strands sprouting from human skin, macro" },
  ];
  for (const shot of creepy) assert.ok(creepyShot(shot), `не помечен: ${shot.prompt}`);
  for (const sc of newScript.scenes) for (const shot of sc.shots ?? []) assert.equal(creepyShot(shot as unknown as Record<string, unknown>), null, `зря помечен: ${shot.prompt}`);
  assert.ok(creepyShot({ framing: "wide", prompt: "a spider web in a sunny garden" }) === null, "паутина общим планом — не макро");
  assert.equal(styleLints({ lighting: "low-key lighting with a cold blue rim light", environment: "dark studio interiors and quiet winter nights" }).length, 1);
  assert.deepEqual(styleLints(newScript.style), []);
  const dark = clone(newScript);
  dark.style = { ...dark.style, lighting: "low-key lighting with a cold blue rim light" };
  dark.scenes[0]!.shots![0] = { framing: "detail", prompt: "human forearm skin covered in goosebumps" };
  const lint = lintScript(dark);
  assert.ok(lint.some((w) => /style мрачный/.test(w)) && lint.some((w) => /сцена s1, план 1: «goosebumps» крупным планом/.test(w)), lint.join(" | "));
});

// ---- Раскладка планов ----

const sceneOf = (durationInFrames: number, words = estimateWords("Под каждым волоском сидит крошечная мышца. Она сокращается и ставит волос дыбом.").words) => ({ durationInFrames, audioStartFrame: 3, words });
const shotsN = (n: number, seconds?: number[]) => Array.from({ length: n }, (_, k) => ({ prompt: `shot ${k}`, seconds: seconds?.[k], visual: img(`v${k}.png`) }));

await test("сумма длин планов — ровно длина сцены; не короче минимума; переход по краям не съедает план", () => {
  for (const total of [60, 97, 150, 211, 400]) {
    for (const n of [1, 2, 3, 4, 6]) {
      const out = layoutShots(shotsN(n, [2, 3, 1.5, 2.5, 2, 3]), sceneOf(total), 12);
      assert.equal(out.reduce((a, s) => a + s.durationInFrames, 0), total, `total=${total} n=${n}`);
      assert.equal(out[0]!.from, 0);
      for (let k = 1; k < out.length; k++) assert.equal(out[k]!.from, out[k - 1]!.from + out[k - 1]!.durationInFrames, "встык, без дыр и наложений");
      if (out.length > 1) {
        assert.ok(out.every((s) => s.durationInFrames >= MIN_SHOT_FRAMES), `минимум ${MIN_SHOT_FRAMES} кадров`);
        assert.ok(out[0]!.durationInFrames >= 12 + MIN_SHOT_FRAMES && out.at(-1)!.durationInFrames >= 12 + MIN_SHOT_FRAMES, "края — с запасом на переход");
      }
    }
  }
  assert.equal(layoutShots(shotsN(6), sceneOf(100), 12).length, 2, "не влезающие планы с конца отбрасываются");
});

await test("склейка по фразе: план начинается на первом слове beat (чуть раньше), иначе — по доле seconds", () => {
  const scene = sceneOf(170);
  const hit = findBeat("Она сокращается", scene.words)!;
  assert.ok(hit);
  const out = layoutShots(
    [
      { prompt: "a", seconds: 2.5, visual: img("a.png") },
      { prompt: "b", seconds: 2.5, beat: "Она сокращается", visual: img("b.png") },
    ],
    scene,
    12,
  );
  assert.equal(out[1]!.from, 3 + Math.floor((hit.startMs / 1000) * FPS) - 2);
  const prop = layoutShots(shotsN(2, [1, 3]), sceneOf(200), 0);
  assert.equal(prop[1]!.from, 50, "без beat — пропорционально seconds (1:3)");
  assert.equal(findBeat("нет такой фразы", scene.words), null);
});

await test("камера: своя — как в сценарии, без неё — по крупности и не два одинаковых движения подряд", () => {
  const out = layoutShots(
    [
      { prompt: "a", framing: "detail", visual: img("a.png") },
      { prompt: "b", framing: "close-up", visual: img("b.png") },
      { prompt: "c", framing: "wide", camera: "tilt-down", visual: img("c.png") },
    ] as (SceneShot & { visual: SceneVisual })[],
    sceneOf(300),
    0,
  );
  assert.deepEqual(out.map((s) => s.camera), ["push-in", "pull-out", "tilt-down"]);
});

// ---- Props: звук и субтитры не сдвигаются ----

await test("кинорежим не меняет тайминг: сцены, голос, субтитры и длина ролика — те же, что без планов", () => {
  const voices = fakeVoices(newScript);
  const shotVisuals = newScript.scenes.map((s) => s.shots?.map((_, k) => ({ visual: img(`visuals/${shotId(s.id, k)}.png`), credit: null })) ?? null);
  const plain = buildVideoProps({ script: oldScript, publicDir: "/tmp/pub", voices, music: null, whooshSrc: null, channelName: "Канал" });
  const cine = buildVideoProps({ script: newScript, publicDir: "/tmp/pub", voices, shotVisuals, music: null, whooshSrc: null, channelName: "Канал" });
  assert.equal(cine.durationInFrames, plain.durationInFrames);
  assert.deepEqual(cine.captions, plain.captions);
  const timing = (p: typeof plain) => p.scenes.map((s) => [s.startFrame, s.durationInFrames, s.audioStartFrame, s.audioSrc]);
  assert.deepEqual(timing(cine), timing(plain));
  for (const s of cine.scenes) {
    if (s.kind === "cta") assert.equal(s.shots, undefined);
    else {
      assert.ok(s.shots && s.shots.length >= 2, `${s.id}: несколько планов`);
      assert.equal(s.shots.reduce((a, x) => a + x.durationInFrames, 0), s.durationInFrames, `${s.id}: планы покрывают сцену`);
    }
  }
  assert.ok(plain.scenes.every((s) => !("shots" in s)), "старый сценарий — props без планов, как раньше");
});

await test("план без кадра выпадает; ни одного кадра — визуал сцены одним планом или обычная сцена", () => {
  const voices = fakeVoices(newScript);
  const s3 = newScript.scenes.findIndex((s) => s.id === "s3");
  const shotVisuals = newScript.scenes.map(() => null as null | { visual: SceneVisual; credit: null }[]);
  shotVisuals[s3] = [{ visual: { type: "none" }, credit: null }, { visual: img("visuals/s3-k2.png"), credit: null }];
  const visuals = newScript.scenes.map((_, i) => ({ visual: i === 1 ? img("visuals/s2.jpg") : ({ type: "none" } as SceneVisual), credit: null }));
  const p = buildVideoProps({ script: newScript, publicDir: "/tmp/pub", voices, visuals, shotVisuals, music: null, whooshSrc: null, channelName: null });
  const sc3 = p.scenes[s3]!;
  assert.equal(sc3.shots?.length, 1);
  assert.equal(sc3.shots![0]!.durationInFrames, sc3.durationInFrames);
  assert.equal(p.scenes[1]!.shots?.[0]?.visual.type, "image", "s2: кадров планов нет — визуал сцены одним планом");
  assert.equal(p.scenes[0]!.shots, undefined, "s1: ни кадров, ни визуала — обычная сцена");
});

// ---- Промпты и общий стиль ----

await test("промпт плана (стиль отдельно): крупность + описание + герой + общий стиль ролика + вертикальная композиция", () => {
  const style = styleText(newScript.style)!;
  for (const part of ["warm uplifting cinematic science documentary still", "photorealistic", "golden-hour sunlight", "warm amber, cream and soft teal color palette", "warm, curious and uplifting mood", APPEAL]) {
    assert.ok(style.includes(part), part);
  }
  // 30a: «setting: дом, снежный парк, лаборатория» в каждом промпте — 4 коллажа из 16; «no text» FLUX читает как «text».
  assert.ok(!style.includes("setting:") && !/\bno\b/.test(style), `в хвосте стиля нет мест и отрицаний: ${style}`);
  const s5 = newScript.scenes.find((s) => s.id === "s5")!;
  const prompts = s5.shots!.map((shot, k) => imagePromptFor(shotScene(s5, shot, k), "shorts", style)!);
  assert.ok(prompts[0]!.startsWith("medium shot: Charles Darwin"), prompts[0]);
  assert.ok(prompts[1]!.includes("extreme close-up detail shot") && prompts[1]!.includes("featuring old notebook"), prompts[1]);
  for (const p of prompts) assert.ok(p.includes("vertical 9:16 composition") && p.endsWith(style), "стиль — в каждом плане");
  assert.equal(styleText(undefined), undefined);
  // Сцена старого сценария: промпт и ключ кэша — как до кинорежима.
  const legacy = oldScript.scenes[0]!;
  assert.ok(imagePromptFor(legacy, "shorts", undefined)!.endsWith(DEFAULT_STYLE));
  const key = JSON.parse(visualKey(legacy, "shorts", { VISUALS: "pexels" })) as Record<string, unknown>;
  assert.equal(key.sst, undefined, "без style сценария ключ манифеста прежний");
});

// ---- Кэш кадров ----

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
function cloudflareMock() {
  const prompts: string[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith("https://api.cloudflare.com/")) throw new Error(`неожиданный запрос: ${url}`);
    const body = init?.body;
    prompts.push(body instanceof FormData ? String(body.get("prompt")) : String(body));
    return new Response(JSON.stringify({ success: true, result: { image: PNG.toString("base64") } }), { headers: { "content-type": "application/json" } });
  };
  return { fn, prompts };
}

await test("кэш: повторный запуск берёт кадры из манифеста; смена стиля или промпта — новый кадр только там, где надо", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "video-studio-cinematic-test-"));
  try {
    const publicDir = path.join(dir, "public");
    const env = { VISUALS: "pexels,cloudflare", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok", PEXELS_API_KEY: "k" };
    const scene = newScript.scenes.find((s) => s.id === "s5")!;
    const run = async (sc: typeof scene, style = newScript.style) => {
      const net = cloudflareMock();
      const prev = readVisualsManifest(publicDir);
      const r = await findShotVisuals({ scene: sc, shots: sc.shots!, format: "shorts", publicDir, sceneIndex: 4, usedIds: new Set(), prev, style }, { env, fetch: net.fn, log: { info: () => {}, warn: () => {} }, cacheDir: path.join(dir, "cache") });
      writeVisualsManifest(publicDir, r.entries as Record<string, ManifestEntry>);
      return { r, net };
    };

    const first = await run(scene);
    assert.equal(first.net.prompts.length, 3, "3 плана — 3 генерации, стоки (pexels) не спрашиваем");
    assert.deepEqual(first.r.results.map((x) => x.visual.type === "image" && x.visual.src), ["visuals/s5-k1.png", "visuals/s5-k2.png", "visuals/s5-k3.png"]);
    assert.ok(first.net.prompts.every((p) => p.includes("photorealistic")), "общий стиль — в запросе к генератору");
    for (const k of [1, 2, 3]) assert.ok(existsSync(path.join(publicDir, "visuals", `s5-k${k}.png`)));

    const again = await run(scene);
    assert.equal(again.net.prompts.length, 0, "повторный запуск — ни одного запроса");
    assert.equal(again.r.reused, 3);

    const edited = clone(scene);
    edited.shots![1]!.prompt = "pen sketches of a hedgehog with raised spines in an old notebook";
    const one = await run(edited);
    assert.equal(one.net.prompts.length, 1, "изменён один план — один новый кадр");
    assert.ok(one.net.prompts[0]!.includes("hedgehog"));

    const restyled = await run(edited, { ...newScript.style, palette: "warm amber and black" });
    assert.equal(restyled.net.prompts.length, 3, "сменился стиль — кадры с прежним стилем не годятся");
    assert.notEqual(
      shotVisualKey(edited, edited.shots![0]!, 0, "shorts", env, styleText(newScript.style)),
      shotVisualKey(edited, edited.shots![0]!, 0, "shorts", env, styleText({ ...newScript.style, palette: "warm amber and black" })),
    );
    const otherFormat = shotVisualKey(edited, edited.shots![0]!, 0, "landscape", env, styleText(newScript.style));
    assert.notEqual(otherFormat, shotVisualKey(edited, edited.shots![0]!, 0, "shorts", env, styleText(newScript.style)), "формат — в ключе");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("без генераторов в VISUALS кадров планов нет и запросов нет (сцена найдёт визуал обычным путём)", async () => {
  const scene = newScript.scenes[1]!;
  const calls: string[] = [];
  const r = await findShotVisuals(
    { scene, shots: scene.shots!, format: "shorts", publicDir: path.join(os.tmpdir(), "vs-none"), sceneIndex: 1, usedIds: new Set(), prev: {}, style: newScript.style },
    { env: { VISUALS: "pexels", PEXELS_API_KEY: "k" }, fetch: async (u) => (calls.push(String(u)), new Response("{}")), log: { info: () => {}, warn: () => {} } },
  );
  assert.equal(calls.length, 0);
  assert.ok(r.results.every((x) => x.visual.type === "none"));
});


// ---- Полные промпты (сценарий кинорежима от 10.2026) ----

const FULL = "Major Meredith, a tall man in his forties with a neat brown moustache, khaki uniform and slouch hat, frowns at a jammed Lewis machine gun on a tripod in a dry golden wheat field in Western Australia, late afternoon sun, 35mm film photograph, 35mm lens, medium shot, the major and the gun fill the upper two thirds of the vertical frame, calm wheat in the lower third.";

await test("полный промпт: в генератор как есть — без стиля, крупности и героя; режим ставит coerce", () => {
  const raw = clone(readJson(NEW_FILE)) as Record<string, unknown> & { scenes: { shots?: Record<string, unknown>[] }[] };
  const cin = coerceScriptCandidate(clone(raw), { format: "shorts", language: "ru", cinematic: true }) as Record<string, unknown>;
  assert.equal(cin.shotPrompts, "complete");
  const classic = coerceScriptCandidate({ ...clone(raw), shotPrompts: "complete" }, { format: "shorts", language: "ru" }) as Record<string, unknown>;
  assert.equal(classic.shotPrompts, undefined, "обычный режим — поле убирается");
  const scene = { ...newScript.scenes[1]!, shots: [{ prompt: FULL, framing: "medium" as const, subject: "Major Meredith" }] };
  const ps = shotScene(scene, scene.shots[0]!, 0, true);
  assert.equal(ps.imagePrompt, FULL, "ни крупности, ни героя код не дописывает");
  assert.equal(aiPromptFor(ps, { format: "shorts", style: "SHOULD NOT APPEAR", rawPrompt: true }, {}), FULL);
  const key = JSON.parse(shotVisualKey(scene, scene.shots[0]!, 0, "shorts", { VISUALS: "cloudflare" }, "style", { complete: true })) as { p: string };
  assert.equal(key.p, FULL, "ключ кэша — по итоговому промпту");
  const keyR1 = shotVisualKey(scene, scene.shots[0]!, 0, "shorts", { VISUALS: "cloudflare" }, undefined, { complete: true, salt: "r1" });
  assert.notEqual(keyR1, shotVisualKey(scene, scene.shots[0]!, 0, "shorts", { VISUALS: "cloudflare" }, undefined, { complete: true }), "повтор кадра — свой ключ");
});

await test("проверки полного промпта: короткий, отрицание, коллаж, надписи; повтор кадра не проверяется", () => {
  assert.deepEqual(completePromptLints({ prompt: FULL }, "p"), []);
  const one = (prompt: string) => completePromptLints({ prompt }, "p").join(" | ");
  assert.match(one("a cat on a fence"), /промпт \d+ слов/);
  assert.match(one(`${FULL} No text, without people.`), /отрицание «No»/);
  assert.match(one(`${FULL} Split screen with the farm.`), /коллаж/);
  assert.match(one(`${FULL} A sign with text above the gate.`), /надписи/);
  assert.deepEqual(completePromptLints({ prompt: "slow push-in on the gun", reuse: "s2-k1" }, "p"), [], "у повтора кадра prompt — одна фраза");
});

await test("раскадровка: бюджет новых картинок и повторы только на более ранний план", () => {
  const sc = (id: string, shots: Record<string, unknown>[]) => ({ id, kind: "media", narration: "x", onScreen: "x", shots });
  const ok = [sc("s1", [{ prompt: FULL }]), sc("s2", [{ prompt: FULL }, { prompt: "push-in", reuse: "s1-k1" }])];
  assert.deepEqual(storyboardLints(ok), []);
  assert.match(storyboardLints([sc("s1", [{ prompt: FULL, reuse: "s2-k1" }])]).join(), /более раннего плана/);
  const many = Array.from({ length: SHOT_LIMITS.newFrames + 1 }, (_, i) => sc(`s${i + 1}`, [{ prompt: FULL }]));
  assert.match(storyboardLints(many).join(), /бюджет ролика/);
});

await test("coerce плана: reuse «S2 K1» → s2-k1, подписи — не больше двух и без пустых, цифра из строки", () => {
  const raw = clone(readJson(NEW_FILE)) as { scenes: { shots?: Record<string, unknown>[] }[] };
  raw.scenes[2]!.shots![0] = {
    prompt: FULL,
    reuse: "S2 K1",
    callouts: [{ label: " пулемёт ", target: "the gun" }, { label: "", target: "x" }, { label: "майор", target: "the major", beat: "Майор" }, { label: "три", target: "y" }],
    sticker: "1932",
  };
  const cin = coerceScriptCandidate(raw, { format: "shorts", language: "ru", cinematic: true }) as { scenes: { shots: SceneShot[] }[] };
  const sh = cin.scenes[2]!.shots[0]!;
  assert.equal(sh.reuse, "s2-k1");
  assert.deepEqual(sh.callouts, [{ label: "пулемёт", target: "the gun" }, { label: "майор", target: "the major", beat: "Майор" }]);
  assert.deepEqual(sh.sticker, { text: "1932" });
});

await test("бюджет кадров и повторы: лишние планы повторяют прошлый кадр сцены, повтор берёт картинку по id", () => {
  const scenes = [
    { id: "s1", shots: [{ prompt: "a" }, { prompt: "b" }] as SceneShot[] },
    { id: "s2", shots: [{ prompt: "c" }, { prompt: "d" }, { prompt: "e", reuse: "s1-k2" }] as SceneShot[] },
  ];
  const capped = capNewFrames(scenes, 3);
  assert.equal(capped.capped, 1);
  assert.equal(capped.scenes[1]!.shots![1]!.reuse, "s2-k1", "4-я новая картинка — повтор кадра своей сцены");
  const res = resolveReuse(capped.scenes, [["A", "B"], ["C", "", ""]], (r: string) => r === "");
  assert.deepEqual(res, [["A", "B"], ["C", "C", "B"]]);
});

await test("подписи и цифра: появляются на словах beat, без рамки проверки подписи нет, цифра уходит вниз от героя", () => {
  const words = [
    { text: "Майор", startMs: 0, endMs: 400 },
    { text: "взял", startMs: 400, endMs: 700 },
    { text: "пулемёт", startMs: 700, endMs: 1300 },
    { text: "в", startMs: 1300, endMs: 1400 },
    { text: "тысяча", startMs: 1400, endMs: 1900 },
  ];
  const scene = { durationInFrames: 120, audioStartFrame: 3, words, visual: { type: "none" } as SceneVisual };
  const shots: SceneShot[] = [{ prompt: FULL, callouts: [{ label: "пулемёт Льюиса", target: "the gun", beat: "пулемёт" }, { label: "майор", target: "the major" }], sticker: { text: "1932", beat: "тысяча" } }];
  const box = { x: 0.5, y: 0.3, w: 0.2, h: 0.1 };
  const out = renderShots(scene, shots, [img("k.png")], 0, [{ subject: { x: 0.3, y: 0.1, w: 0.4, h: 0.5 }, boxes: { "the gun": box } }])!;
  const m = out[0]!.marks!;
  assert.equal(m.callouts.length, 1, "«майор» без рамки проверки — без подписи");
  assert.deepEqual(m.callouts[0], { label: "пулемёт Льюиса", box, at: 3 + Math.floor(0.7 * FPS) });
  assert.equal(m.sticker?.text, "1932");
  assert.equal(m.sticker?.at, 3 + Math.floor(1.4 * FPS));
  assert.equal(m.sticker?.place, "middle", "герой в верхней трети — цифра ниже");
  const bare = renderShots(scene, [{ prompt: FULL }], [img("k.png")], 0)!;
  assert.equal(bare[0]!.marks, undefined, "без подписей и цифры — без marks");
  const rs = { ...scene, id: "s1", kind: "media" as const, narration: "", onScreen: "", audioSrc: "", audioDurationMs: 0, startFrame: 0, shots: out } as RenderScene;
  const cues = sceneCues(rs, FPS);
  assert.deepEqual(cues.pops, [m.callouts[0]!.at + 6]);
  assert.deepEqual(cues.impacts, [m.sticker!.at]);
});

await test("проверка кадров: разбор ответа, рамки в пределах кадра, кэш вердиктов — второй раз без запроса", async () => {
  // Прогон 37: в Actions незаданная переменная — пустая строка, проверка молча выключалась.
  assert.ok(reviewConfig({ VISUALS_REVIEW: "", ANTHROPIC_API_KEY: "k" }).config, "пусто — проверка включена");
  assert.equal(reviewConfig({ VISUALS_REVIEW: "off", ANTHROPIC_API_KEY: "k" }).config, null);
  assert.equal(reviewConfig({ VISUALS_REVIEW: "", VISUALS_REVIEW_MODEL: "", ANTHROPIC_API_KEY: "k" }).config?.model, "claude-opus-5-5");
  assert.deepEqual(cleanBox({ x: -0.1, y: 0.2, w: 0.5, h: 2 }), { x: 0, y: 0.2, w: 0.5, h: 0.8 });
  assert.equal(cleanBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.3 }), null, "точка — не рамка");
  const dir = await mkdtemp(path.join(os.tmpdir(), "vs-review-"));
  try {
    const file = path.join(dir, "s1-k1.png");
    await (await import("node:fs/promises")).writeFile(file, PNG);
    const items: ReviewItem[] = [{ id: "s1-k1", file, phrase: "Майор взял пулемёт", prompt: FULL, targets: ["the gun"] }];
    const answer = {
      frames: [
        { id: "s1-k1", verdict: "redo", score: 3, problems: ["коллаж из трёх панелей"], fix_prompt: "one single scene", subject_box: { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, callouts: [{ target: "The gun", found: true, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.1 } }] },
      ],
    };
    const v = parseAnswer(`вот: ${JSON.stringify(answer)}`, items).get("s1-k1")!;
    assert.equal(v.ok, false);
    assert.equal(v.fixPrompt, "one single scene");
    assert.deepEqual(v.boxes, { "the gun": { x: 0.4, y: 0.3, w: 0.2, h: 0.1 } }, "имя предмета — как в сценарии");
    let calls = 0;
    const client: ReviewClient = {
      beta: {
        messages: {
          stream: (body) => {
            calls++;
            const content = body.messages[0]!.content as { type: string }[];
            assert.equal(content.filter((b) => b.type === "image").length, 1);
            return { finalMessage: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 2000, output_tokens: 300 } }) as never };
          },
        },
      },
    };
    const env = { VISUALS_AI_CACHE_DIR: path.join(dir, "cache") };
    const cfg = { model: "claude-opus-5-5", apiKey: "k", timeoutMs: 1000 };
    const shrink = async () => Buffer.from("jpeg");
    const first = await reviewFrames(items, { topic: "Эму-война" }, cfg, env, client, shrink);
    assert.equal(calls, 1);
    assert.ok(first.costUsd > 0);
    assert.equal(first.verdicts.get("s1-k1")?.score, 3);
    const again = await reviewFrames(items, { topic: "Эму-война" }, cfg, env, client, shrink);
    assert.equal(calls, 1, "тот же кадр и то же задание — вердикт из кэша");
    assert.equal(again.cached, 1);
    assert.equal(again.costUsd, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("общий кэш AI-кадров: тот же промпт и seed — без второго запроса к Cloudflare, даже в другой папке ролика", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vs-aicache-"));
  try {
    const env = { VISUALS: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok", VISUALS_AI_CACHE_DIR: path.join(dir, "ai") };
    const scene = { ...newScript.scenes[1]!, shots: [{ prompt: FULL }] };
    const run = async (folder: string) => {
      const net = cloudflareMock();
      const r = await findShotVisuals({ scene, shots: scene.shots, format: "shorts", publicDir: path.join(dir, folder), sceneIndex: 1, usedIds: new Set(), prev: {}, complete: true }, { env, fetch: net.fn, log: { info: () => {}, warn: () => {} } });
      return { r, net };
    };
    const a = await run("one");
    assert.equal(a.net.prompts.length, 1);
    assert.equal(a.net.prompts[0], FULL, "в генератор — полный промпт как есть");
    const b = await run("two");
    assert.equal(b.net.prompts.length, 0, "другая папка ролика (как чистый раннер Actions) — кадр из кэша");
    assert.equal(b.r.results[0]!.visual.type, "image");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Композиция: слои, переходы, камера ----

const cineProps = buildFixtureProps(newScript, { shotVisual: (id, k) => img(`visuals/${shotId(id, k)}.png`) });

await test("сцена кинорежима — только кадры планов: без затемнения, без текста, встык на всю сцену", () => {
  for (const s of cineProps.scenes.filter((x) => x.shots?.length)) {
    const layers = shotLayers(s);
    assert.ok(layers.every((l) => l.dim === "none" && l.visual.type === "image"));
    assert.ok(layers.every((l) => !("text" in l) && !("onScreen" in l)), "в слоях нет текста");
    assert.equal(layers.at(-1)!.from + layers.at(-1)!.durationInFrames, s.durationInFrames);
    assert.equal(specialLayout({ ...s, map: { lat: 0, lon: 0, label: "x" } }), null, "карта не подменяет кинокадр");
  }
});

await test("переход между сценами кинорежима — наплыв кадра на кадр (fade), обычный режим — как раньше", () => {
  const [a, b] = cineProps.scenes as RenderScene[];
  const size = { width: 1080, height: 1920 };
  assert.equal(pickTransition(a!, b!, 1, size).component, fade().component);
  const plain = buildFixtureProps(oldScript).scenes;
  assert.notEqual(pickTransition(plain[0]!, plain[1]!, 1, size).component, fade().component);
});

await test("камера: ни одно движение не открывает края кадра (Shorts и 16:9) и масштаб меняется плавно", () => {
  for (const [w, h] of [[1080, 1920], [1920, 1080]] as const) {
    for (const move of CAMERA_MOVES as CameraMove[]) {
      let prevScale: number | null = null;
      const frames = 90;
      for (let f = 0; f <= frames; f++) {
        const st = cameraState(move, f / frames, (f / FPS) * 7.3, `seed-${move}`);
        assert.ok(coversFrame(st, w, h), `${move} ${w}×${h}: край на кадре ${f}`);
        if (prevScale !== null) assert.ok(Math.abs(st.scale - prevScale) < 0.004, `${move}: скачок масштаба на кадре ${f}`);
        prevScale = st.scale;
      }
    }
  }
  const moving = (m: CameraMove) => cameraState(m, 0, 0, "s").scale !== cameraState(m, 1, 0, "s").scale || cameraState(m, 0, 0, "s").x !== cameraState(m, 1, 0, "s").x || cameraState(m, 0, 0, "s").y !== cameraState(m, 1, 0, "s").y;
  for (const m of ["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "tilt-down"] as CameraMove[]) assert.ok(moving(m), `${m} двигается`);
  assert.ok(!coversFrame({ scale: 1.02, x: 0.05, y: 0, rotate: 0 }, 1080, 1920), "проверка ловит открытый край");
});

console.log(`\nКинорежим: все проверки пройдены (${passed}).`);
