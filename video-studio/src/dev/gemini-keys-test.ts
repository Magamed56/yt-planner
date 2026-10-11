// Офлайн-проверка второго ключа Gemini TTS (GEMINI_API_KEY_2) на подменённом fetch:
// порядок попыток «модель за моделью, внутри — ключ 1, затем ключ 2», переход на второй
// ключ только при 429, 401/403 выключает свой ключ, «липкая» пара (модель, ключ), без
// второго ключа — как раньше, и сам ключ нигде: ни в логе, ни в ошибках, ни в кэше,
// ни в qc.json/usage.jsonl (там — только номер). Сеть и ключи не нужны.
// Запуск: npx tsx src/dev/gemini-keys-test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VoiceResult } from "../pipeline/contracts";
import { encodeWav16, type PcmAudio } from "../pipeline/audio/wav";
import { ttsUsageRecord } from "../pipeline/script/usage-log";
import { describeVoice, voiceFailureSummary, voiceUsed } from "../pipeline/voice/fallback";
import { TtsError } from "../pipeline/voice/http";
import { wrapProvider, type RawAudio } from "../pipeline/voice/provider";
import { geminiKeyCount, geminiProvider } from "../pipeline/voice/providers/gemini";
import { spokenWeight } from "../pipeline/voice/split";

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

// Длиной как настоящие ключи AI Studio (39 символов) — поиск утечки честный; но не «AIza…»,
// чтобы поиск секретов GitHub не принял тест за утёкший ключ.
const K1 = "fake-gemini-key-one-0000000000000000001";
const K2 = "fake-gemini-key-two-0000000000000000002";
const MAIN = "gemini-3.8-flash-tts";
const LITE = "gemini-3.8-flash-lite-tts";
const LEGACY = "gemini-3.1-flash-tts-preview";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-keys-test-"));
let dirN = 0;
const freshDir = () => path.join(tmp, `run-${++dirN}`);

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// По «гудку» на абзац с паузой между ними — split.ts режет общий звук на сцены.
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

type Reply = "ok" | "day" | "minute" | 400 | 401 | 403 | 404 | 500 | "leak";
interface Seen {
  model: string;
  key: 1 | 2 | 0; // 0 — чужой ключ (такого быть не должно)
}

// «Google» без сети: ответ по (модели, номеру ключа); всё увиденное — в seen.
function fakeGoogle(reply: (model: string, key: 1 | 2 | 0, n: number) => Reply) {
  const seen: Seen[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith("https://generativelanguage.googleapis.com/v1beta/"), `запрос только к Gemini: ${url}`);
    assert.ok(!url.includes(K1) && !url.includes(K2), "ключ не в адресе");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const apiKey = headers["x-goog-api-key"];
    const key = apiKey === K1 ? 1 : apiKey === K2 ? 2 : 0;
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string; input?: { text?: string }[]; contents?: { parts?: { text?: string }[] }[] };
    const legacy = /\/models\/([^:]+):generateContent$/.exec(url)?.[1];
    const model = body.model ?? legacy ?? "?";
    seen.push({ model, key });
    const r = reply(model, key, seen.length);
    if (r === "ok") {
      const text = body.input?.[0]?.text ?? body.contents?.[0]?.parts?.[0]?.text?.split("\n").slice(1).join("\n") ?? "";
      const b64 = encodeWav16(speechLike(text.split("\n\n"))).toString("base64");
      const json = legacy
        ? { candidates: [{ content: { parts: [{ inlineData: { data: b64, mimeType: "audio/wav" } }] } }] }
        : { steps: [{ type: "model_output", content: [{ type: "audio", data: b64, mime_type: "audio/wav" }] }] };
      return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const status = r === "day" || r === "minute" ? 429 : r === "leak" ? 400 : r;
    const details =
      r === "day"
        ? [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }]
        : r === "minute"
          ? [
              { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0s" },
            ]
          : [];
    // «leak» — худший случай: сервис повторил ключ в тексте ошибки.
    const message =
      r === "leak" ? `API key ${apiKey} not valid for ${model}.` : status === 429 ? "You exceeded your current quota." : status === 404 ? "model not found" : status === 500 ? "Internal error" : "API key not valid. Please pass a valid API key.";
    return new Response(JSON.stringify({ error: { code: status, message, details } }), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, seen };
}

// Всё, что ушло в консоль за время проверки, — и для проверки текстов, и для поиска ключа.
const allLogs: string[] = [];
let logs: string[] = []; // только текущей проверки (withGoogle)
const realFetch = globalThis.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
function capture() {
  const grab = (...a: unknown[]) => {
    const line = a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(" ");
    logs.push(line);
    allLogs.push(line);
  };
  console.warn = grab;
  console.error = grab;
}
function release() {
  console.warn = realConsole.warn;
  console.error = realConsole.error;
}

// Всё, что могло бы унести ключ наружу: сообщения, стек и cause ошибок, результаты.
const exposed: string[] = [];
function errorText(e: unknown, depth = 0): string {
  if (!(e instanceof Error)) return String(e);
  return `${e.message}\n${e.stack ?? ""}\n${depth < 5 && e.cause !== undefined ? errorText(e.cause, depth + 1) : ""}`;
}
const noAudio = (r: RawAudio | VoiceResult) => JSON.stringify(r, (k, v) => (k === "audio" || k === "bytes" ? undefined : v));

async function withGoogle(env: Record<string, string | undefined>, reply: Parameters<typeof fakeGoogle>[0], fn: (g: ReturnType<typeof fakeGoogle>) => Promise<void>) {
  const g = fakeGoogle(reply);
  setEnv({ GEMINI_API_KEY: undefined, GEMINI_API_KEY_2: undefined, GOOGLE_API_KEY: undefined, ...env });
  globalThis.fetch = g.fn;
  logs = [];
  capture();
  try {
    await fn(g);
  } finally {
    globalThis.fetch = realFetch;
    release();
  }
}

const ctx = { voice: "Charon", rate: 1 };
const pairs = (seen: Seen[]) => seen.map((s) => `${s.model}#${s.key}`);
async function fail(p: Promise<unknown>): Promise<TtsError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  assert.ok(e instanceof TtsError, `ожидалась ошибка озвучки, а не ${String(e)}`);
  exposed.push(errorText(e));
  return e;
}

async function main() {
  // .env не читаем: окружение задают сами проверки.
  setEnv({
    GEMINI_TTS_MODEL: undefined,
    GEMINI_TTS_STYLE: undefined,
    GEMINI_TTS_VOICE: undefined,
    GEMINI_TTS_BATCH_CHARS: undefined,
    TTS_LANGUAGE: undefined,
    TTS_TIMEOUT_MS: undefined,
    TTS_VOICE: undefined,
    TTS_RATE: undefined,
    TTS_CACHE: undefined,
    TTS_CACHE_DIR: path.join(tmp, "shared"),
    CAPTION_ALIGN: "0", // выравнивание по речи полезло бы за моделью в сеть
  });

  console.log("Gemini TTS: второй ключ");

  await test("без второго ключа — как раньше: основная → lite, в логе и ошибках нет «ключ N», в результате нет keyIndex", async () => {
    await withGoogle({ GEMINI_API_KEY: K1 }, (m) => (m === MAIN ? "day" : "ok"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      exposed.push(noAudio(a));
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${LITE}#1`]);
      assert.equal(a.fallback, LITE);
      assert.ok(!("keyIndex" in a), "без второго ключа номер не пишется");
      assert.equal(logs.length, 1);
      assert.match(logs[0]!, new RegExp(`^\\[озвучка\\] Gemini TTS \\(${MAIN}\\): HTTP 429 .* Пробую следующую модель \\(${LITE}\\) — ею будет озвучен и остаток ролика…$`));
    });
    // Квота у всех моделей: по запросу на модель, наверх — 429 с прежней подписью.
    await withGoogle({ GEMINI_API_KEY: K1 }, (m) => (m === LEGACY ? 404 : "day"), async (g) => {
      const e = await fail(geminiProvider().synthesizeRaw("Тест.", ctx));
      assert.equal(e.status, 429);
      assert.match(e.message, new RegExp(`^Gemini TTS \\(${MAIN}\\): HTTP 429`));
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${LITE}#1`, `${LEGACY}#1`]);
      assert.ok(!logs.join("\n").match(/ключ(ом)? [12]/), logs.join("\n"));
    });
    // Неверный единственный ключ — сразу прежняя ошибка, другие модели не пробуем.
    await withGoogle({ GEMINI_API_KEY: K1 }, () => 401, async (g) => {
      const e = await fail(geminiProvider().synthesizeRaw("Тест.", ctx));
      assert.equal(e.status, 401);
      assert.equal(g.seen.length, 1);
    });
    // Второй ключ, совпадающий с первым (или пустой), — тот же проект: как с одним ключом.
    assert.equal(geminiKeyCount({ GEMINI_API_KEY: K1 }), 1);
    assert.equal(geminiKeyCount({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: ` ${K1} ` }), 1);
    assert.equal(geminiKeyCount({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: "" }), 1);
    assert.equal(geminiKeyCount({ GOOGLE_API_KEY: K1, GEMINI_API_KEY_2: K2 }), 2);
    assert.equal(geminiKeyCount({ GEMINI_API_KEY_2: K2 }), 0, "второй без основного не используется");
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K1 }, (m) => (m === MAIN ? "day" : "ok"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${LITE}#1`]);
      assert.ok(!("keyIndex" in a));
    });
  });

  await test("429 на ключе 1 → та же основная модель ключом 2; дальше — «липко» с той же пары", async () => {
    let k2Quota = false;
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (m, k) => (k === 1 && m === MAIN ? "day" : k === 2 && k2Quota && m === MAIN ? "day" : "ok"), async (g) => {
      const p = geminiProvider();
      const a = await p.synthesizeRaw("Первая сцена.", ctx);
      exposed.push(noAudio(a));
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`]);
      assert.equal(a.fallback, undefined, "модель та же — не запасная (и в общий кэш попадёт)");
      assert.equal(a.keyIndex, 2);
      assert.deepEqual(logs, [`[озвучка] Gemini: квота ключа 1 исчерпана (${MAIN}) — продолжаю ключом 2 (та же модель)…`]);
      // Следующие сцены и ролики запуска — сразу ключом 2, без лишнего 429 на ключе 1.
      const b = await p.synthesizeRaw("Вторая сцена.", ctx);
      assert.deepEqual(pairs(g.seen.slice(2)), [`${MAIN}#2`]);
      assert.equal(b.keyIndex, 2);
      // Кончилась и квота второго проекта — lite ключом 1, и дальше уже с неё.
      k2Quota = true;
      const c = await p.synthesizeRaw("Третья сцена.", ctx);
      assert.deepEqual(pairs(g.seen.slice(3)), [`${MAIN}#2`, `${LITE}#1`]);
      assert.equal(c.fallback, LITE);
      assert.equal(c.keyIndex, 1);
      const d = await p.synthesizeRaw("Четвёртая сцена.", ctx);
      assert.deepEqual(pairs(g.seen.slice(5)), [`${LITE}#1`]);
      assert.equal(d.fallback, LITE);
    });
  });

  await test("оба ключа без квоты основной → lite ключом 1, затем lite ключом 2, затем старая preview", async () => {
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (m) => (m === MAIN ? "day" : "ok"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`, `${LITE}#1`]);
      assert.equal(a.fallback, LITE);
      assert.equal(a.keyIndex, 1);
      assert.equal(logs.length, 2);
      assert.match(logs[1]!, new RegExp(`^\\[озвучка\\] Gemini TTS \\(${MAIN}, ключ 2\\): HTTP 429 .* Пробую следующую модель \\(${LITE}, ключ 1\\)`));
    });
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (m) => (m === LEGACY ? "ok" : "day"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`, `${LITE}#1`, `${LITE}#2`, `${LEGACY}#1`]);
      assert.equal(a.fallback, LEGACY);
    });
    // Квоты нет нигде — наверх 429 (сводка «квота Gemini закончилась»), по запросу на пару.
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, () => "day", async (g) => {
      const e = await fail(geminiProvider().synthesizeRaw("Тест.", ctx));
      assert.equal(e.status, 429);
      assert.equal(voiceFailureSummary("gemini", e), "квота Gemini закончилась — ролик соберётся при повторе");
      assert.equal(g.seen.length, 6);
    });
  });

  await test("404/5xx — дело в модели: второй ключ той же модели не пробуем", async () => {
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (m) => (m === MAIN ? 404 : "ok"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${LITE}#1`]);
      assert.equal(a.keyIndex, 1);
    });
    // 429 на ключе 1, у ключа 2 модель не отвечает — следующая модель снова с ключа 1.
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (m, k) => (m === MAIN ? (k === 1 ? "day" : 404) : "ok"), async (g) => {
      await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`, `${LITE}#1`]);
    });
  });

  await test("429 «в минуту» — ждём и повторяем ту же пару, ко второму ключу не идём", async () => {
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (_m, _k, n) => (n === 1 ? "minute" : "ok"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#1`]);
      assert.equal(a.keyIndex, 1);
      assert.match(logs[0]!, /лимит запросов в минуту — жду 1 с и повторяю/);
    });
  });

  await test("400 API_KEY_INVALID (так Gemini отвечает на неверный ключ) — ключ пропускается, как при 401", async () => {
    // Неверный ключ 1 — основная модель вторым ключом, а не уход на lite.
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (_m, k) => (k === 1 ? 400 : "ok"), async (g) => {
      const a = await geminiProvider().synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`]);
      assert.equal(a.fallback, undefined);
      assert.equal(a.keyIndex, 2);
      assert.ok(logs.some((l) => l.includes("Ключ 1 пропускаю")), logs.join("\n"));
    });
    // Единственный ключ на 400 — как раньше: дальше по цепочке моделей, затем ошибка.
    await withGoogle({ GEMINI_API_KEY: K1 }, () => 400, async (g) => {
      await assert.rejects(geminiProvider().synthesizeRaw("Тест.", ctx), (e: Error) => /HTTP 400/.test(e.message));
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${LITE}#1`, `${LEGACY}#1`]);
    });
  });

  await test("401 на ключе 2 при рабочем ключе 1 — ключ 2 пропускается дальше, озвучка идёт", async () => {
    let liteQuota = false;
    const reply = (m: string, k: 1 | 2 | 0): Reply => (k === 2 ? 401 : m === MAIN || (liteQuota && m === LITE) ? "day" : "ok");
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, reply, async (g) => {
      const p = geminiProvider();
      const a = await p.synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`, `${LITE}#1`]);
      assert.equal(a.fallback, LITE);
      assert.equal(a.keyIndex, 1);
      const warn = logs.find((l) => l.includes("пропускаю"));
      assert.ok(warn, logs.join("\n"));
      assert.match(warn, new RegExp(`^\\[озвучка\\] Gemini TTS \\(${MAIN}, ключ 2\\): HTTP 401 — ключ API неверный.* Ключ 2 пропускаю \\(проверьте секрет GEMINI_API_KEY_2\\) — продолжаю ключом 1\\.$`));
      // Кончилась квота lite на ключе 1 — отклонённый ключ 2 больше не пробуем, дальше preview ключом 1.
      liteQuota = true;
      const b = await p.synthesizeRaw("Ещё.", ctx);
      assert.deepEqual(pairs(g.seen.slice(3)), [`${LITE}#1`, `${LEGACY}#1`]);
      assert.equal(b.fallback, LEGACY);
    });
    // Неверный ключ 1 — дальше всё вторым, ключ 1 больше не пробуем.
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (_m, k) => (k === 1 ? 403 : "ok"), async (g) => {
      const p = geminiProvider();
      const a = await p.synthesizeRaw("Тест.", ctx);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`]);
      assert.equal(a.keyIndex, 2);
      assert.equal(a.fallback, undefined);
      assert.ok(logs.some((l) => /Ключ 1 пропускаю \(проверьте секрет GEMINI_API_KEY\) — продолжаю ключом 2\./.test(l)), logs.join("\n"));
      await p.synthesizeRaw("Ещё.", ctx);
      assert.deepEqual(pairs(g.seen.slice(2)), [`${MAIN}#2`]);
    });
  });

  await test("оба ключа 401/403 — прежняя ошибка «повтор не поможет»", async () => {
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (_m, k) => (k === 1 ? 401 : 403), async (g) => {
      const e = await fail(geminiProvider().synthesizeRaw("Тест.", ctx));
      assert.equal(e.status, 403);
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`], "другие модели с неверными ключами не пробуем");
      assert.match(voiceFailureSummary("gemini", e), /повтор не поможет: проверьте ключ/);
    });
  });

  await test("ключ, повторённый сервисом в ответе, вырезается из ошибки и лога", async () => {
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, () => "leak", async () => {
      const e = await fail(geminiProvider().synthesizeRaw("Тест.", ctx));
      assert.equal(e.status, 400);
      assert.match(e.message, /API key \*\*\* not valid/);
      assert.equal(e.cause, undefined, "исходную ошибку с ключом не тащим");
    });
    await withGoogle({ GEMINI_API_KEY: K1 }, () => "leak", async () => {
      const e = await fail(geminiProvider().synthesizeRaw("Тест.", ctx));
      assert.match(e.message, /API key \*\*\* not valid/);
    });
  });

  await test("общая обвязка: номер ключа — в результате, qc.json и usage.jsonl; кэш от ключа не зависит", async () => {
    // Ключ не входит в настройки звука: тот же configKey при любом наборе ключей.
    const keyOf = (env: Record<string, string | undefined>) => {
      setEnv({ GEMINI_API_KEY: undefined, GEMINI_API_KEY_2: undefined, ...env });
      return geminiProvider().configKey();
    };
    const base = keyOf({ GEMINI_API_KEY: K1 });
    assert.equal(keyOf({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }), base);
    assert.equal(keyOf({ GEMINI_API_KEY: K2 }), base);
    assert.ok(!base.includes(K1) && !base.includes(K2));

    const texts = ["Кошки не чувствуют сладкое.", "Совсем. У них нет рецептора вкуса."];
    const dir = freshDir();
    let results: VoiceResult[] = [];
    await withGoogle({ GEMINI_API_KEY: K1, GEMINI_API_KEY_2: K2 }, (m, k) => (k === 1 && m === MAIN ? "day" : "ok"), async (g) => {
      const p = wrapProvider(geminiProvider());
      results = await p.synthesizeMany!(texts.map((text, i) => ({ text, outFileBase: path.join(dir, "voice", `s${i + 1}`) })));
      assert.deepEqual(pairs(g.seen), [`${MAIN}#1`, `${MAIN}#2`], "обе сцены — одним запросом ключом 2");
      assert.deepEqual(results.map((r) => r.keyIndex), [2, 2]);
      assert.ok(results.every((r) => !r.fallbackModel));
    });
    for (const r of results) exposed.push(noAudio(r));
    const used = voiceUsed({ requested: "gemini", provider: "gemini", results, model: MAIN, reason: null });
    assert.equal(used.keyIndex, 2);
    assert.equal(used.modelFallback, false);
    assert.equal(describeVoice(used), "gemini · Charon · ключ 2");
    const rec = ttsUsageRecord({ provider: "gemini", model: MAIN, calls: 2, chars: 60, costUsd: 0, keyIndex: 2 }, "08a", {}, "2026-10-11T10:00:00Z");
    assert.equal(rec.keyIndex, 2);
    exposed.push(JSON.stringify(used), JSON.stringify(rec));

    // Звук ключа 2 — тот же голос: новый запуск только с ключом 1 берёт его из общего кэша.
    await withGoogle({ GEMINI_API_KEY: K1 }, () => "ok", async (g) => {
      const again = await wrapProvider(geminiProvider()).synthesizeMany!(texts.map((text, i) => ({ text, outFileBase: path.join(freshDir(), "voice", `s${i + 1}`) })));
      assert.equal(g.seen.length, 0, "без запросов — из общего кэша");
      assert.ok(again.every((r) => r.cached && r.keyIndex === undefined), "у кэша номера ключа нет");
    });

    // С одним ключом — ни в qc.json, ни в usage.jsonl поля нет (файлы как раньше).
    const one = voiceUsed({ requested: "gemini", provider: "gemini", results: [{ file: "x.wav", durationMs: 1, words: [], wordsSource: "aligned", voice: "Charon" }], model: MAIN, reason: null });
    assert.ok(!("keyIndex" in one));
    assert.equal(describeVoice(one), "gemini · Charon");
    const plain = ttsUsageRecord({ provider: "gemini", model: MAIN, calls: 1, chars: 812, costUsd: 0 }, null, {}, "2026-10-09T10:37:08Z");
    assert.equal(
      JSON.stringify(plain),
      '{"at":"2026-10-09T10:37:08Z","kind":"tts","code":null,"provider":"gemini","model":"gemini-3.8-flash-tts","inputTokens":null,"outputTokens":null,"costUsd":0,"calls":1,"chars":812,"runId":null}',
    );
    assert.ok(!("keyIndex" in ttsUsageRecord({ provider: "gemini", model: MAIN, calls: 1, chars: 1, costUsd: 0, keyIndex: 0 }, null, {})));
  });

  await test("ни один ключ не встретился в логах, ошибках, результатах и файлах кэша", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(tmp);
    assert.ok(files.some((f) => f.endsWith(".voice.json")), "кэш папки ролика записан");
    assert.ok(files.some((f) => f.includes(`${path.sep}shared${path.sep}`) && f.endsWith(".json")), "общий кэш записан");
    const everything = [...allLogs, ...exposed, ...files.map((f) => fs.readFileSync(f).toString("latin1"))];
    assert.ok(allLogs.length > 5 && exposed.length > 5, "проверять есть что");
    for (const key of [K1, K2]) {
      const hit = everything.find((s) => s.includes(key));
      assert.equal(hit, undefined, `ключ утёк: ${hit?.slice(0, 200)}`);
    }
  });

  console.log(`\nВсе проверки второго ключа Gemini пройдены: ${passed}.`);
}

main()
  .then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  })
  .catch((e: unknown) => {
    release();
    globalThis.fetch = realFetch;
    console.error(`\nОшибка: ${(e as Error).message}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  });
