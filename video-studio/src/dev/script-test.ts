// Офлайн-проверка модуля сценария: generate → parse → validate → repair на
// подменённой сети (fetch) и подменённом клиенте Claude. Ключи и интернет не
// нужны. Запуск: npx tsx src/dev/script-test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { extractJson, generateScript, lintScript, ScriptValidationError, validateScript } from "../pipeline/script/index";
import type { AnthropicLike } from "../pipeline/script/llm/claude";
import { claudeCostUsd } from "../pipeline/script/pricing";
import { parsePlan, planNotes, scriptCode } from "../pipeline/plan";
import type { VideoScript } from "../types";

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
      narration: kind === "hook" ? "Ты тренируешь память неправильно, и вот почему." : words(26, opts.seed + i),
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

await test("План: 60 тем с кодами, код из имени сценария, пожелания — хук, угол и факты с источниками", () => {
  const plan = parsePlan(JSON.parse(readFileSync(path.join(root, "content", "plan.json"), "utf8")));
  assert.equal(plan.items.length, 60);
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

console.log(`\nВсе проверки пройдены: ${passed}.`);
