// Офлайн-проверка модуля сценария: generate → parse → validate → repair на
// подменённой сети (fetch) и подменённом клиенте Claude. Ключи и интернет не
// нужны. Запуск: npx tsx src/dev/script-test.ts

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { extractJson, generateScript, lintScript, ScriptValidationError, validateScript } from "../pipeline/script/index";
import { collectSources, type AnthropicLike } from "../pipeline/script/llm/claude";
import { claudeCostUsd, webSearchCostUsd } from "../pipeline/script/pricing";
import { nextPlanPositions, parsePlan, pickPillars, planNotes, refreshPlanStats, scriptCode, sequelTitle, type ContentPlan } from "../pipeline/plan";
import { assignChapters } from "../pipeline/script/chapters";
import { coveredFromScript, coveredPromptBlock, ctaRepeat, findRepeats, indexCovered, loadCovered, ngrams, recentCtas, stems, type CoveredEntry } from "../pipeline/script/covered";
import { QUIZ_ROUNDS_PLANNED, QUIZ_SILENCE_SEC, SHORTS_DEFAULT_SECONDS, buildShortsPrompt, buildSystemPrompt, shortsTargets } from "../pipeline/script/prompt";
import { fetchSuggestions, parseSuggestResponse, searchPhrases, suggestionsFor } from "../pipeline/script/suggest";
import { appendUsage, countPostRequests, llmUsageRecord, ttsUsageRecord, usageNow, type LlmCallInfo } from "../pipeline/script/usage-log";
import { checkTopics, checkUrl, extractUrl, generatePlanItems, similarTitle } from "../pipeline/script/plan-gen";
import { LIMITS } from "../pipeline/script/schema";
import { SHORTS_RULES, WORDS_PER_SECOND, coerceScene, countWords, ctaProblems, titleRepeatsHook, trimCta } from "../pipeline/script/validate";
import { TITLE_MAX, buildYoutubeMeta, chapterTime, youtubeChapters } from "../pipeline/meta";
import { buildFixtureProps } from "../remotion/fixtures/buildFixture";
import { CHAPTER_CARD_FRAMES, FINAL_TAIL_FRAMES, FPS, QUIZ_REVEAL_FRAMES, SCENE_LEAD_FRAMES, SCENE_TAIL_FRAMES, layoutScenes, quizTiming, type ScriptScene, type VideoScript } from "../types";

// Пауза перед повтором при 503 — в тестах без ожидания.
process.env.LLM_BUSY_WAIT_MS = "1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const demo = JSON.parse(readFileSync(path.join(root, "examples", "demo-ru.json"), "utf8")) as VideoScript;

const logs: string[] = [];
const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) };

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  logs.length = 0;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n${logs.map((l) => `      | ${l}`).join("\n")}`);
    throw e;
  }
}

// ---- подменный fetch ----

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Reply = Response | ((call: Call, signal?: AbortSignal | null) => Promise<Response> | Response);

function mockFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    calls.push(call);
    const r = replies.shift();
    if (!r) throw new Error(`неожиданный запрос №${calls.length}: ${call.url}`);
    return typeof r === "function" ? r(call, init?.signal) : r;
  };
  return { fn, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const chat = (content: string, finish = "stop", usage = { prompt_tokens: 4000, completion_tokens: 1500, total_tokens: 6200 }) =>
  json(200, { model: "gemini-test", choices: [{ message: { role: "assistant", content }, finish_reason: finish }], usage });
const msgs = (c: Call) => c.body.messages as { role: string; content: string }[];

// Тот же демо-сценарий, но в «грязном» виде, как его присылают бесплатные модели.
function messyDemo(): string {
  const d = structuredClone(demo) as unknown as Record<string, unknown> & { scenes: Record<string, unknown>[] };
  d.tags = "память, мозг, #учёба, лайфхаки";
  d.scenes.forEach((s, i) => (s.id = String(i + 1)));
  (d.scenes[1].stat as Record<string, unknown>).value = "66%";
  d.scenes[2].kind = "Statement";
  d.scenes[4].kind = "B-Roll";
  d.scenes[5].kind = "transition"; // такого типа нет и синонима нет → ремонт
  d.scenes[6].icon = null;
  d.scenes[3].onScreen = "3 способа **запомнить** надолго";
  const body = JSON.stringify(d, null, 2).replace(/\n(\s*)\}/g, ",\n$1}"); // висячие запятые
  return `<think>Нужен цепляющий хук про кривую забывания…</think>\nВот сценарий:\n\`\`\`json\n${body}\n\`\`\`\nНадеюсь, подойдёт!`;
}

// ---- Claude mock ----

function claudeMessage(content: unknown[], stop: string, usage: Partial<BetaMessage["usage"]> = {}): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: stop === "refusal" ? { type: "refusal", category: "cyber", explanation: null } : null,
    usage: {
      input_tokens: 3000,
      output_tokens: 2000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      iterations: null,
      ...usage,
    },
  } as unknown as BetaMessage;
}

function mockClaude(replies: (BetaMessage | Error)[]) {
  const calls: BetaMessageStreamParams[] = [];
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(body) {
          calls.push(structuredClone(body));
          const r = replies.shift();
          return {
            finalMessage: async () => {
              if (!r) throw new Error("неожиданный запрос к Claude");
              if (r instanceof Error) throw r;
              return r;
            },
          };
        },
      },
    },
  };
  return { client, calls };
}

// ---- синтетика для длинного ролика ----

const VOCAB = "память работает как мышца которую можно тренировать каждый день если понимать простые правила мозга и не спорить с природой а использовать её силу".split(" ");
const words = (n: number, seed = 0) => Array.from({ length: n }, (_, i) => VOCAB[(i + seed) % VOCAB.length]).join(" ") + ".";

function chunkScenes(n: number, opts: { hook?: boolean; cta?: boolean; seed: number }) {
  const kinds = ["statement", "media", "list", "statement", "quote", "media"];
  return Array.from({ length: n }, (_, i) => {
    const kind = opts.hook && i === 0 ? "hook" : opts.cta && i === n - 1 ? "cta" : kinds[i % kinds.length];
    return {
      id: `s${i + 1}`,
      kind,
      narration: kind === "hook" ? "Ты тренируешь память неправильно, и вот почему." : kind === "cta" ? "А как тренируешь память ты?" : words(26, opts.seed + i),
      onScreen: `Мысль номер *${i + 1}*`,
      ...(kind === "list" ? { items: ["Повторяй", "Вспоминай", "Объясняй"] } : {}),
      icon: "brain",
      visualQuery: `brain study scene ${opts.seed + i}`.replace(/\d+/g, (d) => ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][Number(d) % 9]),
      imagePrompt: "cinematic macro shot of glowing neurons",
    };
  });
}

// ===================================================================

console.log("Сценарий: проверка без сети\n");

await test("validateScript принимает examples/demo-ru.json", () => {
  const s = validateScript(demo);
  assert.equal(s.scenes.length, 7);
  assert.equal(s.scenes[0].kind, "hook");
  assert.ok(Array.isArray(lintScript(s)));
});

await test("validateScript перечисляет ВСЕ проблемы по-русски", () => {
  const bad = structuredClone(demo) as unknown as Record<string, unknown> & { scenes: Record<string, unknown>[] };
  bad.scenes[0].kind = "statement";
  bad.scenes[1].stat = undefined;
  bad.scenes[3].items = ["один"];
  bad.scenes[2].onScreen = "*Очень* длинный текст на экране из *девяти* слов точно";
  bad.scenes[4].visualQuery = "календарь время";
  bad.scenes[5].id = "s9";
  bad.scenes[6].kind = "quote";
  bad.scenes.push({ id: "s8", kind: "joke", narration: "", onScreen: "x" });
  try {
    validateScript(bad);
    assert.fail("ожидалась ошибка");
  } catch (e) {
    assert.ok(e instanceof ScriptValidationError);
    const m = e.message;
    for (const part of ['первая сцена должна иметь kind "hook"', 'обязательно поле stat', "от 2 до 4 пунктов", "больше 7 слов", "больше одного акцента", "на английском", 'id должен быть "s6"', 'недопустимое значение "joke"', 'последняя сцена должна иметь kind "cta"', "пустая строка"]) {
      assert.ok(m.includes(part), `нет «${part}» в:\n${m}`);
    }
  }
});

await test("extractJson: think-теги, ```-блок, висячие запятые, текст вокруг", () => {
  assert.deepEqual(extractJson('<think>хм</think>```json\n{"a": [1, 2,],}\n```'), { a: [1, 2] });
  assert.deepEqual(extractJson('Конечно! Вот: {"a": {"b": "x"}, "c": 1} — готово.'), { a: { b: "x" }, c: 1 });
  assert.deepEqual(extractJson('{"t": "строка\nс переводом", }'), { t: "строка\nс переводом" });
  assert.deepEqual(extractJson('рассуждаю…</think>{"ok": true}'), { ok: true });
  assert.deepEqual(extractJson('// комментарий\n{"x": 1 /* и тут */}'), { x: 1 });
  assert.throws(() => extractJson("просто текст без JSON"), /нет JSON/);
  assert.throws(() => extractJson('{"a": [1, 2'), /не разбирается|нет JSON/);
});

await test("Gemini: 429 → следующая модель, 400 → json_object, мусорный JSON → ремонт → успех", async () => {
  const fixed = "```json\n" + JSON.stringify(demo) + "\n```";
  const { fn, calls } = mockFetch([
    json(429, { error: { message: "Resource has been exhausted (e.g. check quota)." } }),
    json(400, { error: { message: "Invalid JSON payload received. Unknown name \"additionalProperties\"" } }),
    chat(messyDemo()),
    chat(fixed, "stop", { prompt_tokens: 5000, completion_tokens: 1400, total_tokens: 6400 }),
  ]);
  const { script, usage } = await generateScript(
    { topic: "Почему мы забываем выученное", format: "shorts" },
    { env: { GEMINI_API_KEY: "test-key", LLM_FALLBACKS: "none" }, fetch: fn, log },
  );
  assert.equal(calls.length, 4);
  assert.ok(calls[0].url.startsWith("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"));
  assert.equal(calls[0].headers.authorization, "Bearer test-key");
  assert.equal(calls[0].body.model, "gemini-3.8-flash");
  assert.equal((calls[0].body.response_format as { type: string }).type, "json_schema");
  assert.equal(calls[0].body.reasoning_effort, "low");
  const schema = (calls[0].body.response_format as { json_schema: { schema: Record<string, unknown> } }).json_schema.schema;
  assert.ok(!JSON.stringify(schema).includes('"pattern"') && !("$schema" in schema), "схема упрощена");
  assert.equal(calls[1].body.model, "gemini-3.5-flash-lite");
  assert.equal((calls[2].body.response_format as { type: string }).type, "json_object");
  assert.equal(calls[2].body.reasoning_effort, "low", "бюджет размышлений не снимается вместе с json_schema");
  assert.ok(msgs(calls[2])[0].content.includes("JSON-схема ответа"), "схема в системном промпте при json_object");
  const repair = msgs(calls[3]);
  assert.equal(repair.length, 4); // system, user, assistant, user(ремонт)
  assert.equal(repair[2].role, "assistant");
  assert.ok(!repair[2].content.includes("<think>"), "мысли в ремонт не отправляются");
  assert.ok(repair[3].content.includes('"transition"'), "в ремонтном запросе есть ошибка про kind");
  assert.deepEqual(script.scenes.map((s) => s.id), ["s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
  assert.equal(script.format, "shorts");
  const flash = usage.find((u) => u.model === "gemini-3.8-flash")!;
  const lite = usage.find((u) => u.model === "gemini-3.5-flash-lite")!;
  assert.equal(flash.attempts, 1);
  assert.equal(flash.inputTokens, 0);
  assert.equal(lite.attempts, 3);
  assert.equal(lite.inputTokens, 9000);
  assert.equal(lite.outputTokens, 2200 + 1400); // мысли из total_tokens учтены
  assert.equal(lite.costUsd, 0);
});

await test("Мягкая нормализация без ремонта: id, '66%', синонимы kind, теги строкой", async () => {
  const d = extractJson(messyDemo()) as { scenes: { kind: string }[] };
  d.scenes[5].kind = "quote"; // убираем единственную неисправимую ошибку
  const { fn, calls } = mockFetch([chat(JSON.stringify(d))]);
  const { script } = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 1, "ремонт не понадобился");
  assert.equal(script.scenes[1].stat?.value, 66);
  assert.equal(script.scenes[2].kind, "statement");
  assert.equal(script.scenes[4].kind, "media");
  assert.equal(script.scenes[3].onScreen, "3 способа *запомнить* надолго");
  assert.deepEqual(script.tags, ["память", "мозг", "учёба", "лайфхаки"]);
});

await test("finish_reason=length → повтор с удвоенным max_tokens", async () => {
  const full = JSON.stringify(demo);
  const { fn, calls } = mockFetch([chat(full.slice(0, 400), "length"), chat(full)]);
  await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.max_tokens, 8192);
  assert.equal(calls[1].body.max_tokens, 16384);
  assert.equal(calls[1].body.model, "gemini-3.8-flash", "та же модель");
});

await test("Таймаут и 503 у всех Gemini → запасной Groq", async () => {
  const hang: Reply = (_c, signal) =>
    new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  // 503 «high demand» — сначала один повтор той же модели, потом следующая.
  const busy = json(503, { error: { message: "overloaded" } });
  const { fn, calls } = mockFetch([hang, busy, busy, json(500, {}), chat(JSON.stringify(demo))]);
  const started = Date.now();
  const { usage } = await generateScript(
    { topic: "Память", format: "shorts" },
    { env: { GEMINI_API_KEY: "k", GROQ_API_KEY: "g", LLM_TIMEOUT_MS: "80" }, fetch: fn, log },
  );
  assert.ok(Date.now() - started < 5000, "не висим");
  assert.ok(logs.some((l) => l.includes("нет ответа за")), "сообщение о таймауте");
  assert.equal(calls.length, 5);
  assert.equal(calls[1].body.model, calls[2].body.model, "503 → повтор той же модели");
  assert.ok(logs.some((l) => l.includes("перегружен (HTTP 503)")), "сообщение о повторе");
  assert.ok(calls[4].url.startsWith("https://api.groq.com/openai/v1/"));
  assert.equal(calls[4].body.model, "qwen/qwen3.8-27b");
  assert.equal(calls[4].body.max_completion_tokens, 4000);
  assert.equal(calls[4].body.reasoning_effort, "none");
  assert.equal(usage.find((u) => u.provider === "groq")?.attempts, 1);
});

await test("401 у Gemini → остальные модели Gemini пропускаются, дальше OpenRouter", async () => {
  const { fn, calls } = mockFetch([json(401, { error: { message: "API key not valid" } }), chat(JSON.stringify(demo))]);
  await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "bad", OPENROUTER_API_KEY: "or" }, fetch: fn, log });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.startsWith("https://openrouter.ai/api/v1/"));
  assert.equal(calls[1].headers["x-openrouter-title"], "video-studio");
  assert.deepEqual((calls[1].body.plugins as { id: string }[])[0], { id: "response-healing" });
});

await test("Нет ни одного ключа → понятная ошибка", async () => {
  await assert.rejects(generateScript({ topic: "Память", format: "shorts" }, { env: {}, fetch: mockFetch([]).fn, log }), /GEMINI_API_KEY/);
});

await test("Claude (мок SDK): max_tokens → повтор, ремонт с thinking-блоками без изменений, стоимость", async () => {
  const bad = structuredClone(demo);
  bad.scenes[2].onScreen = "Мозг совсем не ленится он просто очень экономит энергию";
  const { client, calls } = mockClaude([
    claudeMessage([{ type: "thinking", thinking: "", signature: "sig0" }, { type: "text", text: '{"title": "обрыв' }], "max_tokens", { output_tokens: 32000 }),
    claudeMessage([{ type: "thinking", thinking: "", signature: "sig1" }, { type: "text", text: JSON.stringify(bad) }], "end_turn", { input_tokens: 3000, output_tokens: 4000, cache_creation_input_tokens: 2500 }),
    claudeMessage([{ type: "thinking", thinking: "", signature: "sig2" }, { type: "text", text: JSON.stringify(demo) }], "end_turn", { input_tokens: 600, output_tokens: 3500, cache_read_input_tokens: 2500 }),
  ]);
  const { script, usage } = await generateScript(
    { topic: "Память", format: "shorts" },
    { env: { LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test", LLM_FALLBACKS: "none" }, anthropic: client, log },
  );
  assert.equal(script.scenes.length, 7);
  assert.equal(calls.length, 3);
  const p0 = calls[0] as unknown as Record<string, unknown>;
  assert.equal(p0.model, "claude-opus-5-5");
  assert.ok(!("thinking" in p0), "thinking не передаётся (на Opus 5.5 его нельзя выключить)");
  assert.deepEqual(p0.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p0.fallbacks, "default");
  const oc = p0.output_config as { effort: string; format: { type: string; schema: Record<string, unknown> } };
  assert.equal(oc.effort, "medium");
  assert.equal(oc.format.type, "json_schema");
  const kindSchema = ((oc.format.schema.properties as Record<string, { items: { properties: Record<string, { enum?: string[] }> } }>).scenes).items.properties.kind;
  assert.ok(kindSchema.enum?.includes("hook"), "enum kind сохранён в схеме");
  assert.ok(!JSON.stringify(oc.format.schema).includes("maxItems"), "неподдерживаемые ограничения массивов убраны");
  assert.equal((p0.system as { cache_control?: unknown }[])[0].cache_control !== undefined, true);
  assert.equal(calls[0].max_tokens, 32000);
  assert.equal(calls[1].max_tokens, 64000, "после max_tokens лимит удвоен");
  const repairMsgs = calls[2].messages;
  assert.equal(repairMsgs.length, 3);
  assert.equal(repairMsgs[repairMsgs.length - 1].role, "user", "без префилла: последним идёт user");
  const assistant = repairMsgs[1].content as { type: string; signature?: string }[];
  assert.equal(assistant[0].type, "thinking");
  assert.equal(assistant[0].signature, "sig1", "thinking-блок возвращён без изменений");
  assert.ok(String((repairMsgs[2].content as string)).includes("onScreen слишком длинный"));
  const u = usage[0];
  assert.equal(u.provider, "claude");
  assert.equal(u.attempts, 3);
  const expected =
    claudeCostUsd("claude-opus-5-5", { input: 3000, cacheWrite: 0, cacheRead: 0, output: 32000 }) +
    claudeCostUsd("claude-opus-5-5", { input: 3000, cacheWrite: 2500, cacheRead: 0, output: 4000 }) +
    claudeCostUsd("claude-opus-5-5", { input: 600, cacheWrite: 0, cacheRead: 2500, output: 3500 });
  assert.ok(Math.abs(u.costUsd - expected) < 1e-6, `стоимость ${u.costUsd} ≠ ${expected}`);
  assert.ok(u.costUsd > 0.7 && u.costUsd < 0.9, `опус: ~$0.8 за этот (раздутый мок) прогон, получили ${u.costUsd}`);
});

await test("Claude через настоящий SDK (подменён только fetch): заголовки, тело, SSE → finalMessage", async () => {
  const text = JSON.stringify(demo);
  const sse = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4200, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sigX" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(0, 500) } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(500) } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5000 } },
    { type: "message_stop" },
  ]
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const sdkFetch = async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({ apiKey: "sk-ant-test", fetch: sdkFetch, maxRetries: 0 });
  const { script, usage } = await generateScript(
    { topic: "Память", format: "shorts" },
    { env: { LLM_PROVIDER: "claude", LLM_FALLBACKS: "none", LLM_EFFORT: "high" }, anthropic: client, log },
  );
  assert.equal(script.scenes.length, 7);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith("https://api.anthropic.com/v1/messages"), seen[0].url);
  assert.ok((seen[0].headers.get("anthropic-beta") ?? "").includes("server-side-fallback-2026-07-01"));
  assert.equal(seen[0].headers.get("x-api-key"), "sk-ant-test");
  const b = seen[0].body;
  assert.equal(b.stream, true);
  assert.equal(b.fallbacks, "default");
  assert.ok(!("betas" in b), "betas уходит заголовком, а не в теле");
  assert.ok(!("thinking" in b));
  assert.equal((b.output_config as { effort: string }).effort, "high", "LLM_EFFORT учитывается");
  assert.equal(usage[0].costUsd, claudeCostUsd("claude-opus-5-5", { input: 4200, cacheWrite: 0, cacheRead: 0, output: 5000 }));
});

await test("Claude: серверный fallback — текст до точки переключения отброшен, цена по fallback-модели", async () => {
  const { client } = mockClaude([
    claudeMessage(
      [
        { type: "text", text: '{"title": "частичный отв' },
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
        { type: "text", text: JSON.stringify(demo) },
      ],
      "end_turn",
      {
        iterations: [
          { type: "message", model: null, input_tokens: 3000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 3000, output_tokens: 2500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
        ] as unknown as BetaMessage["usage"]["iterations"],
      },
    ),
  ]);
  const { usage } = await generateScript(
    { topic: "Память", format: "shorts" },
    { env: { LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test", LLM_FALLBACKS: "none" }, anthropic: client, log },
  );
  const expected = claudeCostUsd("claude-opus-5-5", { input: 3000, cacheWrite: 0, cacheRead: 0, output: 200 }) + claudeCostUsd("claude-opus-4-8", { input: 3000, cacheWrite: 0, cacheRead: 0, output: 2500 });
  assert.ok(Math.abs(usage[0].costUsd - expected) < 1e-6);
  assert.equal(usage[0].inputTokens, 6000);
});

await test("Claude: отказ (refusal) и RateLimitError → следующий провайдер", async () => {
  const rate = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "rate limited", new Headers());
  const { client, calls } = mockClaude([claudeMessage([], "refusal", { output_tokens: 0 }), rate]);
  const { fn } = mockFetch([chat(JSON.stringify(demo))]);
  const { usage } = await generateScript(
    { topic: "Память", format: "shorts" },
    { env: { LLM_PROVIDER: "claude", LLM_MODEL: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "sk", LLM_FALLBACKS: "claude:claude-haiku-4-5,gemini", GEMINI_API_KEY: "k" }, anthropic: client, fetch: fn, log },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "claude-sonnet-5-5");
  assert.equal(calls[1].model, "claude-haiku-4-5");
  const haiku = calls[1] as unknown as Record<string, unknown>;
  assert.ok(!("fallbacks" in haiku) && !("betas" in haiku), "Haiku 4.5 — без fallbacks");
  assert.equal((haiku.output_config as Record<string, unknown>).effort, undefined, "Haiku 4.5 — без effort");
  assert.ok(logs.some((l) => l.includes("отказалась") && l.includes("cyber")));
  assert.ok(usage.some((u) => u.provider === "gemini"));
});

await test("Claude: пустой баланс (400 credit balance) → без повторов, сразу бесплатный Gemini", async () => {
  const msg = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
  const err = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: msg } }, msg, new Headers());
  const { client, calls } = mockClaude([err]);
  const { fn } = mockFetch([chat(JSON.stringify(demo))]);
  const { usage } = await generateScript(
    { topic: "Память", format: "shorts" },
    { env: { LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk", GEMINI_API_KEY: "k" }, anthropic: client, fetch: fn, log },
  );
  assert.equal(calls.length, 1, "без «упрощения» запроса");
  assert.ok(logs.some((l) => l.includes("закончились средства")), logs.join("\n"));
  assert.equal(usage.find((u) => u.provider === "claude")?.costUsd, 0);
  assert.ok(usage.some((u) => u.provider === "gemini" && u.attempts === 1));
});

await test("Landscape: план → части → склейка, id сквозные, хук/cta на местах", async () => {
  const outline = {
    title: "Как тренировать память: научный разбор",
    description: "Разбираем, как работает память и что реально помогает. #память #мозг #наука",
    tags: ["память", "мозг"],
    theme: "midnight",
    sections: [1, 2, 3, 4].map((i) => ({ heading: `Раздел ${i}`, goal: `Цель ${i}`, points: [`Факт ${i}.1`, `Факт ${i}.2`], seconds: "60" })),
  };
  const { fn, calls } = mockFetch([
    chat(JSON.stringify(outline)),
    chat(JSON.stringify({ scenes: chunkScenes(9, { hook: true, seed: 0 }) })),
    chat(JSON.stringify({ scenes: chunkScenes(9, { cta: true, seed: 3 }) })),
  ]);
  const { script } = await generateScript(
    { topic: "Как тренировать память", format: "landscape", targetSeconds: 240 },
    { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log },
  );
  assert.equal(calls.length, 3);
  assert.ok(msgs(calls[0])[1].content.includes("ПЛАН ролика"));
  assert.ok(msgs(calls[1])[1].content.includes("ЧАСТЬ 1 из 2"));
  assert.ok(msgs(calls[2])[1].content.includes("ЧАСТЬ 2 из 2"));
  assert.ok(msgs(calls[2])[1].content.includes(words(26, 8)), "вторая часть видит хвост первой");
  assert.equal(msgs(calls[0])[0].content, msgs(calls[2])[0].content, "системный промпт одинаковый (кэш)");
  assert.equal(script.format, "landscape");
  assert.equal(script.title, outline.title);
  assert.equal(script.scenes.length, 18);
  assert.deepEqual(script.scenes.map((s) => s.id), Array.from({ length: 18 }, (_, i) => `s${i + 1}`));
  assert.equal(script.scenes[0].kind, "hook");
  assert.equal(script.scenes[17].kind, "cta");
  assert.equal(script.scenes.filter((s) => s.kind === "hook" || s.kind === "cta").length, 2);
});

await test("Landscape: часть с лишним hook уходит в ремонт", async () => {
  const outline = { title: "T", description: "D #x", tags: ["a"], sections: [{ heading: "A", goal: "g", points: ["p"], seconds: 100 }, { heading: "B", goal: "g", points: ["p"], seconds: 100 }] };
  const second = chunkScenes(9, { cta: true, seed: 2 });
  second[0].kind = "hook"; // во второй части хука быть не должно
  const fixedSecond = chunkScenes(9, { cta: true, seed: 2 });
  const { fn, calls } = mockFetch([
    chat(JSON.stringify(outline)),
    chat(JSON.stringify({ scenes: chunkScenes(9, { hook: true, seed: 0 }) })),
    chat(JSON.stringify({ scenes: second })),
    chat(JSON.stringify({ scenes: fixedSecond })),
  ]);
  const { script } = await generateScript({ topic: "Память", format: "landscape", targetSeconds: 200 }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 4);
  assert.ok(msgs(calls[3])[3].content.includes('kind "hook" допустим только'));
  assert.equal(script.scenes.length, 18);
});

await test("План: 60+ тем с кодами, код из имени сценария, пожелания — хук, угол и факты с источниками", () => {
  const plan = parsePlan(JSON.parse(readFileSync(path.join(root, "content", "plan.json"), "utf8")));
  assert.ok(plan.items.length >= 60, "план только растёт (plan-extend дописывает темы)");
  assert.equal(scriptCode("scripts/sut-08a-pochemu-tak.json"), "08a");
  assert.equal(scriptCode("C:\\x\\scripts\\sut-12B-abc.json"), "12b");
  assert.equal(scriptCode("scripts/kleopatra.json"), null);
  const item = plan.items.find((i) => i.id === "08a")!;
  const notes = planNotes(item);
  assert.ok(notes.includes(item.hook.trim()));
  assert.ok(notes.includes(item.angle.trim()));
  for (const f of item.keyFacts) assert.ok(notes.includes(f.source.trim()), `нет источника: ${f.source}`);
  assert.match(notes, /других фактов и цифр не добавляй/);
  assert.throws(() => parsePlan({ items: [{ id: "8a", title: "x", keyFacts: [] }] }), /вида «08a»/);
});

// ===================================================================
// Викторина, «Разбор» с главами, «уже было на канале», подсказки поиска,
// журнал расхода, план тем (plan-extend / plan-sequel). Всё — без сети.

function quizScript(): VideoScript {
  return {
    title: "Правда или миф: золотые рыбки и память",
    description: "Проверь себя: два утверждения о памяти рыб и людей. #память #мифы #shorts",
    tags: ["память", "мифы", "рыбы", "викторина", "наука"],
    language: "ru",
    format: "shorts",
    theme: "midnight",
    scenes: [
      { id: "s1", kind: "hook", narration: "Проверь себя: правда или миф? Два факта о памяти.", onScreen: "Правда или *миф*?", icon: "brain", visualQuery: "goldfish bowl" },
      { id: "s2", kind: "quiz", narration: "Говорят, золотая рыбка помнит всего три секунды, а потом всё забывает. Правда или миф?", onScreen: "Рыбка помнит *3 секунды*", icon: "fish", visualQuery: "goldfish swimming", quiz: { answer: "myth", explanation: "В опытах рыбки помнили сигнал месяцами" } },
      { id: "s3", kind: "statement", narration: "Миф! В опытах золотых рыбок учили нажимать на рычаг ради еды, и они помнили этот трюк месяцами, даже после долгого перерыва.", onScreen: "Помнят *месяцами*", icon: "calendar-check", visualQuery: "aquarium fish feeding" },
      { id: "s4", kind: "quiz", narration: "Сон помогает закрепить то, что ты выучил за день. Правда или миф?", onScreen: "Сон *закрепляет* память", icon: "moon", visualQuery: "person sleeping bed", quiz: { answer: "truth", explanation: "Во сне мозг переносит знания в долгую память", question: "А ты высыпаешься?" } },
      { id: "s5", kind: "statement", narration: "Правда! Во сне мозг заново проигрывает дневные события и переносит их в долговременную память, поэтому после сна вспоминать легче.", onScreen: "Мозг *повторяет* день", icon: "brain", visualQuery: "night city lights" },
      { id: "s6", kind: "cta", narration: "Сколько угадал? Пиши в комментариях.", onScreen: "Сколько *угадал*?", icon: "message-circle" },
    ],
  };
}

const userMsg = (c: Call) => msgs(c).find((m) => m.role === "user")?.content ?? "";

await test("Викторина: схема и проверка quiz, нормализация ответа, мягкие замечания", () => {
  const s = validateScript(quizScript());
  assert.equal(s.scenes[1].quiz?.answer, "myth");
  assert.ok(!lintScript(s).some((w) => /викторин|после quiz|вердикта/.test(w)), lintScript(s).join("\n"));
  const coerced = coerceScene({ id: "x", kind: "Trivia", narration: "А?", onScreen: "А", quiz: { verdict: "Миф!", explanation: "  Так  ", pauseSec: "10" } }, 0) as Record<string, unknown>;
  assert.equal(coerced.kind, "quiz");
  assert.deepEqual(coerced.quiz, { answer: "myth", explanation: "Так", pauseSec: 5 });
  const falseIsMyth = coerceScene({ id: "x", kind: "quiz", narration: "А?", onScreen: "А", quiz: { answer: false, explanation: "x" } }, 0) as { quiz: { answer: string } };
  assert.equal(falseIsMyth.quiz.answer, "myth");
  const statement = coerceScene({ id: "x", kind: "statement", narration: "А", onScreen: "А", quiz: { answer: "truth", explanation: "x" }, chapter: "  «Глава 2: Начало»  " }, 0) as Record<string, unknown>;
  assert.ok(!("quiz" in statement), "quiz у чужого kind убран");
  assert.equal(statement.chapter, "Начало", "номер главы и кавычки убраны");
  const bad = quizScript();
  delete (bad.scenes[1] as Partial<ScriptScene>).quiz;
  (bad.scenes[3].quiz as { explanation: string }).explanation = "очень длинное пояснение вердикта из целых семнадцати слов которое никто не успеет прочитать за полторы секунды никак";
  assert.throws(() => validateScript(bad), (e: unknown) => e instanceof ScriptValidationError && /обязательно поле quiz/.test(e.message) && /quiz\.explanation слишком длинное/.test(e.message));
});

await test("Тайминг: пауза викторины и вердикт после голоса, карточка главы — перед голосом", () => {
  const laid = layoutScenes([
    { audioDurationMs: 1000, chapter: "Вступление" },
    { audioDurationMs: 2000, kind: "quiz", quiz: { pauseSec: 4 } },
    { audioDurationMs: 1000, chapter: "Как это работает" },
    { audioDurationMs: 1000, kind: "quiz", quiz: {} },
    { audioDurationMs: 1000, kind: "quiz" }, // без данных — обычная сцена
  ]);
  const [a, q, c, q2, plain] = laid.scenes;
  assert.equal(a.audioStartFrame, SCENE_LEAD_FRAMES, "у первой сцены карточки главы нет");
  assert.equal(q.durationInFrames, SCENE_LEAD_FRAMES + 60 + 4 * FPS + QUIZ_REVEAL_FRAMES + SCENE_TAIL_FRAMES);
  const t = quizTiming(q);
  assert.equal(t.countdownStart, SCENE_LEAD_FRAMES + 60);
  assert.equal(t.revealAt, SCENE_LEAD_FRAMES + 60 + 4 * FPS);
  assert.equal(c.audioStartFrame, SCENE_LEAD_FRAMES + CHAPTER_CARD_FRAMES, "голос главы — после карточки");
  assert.equal(c.durationInFrames, SCENE_LEAD_FRAMES + CHAPTER_CARD_FRAMES + 30 + SCENE_TAIL_FRAMES);
  assert.equal(quizTiming(q2).pauseFrames, 3 * FPS, "пауза по умолчанию — 3 с");
  assert.equal(plain.durationInFrames, SCENE_LEAD_FRAMES + 30 + FINAL_TAIL_FRAMES, "у финала — короткий хвост, без лишней секунды");
  // Композиция сверяет сумму длительностей с durationInFrames — с паузами она сходится.
  const props = buildFixtureProps(quizScript());
  const sum = props.scenes.reduce((s, sc) => s + sc.durationInFrames, 0) - (props.scenes.length - 1) * props.transitionFrames;
  assert.equal(sum, props.durationInFrames);
  const plainProps = buildFixtureProps({ ...quizScript(), scenes: quizScript().scenes.map((s) => ({ ...s, kind: s.kind === "quiz" ? ("statement" as const) : s.kind, quiz: undefined })) });
  assert.equal(props.durationInFrames - plainProps.durationInFrames, 2 * (3 * FPS + QUIZ_REVEAL_FRAMES), "два раунда — две паузы");
});

await test("Генерация викторины (--quiz): промпт, цели по словам без пауз, нет quiz → ремонт", async () => {
  const { fn, calls } = mockFetch([chat(JSON.stringify(demo)), chat(JSON.stringify(quizScript()))]);
  const { script } = await generateScript({ topic: "Мифы о памяти", format: "shorts", quiz: true }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 2);
  assert.match(userMsg(calls[0]), /викторина «Правда или миф\?»/);
  assert.match(userMsg(calls[0]), /kind "quiz"/);
  assert.ok(msgs(calls[1])[3].content.includes('нет ни одной сцены kind "quiz"'));
  assert.equal(script.scenes.filter((s) => s.kind === "quiz").length, 2);
  await assert.rejects(generateScript({ topic: "x", format: "landscape", quiz: true }, { env: { GEMINI_API_KEY: "k" }, fetch: mockFetch([]).fn, log }), /только формат shorts/);
});

await test("«Разбор» (--long): главы из плана, отметки модели и запасная расстановка, лимит 45 сцен", async () => {
  const headings = ["Почему мы забываем", "Кривая Эббингауза", "Сон и память", "Интервалы", "Что делать"];
  const outline = {
    title: "Как работает память: большой разбор",
    description: "Разбираем память по шагам. #память #мозг #наука",
    tags: ["память", "мозг"],
    theme: "midnight",
    sections: headings.map((h, i) => ({ heading: h, goal: `Цель ${i + 1}`, points: [`Факт ${i + 1}`], seconds: 84 })),
  };
  const part1 = chunkScenes(10, { hook: true, seed: 0 }) as Record<string, unknown>[];
  part1[0].chapter = "Почему мы забываем";
  part1[5].chapter = "кривая эббингауза"; // регистр не важен
  const part2 = chunkScenes(10, { seed: 3 }); // модель главы не отметила
  const part3 = chunkScenes(6, { cta: true, seed: 6 }) as Record<string, unknown>[];
  part3[0].chapter = "Что делать";
  const { fn, calls } = mockFetch([chat(JSON.stringify(outline)), chat(JSON.stringify({ scenes: part1 })), chat(JSON.stringify({ scenes: part2 })), chat(JSON.stringify({ scenes: part3 }))]);
  const { script, warnings } = await generateScript({ topic: "Память", format: "landscape", long: true }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 4);
  assert.match(userMsg(calls[0]), /главами YouTube/);
  assert.match(userMsg(calls[0]), /около 420 секунд/, "«Разбор» по умолчанию — 7 минут");
  assert.match(userMsg(calls[1]), /Главы: у ПЕРВОЙ сцены/);
  assert.equal(script.scenes.length, 26);
  const ch = script.scenes.filter((s) => s.chapter).map((s) => [s.id, s.chapter]);
  assert.deepEqual(
    ch.map(([, c]) => c),
    headings,
  );
  assert.deepEqual(ch.slice(0, 2).map(([id]) => id), ["s1", "s6"], "отметки модели сохранены");
  assert.equal(ch[2][0], "s11", "часть без отметок — глава с её первой сцены");
  assert.deepEqual(warnings, []);
  // Доля части от лимита «Разбора» (45 сцен): 168 с из 420 → не больше 18 сцен.
  const tooMany = mockFetch([chat(JSON.stringify(outline)), chat(JSON.stringify({ scenes: chunkScenes(22, { hook: true, seed: 0 }) }))]);
  await assert.rejects(generateScript({ topic: "Память", format: "landscape", long: true }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: tooMany.fn, log }));
  assert.ok(userMsg(tooMany.calls[1]).includes("12–18 сцен"), userMsg(tooMany.calls[1]));
  assert.ok(msgs(tooMany.calls[2])[3].content.includes("нужно не больше 18"), "ремонт: лимит сцен части");
});

await test("Главы: расстановка по доле слов, таймкоды YouTube (0:00, ≥ 3 глав, ≥ 10 с), описание", () => {
  const sc = Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, kind: "statement" as const, narration: words(20, i), onScreen: "x" }));
  const auto = assignChapters(sc, [{ heading: "Первая", seconds: 50 }, { heading: "Вторая", seconds: 50 }]);
  assert.deepEqual(auto.map((s) => s.chapter ?? null), ["Первая", null, null, "Вторая", null, null]);
  const marked = assignChapters([{ ...sc[0], chapter: "первая" }, sc[1], { ...sc[2], chapter: "Вторая!" }, sc[3]], [{ heading: "Первая", seconds: 10 }, { heading: "Вторая", seconds: 90 }]);
  assert.deepEqual(marked.map((s) => s.chapter ?? null), ["Первая", null, "Вторая", null]);

  const at = (sec: number) => sec * FPS;
  const chapters = youtubeChapters(
    [
      { chapter: "Вступление", startFrame: at(3) },
      { startFrame: at(20) },
      { chapter: "Как это работает", startFrame: at(45) },
      { chapter: "Короткая", startFrame: at(50) },
      { chapter: "Итог", startFrame: at(120) },
      { chapter: "Хвост", startFrame: at(195) },
    ],
    200,
  );
  assert.deepEqual(chapters, [
    { startSec: 0, title: "Вступление" },
    { startSec: 45, title: "Как это работает" },
    { startSec: 120, title: "Итог" },
  ]);
  assert.deepEqual(youtubeChapters([{ chapter: "A", startFrame: 0 }, { chapter: "B", startFrame: at(60) }], 300), [], "меньше 3 глав — без таймкодов");
  assert.equal(chapterTime(75), "1:15");
  assert.equal(chapterTime(3725), "1:02:05");
  const script = { ...demo, format: "landscape" as const };
  const meta = buildYoutubeMeta({ script, format: "landscape", visualCredits: [], musicCredit: null, voiceProvider: "edge", chapters });
  assert.ok(meta.description.includes("Таймкоды:\n0:00 Вступление\n0:45 Как это работает\n2:00 Итог"), meta.description);
  const shorts = buildYoutubeMeta({ script: demo, format: "shorts", visualCredits: [], musicCredit: null, voiceProvider: "edge", chapters });
  assert.ok(!shorts.description.includes("Таймкоды"), "в Shorts глав нет");
});

await test("«Уже было на канале»: нормализация, n-граммы, повтор, блок для промпта, корпус с диска", () => {
  assert.deepEqual(stems("Золотые рыбки помнят месяцами"), ["золот", "рыбк", "помня", "месяц"]);
  assert.equal(ngrams(stems("золотая рыбка помнит всего три секунды")).size, 4);
  const entries: CoveredEntry[] = [
    { code: "05a", title: "Память рыбок", texts: ["Золотая рыбка помнит всего три секунды — это миф"] },
    { code: "02b", title: "Щекотка", texts: ["Себя пощекотать нельзя: мозг предсказывает касание"] },
  ];
  const index = indexCovered(entries);
  const hits = findRepeats(
    [
      { id: "s1", kind: "hook", narration: "Говорят, золотая рыбка помнит всего три секунды.", onScreen: "3 секунды?" },
      { id: "s2", kind: "statement", narration: "Осьминог решает головоломки и открывает банки.", onScreen: "Умный *осьминог*" },
      { id: "s3", kind: "cta", narration: "Себя пощекотать нельзя, мозг предсказывает касание. Подпишись!", onScreen: "Подпишись" },
    ],
    index,
  );
  assert.equal(hits.length, 1, "повтор в s1, s2 — новое, cta не проверяется");
  assert.equal(hits[0].code, "05a");
  assert.ok(hits[0].ratio >= 0.5);
  const block = coveredPromptBlock(entries, "Память золотых рыбок");
  assert.match(block, /05a «Память рыбок»: Золотая рыбка/);
  assert.match(block, /другие ролики канала: «Щекотка»/);
  const plan = parsePlan(JSON.parse(readFileSync(path.join(root, "content", "plan.json"), "utf8")));
  const covered = loadCovered(root, { plan, exclude: ["08a"] });
  assert.ok(covered.length >= 10);
  assert.ok(!covered.some((e) => e.code === "08a"), "своя тема — не повтор");
  const c01a = covered.find((e) => e.code === "01a")!;
  assert.ok(c01a.texts.some((t) => t.includes("кости")), "факты плана готовой темы в корпусе");
  assert.ok(!c01a.texts.some((t) => /подпишись/i.test(t)), "призыв cta — не факт");
});

await test("Повтор уже сказанного: один ремонт с конкретными сценами, затем — только замечание", async () => {
  const covered = [coveredFromScript("scripts/sut-05a-zabyvanie.json", demo)!];
  const { fn, calls } = mockFetch([chat(JSON.stringify(demo)), chat(JSON.stringify(demo))]);
  const { warnings } = await generateScript({ topic: "Память", format: "shorts", covered }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 2, "один ремонтный запрос");
  assert.match(userMsg(calls[0]), /Уже было на канале/);
  assert.match(msgs(calls[1])[3].content, /почти дословно повторяет то, что уже было в ролике 05a/);
  assert.ok(warnings.some((w) => /похожа на уже сказанное в ролике 05a/.test(w)), warnings.join("\n"));
  // Повтор появился только в исправленном ответе — замечание, а не переход к следующей модели.
  const broken = quizScript();
  (broken.scenes[2] as { kind: string }).kind = "transition";
  const late = mockFetch([chat(JSON.stringify(broken)), chat(JSON.stringify(demo))]);
  const lateRes = await generateScript({ topic: "Память", format: "shorts", covered }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: late.fn, log });
  assert.equal(late.calls.length, 2);
  assert.ok(!msgs(late.calls[1])[3].content.includes("почти дословно"), "в первом ответе повтора не было");
  assert.ok(lateRes.warnings.some((w) => w.includes("05a")));
  const fresh = mockFetch([chat(JSON.stringify(demo))]);
  const other: CoveredEntry[] = [{ code: "01a", title: "Голос", texts: ["Свой голос человек слышит по воздуху и через кости черепа"] }];
  const r = await generateScript({ topic: "Память", format: "shorts", covered: other }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fresh.fn, log });
  assert.equal(fresh.calls.length, 1);
  assert.deepEqual(r.warnings, []);
});

// ===================================================================
// Правила Shorts: темп по готовым роликам, объём ±15 %, финал-вопрос, сцены media, заголовок.

// Готовые сценарии канала и длительности роликов из content/ — данные калибровки.
function channelScripts(): { code: string; script: VideoScript }[] {
  return readdirSync(path.join(root, "scripts"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ code: scriptCode(f) ?? f, script: JSON.parse(readFileSync(path.join(root, "scripts", f), "utf8")) as VideoScript }));
}

// Демо с добавленными словами в середине (объём мимо цели).
function padded(extra: number): VideoScript {
  const d = structuredClone(demo);
  d.scenes[3].narration += ` ${Array.from({ length: extra }, () => "повторяй").join(" ")}.`;
  return d;
}

function withCta(narration: string): VideoScript {
  const d = structuredClone(demo);
  d.scenes[d.scenes.length - 1].narration = narration;
  return d;
}

await test("Темп: WORDS_PER_SECOND — по готовым роликам канала, Shorts по умолчанию 40–45 с", () => {
  const durations = new Map<string, number>();
  for (const f of ["videos.json", "week1-videos.json"]) {
    const list = (JSON.parse(readFileSync(path.join(root, "content", f), "utf8")) as { videos: { id: string; durationSec?: number }[] }).videos;
    for (const v of list) if (typeof v.durationSec === "number") durations.set(v.id, v.durationSec);
  }
  let words = 0;
  let seconds = 0;
  let n = 0;
  for (const { code, script } of channelScripts()) {
    const sec = durations.get(code);
    // Викторина молчит во время отсчёта — в калибровку темпа не годится.
    if (!sec || script.scenes.some((s) => s.kind === "quiz")) continue;
    words += script.scenes.reduce((a, s) => a + countWords(s.narration), 0);
    seconds += sec;
    n++;
  }
  assert.ok(n >= 15, `роликов для калибровки: ${n}`);
  const rate = words / seconds;
  assert.ok(Math.abs(rate - WORDS_PER_SECOND) < 0.25, `темп готовых роликов ${rate.toFixed(2)} слова/с, а WORDS_PER_SECOND = ${WORDS_PER_SECOND} — откалибруй заново`);
  assert.ok(SHORTS_DEFAULT_SECONDS >= 40 && SHORTS_DEFAULT_SECONDS <= 45);
  const t = shortsTargets(SHORTS_DEFAULT_SECONDS);
  assert.deepEqual([t.wordsMin, t.wordsMax, t.scenesMin, t.scenesMax], [79, 97, 6, 8]);
  // Прежние сценарии (≈ 120 слов) — заметно длиннее новой цели.
  assert.ok(120 / (SHORTS_DEFAULT_SECONDS * WORDS_PER_SECOND) > 1 + SHORTS_RULES.lengthTolerance);
});

await test("Промпт Shorts: 42 с, 2–3 сцены media, финал-вопрос до 8 слов без «подпишись», title до 50", async () => {
  const system = buildSystemPrompt();
  assert.match(system, /один короткий вопрос зрителю по теме ролика, до 8 слов/);
  assert.match(system, /2–3 сцены "media"/);
  assert.match(system, /у Shorts до 50 символов/);
  assert.ok(!/затем призыв подписаться/.test(system), "старое правило финала убрано");
  assert.ok(!/подпиш/i.test(JSON.stringify(demo.scenes.at(-1))), "пример в промпте — без «подпишись»");
  const covered: CoveredEntry[] = [{ code: "08b", title: "Рост", texts: ["Утром ты выше, чем вечером"], cta: "А ты замечал, что вечером ниже? Напиши в комментариях и подпишись." }];
  const { fn, calls } = mockFetch([chat(JSON.stringify(demo))]);
  await generateScript({ topic: "Память", format: "shorts", covered }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  const user = userMsg(calls[0]);
  assert.match(user, /около 42 секунд — это 79–97 слов narration суммарно, 6–8 сцен, из них 2–3 — kind "media"/);
  assert.match(user, /один вопрос зрителю до 8 слов/);
  assert.match(user, /title — до 50 символов и не повторяет хук/);
  assert.match(user, /Финалы последних роликов — не повторяй.*«А ты замечал, что вечером ниже\?/);
  assert.ok(logs.some((l) => /Готово: .*90 слов \(~43 с\)/.test(l)), logs.join("\n"));
});

await test("Объём ±15 %: первый ответ мимо — ремонт; после ремонта небольшой промах — замечание, большой — следующая модель", async () => {
  // +20 слов (110 при цели ≈ 88, +25 %) — дважды: ремонт, затем принят с замечанием.
  const { fn, calls } = mockFetch([chat(JSON.stringify(padded(20))), chat(JSON.stringify(padded(20)))]);
  const res = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 2, "один ремонт, без перехода к другой модели");
  assert.match(msgs(calls[1])[3].content, /общий объём narration 110 слов — для ~42 с нужно 79–97 слов/);
  assert.ok(res.warnings.some((w) => /объём narration 110 слов вместо ~88 — ролик выйдет на 25 % длиннее цели/.test(w)), res.warnings.join("\n"));

  // +40 слов (+47 %) и после ремонта — это уже не «чуть мимо»: следующая модель.
  const far = mockFetch([chat(JSON.stringify(padded(40))), chat(JSON.stringify(padded(40))), chat(JSON.stringify(demo))]);
  const ok = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: far.fn, log });
  assert.equal(far.calls.length, 3);
  assert.notEqual(far.calls[2].body.model, far.calls[0].body.model);
  assert.equal(ok.script.scenes[3].narration, demo.scenes[3].narration);
  assert.deepEqual(ok.warnings, [], "ответ в допуске — без замечаний");

  // Первая модель не ответила (429) — строгой остаётся проверка первого настоящего ответа.
  const late = mockFetch([json(429, {}), chat(JSON.stringify(padded(20))), chat(JSON.stringify(padded(20)))]);
  await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: late.fn, log });
  assert.equal(late.calls.length, 3, "429 не тратит строгую проверку: первый ответ ушёл в ремонт");
  assert.equal(late.calls[1].body.model, late.calls[2].body.model, "ремонт — у той же модели");
});

await test("Финал: длиннее 8 слов или с «подпишись» — ремонт; не помогло — сокращаем сами или следующая модель", async () => {
  assert.deepEqual(ctaProblems(demo.scenes), []);
  const old = "А ты замечал такое? Напиши в комментариях и подпишись, чтобы не пропустить новое.";
  const problems = ctaProblems(withCta(old).scenes).join("\n");
  assert.match(problems, /финал \(kind "cta"\) — 13 слов, нужно не больше 8/);
  assert.match(problems, /не проси подписаться/);
  assert.equal(ctaProblems(withCta("Подписывайся!").scenes).length, 1);
  assert.equal(ctaProblems(withCta("Subscribe for more facts").scenes).length, 1);
  assert.equal(ctaProblems(withCta("Жми на подписку!").scenes).length, 1);
  assert.deepEqual(ctaProblems(withCta("Чья подпись стоит на купюре?").scenes), [], "«подпись» — не призыв");

  assert.equal(trimCta(old), "А ты замечал такое?");
  assert.equal(trimCta("А ты замечал, что вечером ниже? Напиши в комментариях и подпишись."), "А ты замечал, что вечером ниже?");
  assert.equal(trimCta("Точка у тебя исчезла? Напиши в комментариях, на каком расстоянии. И подпишись."), "Точка у тебя исчезла?");
  assert.equal(trimCta("Подпишись, чтобы не забыть следующий лайфхак для мозга."), null);
  assert.equal(trimCta("Какой факт из этого ролика удивил тебя сильнее всего и почему"), null, "длинный финал без вопроса не угадать");

  const { fn, calls } = mockFetch([chat(JSON.stringify(withCta(old))), chat(JSON.stringify(withCta(old)))]);
  const res = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 2);
  const repair = msgs(calls[1])[3].content;
  assert.match(repair, /не проси подписаться/);
  assert.equal((repair.match(/не проси подписаться/g) ?? []).length, 1, "замечание не дублирует проблему");
  assert.equal(res.script.scenes.at(-1)!.narration, "А ты замечал такое?");
  assert.ok(res.warnings.some((w) => w.startsWith("финал сокращён автоматически")), res.warnings.join("\n"));

  const hopeless = mockFetch([chat(JSON.stringify(withCta("Подпишись!"))), chat(JSON.stringify(withCta("Подпишись!"))), chat(JSON.stringify(demo))]);
  const fixed = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: hopeless.fn, log });
  assert.equal(hopeless.calls.length, 3, "сокращать нечего — следующая модель");
  assert.equal(fixed.script.scenes.at(-1)!.narration, demo.scenes.at(-1)!.narration);

  // «Разбор»: правило финала — в последней части.
  const outline = { title: "T", description: "D #x", tags: ["a"], sections: [{ heading: "A", goal: "g", points: ["p"], seconds: 100 }, { heading: "B", goal: "g", points: ["p"], seconds: 100 }] };
  const second = chunkScenes(9, { cta: true, seed: 2 });
  second[8].narration = "Подпишись на канал и поставь лайк, впереди ещё много интересного.";
  const land = mockFetch([chat(JSON.stringify(outline)), chat(JSON.stringify({ scenes: chunkScenes(9, { hook: true, seed: 0 }) })), chat(JSON.stringify({ scenes: second })), chat(JSON.stringify({ scenes: chunkScenes(9, { cta: true, seed: 2 }) }))]);
  const long = await generateScript({ topic: "Память", format: "landscape", targetSeconds: 200 }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: land.fn, log });
  assert.equal(land.calls.length, 4);
  assert.match(msgs(land.calls[3])[3].content, /не проси подписаться/);
  assert.match(userMsg(land.calls[2]), /закончи сценой kind "cta" — один короткий вопрос зрителю по теме \(до 8 слов\)/);
  assert.equal(long.script.scenes.at(-1)!.narration, "А как тренируешь память ты?");
});

await test("Финал повторяет прошлые ролики — замечание; старые сценарии проходят validateScript, правило для них — замечание", async () => {
  const scripts = channelScripts();
  assert.ok(scripts.length >= 22);
  // Находка разбора: финал «…и подпишись» у всех готовых роликов — для них это замечание, не ошибка.
  for (const { code, script } of scripts) {
    assert.doesNotThrow(() => validateScript(script), `сценарий ${code} больше не проходит validateScript`);
    assert.ok(lintScript(script).some((w) => w.includes("не проси подписаться")), `${code}: нет замечания о «подпишись»`);
  }
  const covered = loadCovered(root);
  const recent = recentCtas(covered);
  assert.equal(recent.length, 10, "последние 10 финалов");
  assert.equal(recent.at(-1)!.code, scripts.at(-1)!.code, "самый свежий — последним");
  assert.ok(!covered.some((e) => e.texts.some((t) => e.cta && t.includes(e.cta))), "финал — не факт");
  assert.ok(ctaRepeat("А ты замечал такое? Напиши в комментариях.", recent), "шаблон «напиши в комментариях» уже был");
  assert.equal(ctaRepeat("А что из вчерашнего ты помнишь сегодня?", recent), null);

  const entries: CoveredEntry[] = [{ code: "08b", title: "Рост", texts: ["Утром ты выше, чем вечером"], cta: "А ты замечал, что вечером ниже? Напиши в комментариях и подпишись." }];
  const { fn } = mockFetch([chat(JSON.stringify(withCta("А ты замечал такое? Напиши в комментариях.")))]);
  const res = await generateScript({ topic: "Память", format: "shorts", covered: entries }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.ok(res.warnings.some((w) => /финал «А ты замечал такое\? Напиши в комментариях\.» почти повторяет финал ролика 08b/.test(w)), res.warnings.join("\n"));
});

await test("Сцены media (2–3 в Shorts) и заголовок (до 50 символов, не пересказ хука) — замечания", () => {
  const ok = lintScript(validateScript(demo));
  assert.ok(!ok.some((w) => /kind "media"|title|финал/.test(w)), ok.join("\n"));
  const one = structuredClone(demo);
  one.scenes[2].kind = "statement";
  assert.ok(lintScript(one).some((w) => w.startsWith('сцен kind "media" — 1, в Shorts нужно 2–3')));
  const four = structuredClone(demo);
  for (const i of [1, 3]) Object.assign(four.scenes[i], { kind: "media", stat: undefined, items: undefined });
  assert.ok(lintScript(four).some((w) => w.startsWith('сцен kind "media" — 4')));
  assert.ok(!lintScript(quizScript()).some((w) => w.includes('kind "media"')), "у викторины своя структура");
  assert.ok(!lintScript({ ...demo, format: "landscape" }).some((w) => w.includes('kind "media"')));

  // Пары из готовых роликов: 06b и 03b пересказывают хук, 05a — дополняет.
  assert.ok(titleRepeatsHook("Эта акула может быть старше Санкт-Петербурга", "Эта акула может быть старше Санкт-Петербурга. И это не шутка."));
  assert.ok(titleRepeatsHook("Самый знаменитый компьютерный баг был настоящим насекомым", "Самый знаменитый компьютерный баг был настоящим насекомым. В прямом смысле."));
  assert.ok(!titleRepeatsHook("Невидимая горилла: почему ты не видишь очевидное", "Половина зрителей не заметила гориллу прямо у себя перед глазами."));
  assert.ok(!titleRepeatsHook(demo.title, demo.scenes[0].narration));
  const echo = { ...demo, title: "Через сутки ты забудешь почти всё выученное" };
  assert.ok(lintScript(echo).some((w) => w.startsWith("title почти повторяет хук")));
  const long = { ...demo, title: "Почему ты забываешь шестьдесят шесть процентов за сутки" };
  assert.ok(long.title.length > 50 && long.title.length <= 70);
  assert.ok(lintScript(long).some((w) => w.startsWith(`title ${long.title.length} символов — для Shorts лучше до 50`)));
  assert.ok(!lintScript({ ...long, format: "landscape" }).some((w) => w.includes("лучше до 50")), "у длинного ролика — до 70");
});

await test("Нет visualQuery: карте и столбикам не нужен (как findVisual), прочим сценам — замечание", () => {
  const noQuery = (s: VideoScript, id: string) => lintScript(s).some((w) => w.startsWith(`сцена ${id}: нет visualQuery`));
  // Ложные замечания из логов CI: 13a s2 (столбики «Вода/Сатурн»), 12b s7 (три столбика).
  const ready = new Map(channelScripts().map((c) => [c.code, c.script]));
  for (const [code, id] of [["13a", "s2"], ["12b", "s7"]] as const) {
    const s = ready.get(code);
    assert.ok(s, `нет сценария ${code} в scripts/`);
    assert.ok((s.scenes.find((x) => x.id === id)?.compare?.items.length ?? 0) >= 2, `${code} ${id} — со столбиками`);
    assert.ok(!noQuery(s, id), `${code} ${id}: лишнее замечание`);
  }

  const bare = (patch: Partial<ScriptScene>, i = 3) => {
    const d = structuredClone(demo);
    Object.assign(d.scenes[i], { visualQuery: undefined, ...patch });
    return d;
  };
  const map = { lat: 29.98, lon: 31.13, label: "Гиза" };
  const two = { items: [{ label: "Вода", value: 1000 }, { label: "Сатурн", value: 687 }] };
  assert.ok(noQuery(bare({}), "s4"), "без графики — замечание");
  assert.ok(!noQuery(bare({ map }), "s4"), "карта");
  assert.ok(!noQuery(bare({ compare: two }), "s4"), "два столбика");
  assert.ok(noQuery(bare({ compare: { items: two.items.slice(0, 1) } }), "s4"), "один столбик композиция не рисует");
  // Хук findVisual подбирает и с картой — запрос ему нужен.
  assert.ok(noQuery(bare({ map }, 0), "s1"), "хук с картой");
});

await test("Финал: «подписал»/«подпиши» — не призыв; вопрос чуть длиннее 8 слов после ремонта — замечание, не другая модель", async () => {
  // Глагол «подписать» (договор, указ) — частая тема истории, призывом не считается.
  for (const q of ["А ты бы подписал такой указ?", "Кто подписывал Декларацию первым?", "Подпиши открытку маме сегодня?", "Чья подпись на купюре?"]) {
    assert.deepEqual(ctaProblems(withCta(q).scenes), [], q);
  }
  for (const q of ["Подпишись!", "Подпишитесь на канал", "Ну что, подпишешься?", "Не забудь подписаться", "Подписывайтесь", "Стань подписчиком", "Жми на подписку"]) {
    assert.equal(ctaProblems(withCta(q).scenes).filter((p) => p.includes("не проси подписаться")).length, 1, q);
  }
  assert.ok(lintScript({ ...demo, scenes: [...demo.scenes.slice(0, -1), { ...demo.scenes.at(-1)!, onScreen: "*Подпишись*" }] }).some((w) => w.startsWith("onScreen финала")));

  // Вопрос в 9 слов дважды: ремонт, затем принят с замечанием — без перехода к следующей модели.
  const longQuestion = "А ты замечал, что вчерашнее забывается быстрее, чем позавчерашнее?";
  assert.equal(countWords(longQuestion), 9);
  const { fn, calls } = mockFetch([chat(JSON.stringify(withCta(longQuestion))), chat(JSON.stringify(withCta(longQuestion)))]);
  const res = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 2);
  assert.match(msgs(calls[1])[3].content, /финал \(kind "cta"\) — 9 слов, нужно не больше 8/);
  assert.equal(res.script.scenes.at(-1)!.narration, longQuestion);
  assert.ok(res.warnings.some((w) => w.startsWith(`финал «${longQuestion}» — 9 слов, лучше до 8`)), res.warnings.join("\n"));
  assert.ok(!res.warnings.some((w) => w.startsWith("финал сокращён")), "текст не менялся — «сокращён» не пишем");

  // Длинный финал без вопроса так не принимаем — следующая модель.
  const noQuestion = "Расскажи друзьям про кривую забывания и проверь себя через неделю";
  const nq = mockFetch([chat(JSON.stringify(withCta(noQuestion))), chat(JSON.stringify(withCta(noQuestion))), chat(JSON.stringify(demo))]);
  const ok = await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: nq.fn, log });
  assert.equal(nq.calls.length, 3);
  assert.equal(ok.script.scenes.at(-1)!.narration, demo.scenes.at(-1)!.narration);
});

await test("Викторина в 40–45 с: ровно 2 раунда; третий раунд — ремонт с подсказкой убрать раунд", async () => {
  // Три раунда — это ≈ 95 слов и 13,5 с тишины: в 42 с не влезают ни при каком допуске.
  const three = quizScript();
  const extra = structuredClone(three.scenes.slice(1, 3));
  extra[0].narration = "Говорят, у осьминога три сердца и голубая кровь. Правда или миф?";
  extra[0].onScreen = "У осьминога *3 сердца*";
  extra[0].quiz = { answer: "truth", explanation: "Два сердца гонят кровь через жабры" };
  extra[1].narration = "Правда! Два сердца качают кровь через жабры, третье — по всему телу, а медь делает кровь голубой.";
  extra[1].onScreen = "Три *сердца*";
  three.scenes.splice(5, 0, ...extra);
  three.scenes.forEach((s, i) => (s.id = `s${i + 1}`));
  const { fn, calls } = mockFetch([chat(JSON.stringify(three)), chat(JSON.stringify(quizScript()))]);
  const { script } = await generateScript({ topic: "Мифы о памяти", format: "shorts", quiz: true }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.match(userMsg(calls[0]), /hook → ровно 2 раунда → cta/);
  assert.match(userMsg(calls[0]), /Два факта о сне/);
  assert.match(userMsg(calls[0]), /«Сколько из них ты угадал\?»/);
  assert.ok(!/Пиши в комментариях/.test(userMsg(calls[0])), "пример финала не спорит с системным промптом");
  assert.match(msgs(calls[1])[3].content, /или оставь 2 раунда викторины/);
  assert.equal(script.scenes.filter((s) => s.kind === "quiz").length, 2);

  // В минуту три раунда помещаются — их можно предложить.
  const minute = buildShortsPrompt({ topic: "Мифы о памяти", format: "shorts", quiz: true }, shortsTargets(60 - QUIZ_ROUNDS_PLANNED * QUIZ_SILENCE_SEC));
  assert.match(minute, /около 60 секунд/);
  assert.match(minute, /hook → 2–3 раунда → cta/);
  assert.match(buildSystemPrompt(), /В Shorts \(кроме викторины\) — 2–3 сцены "media"/);
});

// Строка → байты windows-1251 (кириллица): так отвечает Google без oe=utf-8.
function cp1251(s: string): ArrayBuffer {
  return Uint8Array.from([...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 0x410 && c <= 0x44f) return 0xc0 + (c - 0x410);
    if (ch === "ё") return 0xb8;
    if (ch === "Ё") return 0xa8;
    return c < 0x80 ? c : 0x3f;
  })).buffer as ArrayBuffer;
}

await test("Подсказки поиска YouTube: JSONP, windows-1251, тихий отказ, фразы из названия", async () => {
  assert.deepEqual(parseSuggestResponse('window.google.ac.h(["почему цены",[["почему цены растут",0,[512]],["почему цены на <b>бензин</b>",0,[512]]],{"k":1}])'), ["почему цены растут", "почему цены на бензин"]);
  assert.deepEqual(parseSuggestResponse('["q",["a","b"]]'), ["a", "b"]);
  assert.deepEqual(parseSuggestResponse("<html>captcha</html>"), []);
  assert.deepEqual(searchPhrases("Почему цены заканчиваются на 99: эффект левой цифры"), ["почему цены заканчиваются на", "цены заканчиваются"]);
  assert.equal(LIMITS.title, TITLE_MAX, "предел заголовка сценария = предел meta.ts");

  const body = cp1251('window.google.ac.h(["почему",[["почему небо голубое",0,[512]]],{}])');
  const seen: string[] = [];
  const ok = await fetchSuggestions("почему", {
    fetch: async (url) => {
      seen.push(String(url));
      return new Response(body, { status: 200, headers: { "content-type": "text/javascript; charset=windows-1251" } });
    },
  });
  assert.deepEqual(ok, ["почему небо голубое"]);
  assert.ok(seen[0].startsWith("https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=ru"));
  assert.ok(seen[0].includes(`q=${encodeURIComponent("почему")}`));
  assert.deepEqual(await fetchSuggestions("x", { fetch: async () => { throw new Error("ENOTFOUND"); } }), []);
  assert.deepEqual(await fetchSuggestions("x", { fetch: async () => new Response("", { status: 429 }) }), []);
  const t0 = Date.now();
  const hang = (_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.deepEqual(await fetchSuggestions("x", { fetch: hang, timeoutMs: 50 }), []);
  assert.ok(Date.now() - t0 < 3000, "таймаут, а не зависание");
  const merged = await suggestionsFor(["почему цены", "цены"], {
    fetch: async (url) =>
      new Response(
        String(url).endsWith(`q=${encodeURIComponent("цены")}`)
          ? JSON.stringify(["цены", ["цены растут", "почему цены растут"]])
          : JSON.stringify(["почему цены", ["почему цены растут", "почему цены", "x".repeat(80)]]),
      ),
  });
  assert.deepEqual(merged, ["почему цены растут", "цены растут"], "без дублей, без самой фразы и слишком длинных");
});

await test("Подсказки в генерации: фразы → запросы → промпт; YT_SUGGEST=0 и сбой — без них", async () => {
  const sugg = (q: string) => json(200, [q, [[`${q} растут`, 0, [512]], [`${q} в мире`, 0, [512]]], {}]);
  const { fn, calls } = mockFetch([sugg("цены"), sugg("товары"), chat(JSON.stringify(demo))]);
  await generateScript({ topic: "Цены", format: "shorts", searchPhrases: ["цены", "товары"] }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.includes("suggestqueries.google.com"));
  assert.match(userMsg(calls[2]), /подсказки поиска\): «цены растут»; «цены в мире»; «товары растут»/);
  const off = mockFetch([chat(JSON.stringify(demo))]);
  await generateScript({ topic: "Цены", format: "shorts", searchPhrases: ["цены"] }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none", YT_SUGGEST: "0" }, fetch: off.fn, log });
  assert.equal(off.calls.length, 1, "YT_SUGGEST=0 — без запроса подсказок");
  const broken = mockFetch([json(503, {}), chat(JSON.stringify(demo))]);
  await generateScript({ topic: "Цены", format: "shorts", searchPhrases: ["цены"] }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: broken.fn, log });
  assert.ok(!userMsg(broken.calls[1]).includes("подсказки поиска"), "сбой подсказок — молча без них");
});

await test("Журнал расхода: запись на каждый запрос LLM, точная схема строки, USAGE_LOG, счётчик POST", async () => {
  const seenCalls: LlmCallInfo[] = [];
  const { fn } = mockFetch([json(429, { error: { message: "quota" } }), chat(JSON.stringify(demo))]);
  await generateScript({ topic: "Память", format: "shorts" }, { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log, onLlmCall: (c) => seenCalls.push(c) });
  assert.equal(seenCalls.length, 2);
  assert.deepEqual(seenCalls[0], { provider: "gemini", model: "gemini-3.8-flash", inputTokens: null, outputTokens: null, costUsd: null, ok: false });
  assert.deepEqual(seenCalls[1], { provider: "gemini", model: "gemini-test", inputTokens: 4000, outputTokens: 2200, costUsd: 0, ok: true });

  const rec = llmUsageRecord(seenCalls[1], "08a", { GITHUB_RUN_ID: "123" }, "2026-10-09T10:37:08Z");
  assert.deepEqual(Object.keys(rec), ["at", "kind", "code", "provider", "model", "inputTokens", "outputTokens", "costUsd", "calls", "chars", "runId"]);
  assert.deepEqual(rec, { at: "2026-10-09T10:37:08Z", kind: "script", code: "08a", provider: "gemini", model: "gemini-test", inputTokens: 4000, outputTokens: 2200, costUsd: 0, calls: 1, chars: null, runId: "123" });
  const tts = ttsUsageRecord({ provider: "gemini", model: "gemini-3.8-flash-tts", calls: 1, chars: 812, costUsd: 0 }, null, {}, "2026-10-09T10:37:08Z");
  assert.deepEqual(Object.keys(tts), Object.keys(rec));
  assert.equal(tts.kind, "tts");
  assert.equal(tts.runId, null);
  assert.match(usageNow(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

  const dir = mkdtempSync(path.join(os.tmpdir(), "vs-usage-"));
  try {
    const file = path.join(dir, "usage.jsonl");
    assert.equal(appendUsage(dir, [rec, tts], { USAGE_LOG: file }), file);
    appendUsage(dir, [rec], { USAGE_LOG: file });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.deepEqual(JSON.parse(lines[1]), tts);
    assert.equal(appendUsage(dir, [rec], { USAGE_LOG: "0" }), null);
    assert.equal(appendUsage(dir, [rec], {}), path.join(dir, "content", "usage.jsonl"), "по умолчанию — content/usage.jsonl");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const original = globalThis.fetch;
  const fake = (async () => new Response("ok")) as typeof fetch;
  globalThis.fetch = fake;
  try {
    const r = await countPostRequests(async () => {
      await fetch("http://tts.local/a", { method: "POST" });
      await fetch("http://tts.local/model.onnx");
      await fetch("http://tts.local/b", { method: "post" });
      return 7;
    });
    assert.deepEqual({ value: r.value, posts: r.posts }, { value: 7, posts: 2 });
    assert.equal(globalThis.fetch, fake, "fetch восстановлен");
    const failed = await countPostRequests(async () => {
      await fetch("http://tts.local/a", { method: "POST" });
      throw new Error("квота");
    });
    assert.equal(failed.posts, 1);
    assert.match(String(failed.error), /квота/);
  } finally {
    globalThis.fetch = original;
  }
});

// ---- План тем ----

const PLAN_JSON = () => parsePlan(JSON.parse(readFileSync(path.join(root, "content", "plan.json"), "utf8")));

function routeFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    return route(url, init);
  };
  return { fn, calls };
}

await test("План: следующие коды по слотам, рубрики по редкости, «Часть N», сводка и пожелания", () => {
  const plan = PLAN_JSON();
  const last = [...plan.items].sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
  const pos = nextPlanPositions(plan, 3, ["12:00", "19:00"]);
  assert.equal(pos.length, 3);
  assert.ok(pos[0].id > last.id, `${pos[0].id} после ${last.id}`);
  assert.deepEqual(nextPlanPositions({ items: [{ id: "30b" }, { id: "30a" }] as ContentPlan["items"] }, 3, ["12:00", "19:00"]), [
    { id: "31a", day: 31, slot: "12:00" },
    { id: "31b", day: 31, slot: "19:00" },
    { id: "32a", day: 32, slot: "12:00" },
  ]);
  assert.deepEqual(nextPlanPositions({ items: [{ id: "01a" }, { id: "01b" }] as ContentPlan["items"] }, 2, ["10:00", "14:00", "19:00"]).map((p) => p.id), ["01c", "02a"]);
  assert.throws(() => nextPlanPositions({ items: [{ id: "99b" }] as ContentPlan["items"] }, 1, ["12:00", "19:00"]), /до 99/);

  const few = { items: [{ id: "01a", pillar: "space", slot: "12:00" }, { id: "01b", pillar: "space", slot: "19:00" }, { id: "02a", pillar: "mind", slot: "12:00" }] as ContentPlan["items"] };
  const picked = pickPillars(few, nextPlanPositions(few, 4, ["12:00", "19:00"]), ["space", "mind", "body"]);
  assert.equal(picked[0], "body", "самая редкая рубрика первой");
  for (let i = 1; i < picked.length; i++) assert.notEqual(picked[i], picked[i - 1], "одна рубрика не два раза подряд");

  assert.deepEqual(sequelTitle("Почему свой голос на записи звучит чужим"), { title: "Почему свой голос на записи звучит чужим. Часть 2", part: 2 });
  assert.deepEqual(sequelTitle("Медуза, которая умеет молодеть. Часть 2"), { title: "Медуза, которая умеет молодеть. Часть 3", part: 3 });

  const copy = structuredClone(plan);
  const space = (copy.pillars as unknown as { id: string; total: number; "12:00": number }[]).find((p) => p.id === "space")!;
  const before = { total: space.total, noon: space["12:00"] };
  copy.items.push({ id: "99a", day: 99, slot: "12:00", pillar: "space", title: "t", hook: "h", angle: "a", keyFacts: [], status: "planned" });
  refreshPlanStats(copy);
  assert.equal(copy.days, 99);
  assert.equal(space.total, before.total + 1);
  assert.equal(space["12:00"], before.noon + 1);

  const item = plan.items.find((i) => i.id === "05b")!;
  const loose = planNotes(item, { strict: false, sequel: plan.items.find((i) => i.id === "01a")! });
  assert.match(loose, /Обязательно используй эти проверенные факты/);
  assert.match(loose, /Это вторая часть ролика 01a/);
  assert.match(planNotes(item), /других фактов и цифр не добавляй/, "по умолчанию — строго как раньше");
});

await test("План: ссылки источников, похожие названия, разбор ответа LLM", () => {
  assert.equal(extractUrl("Smith 2020, https://doi.org/10.1000/xyz."), "https://doi.org/10.1000/xyz");
  assert.equal(extractUrl("(источник: https://en.wikipedia.org/wiki/Octopus)"), "https://en.wikipedia.org/wiki/Octopus");
  assert.equal(extractUrl("https://en.wikipedia.org/wiki/Mercury_(planet)"), "https://en.wikipedia.org/wiki/Mercury_(planet)");
  assert.equal(extractUrl("Учебник биологии, 2010"), null);
  assert.equal(extractUrl("http://localhost/x"), null);
  assert.ok(similarTitle("Почему небо голубое", "Почему небо голубое днём?"));
  assert.ok(!similarTitle("Почему небо голубое", "Почему кошки мурлычут"));

  const fact = (n: number, url = `https://en.wikipedia.org/wiki/Fact_${n}`) => ({ claim: `Факт номер ${n} про осьминогов и их удивительные сердца`, source: url });
  const v = checkTopics(
    {
      items: [
        { code: "31a", title: "Почему у осьминога три сердца", hook: "У осьминога три сердца.", angle: "Как устроено.", keyFacts: [fact(1), { claim: "Без ссылки", source: "Учебник" }, fact(2)] },
        { code: "31b", title: "Почему небо голубое днём", hook: "Небо голубое.", angle: "Рэлей.", keyFacts: [fact(3), fact(4)] },
        { code: "32a", title: "Как спят дельфины", hook: "Дельфин спит половиной мозга.", angle: "Полушария.", keyFacts: [fact(5)] },
        { code: "32b", title: "Память золотой рыбки", hook: "Три секунды?", angle: "Миф.", keyFacts: [{ claim: "Золотая рыбка помнит всего три секунды это миф", source: "https://ru.wikipedia.org/wiki/Золотая_рыбка" }, fact(6)] },
      ],
    },
    {
      positions: ["31a", "31b", "32a", "32b"].map((id) => ({ id, day: 31, slot: "12:00" })),
      existingTitles: ["Почему небо голубое"],
      covered: [{ code: "05a", title: "Память рыбок", texts: ["Золотая рыбка помнит всего три секунды — это миф"] }],
    },
  );
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.deepEqual([...v.value.topics.keys()], ["31a"], "31b — дубль названия, 32a — мало фактов, 32b — факт уже был");
  assert.equal(v.value.topics.get("31a")!.keyFacts.length, 2);
  const notes = v.value.notes.join("\n");
  for (const part of ["без ссылки", "слишком похожа", "нужно минимум 2", "уже был на канале"]) assert.ok(notes.includes(part), `нет «${part}» в:\n${notes}`);
  const none = checkTopics({ nope: 1 }, { positions: [{ id: "31a", day: 31, slot: "12:00" }], existingTitles: [], covered: [] });
  assert.ok(!none.ok, "без items — в ремонт");
});

await test("План: проверка ссылки по сети — 200/405→GET/404/нет домена/403/таймаут", async () => {
  const status = (code: number) => async () => new Response(null, { status: code });
  assert.equal(await checkUrl("https://a.org/x", status(200)), "ok");
  assert.equal(await checkUrl("https://a.org/x", status(404)), "dead");
  assert.equal(await checkUrl("https://a.org/x", status(403)), "unknown", "блокировка бота — не выдумка");
  let n = 0;
  assert.equal(await checkUrl("https://a.org/x", async (_u, init) => new Response(null, { status: init?.method === "HEAD" ? 405 : 200 })), "ok");
  assert.equal(await checkUrl("https://nope.invalid/x", async () => { n++; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }), "dead");
  assert.ok(n >= 1);
  const hang = (_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal(await checkUrl("https://slow.org/x", hang, 30), "unknown");
});

await test("plan-extend (Gemini, без поиска): факты без ссылки и с битой ссылкой выброшены, второй заход за недостающей темой", async () => {
  const plan = { items: [{ id: "30b", day: 30, slot: "19:00", pillar: "nature", title: "Медуза, которая умеет молодеть", hook: "h", angle: "a", keyFacts: [], status: "planned" }] } as ContentPlan;
  const good = (n: number) => ({ claim: `Проверяемый факт ${n} о теме с конкретными цифрами`, source: `https://en.wikipedia.org/wiki/Topic_${n}` });
  const round1 = {
    items: [
      { code: "31a", title: "Почему у осьминога голубая кровь", hook: "Кровь осьминога голубая.", angle: "Гемоцианин вместо гемоглобина.", keyFacts: [good(1), { claim: "Гемоцианин содержит медь", source: "Учебник биологии" }, { claim: "Факт на битой ссылке", source: "https://dead.example.org/page" }] },
      { code: "31b", title: "Как пчёлы рассказывают дорогу", hook: "Пчела танцует карту.", angle: "Виляющий танец.", keyFacts: [good(2), good(3)] },
    ],
  };
  const round2 = { items: [{ code: "31a", title: "Почему у осьминога голубая кровь", hook: "Кровь осьминога голубая.", angle: "Гемоцианин.", keyFacts: [good(4), good(5)] }] };
  const llm = [round1, round2];
  const { fn, calls } = routeFetch((url) => {
    if (url.includes("generativelanguage")) return chat(JSON.stringify(llm.shift()));
    return new Response(null, { status: url.includes("dead.example.org") ? 404 : 200 });
  });
  const seenCalls: LlmCallInfo[] = [];
  const res = await generatePlanItems(
    {
      plan,
      positions: [
        { id: "31a", day: 31, slot: "12:00", pillar: "nature" },
        { id: "31b", day: 31, slot: "19:00", pillar: "tech" },
      ],
      pillars: [{ id: "nature", title: "Природа и животные" }, { id: "tech", title: "Технологии и ИИ" }],
      channel: { name: "Суть за минуту", niche: "наука", audience: "все" },
      covered: [],
    },
    { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fn, log, onLlmCall: (c) => seenCalls.push(c) },
  );
  const llmCalls = calls.filter((c) => c.url.includes("generativelanguage"));
  assert.equal(llmCalls.length, 2, "второй заход — только за 31a");
  const prompt1 = (llmCalls[0].body!.messages as { role: string; content: string }[]).find((m) => m.role === "user")!.content;
  assert.match(prompt1, /31a — рубрика «Природа и животные»/);
  assert.match(prompt1, /«Медуза, которая умеет молодеть»/, "существующие темы — в промпте");
  const system1 = (llmCalls[0].body!.messages as { role: string; content: string }[])[0].content;
  assert.match(system1, /каждую ссылку проверят запросом по сети/);
  const prompt2 = (llmCalls[1].body!.messages as { role: string; content: string }[]).find((m) => m.role === "user")!.content;
  assert.ok(prompt2.includes("31a") && !prompt2.includes("31b —"));
  assert.ok(calls.some((c) => c.url.includes("dead.example.org")), "ссылки проверены по сети");
  assert.deepEqual(res.items.map((i) => i.id), ["31a", "31b"]);
  assert.deepEqual(res.items[0].keyFacts.map((f) => f.source), [good(4).source, good(5).source]);
  assert.equal(res.items[1].pillar, "tech");
  assert.equal(res.items[1].status, "planned");
  assert.deepEqual(res.missing, []);
  const notes = res.notes.join("\n");
  assert.ok(notes.includes("без ссылки") && notes.includes("не открывается"), notes);
  assert.equal(seenCalls.length, 2, "оба запроса — в журнал расхода");
});

await test("plan-sequel (Claude + веб-поиск): инструмент поиска, pause_turn, ссылки из выдачи без проверки, цена поисков", async () => {
  const base = { id: "01a", day: 1, slot: "12:00", pillar: "why", title: "Почему свой голос на записи звучит чужим", hook: "Голос чужой.", angle: "Кости.", keyFacts: [{ claim: "Свой голос слышен через кости черепа", source: "Pörschmann 2000" }], status: "script-ready" };
  const topics = JSON.stringify({ items: [{ code: "31a", title: "Почему мы не узнаём свой голос", hook: "Мозг не узнаёт твой голос.", angle: "Ожидание и привычка.", keyFacts: [{ claim: "Люди хуже оценивают свой записанный голос", source: "https://en.wikipedia.org/wiki/Voice_confrontation" }, { claim: "Костная проводимость меняет тембр", source: "https://www.nature.com/articles/xyz" }] }] });
  const paused = claudeMessage(
    [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "voice confrontation" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://en.wikipedia.org/wiki/Voice_confrontation", title: "Voice", encrypted_content: "x", page_age: null }] },
    ],
    "pause_turn",
    { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } as Partial<BetaMessage["usage"]>,
  );
  const final = claudeMessage(
    [
      { type: "text", text: topics.slice(0, 60), citations: null },
      { type: "text", text: topics.slice(60), citations: [{ type: "web_search_result_location", url: "https://www.nature.com/articles/xyz", title: "N", encrypted_index: "e", cited_text: "c" }] },
    ],
    "end_turn",
    { server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } } as Partial<BetaMessage["usage"]>,
  );
  assert.deepEqual(collectSources([...paused.content, ...final.content] as BetaContentBlock[]), ["https://en.wikipedia.org/wiki/Voice_confrontation", "https://www.nature.com/articles/xyz"]);
  const { client, calls } = mockClaude([paused, final]);
  const noNet = routeFetch(() => {
    throw new Error("сеть не нужна: ссылки из выдачи поиска");
  });
  const seenCalls: LlmCallInfo[] = [];
  const res = await generatePlanItems(
    { plan: { items: [base] } as ContentPlan, positions: [{ id: "31a", day: 31, slot: "12:00", pillar: "why" }], pillars: [{ id: "why", title: "Почему так?" }], channel: { name: "Суть за минуту" }, covered: [{ code: "01a", title: base.title, texts: base.keyFacts.map((f) => f.claim) }], sequelOf: base },
    { env: { LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test", LLM_FALLBACKS: "none" }, anthropic: client, fetch: noNet.fn, log, onLlmCall: (c) => seenCalls.push(c) },
  );
  assert.equal(calls.length, 2, "pause_turn — продолжение тем же ходом");
  const p0 = calls[0] as unknown as Record<string, unknown>;
  assert.deepEqual(p0.tools, [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
  assert.ok(!(p0.output_config as Record<string, unknown>).format, "с поиском — без output_config.format (цитаты несовместимы)");
  assert.match((p0.system as { text: string }[])[0].text, /JSON-схема ответа/);
  assert.match((p0.system as { text: string }[])[0].text, /Источники ищи веб-поиском/);
  assert.match(String((calls[0].messages[0] as { content: string }).content), /продолжение ролика 01a/);
  const cont = calls[1].messages;
  assert.equal(cont[cont.length - 1].role, "assistant");
  assert.equal(((cont[cont.length - 1].content as { type: string }[])[0]).type, "server_tool_use", "пауза возвращена как есть");
  assert.equal(noNet.calls.length, 0);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].title, "Почему свой голос на записи звучит чужим. Часть 2");
  assert.equal(res.items[0].sequelOf, "01a");
  assert.equal(res.items[0].pillar, "why");
  const tokens = claudeCostUsd("claude-opus-5-5", { input: 3000, cacheWrite: 0, cacheRead: 0, output: 2000 }) * 2;
  assert.ok(Math.abs(res.usage[0].costUsd - (tokens + webSearchCostUsd(3))) < 1e-6, `стоимость с поисками: ${res.usage[0].costUsd}`);
  assert.equal(seenCalls.length, 1);
  assert.ok(Math.abs((seenCalls[0].costUsd ?? 0) - res.usage[0].costUsd) < 1e-9);
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
