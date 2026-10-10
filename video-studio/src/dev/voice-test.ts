// Озвучка. По умолчанию — офлайн-проверки без сети и ключей: общий кэш между запусками
// (чистый раннер Actions не озвучивает тот же текст заново), ключ кэша, запасная модель,
// уборка кэша, запасной голос и сводка «квота Gemini закончилась», Gemini на подменённом fetch.
// С --live — настоящий синтез сцен examples/demo-ru.json провайдером из TTS_PROVIDER.
//
//   npx tsx src/dev/voice-test.ts                                  # офлайн-проверки
//   npx tsx src/dev/voice-test.ts --live                           # edge (нужен интернет)
//   TTS_PROVIDER=piper npx tsx src/dev/voice-test.ts --live        # Piper, офлайн после загрузки модели
//   npx tsx src/dev/voice-test.ts --live examples/demo-ru.json out/voice-test s1 s2 s3 s4
//
// Windows (PowerShell): $env:TTS_PROVIDER="piper"; npx tsx src/dev/voice-test.ts --live

import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VideoScript } from "../types";
import type { VoiceResult } from "../pipeline/contracts";
import type { PcmAudio } from "../pipeline/audio/wav";
import { projectRoot } from "../pipeline/audio/paths";
import { getVoiceProvider } from "../pipeline/voice";
import { describeVoice, failureReason, fallbackDisabled, fallbackProviderNames, isQuotaError, voiceFailureSummary, voiceQcIssues, voiceUsed } from "../pipeline/voice/fallback";
import { TtsError } from "../pipeline/voice/http";
import { wrapProvider, type RawAudio, type RawProvider } from "../pipeline/voice/provider";
import { geminiProvider } from "../pipeline/voice/providers/gemini";
import { pruneShared, readShared, sharedCacheDays, sharedCacheDir, sharedKey, writeShared } from "../pipeline/voice/shared-cache";
import { spokenWeight } from "../pipeline/voice/split";

// ---- офлайн-проверки ----

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
let dirN = 0;
const freshDir = (name = "run") => path.join(tmp, `${name}-${++dirN}`);

// Похожий на речь звук: по «слову-гудку» на сцену (длина — по слогам), между сценами пауза,
// как у Gemini с абзацами, — его режет split.ts.
function speechLike(texts: string[], sr = 24000): PcmAudio {
  const parts: number[] = [];
  const silence = (ms: number) => {
    for (let i = 0; i < (sr * ms) / 1000; i++) parts.push(0);
  };
  silence(200);
  texts.forEach((t, k) => {
    const n = Math.round((sr * spokenWeight(t) * 80) / 1000);
    for (let i = 0; i < n; i++) {
      const x = i / sr;
      parts.push(0.3 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * x)) * (Math.sin(2 * Math.PI * 300 * x) + 0.6 * Math.sin(2 * Math.PI * 1000 * x)));
    }
    silence(k < texts.length - 1 ? 900 : 300);
  });
  return { sampleRate: sr, channels: [Float32Array.from(parts)] };
}

// MP3 из пустых кадров MPEG1 Layer III 128 кбит/с, 44,1 кГц (по 417 байт) — длительность считает duration.ts.
function fakeMp3(frames: number): Uint8Array {
  const out = new Uint8Array(frames * 417);
  for (let f = 0; f < frames; f++) out.set([0xff, 0xfb, 0x90, 0x64], f * 417);
  return out;
}

interface FakeOpts {
  name?: string;
  style?: string;
  batch?: number;
  fallback?: string;
  mp3?: boolean;
  takes?: boolean; // каждый запрос — новый дубль (длиннее прежнего), как живой сервис
}

// «Сервис» без сети: считает запросы и отдаёт синтетический звук.
function fake(o: FakeOpts = {}) {
  const calls: string[] = [];
  const raw: RawProvider = {
    name: o.name ?? "gemini",
    output: o.mp3 ? "mp3" : "wav",
    ...(o.batch ? { batchMaxChars: o.batch } : {}),
    resolveVoice: (v) => v ?? "Charon",
    configKey: () => `fake:${o.style ?? "Энергично"}`,
    async synthesizeRaw(text): Promise<RawAudio> {
      calls.push(text);
      const fb = o.fallback ? { fallback: o.fallback } : {};
      if (o.mp3) return { kind: "mp3", bytes: fakeMp3(80), words: [{ text: text.split(" ")[0]!, startMs: 0, endMs: 300 }], ...fb };
      if (o.takes) return { kind: "pcm", audio: speechLike([text + " а".repeat(calls.length * 5)]), ...fb };
      return { kind: "pcm", audio: speechLike(text.split("\n\n")), ...fb };
    },
  };
  return { provider: wrapProvider(raw), calls };
}

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function offline() {
  // .env не читаем: тесты сами задают окружение.
  setEnv({ TTS_CACHE: undefined, TTS_CACHE_DIR: path.join(tmp, "shared"), TTS_CACHE_DAYS: undefined, TTS_VOICE: undefined, TTS_RATE: undefined, TTS_FALLBACK: undefined });
  const TEXT = "Кошки не чувствуют сладкое. Совсем.";

  console.log("Общий кэш озвучки");

  await test("чистый раннер (новая папка ролика) — сцена из общего кэша, без запроса к сервису", async () => {
    const { provider, calls } = fake();
    const a = await provider.synthesize(TEXT, path.join(freshDir(), "voice", "s1"));
    assert.equal(calls.length, 1);
    assert.ok(!a.cached);
    assert.equal(a.voice, "Charon");
    // Тот же текст, та же модель/стиль/голос — но папки ролика нет (как на новом раннере Actions).
    const b = await provider.synthesize(TEXT, path.join(freshDir(), "voice", "s1"));
    assert.equal(calls.length, 1, "второй запуск не должен ходить в сервис");
    assert.equal(b.cached, true);
    assert.ok(fs.existsSync(b.file), "звук сцены записан в новую папку");
    assert.ok(Math.abs(b.durationMs - a.durationMs) < 5, `длительность та же: ${a.durationMs} и ${b.durationMs}`);
    assert.deepEqual(b.words.map((w) => w.text), a.words.map((w) => w.text));
    // Повтор в той же папке — кэш папки ролика, как раньше.
    const c = await provider.synthesize(TEXT, b.file.replace(/\.wav$/, ""));
    assert.equal(c.cached, true);
    assert.equal(calls.length, 1);
  });

  await test("ключ: другой текст, голос, стиль (модель) или провайдер — озвучка заново", async () => {
    const base = fake();
    await base.provider.synthesize(TEXT + " Ключ.", path.join(freshDir(), "s1"));
    assert.equal(base.calls.length, 1);
    await base.provider.synthesize(TEXT + " Ключ.", path.join(freshDir(), "s1"), { voice: "Puck" });
    assert.equal(base.calls.length, 2, "другой голос");
    await base.provider.synthesize(TEXT + " Ключ, но другой.", path.join(freshDir(), "s1"));
    assert.equal(base.calls.length, 3, "другой текст");
    const styled = fake({ style: "Спокойно" });
    await styled.provider.synthesize(TEXT + " Ключ.", path.join(freshDir(), "s1"));
    assert.equal(styled.calls.length, 1, "другой стиль");
    const edge = fake({ name: "edge" });
    await edge.provider.synthesize(TEXT + " Ключ.", path.join(freshDir(), "s1"));
    assert.equal(edge.calls.length, 1, "другой провайдер");
    // Нормализация текста: лишние пробелы ключ не меняют.
    await base.provider.synthesize(`  ${TEXT}   Ключ. `, path.join(freshDir(), "s1"));
    assert.equal(base.calls.length, 3);
  });

  await test("запасная модель (Gemini lite после квоты) в общий кэш не попадает, результат помечен", async () => {
    const { provider, calls } = fake({ fallback: "gemini-3.8-flash-lite-tts" });
    const a = await provider.synthesize(TEXT + " Запасная.", path.join(freshDir(), "s1"));
    assert.equal(a.fallbackModel, "gemini-3.8-flash-lite-tts");
    await provider.synthesize(TEXT + " Запасная.", path.join(freshDir(), "s1"));
    assert.equal(calls.length, 2, "пересборка переозвучивает основной моделью");
  });

  await test("TTS_CACHE=0 — новый дубль: из кэша не берём, а запись общего кэша заменяется", async () => {
    const { provider, calls } = fake({ takes: true });
    const text = TEXT + " Дубль.";
    const a = await provider.synthesize(text, path.join(freshDir(), "s1"));
    setEnv({ TTS_CACHE: "0" });
    let b: VoiceResult;
    try {
      b = await provider.synthesize(text, path.join(freshDir(), "s1"));
    } finally {
      setEnv({ TTS_CACHE: undefined });
    }
    assert.equal(calls.length, 2, "с TTS_CACHE=0 — запрос к сервису, а не кэш");
    assert.ok(!b.cached);
    assert.ok(b.durationMs > a.durationMs + 100, `новый дубль: ${a.durationMs} → ${b.durationMs} мс`);
    // Следующая пересборка без флага — из кэша, и это новый дубль, а не прежний.
    const c = await provider.synthesize(text, path.join(freshDir(), "s1"));
    assert.equal(calls.length, 2);
    assert.equal(c.cached, true);
    assert.ok(Math.abs(c.durationMs - b.durationMs) < 5, `из кэша — новый дубль: ${c.durationMs} и ${b.durationMs} мс`);
  });

  await test("TTS_CACHE_DIR=none выключает общий кэш; путь по умолчанию — .cache/voice", async () => {
    assert.equal(sharedCacheDir({ TTS_CACHE: "0" }), path.join(projectRoot(), ".cache", "voice"), "TTS_CACHE=0 запрещает только чтение");
    assert.equal(sharedCacheDir({ TTS_CACHE_DIR: "none" }), null);
    assert.equal(sharedCacheDir({}), path.join(projectRoot(), ".cache", "voice"));
    assert.equal(sharedCacheDir({ TTS_CACHE_DIR: "x/y" }), path.resolve("x/y"));
    assert.equal(sharedCacheDays({}), 14);
    assert.equal(sharedCacheDays({ TTS_CACHE_DAYS: "3" }), 3);
    const prev = process.env.TTS_CACHE_DIR;
    setEnv({ TTS_CACHE_DIR: "none" });
    try {
      const { provider, calls } = fake();
      await provider.synthesize(TEXT + " Без кэша.", path.join(freshDir(), "s1"));
      await provider.synthesize(TEXT + " Без кэша.", path.join(freshDir(), "s1"));
      assert.equal(calls.length, 2);
    } finally {
      setEnv({ TTS_CACHE_DIR: prev });
    }
  });

  await test("пакет Gemini: весь ролик одним запросом; правка одной сцены — запрос только по ней", async () => {
    const scenes = ["Первая сцена про кошек и вкус.", "Вторая сцена: рецепторы сладкого сломаны.", "Третья сцена — что они чувствуют вместо."];
    const { provider, calls } = fake({ batch: 2500 });
    assert.ok(provider.synthesizeMany);
    const dirA = freshDir();
    const items = (dir: string, texts: string[]) => texts.map((text, i) => ({ text, outFileBase: path.join(dir, "voice", `s${i + 1}`) }));
    const first = await provider.synthesizeMany!(items(dirA, scenes));
    assert.equal(calls.length, 1, `один запрос на ролик, было: ${calls.length}`);
    assert.equal(first.length, 3);
    assert.ok(first.every((r) => !r.cached && r.voice === "Charon"));
    // Новый раннер, сцена 2 исправлена: 1 и 3 — из общего кэша, запрос — только по второй.
    const edited = [scenes[0]!, "Вторая сцена: ген сладкого вкуса выключен.", scenes[2]!];
    const second = await provider.synthesizeMany!(items(freshDir(), edited));
    assert.equal(calls.length, 2);
    assert.equal(calls[1], edited[1]);
    assert.deepEqual(second.map((r) => Boolean(r.cached)), [true, false, true]);
    // Тот же сценарий ещё раз на чистом раннере — ни одного запроса (как 10a/10b в usage.jsonl).
    await provider.synthesizeMany!(items(freshDir(), edited));
    assert.equal(calls.length, 2);
    // Правка сцен вразбивку (1 и 3, вторая — из кэша) — всё равно один запрос, а не по сцене:
    // иначе кэш тратил бы квоту больше, чем озвучка всего ролика заново.
    const spread = ["Коротко.", edited[1]!, "Третья сцена — что они чувствуют вместо сладкого: умами, соль и горечь."];
    const third = await provider.synthesizeMany!(items(freshDir(), spread));
    assert.equal(calls.length, 3, `один запрос на две сцены вразбивку, было: ${calls.length - 2}`);
    assert.equal(calls[2], `${spread[0]}\n\n${spread[2]}`);
    assert.deepEqual(third.map((r) => Boolean(r.cached)), [false, true, false]);
    assert.ok(third[0]!.durationMs < third[2]!.durationMs, `звук разрезан по своим сценам: ${third[0]!.durationMs} и ${third[2]!.durationMs} мс`);
  });

  await test("MP3 (Edge): сырой звук и тайминги провайдера из общего кэша", async () => {
    const { provider, calls } = fake({ name: "edge", mp3: true });
    const a = await provider.synthesize("Привет, мир.", path.join(freshDir(), "s1"));
    const b = await provider.synthesize("Привет, мир.", path.join(freshDir(), "s1"));
    assert.equal(calls.length, 1);
    assert.ok(b.file.endsWith(".mp3"));
    assert.equal(b.wordsSource, "provider");
    assert.ok(Math.abs(a.durationMs - b.durationMs) < 1);
  });

  await test("битая запись общего кэша — озвучка заново, а не падение", async () => {
    const { provider, calls } = fake();
    const text = TEXT + " Битая.";
    await provider.synthesize(text, path.join(freshDir(), "s1"));
    // Портим звук самой свежей записи — её только что положили.
    const dir = sharedCacheDir()!;
    const newest = fs.readdirSync(dir).filter((n) => n.endsWith(".wav")).sort((x, y) => fs.statSync(path.join(dir, y)).mtimeMs - fs.statSync(path.join(dir, x)).mtimeMs)[0]!;
    fs.writeFileSync(path.join(dir, newest), "не wav");
    const r = await provider.synthesize(text, path.join(freshDir(), "s1"));
    assert.equal(calls.length, 2);
    assert.ok(!r.cached);
  });

  await test("уборка: записи старше срока удаляются вместе со звуком, свежие и чужие временные — остаются", async () => {
    const dir = path.join(tmp, "prune");
    const now = Date.now();
    const pcm: RawAudio = { kind: "pcm", audio: speechLike(["Старая."]) };
    const meta = { provider: "gemini", voice: "Charon", chars: 7 };
    await writeShared(dir, "старая", pcm, meta, new Date(now - 20 * 86_400_000));
    await writeShared(dir, "свежая", pcm, meta, new Date(now - 2 * 86_400_000));
    await writeShared(dir, "запасная", { ...pcm, fallback: "lite" }, meta, new Date(now));
    fs.writeFileSync(path.join(dir, "deadbeef.wav.123-456"), "недописанный звук соседнего процесса");
    fs.writeFileSync(path.join(dir, "битая.json"), "{");
    const removed = await pruneShared(dir, 14, now);
    assert.equal(removed, 2, "старая и битая");
    const fresh = sharedKey("свежая");
    assert.deepEqual(fs.readdirSync(dir).sort(), [`${fresh}.json`, `${fresh}.wav`, "deadbeef.wav.123-456"].sort());
    assert.ok(await readShared(dir, "свежая"));
    assert.equal(await readShared(dir, "старая"), null);
    assert.equal(await readShared(dir, "запасная"), null, "запасная модель не кладётся");
    // Через пару часов недописанный файл — уже мусор.
    await pruneShared(dir, 14, now + 2 * 3_600_000);
    assert.deepEqual(fs.readdirSync(dir).sort(), [`${fresh}.json`, `${fresh}.wav`].sort());
    // Через 13 дней свежая запись ещё жива, через 15 — нет.
    assert.equal(await pruneShared(dir, 14, now + 11 * 86_400_000), 0);
    assert.equal(await pruneShared(dir, 14, now + 13 * 86_400_000), 1);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  console.log("Запасной голос");

  await test("TTS_FALLBACK: по умолчанию gemini → edge, piper; none — без подмены; свой список", () => {
    assert.deepEqual(fallbackProviderNames("gemini", {}), ["edge", "piper"]);
    assert.deepEqual(fallbackProviderNames("edge", {}), ["piper"]);
    assert.deepEqual(fallbackProviderNames("elevenlabs", {}), []);
    assert.deepEqual(fallbackProviderNames("gemini", { TTS_FALLBACK: "none" }), []);
    assert.deepEqual(fallbackProviderNames("gemini", { TTS_FALLBACK: " OFF " }), []);
    assert.deepEqual(fallbackProviderNames("gemini", { TTS_FALLBACK: "piper, gemini" }), ["piper"]);
    assert.equal(fallbackDisabled({ TTS_FALLBACK: "none" }), true);
    assert.equal(fallbackDisabled({ TTS_FALLBACK: "" }), false);
  });

  await test("сводка: «квота Gemini закончилась — ролик соберётся при повторе»; ключ неверный — повтор не поможет", () => {
    const quota = new TtsError("Gemini TTS (gemini-3.8-flash-tts): HTTP 429 — исчерпан лимит запросов.", { status: 429, retryable: true, quotaId: "GenerateRequestsPerDayPerProjectPerModel" });
    assert.equal(isQuotaError(quota), true);
    assert.equal(isQuotaError(new Error("Gemini TTS: HTTP 429 — исчерпан лимит")), true);
    assert.equal(voiceFailureSummary("gemini", quota), "квота Gemini закончилась — ролик соберётся при повторе");
    assert.equal(failureReason("gemini", quota), "квота Gemini закончилась");
    const key = new TtsError("Gemini TTS: HTTP 403 — ключ API неверный.", { status: 403 });
    assert.equal(isQuotaError(key), false);
    assert.match(voiceFailureSummary("gemini", key), /^озвучка Gemini не удалась \(.*403.*\) — повтор не поможет/);
    assert.match(voiceFailureSummary("edge", new TtsError("Edge TTS: нет ответа за 30 с.", { retryable: true })), /ролик соберётся при повторе$/);
  });

  await test("кто озвучил: запасной провайдер, запасная модель, основной — и предупреждение для qc.json", () => {
    const r = (o: Partial<VoiceResult>): VoiceResult => ({ file: "x.wav", durationMs: 1000, words: [], wordsSource: "estimated", ...o });
    const edge = voiceUsed({ requested: "gemini", provider: "edge", results: [r({ voice: "ru-RU-DmitryNeural" })], model: null, reason: "квота Gemini закончилась" });
    assert.deepEqual(edge, { provider: "edge", name: "ru-RU-DmitryNeural", model: null, requested: "gemini", fallback: true, modelFallback: false, reason: "квота Gemini закончилась" });
    assert.equal(describeVoice(edge), "⚠ edge · ru-RU-DmitryNeural — запасной вместо gemini: квота Gemini закончилась");
    const issues = voiceQcIssues(edge);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.id, "voice-fallback");
    assert.equal(issues[0]!.severity, "warn");
    assert.match(issues[0]!.message, /запасным голосом edge \(ru-RU-DmitryNeural\) вместо gemini/);

    const lite = voiceUsed({ requested: "gemini", provider: "gemini", results: [r({ voice: "Charon", cached: true }), r({ voice: "Charon", fallbackModel: "gemini-3.8-flash-lite-tts" })], model: "gemini-3.8-flash-tts", reason: null });
    assert.equal(lite.fallback, false);
    assert.equal(lite.modelFallback, true);
    assert.equal(lite.model, "gemini-3.8-flash-lite-tts");
    assert.match(lite.reason ?? "", /основная модель gemini-3\.8-flash-tts не ответила/);
    assert.deepEqual(voiceQcIssues(lite), []);

    const main = voiceUsed({ requested: "gemini", provider: "gemini", results: [r({ voice: "Charon" })], model: "gemini-3.8-flash-tts", reason: null });
    assert.equal(describeVoice(main), "gemini · Charon");
    assert.equal(main.reason, null);
  });

  await test("Gemini на подменённом fetch: суточная квота у всех моделей → 429 наверх, без лишнего повтора", async () => {
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    const body = (status: number) =>
      JSON.stringify({
        error: {
          code: status,
          message: status === 429 ? "You exceeded your current quota." : "model not found",
          details: status === 429 ? [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] : [],
        },
      });
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const model = String(JSON.parse(String(init?.body ?? "{}")).model ?? "legacy");
      seen.push(model);
      // Основная и lite — квота на сегодня, старая preview — 404 (её сняли).
      const status = model === "legacy" ? 404 : 429;
      return new Response(body(status), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const prevKey = process.env.GEMINI_API_KEY;
    setEnv({ GEMINI_API_KEY: "test-key", GEMINI_TTS_MODEL: undefined });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const p = wrapProvider(geminiProvider());
      const e = await p.synthesize("Тест квоты.", path.join(freshDir(), "s1")).then(
        () => null,
        (err: unknown) => err,
      );
      assert.ok(e instanceof TtsError, "ошибка озвучки");
      assert.equal((e as TtsError).status, 429, "наверх — квота, а не 404 последней модели");
      assert.equal(voiceFailureSummary("gemini", e), "квота Gemini закончилась — ролик соберётся при повторе");
      assert.equal(seen.length, 3, `по запросу на модель, без повтора всей цепочки: ${seen.join(", ")}`);
    } finally {
      globalThis.fetch = realFetch;
      console.warn = warn;
      setEnv({ GEMINI_API_KEY: prevKey });
    }
  });

  console.log(`\nВсе проверки озвучки пройдены: ${passed}.`);
}

// ---- живой синтез (--live) ----

async function live(args: string[]) {
  const { loadEnv } = await import("../cli/common");
  loadEnv();
  const [scriptArg, outArg, ...ids] = args;
  const scriptPath = path.resolve(scriptArg ?? path.join(projectRoot(), "examples", "demo-ru.json"));
  const outDir = path.resolve(outArg ?? path.join(projectRoot(), "out", "voice-test"));
  const wanted = ids.length ? ids : ["s1", "s2", "s3"];
  const script = JSON.parse(await readFile(scriptPath, "utf8")) as VideoScript;
  const provider = getVoiceProvider();
  console.log(`Провайдер: ${provider.name}; сценарий: ${scriptPath}; файлы: ${outDir}`);

  for (const scene of script.scenes.filter((s) => wanted.includes(s.id))) {
    const t0 = Date.now();
    const r = await provider.synthesize(scene.narration, path.join(outDir, scene.id));
    const ms = Date.now() - t0;
    const speech = r.words.length ? `${r.words[0]!.startMs}–${r.words.at(-1)!.endMs} мс` : "—";
    console.log(`\n${scene.id}: ${(r.durationMs / 1000).toFixed(2)} с, слов ${r.words.length} (${r.wordsSource === "provider" ? "тайминги провайдера" : r.wordsSource === "aligned" ? "по распознанной речи" : "оценка по звуку"}), речь ${speech}, синтез ${ms} мс${r.cached ? " (из кэша)" : ""}`);
    console.log(`  ${path.relative(process.cwd(), r.file)}`);
    for (const w of r.words.slice(0, 8)) console.log(`  ${String(w.startMs).padStart(6)} → ${String(w.endMs).padStart(6)}  ${w.text}`);
    if (r.words.length > 8) console.log(`  … ещё ${r.words.length - 8}`);
  }
}

const argv = process.argv.slice(2);
// Офлайн-проверкам выравнивание по речи не нужно: без модели оно полезло бы в сеть
// (оно проверяется в align-test.ts). В --live — как в настоящей сборке.
if (argv[0] !== "--live") process.env.CAPTION_ALIGN ??= "0";
const run = argv[0] === "--live" ? live(argv.slice(1)) : offline();
run
  .then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0); // edge-tts может держать таймеры
  })
  .catch((e: unknown) => {
    console.error(`\nОшибка: ${(e as Error).message}`);
    if (!(e instanceof TtsError) && e instanceof Error && e.stack && argv[0] !== "--live") console.error(e.stack);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  });
