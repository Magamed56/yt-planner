// Офлайн-проверка роликов на других языках: коды и имена файлов, выбор канала
// channels/<язык>.json, голос под язык, перевод сценария (проверка + ремонтный запрос на
// подменённом fetch), описание, подписи композиции и бренд-заставка на языке ролика. Сеть и ключи не нужны.
// Запуск: npx tsx src/dev/lang-test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyChannelDefaults } from "../pipeline/channel";
import { brandChannelOf, loadChannel, useLanguageChannel } from "../pipeline/channel-file";
import { applyLanguageVoice, captionFileName, channelFileForLang, langInfo, langScriptDir, langVideoName, normalizeLang, parseLangs, voiceLang } from "../pipeline/lang";
import { buildYoutubeMeta, metaText } from "../pipeline/meta";
import { buildVideoProps } from "../pipeline/props";
import { checkScriptTranslation, scriptTextOf, translateScript } from "../pipeline/script/translate";
import { coerceScriptCandidate } from "../pipeline/script/validate";
import { edgeDefaultVoice } from "../pipeline/voice/providers/edge";
import { resolvePiperVoice } from "../pipeline/voice/providers/piper";
import { parseLangArg, prepareLanguage, runLanguage, scriptLanguage } from "../cli/lang-run";
import { factsNote, langScriptName } from "../cli/script-lang";
import { BRAND_CHANNEL_PROP } from "../remotion/brand/jobs";
import { BRAND_TEXTS, brandTexts } from "../remotion/brand/texts";
import { uiText } from "../remotion/lib/ui-text";
import type { VideoScript } from "../types";

process.env.LLM_BUSY_WAIT_MS = "1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const demo = JSON.parse(fs.readFileSync(path.join(root, "examples", "demo-ru.json"), "utf8")) as VideoScript;
const log = { info: () => {}, warn: () => {} };

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

// ---- коды, имена ----

await test("языки: коды, синонимы, список через запятую, понятная ошибка", () => {
  assert.equal(normalizeLang("EN"), "en");
  assert.equal(normalizeLang("en-US"), "en");
  assert.equal(normalizeLang("kz"), "kk");
  assert.equal(normalizeLang("uz_Latn"), "uz");
  assert.equal(normalizeLang("xx"), null);
  assert.deepEqual(parseLangs("en, kk uz;en,xx"), { langs: ["en", "kk", "uz"], unknown: ["xx"] });
  assert.throws(() => langInfo("xx"), /не знаю/);
  assert.equal(parseLangArg("KZ"), "kk");
  assert.throws(() => parseLangArg("klingon"), /не знаю язык/);
});

await test("имена: scripts/<язык>/, «en-08a-<slug>.mp4» (русский — «08a-<slug>.mp4»), channels/<язык>.json", () => {
  assert.equal(langScriptDir("ru"), "scripts");
  assert.equal(langScriptDir("en"), "scripts/en");
  assert.equal(langVideoName("08a", "ru", "pochemu"), "08a-pochemu");
  assert.equal(langVideoName("08a", "en", "why-prices"), "en-08a-why-prices");
  // Панель узнаёт ролик русского канала по «08a-….mp4» — перевод под это правило не попадает.
  assert.ok(!/^(\d{2}[a-z])-.+\.mp4$/i.test(`${langVideoName("08a", "en", "why")}.mp4`));
  assert.equal(channelFileForLang("ru"), "channel.json");
  assert.equal(channelFileForLang("kk"), "channels/kk.json");
  assert.equal(captionFileName("uz"), "captions.uz.srt");
  assert.equal(langScriptName("08a", "Why prices end in 99", false), "sut-08a-why-prices-end-in-99");
  assert.equal(langScriptName("08a", "Почему цены", true), "razbor-08a-pochemu-tseny");
});

// ---- голос ----

await test("голос под язык: русский не трогаем; чужой TTS_VOICE меняем; kk/uz — Edge, у uz без Piper", () => {
  const ru: Record<string, string | undefined> = { TTS_VOICE: "ru-RU-SvetlanaNeural" };
  assert.deepEqual(applyLanguageVoice("ru", ru), ["TTS_LANGUAGE=ru"]);
  assert.equal(ru.TTS_VOICE, "ru-RU-SvetlanaNeural");

  const en: Record<string, string | undefined> = { TTS_PROVIDER: "auto", TTS_VOICE: "ru-RU-SvetlanaNeural" };
  applyLanguageVoice("en", en);
  assert.equal(en.TTS_LANGUAGE, "en");
  assert.equal(en.TTS_VOICE, "en-US-ChristopherNeural");
  assert.equal(en.TTS_PROVIDER, "auto"); // у английского есть Gemini TTS
  assert.equal(en.TTS_FALLBACK, undefined);
  const enOwn: Record<string, string | undefined> = { TTS_VOICE: "en-GB-RyanNeural" };
  applyLanguageVoice("en", enOwn);
  assert.equal(enOwn.TTS_VOICE, "en-GB-RyanNeural");

  const kk: Record<string, string | undefined> = {};
  applyLanguageVoice("kk", kk, "kk-KZ-AigulNeural");
  assert.equal(kk.TTS_PROVIDER, "edge");
  assert.equal(kk.TTS_VOICE, "kk-KZ-AigulNeural"); // голос из channels/kk.json важнее умолчания
  assert.equal(kk.TTS_FALLBACK, undefined); // Piper kk_KZ есть
  const kkGemini: Record<string, string | undefined> = { TTS_PROVIDER: "gemini" };
  applyLanguageVoice("kk", kkGemini);
  assert.equal(kkGemini.TTS_PROVIDER, "gemini"); // явный выбор человека сильнее

  const uz: Record<string, string | undefined> = {};
  applyLanguageVoice("uz", uz, "en-US-ChristopherNeural");
  assert.equal(uz.TTS_VOICE, "uz-UZ-SardorNeural");
  assert.equal(uz.TTS_FALLBACK, "edge"); // без Piper: запасной офлайн-голос заговорил бы по-русски
  assert.equal(voiceLang("kk_KZ-issai-high"), "kk");
  assert.equal(voiceLang("Charon"), null);
});

await test("Edge и Piper: голос по умолчанию — языка ролика (TTS_LANGUAGE); для русского — как раньше", () => {
  const prev = process.env.TTS_LANGUAGE;
  try {
    delete process.env.TTS_LANGUAGE;
    assert.equal(resolvePiperVoice(undefined), "ru_RU-dmitri-medium");
    assert.equal(resolvePiperVoice("ru-RU-SvetlanaNeural"), "ru_RU-irina-medium");
    assert.equal(edgeDefaultVoice(), "ru-RU-DmitryNeural");
    process.env.TTS_LANGUAGE = "en";
    assert.equal(resolvePiperVoice(undefined), "en_US-lessac-medium");
    assert.equal(resolvePiperVoice("en-US-ChristopherNeural"), "en_US-lessac-medium");
    assert.equal(resolvePiperVoice("kk-KZ-DauletNeural"), "kk_KZ-issai-high");
    assert.equal(edgeDefaultVoice(), "en-US-ChristopherNeural");
    assert.equal(edgeDefaultVoice("uz"), "uz-UZ-SardorNeural");
  } finally {
    if (prev === undefined) delete process.env.TTS_LANGUAGE;
    else process.env.TTS_LANGUAGE = prev;
  }
});

// ---- канал языка ----

await test("channels/en|kk|uz.json: та же схема; en — настоящий канал, kk/uz — заготовки; выбор файла по языку", () => {
  for (const lang of ["en", "kk", "uz"]) {
    const ch = loadChannel({ file: path.join(root, channelFileForLang(lang)), env: {} });
    assert.equal(ch.language, lang);
    assert.ok(ch.name && ch.cta.subscribe && ch.cta.comment && ch.cta.onScreenComment && ch.disclaimer);
    assert.ok(ch.hashtags.brand.length && ch.hashtags.core.length);
    assert.deepEqual(ch.hashtags.youtubeShorts, ["#shorts"]);
    const raw = fs.readFileSync(path.join(root, channelFileForLang(lang)), "utf8");
    if (lang === "en") {
      // Канал создан: заготовочных пометок нет, иначе make и панель продолжат звать «заменить».
      assert.equal(ch.placeholder, undefined, "en: «placeholder» удалён — канал создан");
      assert.doesNotMatch(raw, /"_todo"|"placeholder"/);
      continue;
    }
    assert.equal(ch.placeholder, true, `${lang}: «placeholder»: true — заменить после создания канала`);
    assert.equal(ch.links.youtube, null);
    assert.match(raw, /заменить после создания канала/);
  }
  // Ник — как в channel.json: без «@» (его добавляют картинки и подвал), ссылка — на этот ник.
  const en = loadChannel({ file: path.join(root, "channels", "en.json"), env: {} });
  assert.equal(en.name, "Gist in a Minute");
  assert.equal(en.handle, "GistinaMinute");
  assert.equal(en.links.youtube, "https://www.youtube.com/@GistinaMinute");
  assert.equal(en.links.instagram, null);
  const rawEn = JSON.parse(fs.readFileSync(path.join(root, "channels", "en.json"), "utf8")) as { handle?: unknown };
  const rawRu = JSON.parse(fs.readFileSync(path.join(root, "channel.json"), "utf8")) as { handle?: unknown };
  assert.equal(String(rawRu.handle).startsWith("@"), String(rawEn.handle).startsWith("@"), "handle хранится так же, как в channel.json");
  assert.equal(loadChannel({ file: path.join(root, "channel.json"), env: {} }).placeholder, undefined);
  const kk = loadChannel({ file: path.join(root, "channels", "kk.json"), env: {} });
  const env: NodeJS.ProcessEnv = {};
  applyChannelDefaults(kk, env);
  assert.equal(env.TTS_VOICE, "kk-KZ-DauletNeural");
  assert.equal(env.GEMINI_TTS_VOICE, undefined);

  const e1: NodeJS.ProcessEnv = { CHANNEL_NAME: "Суть за минуту" };
  assert.equal(useLanguageChannel("en", e1), "channels/en.json");
  assert.equal(e1.CHANNEL_FILE, "channels/en.json");
  // Имя русского канала из переменных репозитория не перебивает имя из channels/en.json.
  assert.equal(e1.CHANNEL_NAME, undefined);
  assert.equal(loadChannel({ env: e1 }).name, "Gist in a Minute");
  assert.equal(useLanguageChannel("ru", {}), null);
  const own: NodeJS.ProcessEnv = { CHANNEL_FILE: "my.json" };
  assert.equal(useLanguageChannel("en", own), null);
  assert.equal(own.CHANNEL_FILE, "my.json");
  assert.throws(() => useLanguageChannel("de", {}), /channels\/de\.json/);
});

await test("язык сборки: из сценария, --lang должен совпасть; загрузка для других языков запрещена", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-lang-"));
  const en = path.join(dir, "sut-08a-why.json");
  fs.writeFileSync(en, "﻿" + JSON.stringify({ ...demo, language: "en" }));
  assert.equal(scriptLanguage(en), "en");
  assert.equal(runLanguage({ script: en }), "en");
  assert.equal(runLanguage({ script: en, lang: "en" }), "en");
  assert.throws(() => runLanguage({ script: en, lang: "kk" }), /переведите/);
  assert.equal(runLanguage({ demo: true }), "ru");
  assert.equal(runLanguage({ lang: "uz" }), "uz");
  assert.equal(runLanguage({ script: path.join(root, "examples", "demo-ru.json") }), "ru");
  assert.throws(() => prepareLanguage("en", 1), /нельзя загрузить с --upload/);
  assert.equal(prepareLanguage("ru", 2), null);
  fs.rmSync(dir, { recursive: true, force: true });
  // Язык задаёт запрос: модель любит оставлять "ru" из примера в промпте.
  const cand = coerceScriptCandidate({ ...demo, language: "ru" }, { format: "shorts", language: "en" }) as { language: string };
  assert.equal(cand.language, "en");
  assert.equal((coerceScriptCandidate({ ...demo, language: "en" }, { format: "shorts" }) as { language: string }).language, "en");
});

// ---- перевод сценария ----

// «Перевод» демо: те же сцены, английские слова в том же количестве.
function fakeTranslation(src: VideoScript, patch: (t: ReturnType<typeof scriptTextOf>) => void = () => {}) {
  const t = scriptTextOf(src);
  t.title = "Why you forget 66% of what you learn in a day";
  t.description = "The Ebbinghaus forgetting curve and how to remember for longer.\n#memory #learning #shorts";
  t.tags = ["memory", "brain", "learning"];
  t.scenes = t.scenes.map((s, i) => ({
    ...s,
    narration: s.narration.split(/\s+/).map((_, k) => (k === 0 ? `Scene${"abcdefgh"[i]}` : "word")).join(" ") + ".",
    onScreen: i === 0 ? "You will *forget* almost everything" : `Point *${i}*`,
    ...(s.items ? { items: s.items.map((_, k) => `Item ${k + 1}`) } : {}),
    ...(s.statLabel ? { statLabel: "forgotten within a day" } : {}),
  }));
  patch(t);
  return t;
}

await test("перевод сценария: те же сцены, числа, иконки и запросы стоков; язык — en", () => {
  const v = checkScriptTranslation(demo, fakeTranslation(demo), "en");
  assert.ok(v.ok, v.ok ? "" : v.problems.join("\n"));
  const s = v.value;
  assert.equal(s.language, "en");
  assert.equal(s.scenes.length, demo.scenes.length);
  const stat = demo.scenes.findIndex((x) => x.stat);
  assert.equal(s.scenes[stat]!.stat!.value, demo.scenes[stat]!.stat!.value);
  assert.equal(s.scenes[stat]!.stat!.label, "forgotten within a day");
  assert.deepEqual(
    s.scenes.map((x) => [x.id, x.kind, x.icon, x.visualQuery]),
    demo.scenes.map((x) => [x.id, x.kind, x.icon, x.visualQuery]),
  );
  assert.equal(s.theme, demo.theme);
  assert.equal(s.title, "Why you forget 66% of what you learn in a day");
});

await test("перевод сценария: лишняя/пропущенная сцена, кириллица, объём речи — в ремонт", () => {
  const fewer = checkScriptTranslation(demo, fakeTranslation(demo, (t) => t.scenes.pop()), "en");
  assert.ok(!fewer.ok && fewer.problems.some((p) => /сцен в ответе/.test(p)));
  const cyr = checkScriptTranslation(demo, fakeTranslation(demo, (t) => (t.scenes[1]!.narration = demo.scenes[1]!.narration)), "en");
  assert.ok(!cyr.ok && cyr.problems.some((p) => /осталась кириллица/.test(p)));
  const short = checkScriptTranslation(demo, fakeTranslation(demo, (t) => t.scenes.forEach((s) => (s.narration = "Short."))), "en");
  assert.ok(!short.ok && short.problems.some((p) => /короче/.test(p)));
  const list = demo.scenes.findIndex((x) => x.items);
  const items = checkScriptTranslation(demo, fakeTranslation(demo, (t) => (t.scenes[list]!.items = ["Only one"])), "en");
  assert.ok(!items.ok && items.problems.some((p) => /items/.test(p)));
  const kkSame = checkScriptTranslation(demo, scriptTextOf(demo), "kk");
  assert.ok(!kkSame.ok && kkSame.problems.some((p) => /совпадают с русским/.test(p)));
});

await test("translateScript: ответ без сцены → ремонтный запрос → перевод; факты темы — в запросе", async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const chat = (content: string) => json({ model: "gemini-test", choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const replies = [chat(JSON.stringify(fakeTranslation(demo, (t) => t.scenes.pop()))), chat(JSON.stringify(fakeTranslation(demo)))];
  const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return replies.shift() ?? Promise.reject(new Error("лишний запрос"));
  };
  const notes = factsNote({ keyFacts: [{ claim: "Кривая забывания, 1885", source: "https://example.com/ebbinghaus" }] });
  const r = await translateScript(demo, "en", { env: { GEMINI_API_KEY: "k", LLM_FALLBACKS: "none" }, fetch: fetchMock, log, notes });
  assert.equal(r.script.language, "en");
  assert.equal(bodies.length, 2);
  const user = bodies[0]!.messages.find((m) => m.role === "user")!.content;
  assert.match(user, /English \(en\)/);
  assert.match(user, /example\.com\/ebbinghaus/);
  assert.match(bodies[1]!.messages.at(-1)!.content, /сцен в ответе/);
  await assert.rejects(translateScript({ ...demo, language: "en" }, "en", { env: { GEMINI_API_KEY: "k" }, fetch: fetchMock, log }), /уже на языке/);
});

// ---- описание и подписи композиции ----

await test("описание на языке ролика: подвал и хэштеги из channels/en.json, служебные строки по-английски", () => {
  const ch = loadChannel({ file: path.join(root, "channels", "en.json"), env: {} });
  const v = checkScriptTranslation(demo, fakeTranslation(demo), "en");
  assert.ok(v.ok);
  const meta = buildYoutubeMeta({
    script: v.value,
    format: "shorts",
    visualCredits: [{ provider: "Pexels", author: "Ann", url: "https://pexels.com/1" }],
    musicCredit: "Track by Someone (CC BY)",
    voiceProvider: "edge",
    channel: ch,
  });
  assert.equal(meta.defaultLanguage, "en");
  assert.match(meta.description, /Video and photos:/);
  assert.match(meta.description, /Music: Track by Someone/);
  assert.match(meta.description, /Subscribe for a new gist every day/);
  assert.match(meta.description, /#gistinaminute/);
  assert.match(meta.description, /#shorts/);
  assert.doesNotMatch(meta.description, /[А-Яа-яЁё]/);
  assert.ok(meta.tags.includes("gist in a minute"));
  // Русский — как раньше.
  const ru = buildYoutubeMeta({ script: demo, format: "shorts", visualCredits: [{ provider: "Pexels", author: "Ann", url: null }], musicCredit: null, voiceProvider: "edge", channel: loadChannel({ file: path.join(root, "channel.json"), env: {} }) });
  assert.match(ru.description, /Видео и фото:/);
  assert.equal(metaText("de").media, "Video and photos:");
  assert.match(metaText("kk").chapters, /Уақыт/);
});

await test("подписи композиции: язык ролика, старые props без языка — по-русски", () => {
  assert.equal(uiText(undefined).subscribe, "Подписаться");
  assert.equal(uiText("ru").quizTitle, "ПРАВДА ИЛИ МИФ?");
  assert.equal(uiText("en").subscribe, "Subscribe");
  assert.equal(uiText("en").chapter(2), "CHAPTER 2");
  assert.equal(uiText("en").decimal, ".");
  assert.equal(uiText("kk").chapter(3), "3-ТАРАУ");
  assert.equal(uiText("uz").truth, "HAQIQAT");
  assert.equal(uiText("de").subscribe, "Subscribe");
});

await test("надписи бренд-кита: русские как были, английские для channels/en.json, у созданного канала язык есть", () => {
  const ru = brandTexts("ru");
  assert.equal(ru.perDay(2), "2 ролика в день");
  assert.equal(ru.perDay(1), "1 ролик в день");
  assert.equal(ru.schedule(2), "2 новых ролика в день");
  assert.equal(ru.schedule(1), "Новый ролик каждый день");
  assert.equal(ru.hello, "Знакомство");
  assert.equal(ru.markWord, "просто");
  assert.equal(brandTexts(undefined), ru, "старый channel.json без language — русский");
  const en = brandTexts("en");
  assert.equal(en.perDay(2), "2 videos a day");
  assert.equal(en.schedule(2), "2 new videos a day");
  assert.equal(en.schedule(1), "New video every day");
  assert.match("Complex made simple. Every day", new RegExp(en.markWord));
  assert.doesNotMatch(Object.values(en.short).join(" ") + en.hello + Object.values(en.about).join(""), /[А-Яа-яЁё]/);
  assert.equal(brandTexts("de"), en, "языка нет — английский, а не русский");
  // Каждая рубрика созданного канала подписана на его языке; заготовкам (kk, uz) кит не рисуется.
  for (const lang of ["ru", "en", "kk", "uz"]) {
    const ch = JSON.parse(fs.readFileSync(path.join(root, channelFileForLang(lang)), "utf8")) as { placeholder?: boolean; language?: string; pillars: { id: string }[] };
    if (ch.placeholder) continue;
    const texts = BRAND_TEXTS[ch.language ?? "ru"];
    assert.ok(texts, `${lang}: нет надписей бренд-кита в src/remotion/brand/texts.ts`);
    for (const p of ch.pillars) assert.ok(texts.short[p.id], `${lang}: нет короткой подписи рубрики ${p.id}`);
  }
});

await test("заставка ролика: канал языка (channels/en.json) — в props и в название бренда; русский ролик — без ключа", async () => {
  const voices = demo.scenes.map(() => ({ file: "", durationMs: 1500, words: [], wordsSource: "estimated" as const }));
  const props = (script: VideoScript, brandChannel: Record<string, unknown> | null) =>
    buildVideoProps({ script, publicDir: os.tmpdir(), voices, music: null, whooshSrc: null, brandIntro: true, brandChannel, channelName: null }) as unknown as Record<string, unknown>;

  // Как в make: --lang en → CHANNEL_FILE=channels/en.json → loadChannel → props.
  const env: NodeJS.ProcessEnv = {};
  useLanguageChannel("en", env);
  const en = props({ ...demo, language: "en" }, brandChannelOf(loadChannel({ env })));
  const brand = en[BRAND_CHANNEL_PROP] as { name?: string; language?: string } | undefined;
  assert.equal(brand?.name, "Gist in a Minute");
  assert.equal(brand?.language, "en");

  // Русский ролик (channel.json) и ролик без файла канала — ключа нет, props.json как раньше.
  const ru = props(demo, brandChannelOf(loadChannel({ env: {} })));
  assert.equal(BRAND_CHANNEL_PROP in ru, false);
  assert.equal(brandChannelOf({ file: null }), null);
  assert.equal(brandChannelOf({ file: path.join(root, ".", "channel.json") }), null);

  // data.ts в браузере рендера читает inputProps через getInputProps() (window.remotion_inputProps):
  // с props английского ролика название бренда — английское (без ключа — channel.json из бандла).
  // BRAND считается один раз при загрузке модуля — поэтому только динамический импорт после window:
  // статический импорт data.ts (в т. ч. через другой модуль) в этом файле молча даст русский BRAND.
  const g = globalThis as { window?: unknown };
  g.window = { remotion_inputProps: JSON.stringify(en), location: { origin: "http://localhost" } };
  try {
    const { BRAND, splitName } = await import("../remotion/brand/data");
    assert.equal(BRAND.name, "Gist in a Minute");
    assert.deepEqual(splitName(BRAND.name), ["GIST", "IN A MINUTE"]);
    assert.equal(BRAND.language, "en");
  } finally {
    delete g.window;
  }
});

console.log(`\nlang-test: ${passed} проверок пройдено`);
