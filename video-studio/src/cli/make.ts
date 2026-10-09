// Одна команда → готовый ролик:
//   тема (LLM) или готовый JSON → озвучка → визуал → музыка → props →
//   субтитры/описание/стоимость → рендер MP4 + обложки → (YouTube, Instagram).
// Умолчания канала (имя, голос, хэштеги, подвал описания, слоты) — из channel.json.
//
//   npm run make -- --demo
//   npm run make -- --topic "Почему мы забываем" --format shorts
//   npm run make -- --script scripts/pochemu-my-zabyvaem.json --upload youtube --privacy private
//   npm run make -- --script scripts/x.json --upload youtube,instagram --schedule
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { FPS, THEME_NAMES, layoutScenes, type Format, type ThemeName, type VideoProps, type VideoScript } from "../types";
import type { Credit, LlmUsage, VisualResult, VoiceProvider, VoiceResult } from "../pipeline/contracts";
import { makeSfx, prepareMusic } from "../pipeline/audio/index";
import { applyChannelDefaults, applyPillarVoice, brandIntroEnabled, type ChannelConfig } from "../pipeline/channel";
import { loadChannel } from "../pipeline/channel-file";
import { coverFrame, frameToMs, renderCover } from "../pipeline/cover";
import { buildInstagramCaption, instagramEnvHelp, missingInstagramEnv, publishRunDir, writeInstagramAssets, type InstagramMeta, type RunDirPublishResult } from "../pipeline/instagram";
import { buildYoutubeMeta, descriptionTxt, youtubeChapters } from "../pipeline/meta";
import { buildVideoProps } from "../pipeline/props";
import { qcMode, qcSummary, runQc, writeQc, type QcReport } from "../pipeline/qc";
import { checkBrowserEnv, preparePublicDir, renderVideo, type RenderResult } from "../pipeline/render";
import { generateScript, lintScript, ScriptGenerationError } from "../pipeline/script/index";
// Журнал расхода (content/usage.jsonl) и «уже было на канале» — см. src/pipeline/script/.
import { coveredCode, loadCovered } from "../pipeline/script/covered";
import { searchPhrases } from "../pipeline/script/suggest";
import { appendUsage, countPostRequests, llmUsageRecord, ttsUsageRecord, type LlmCallInfo, type UsageRecord } from "../pipeline/script/usage-log";
import { GEMINI_DEFAULT_MODEL } from "../pipeline/voice/providers/gemini";
import { applyLanguageVoice } from "../pipeline/lang";
import { slugify } from "../pipeline/slug";
import { captionsToSrt } from "../pipeline/srt";
import { parsePlan, scriptCode } from "../pipeline/plan";
import { findVisual, realFirstForPillar } from "../pipeline/visuals/index";
import { readVisualsManifest, reusableEntry, visualKey, writeVisualsManifest, type ManifestEntry } from "../pipeline/visuals/manifest";
import { getVoiceProvider, resolvePiperVoice } from "../pipeline/voice/index";
import { EDGE_DEFAULT_VOICE } from "../pipeline/voice/providers/edge";
import { PRIVACY_VALUES, missingYoutubeEnv, uploadToYoutube, youtubeEnvHelp, type Privacy, type UploadResult } from "../pipeline/youtube";
import {
  ROOT,
  Steps,
  UserError,
  argsError,
  escapeMd,
  fail,
  fmtDuration,
  ghOutput,
  ghSummary,
  loadEnv,
  rel,
  reportFailedLlmUsage,
  resolveInputPath,
  writeJson,
  writeYoutubeResult,
} from "./common";
import { SCHEDULE_HELP, describePublishAt, parseUploadTargets, resolvePublishAt, scheduleArgsFrom, wantsSchedule, type ScheduleArgs, type UploadTarget } from "./publish-options";
import { loadScriptFile } from "./scriptFile";
import { parseLangArg, prepareLanguage, runLanguage } from "./lang-run";

const HELP = `Сборка ролика одной командой.

  npm run make -- --demo                         демо-сценарий examples/demo-ru.json
  npm run make -- --topic "тема"                 сценарий напишет LLM (по умолчанию бесплатный Gemini)
  npm run make -- --script scripts/<файл>.json   свой или отредактированный сценарий

Параметры:
  --format shorts|landscape    формат (по умолчанию из сценария, для --topic — shorts)
  --theme  midnight|sunset|emerald|mono   палитра (по умолчанию из сценария)
  --voice  auto|gemini|edge|piper|elevenlabs|openai|fish   провайдер озвучки (иначе TTS_PROVIDER; auto — Gemini при ключе, иначе Edge)
  --lang   en|kk|uz|…          язык ролика (иначе — из сценария): канал channels/<язык>.json, голос языка; без --upload
  --notes  "..."               пожелания к сценарию (только с --topic)
  --seconds N                  желаемая длительность (только с --topic)
  --mood   calm|inspiring|upbeat|tech|dark   настроение музыки (иначе MUSIC_MOOD)
  --out    out/                куда класть папку ролика (по умолчанию out/)
  --no-render                  только подготовить звук, визуал и props.json
  --concurrency N              сколько кадров рендерить параллельно (иначе RENDER_CONCURRENCY / авто)
  --upload youtube|instagram|youtube,instagram   опубликовать после рендера
  --privacy private|unlisted|public   видимость на YouTube (по умолчанию private)
${SCHEDULE_HELP}

Instagram публикуется сразу (у API нет отложенной публикации); по расписанию —
через workflow, см. docs/instagram-setup.md. Настройки канала — channel.json.
`;

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_") || "scene";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Args {
  topic?: string;
  script?: string;
  demo: boolean;
  format?: Format;
  theme?: ThemeName;
  voice?: string;
  lang?: string;
  notes?: string;
  seconds?: number;
  mood?: string;
  out: string;
  render: boolean;
  concurrency?: number;
  upload: Set<UploadTarget>;
  privacy: Privacy;
  schedule: ScheduleArgs;
}

function parse(): Args {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        topic: { type: "string" },
        script: { type: "string" },
        demo: { type: "boolean", default: false },
        format: { type: "string" },
        theme: { type: "string" },
        voice: { type: "string" },
        lang: { type: "string" },
        notes: { type: "string" },
        seconds: { type: "string" },
        mood: { type: "string" },
        out: { type: "string" },
        "no-render": { type: "boolean", default: false },
        concurrency: { type: "string" },
        upload: { type: "string" },
        privacy: { type: "string" },
        "publish-at": { type: "string" },
        schedule: { type: "boolean", default: false },
        "schedule-slot": { type: "string" },
        "schedule-start": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const str = (k: string) => {
    const v = values[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const sources = [str("topic") ? "--topic" : null, str("script") ? "--script" : null, values.demo ? "--demo" : null].filter(Boolean);
  if (sources.length === 0) throw new UserError(`Укажите, откуда взять сценарий: --topic "тема", --script файл.json или --demo.\n\n${HELP}`);
  if (sources.length > 1) throw new UserError(`Выберите что-то одно из ${sources.join(", ")}.`);

  const format = str("format");
  if (format && format !== "shorts" && format !== "landscape") throw new UserError(`--format: shorts или landscape, а не «${format}».`);
  const theme = str("theme");
  if (theme && theme !== "auto" && !THEME_NAMES.includes(theme as ThemeName)) throw new UserError(`--theme: одна из ${THEME_NAMES.join(", ")}.`);
  const upload = parseUploadTargets(str("upload"));
  const schedule = scheduleArgsFrom(values);
  if (wantsSchedule(schedule) && !upload.has("youtube")) throw new UserError("Расписание (--schedule, --schedule-slot, --publish-at) — для YouTube: добавьте --upload youtube.");
  const privacy = (str("privacy") ?? "private") as Privacy;
  if (!PRIVACY_VALUES.includes(privacy)) throw new UserError(`--privacy: ${PRIVACY_VALUES.join(" | ")}.`);
  const num = (k: string) => {
    const v = str(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new UserError(`--${k}: нужно положительное число, а не «${v}».`);
    return n;
  };
  return {
    topic: str("topic"),
    script: str("script"),
    demo: Boolean(values.demo),
    format: format as Format | undefined,
    theme: theme && theme !== "auto" ? (theme as ThemeName) : undefined,
    voice: str("voice"),
    lang: parseLangArg(str("lang")),
    notes: str("notes"),
    seconds: num("seconds"),
    mood: str("mood"),
    out: path.resolve(str("out") ?? path.join(ROOT, "out")),
    render: !values["no-render"],
    concurrency: num("concurrency"),
    upload,
    privacy,
    schedule,
  };
}

// ---- Озвучка ----

async function synthesizeAll(provider: VoiceProvider, script: VideoScript, publicDir: string): Promise<VoiceResult[]> {
  if (provider.synthesizeMany) {
    // Квота «на запросы» (Gemini): весь ролик одним-двумя запросами, а не по сцене.
    const items = script.scenes.map((scene) => ({ text: scene.narration, outFileBase: path.join(publicDir, "voice", safeId(scene.id)) }));
    const results = await provider.synthesizeMany(items);
    for (const [i, r] of results.entries()) logVoice(script.scenes[i]!, r);
    return results;
  }
  const out: VoiceResult[] = [];
  for (const [i, scene] of script.scenes.entries()) {
    const base = path.join(publicDir, "voice", safeId(scene.id));
    let result: VoiceResult | null = null;
    for (let attempt = 1; !result; attempt++) {
      try {
        result = await provider.synthesize(scene.narration, base);
      } catch (e) {
        // Первая сцена не повторяется: если провайдер недоступен, быстрее
        // перейти на запасной, чем ждать таймауты на каждой сцене.
        if (i === 0 || attempt >= 2) throw e;
        console.warn(`  ${scene.id}: ${errText(e)} — ещё одна попытка через 5 с…`);
        await sleep(5000);
      }
    }
    logVoice(scene, result);
    out.push(result);
  }
  return out;
}

function logVoice(scene: VideoScript["scenes"][number], result: VoiceResult): void {
  const src = result.wordsSource === "provider" ? "тайминги от провайдера" : "тайминги оценены по звуку";
  console.log(`  ${scene.id} (${scene.kind}): ${(result.durationMs / 1000).toFixed(2)} с, ${result.words.length} слов, ${src}`);
}

// Имя голоса для описания — только там, где оно понятно зрителю.
function voiceLabel(provider: string): string | null {
  const v = process.env.TTS_VOICE?.trim();
  if (provider === "edge") return v && /Neural$/.test(v) ? v : EDGE_DEFAULT_VOICE;
  if (provider === "piper") return resolvePiperVoice(v);
  return null;
}

// Модель TTS для журнала расхода — там, где она настраивается.
function ttsModel(provider: string): string | null {
  const env = (name: string) => process.env[name]?.trim() || null;
  if (provider === "gemini") return env("GEMINI_TTS_MODEL") ?? GEMINI_DEFAULT_MODEL;
  if (provider === "elevenlabs") return env("ELEVENLABS_MODEL");
  if (provider === "openai") return env("OPENAI_TTS_MODEL");
  return null;
}

function fallbackProviderNames(primary: string): string[] {
  const raw = process.env.TTS_FALLBACK?.trim().toLowerCase();
  if (raw === "none" || raw === "off" || raw === "0") return [];
  if (raw) return raw.split(",").map((v) => v.trim()).filter((v) => v && v !== primary);
  // Edge — неофициальный API, его могут закрыть или ограничить для IP
  // датацентров; Piper работает офлайн везде. У Gemini маленькая суточная
  // квота — кончилась, значит весь ролик озвучит Edge (а если и он недоступен — Piper).
  // Платные (ElevenLabs) и локальные серверы выбирают осознанно — их молча не подменяем.
  if (primary === "gemini") return ["edge", "piper"];
  if (primary === "edge") return ["piper"];
  return [];
}

// ---- main ----

async function main() {
  const tStart = Date.now();
  const envFile = loadEnv();
  const args = parse();
  if (args.voice) process.env.TTS_PROVIDER = args.voice;
  // Язык ролика (--lang или из сценария scripts/en/…): не русский — свой канал, голос и подписи.
  const lang = runLanguage(args);
  const langChannel = prepareLanguage(lang, args.upload.size);

  console.log("video-studio · сборка ролика");
  if (envFile) console.log(`  настройки: ${rel(envFile)}`);
  let channel: ChannelConfig;
  try {
    channel = loadChannel();
  } catch (e) {
    throw new UserError(errText(e));
  }
  // Рубрика темы из content/plan.json (для сценариев sut-08a-….json): реальные фото для истории/природы/космоса.
  const pillar = planPillar(args.script);
  // Голос и темп рубрики (channel.json → voiceByPillar) — до умолчаний канала: важнее голоса
  // канала, но слабее --voice и переменных окружения.
  const pillarVoice = applyPillarVoice(channel, pillar);
  if (pillarVoice.length) console.log(`  рубрика «${pillar}»: голос — ${pillarVoice.join(", ")}`);
  // Голос Gemini, его манера и подпись «облачка» — из канала, если не заданы в окружении.
  const applied = applyChannelDefaults(channel);
  if (channel.file) console.log(`  канал: «${channel.name ?? "без названия"}» (${rel(channel.file)})${applied.length ? `, умолчания: ${applied.join(", ")}` : ""}`);
  const langVoice = applyLanguageVoice(lang, process.env, channel.voice.name);
  if (lang !== "ru") console.log(`  язык ролика: ${lang}${langChannel ? `, канал ${langChannel}` : ""}${langVoice.length ? `, голос: ${langVoice.join(", ")}` : ""}`);
  if (channel.placeholder) console.warn(`  ⚠ ${channel.file ? rel(channel.file) : "канал"} — заготовка: имя и ссылки заменить после создания канала.`);

  // Проверки до долгих шагов: ключи и браузер.
  let voice = getVoiceProvider(args.voice);
  if (args.upload.has("youtube")) {
    const missing = missingYoutubeEnv();
    if (missing.length) throw new UserError(`--upload youtube: не заданы ${missing.join(", ")}.\n${youtubeEnvHelp()}`);
  }
  if (args.upload.has("instagram")) {
    const missing = missingInstagramEnv();
    if (missing.length) throw new UserError(`--upload instagram: не заданы ${missing.join(", ")}.\n${instagramEnvHelp()}`);
  }
  if (args.render) checkBrowserEnv();

  const steps = new Steps(7 + args.upload.size);
  const usage: LlmUsage[] = [];

  // 1. Сценарий
  let script = await steps.run("Сценарий", async () => {
    let s: VideoScript;
    if (args.topic) {
      const format = args.format ?? "shorts";
      console.log(`  тема: «${args.topic}», формат: ${format}`);
      let r: Awaited<ReturnType<typeof generateScript>>;
      const llmCalls: LlmCallInfo[] = []; // → content/usage.jsonl
      try {
        r = await generateScript(
          { topic: args.topic, format, language: lang, notes: args.notes, targetSeconds: args.seconds, covered: loadCovered(ROOT), searchPhrases: searchPhrases(args.topic) },
          { onLlmCall: (c) => llmCalls.push(c) },
        );
      } catch (e) {
        if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, args.out);
        throw e;
      } finally {
        appendUsage(ROOT, llmCalls.map((c) => llmUsageRecord(c, null)));
      }
      for (const w of r.warnings) console.log(`  замечание: ${w}`);
      usage.push(...r.usage);
      s = r.script;
      const cost = r.usage.reduce((a, u) => a + u.costUsd, 0);
      const last = r.usage.at(-1);
      console.log(`  написал: ${last ? `${last.provider} · ${last.model}` : "LLM"}, стоимость $${cost.toFixed(4)}`);
    } else {
      const file = args.demo ? path.join(ROOT, "examples", "demo-ru.json") : (args.script as string);
      s = loadScriptFile(file);
      console.log(`  файл: ${args.demo ? "examples/demo-ru.json (демо)" : file}`);
    }
    for (const w of lintScript(s)) console.log(`  замечание: ${w}`);
    return s;
  });
  if (args.format && args.format !== script.format) script = { ...script, format: args.format };
  if (args.theme) script = { ...script, theme: args.theme };
  else if (!script.theme && channel.theme) script = { ...script, theme: channel.theme };
  const format = script.format;
  const slug = slugify(script.title);
  const source = runSource(args, script);
  const { runDir, busy } = chooseRunDir(args.out, slug, source);
  if (busy) console.log(`  папка ${rel(path.join(args.out, slug))} занята другим сценарием (${busy}) — пишу в новую`);
  const publicDir = preparePublicDir(runDir);
  writeJson(path.join(runDir, SOURCE_FILE), { source, title: script.title, updatedAt: new Date().toISOString() });
  writeJson(path.join(runDir, "script.json"), script);
  // Сразу, а не в конце: если озвучка или рендер упадут, workflow всё равно
  // сохранит сценарий (особенно ценен написанный LLM — квота/деньги потрачены).
  ghOutput({ slug, run_dir: rel(runDir), title: script.title });
  console.log(`  «${script.title}» — ${script.scenes.length} сцен, ${format}, тема ${script.theme ?? "midnight"}`);
  console.log(`  папка ролика: ${rel(runDir)}`);

  // 2. Озвучка
  let voices: VoiceResult[] = [];
  const ttsUsage: UsageRecord[] = []; // → content/usage.jsonl (запросы и символы по провайдерам)
  const usageCode = args.script ? coveredCode(path.basename(args.script)) : null;
  voices = await steps.run("Озвучка", async () => {
    console.log(`  провайдер: ${voice.name}`);
    const fallbacks = fallbackProviderNames(voice.name);
    try {
      for (;;) {
        const t0 = Date.now() - 1000; // запас на грубое время изменения файла
        const run = await countPostRequests(() => synthesizeAll(voice, script, publicDir));
        if (run.value) {
          // Озвучено сейчас (а не взято из кэша прошлого запуска) — по времени файла.
          const fresh = run.value.map((v, i) => ({ v, i })).filter(({ v }) => fs.existsSync(v.file) && fs.statSync(v.file).mtimeMs >= t0);
          const chars = fresh.reduce((a, { i }) => a + script.scenes[i]!.narration.length, 0);
          const calls = run.posts > 0 ? run.posts : fresh.length;
          if (calls > 0) ttsUsage.push(ttsUsageRecord({ provider: voice.name, model: ttsModel(voice.name), calls, chars, costUsd: voice.name === "elevenlabs" ? null : 0 }, usageCode));
          return run.value;
        }
        const e = run.error;
        // Неудачные запросы тоже тратят квоту (Gemini — ~10 в сутки): пишем и их.
        if (run.posts > 0) ttsUsage.push(ttsUsageRecord({ provider: voice.name, model: ttsModel(voice.name), calls: run.posts, chars: null, costUsd: voice.name === "elevenlabs" ? null : 0 }, usageCode));
        const fb = fallbacks.shift();
        if (!fb) {
          const alt = voice.name === "piper" ? "--voice edge" : "--voice piper (офлайн)";
          throw new UserError(`Озвучка через ${voice.name} не удалась: ${errText(e)}\n  Попробуйте другой провайдер: ${alt}. Все варианты — npm run make -- --help.`);
        }
        // Весь ролик заново — чтобы в нём был один голос, а не два.
        console.warn(`  ⚠ ${voice.name} не работает: ${errText(e).split("\n")[0]}\n  Озвучиваю весь ролик запасным провайдером ${fb} (TTS_FALLBACK=none — отключить).`);
        voice = getVoiceProvider(fb);
      }
    } finally {
      appendUsage(ROOT, ttsUsage);
    }
  });
  const voiceDurationMs = voices.reduce((a, v) => a + v.durationMs, 0);

  // 3. Визуал
  const visuals: VisualResult[] = await steps.run("Визуал", async () => {
    // Визуал прошлого запуска этой папки берём повторно, если входы сцены не
    // менялись (manifest.ts): квоты стоков и генерации не тратятся заново.
    const prev = readVisualsManifest(publicDir);
    const next: Record<string, ManifestEntry> = {};
    const minDur = (i: number) => voices[i].durationMs / 1000 + 0.8;
    const realFirst = realFirstForPillar(pillar);
    if (realFirst) console.log(`  рубрика «${pillar}»: сначала реальные фото (Wikimedia Commons, Openverse)`);
    const keys = script.scenes.map((scene) => visualKey(scene, format, process.env, { realFirst }));
    const reused = script.scenes.map((scene, i) => reusableEntry(prev[scene.id], keys[i], publicDir, minDur(i)));
    // Клипы, которые остаются, — сразу в usedIds: заново подобранные сцены их не повторят.
    const usedIds = new Set<string>(reused.flatMap((e) => (e?.candidateId ? [e.candidateId] : [])));
    const out: VisualResult[] = [];
    // По очереди, а не параллельно: у стоков лимиты запросов в час.
    for (const [i, scene] of script.scenes.entries()) {
      const old = reused[i];
      let r: VisualResult;
      let candidateId: string | null = null;
      if (old) {
        r = old.result;
        candidateId = old.candidateId;
      } else {
        const before = new Set(usedIds);
        r = await findVisual(scene, { format, publicDir, sceneIndex: i, minDurationSec: minDur(i), usedIds, realFirst });
        candidateId = [...usedIds].find((id) => !before.has(id)) ?? null;
      }
      next[scene.id] = { key: keys[i], result: r, candidateId, minDurationSec: minDur(i) };
      out.push(r);
      const v = r.visual;
      if (v.type !== "none") console.log(`  ${scene.id}: ${v.type === "video" ? `видео ${v.durationSec.toFixed(1)} с` : "картинка"} — ${r.credit?.provider ?? "?"}${r.credit?.author ? `, ${r.credit.author}` : ""}${old ? " (из прошлого запуска)" : ""}`);
    }
    writeVisualsManifest(publicDir, next);
    const found = out.filter((r) => r.visual.type !== "none").length;
    const again = reused.filter(Boolean).length;
    console.log(`  визуал найден для ${found} из ${out.length} сцен${found < out.length ? " (остальные — чистая моушен-графика)" : ""}`);
    if (again) console.log(`  ${again} — из прошлого запуска; подобрать заново: удалите ${rel(path.join(publicDir, "visuals"))}`);
    return out;
  });

  // 4. Музыка и звук перехода
  // Бренд-заставка ≤ 0,5 с поверх начала хука: channel.json → brandIntro, BRAND_INTRO=off|on.
  const brandIntro = brandIntroEnabled(channel);
  const { music, whooshSrc, sfx } = await steps.run("Музыка и звук перехода", async () => {
    fs.rmSync(path.join(publicDir, "music"), { recursive: true, force: true });
    fs.rmSync(path.join(publicDir, "sfx"), { recursive: true, force: true });
    // Длина — по той же раскладке, что у props: с паузами викторины и карточками глав.
    const durationMs = Math.round((layoutScenes(script.scenes.map((s, i) => ({ ...s, audioDurationMs: Math.max(0, Math.round(voices[i]!.durationMs)) }))).durationInFrames / FPS) * 1000);
    const music = await prepareMusic(publicDir, { durationMs, mood: args.mood || process.env.MUSIC_MOOD?.trim() || undefined, seed: slug });
    if (!music) console.log("  без музыки (MUSIC=none)");
    // Свист переходов (3 варианта) + звуки монтажа: пункты, удар цифры, искра заставки (SFX=whoosh|off).
    const { whooshSrc, sfx } = await makeSfx(publicDir, { sting: brandIntro });
    return { music, whooshSrc, sfx };
  });

  // 5. Props композиции
  const props = await steps.run("Сборка таймлинии (props.json)", async () => {
    const p = buildVideoProps({ script, publicDir, voices, visuals, music, whooshSrc, sfx, brandIntro, format, theme: script.theme, channelName: channel.name });
    writeJson(path.join(runDir, "props.json"), p);
    console.log(`  длительность ${(p.durationInFrames / FPS).toFixed(1)} с (${p.durationInFrames} кадров), голос ${(voiceDurationMs / 1000).toFixed(1)} с, слов в субтитрах: ${p.captions.length}`);
    return p;
  });

  // 6. Субтитры, описание, стоимость — до рендера: пригодятся, даже если рендер упадёт.
  const files = await steps.run("Субтитры, описание и стоимость", async () => {
    const srt = path.join(runDir, "captions.srt");
    fs.writeFileSync(srt, captionsToSrt(props.captions, { maxLineChars: format === "shorts" ? 32 : 42 }));
    const meta = buildYoutubeMeta({
      script,
      format,
      visualCredits: visuals.map((v) => v.credit),
      musicCredit: music?.credit ?? null,
      voiceProvider: voice.name,
      voiceName: voiceLabel(voice.name),
      channel,
      chapters: youtubeChapters(props.scenes, props.durationInFrames / FPS), // таймкоды глав «Разбора»
    });
    const description = path.join(runDir, "description.txt");
    fs.writeFileSync(description, descriptionTxt(meta));
    writeJson(path.join(runDir, "youtube.json"), meta);
    // Instagram: подпись (правится руками в instagram.txt) и кадр обложки — тот же, что в cover.jpg.
    const igMeta: InstagramMeta = { caption: buildInstagramCaption(script, channel), thumbOffsetMs: frameToMs(coverFrame(props)), shareToFeed: true, cover: null };
    const ig = writeInstagramAssets(runDir, igMeta);
    const cost = buildCost(usage, voice.name, script, visuals.map((v) => v.credit));
    writeJson(path.join(runDir, "cost.json"), cost);
    console.log(`  стоимость запуска: $${cost.totalUsd.toFixed(4)}${cost.totalUsd === 0 ? " (всё бесплатно)" : ""}`);
    return { srt, description, meta, cost, igMeta, igCaption: ig.captionFile };
  });

  // 7. Рендер
  let render: RenderResult | null = null;
  let cover: string | null = null;
  let qcFile: string | null = null;
  if (args.render) {
    render = await steps.run("Рендер видео и обложки", async () => {
      const r = await renderVideo({ runDir, props, concurrency: args.concurrency });
      // Обложка Reels 1080×1920 — кадр конца хука без субтитров.
      try {
        const c = await renderCover({ runDir, props });
        cover = c.file;
        writeInstagramAssets(runDir, { ...files.igMeta, cover: path.basename(c.file), thumbOffsetMs: c.ms });
        console.log(`  обложка Reels: ${rel(c.file)} (кадр ${c.frame}, ${(c.ms / 1000).toFixed(1)} с)`);
      } catch (e) {
        console.warn(`  ⚠ обложку Reels сделать не удалось: ${errText(e).split("\n")[0]} — Instagram возьмёт кадр по thumb_offset`);
      }
      // QC (pipeline/qc.ts) — до загрузки: битый ролик не должен уйти на YouTube.
      qcFile = await checkRender(r, props, runDir);
      return r;
    });
  } else steps.skip("Рендер видео и обложки", "--no-render");

  // 8. YouTube
  let youtube: UploadResult | null = null;
  if (args.upload.has("youtube")) {
    if (!render) steps.skip("Загрузка на YouTube", "нет видео: указан --no-render");
    else {
      const r = render;
      youtube = await steps.run("Загрузка на YouTube", () => {
        // Слот считаем сейчас, а не до рендера: за время рендера ближайший мог пройти.
        const publishAt = resolvePublishAt(args.schedule, channel, args.out);
        if (publishAt) console.log(`  отложенная публикация: ${describePublishAt(publishAt, channel)} — до этого видео приватное`);
        return uploadToYoutube({ videoFile: r.videoFile, thumbnailFile: r.thumbnailJpg ?? r.thumbnailFile, meta: files.meta, privacy: args.privacy, publishAt });
      });
      writeYoutubeResult(runDir, youtube);
      if (!youtube.publishAt && args.privacy !== "private" && youtube.privacy === "private") {
        console.warn("  ⚠ YouTube оставил видео приватным: загрузки из непроверенных проектов Google Cloud всегда приватные — смените видимость в YouTube Studio.");
      }
    }
  }

  // 9. Instagram
  let instagram: RunDirPublishResult | null = null;
  if (args.upload.has("instagram")) {
    if (!render) steps.skip("Публикация в Instagram", "нет видео: указан --no-render");
    else instagram = await steps.run("Публикация в Instagram", () => publishRunDir(runDir, { log: (m) => console.log(`  ${m}`) }));
  }

  const totalMs = Date.now() - tStart;
  const result = {
    slug,
    title: script.title,
    format,
    theme: script.theme ?? "midnight",
    voiceProvider: voice.name,
    durationSec: Number((props.durationInFrames / FPS).toFixed(2)),
    runDir: rel(runDir),
    files: {
      video: render ? rel(render.videoFile) : null,
      thumbnail: render?.thumbnailFile ? rel(render.thumbnailFile) : null,
      captions: rel(files.srt),
      description: rel(files.description),
      props: rel(path.join(runDir, "props.json")),
      script: rel(path.join(runDir, "script.json")),
      cost: rel(path.join(runDir, "cost.json")),
      instagramCaption: rel(files.igCaption),
      cover: cover ? rel(cover) : null,
      qc: qcFile ? rel(qcFile) : null,
    },
    costUsd: files.cost.totalUsd,
    renderSec: render ? Number((render.renderMs / 1000).toFixed(1)) : null,
    loudnessLufs: render?.loudness?.outputLufs ?? null,
    totalSec: Number((totalMs / 1000).toFixed(1)),
    timings: steps.timings.map((t) => ({ step: t.name, sec: Number((t.ms / 1000).toFixed(1)) })),
    youtube,
    instagram: instagram ? { mediaId: instagram.mediaId, permalink: instagram.permalink, publishedAt: instagram.publishedAt, duplicate: instagram.duplicate } : null,
  };
  writeJson(path.join(runDir, "result.json"), result);

  printSummary(result, render);
  ghOutput({
    slug,
    run_dir: result.runDir,
    title: script.title,
    video: result.files.video,
    thumbnail: result.files.thumbnail,
    captions: result.files.captions,
    description: result.files.description,
    duration_sec: result.durationSec,
    cost_usd: result.costUsd.toFixed(4),
    youtube_url: youtube?.url,
    youtube_publish_at: youtube?.publishAt,
    instagram_caption: result.files.instagramCaption,
    cover: result.files.cover,
    instagram_url: instagram?.permalink ?? instagram?.mediaId,
  });
  ghSummary(summaryMarkdown(result, render, script));
}

// ---- QC готового видео ----

// qc.json рядом с видео и сводка в лог. Серьёзная проблема (нет звука, не та
// длительность или размер) — видео переименовывается в video-qc-failed.mp4
// (релиз и загрузка его не возьмут) и запуск падает; QC=warn — только
// предупреждения, QC=off — без проверки. Сбой самой проверки ролик не губит.
async function checkRender(render: RenderResult, props: VideoProps, runDir: string): Promise<string | null> {
  const mode = qcMode();
  if (mode === "off") {
    console.log("  QC пропущен (QC=off)");
    return null;
  }
  let report: QcReport;
  try {
    report = await runQc(render.videoFile, props, { mode });
  } catch (e) {
    console.warn(`  ⚠ QC не выполнен: ${errText(e).split("\n")[0]}`);
    return null;
  }
  const file = writeQc(runDir, report);
  for (const line of qcSummary(report)) console.log(`  ${line}`);
  if (report.ok) return file;
  const failed = path.join(path.dirname(render.videoFile), "video-qc-failed.mp4");
  fs.rmSync(failed, { force: true });
  fs.renameSync(render.videoFile, failed);
  const errors = report.issues.filter((i) => i.severity === "error").map((i) => i.message.split(" — ")[0]);
  throw new UserError(
    `QC не пройден: ${errors.join("; ")}.\n  Видео переименовано в ${rel(failed)}, чтобы его не опубликовали; подробности — ${rel(file)}.\n  Опубликовать всё равно: QC=warn npm run make -- … (или исправьте причину и соберите заново).`,
  );
}

// ---- Рубрика ролика ----

// Сценарий из плана (scripts/sut-08a-….json) → рубрика темы в content/plan.json.
// Нет кода, плана или темы — null, всё по умолчанию (битый план не валит сборку).
function planPillar(scriptFile: string | undefined): string | null {
  const code = scriptFile ? scriptCode(scriptFile) : null;
  if (!code) return null;
  try {
    const plan = parsePlan(JSON.parse(fs.readFileSync(path.join(ROOT, "content", "plan.json"), "utf8").replace(/^﻿/, "")));
    return plan.items.find((it) => it.id === code)?.pillar?.trim() || null;
  } catch {
    return null;
  }
}

// ---- Папка ролика ----

const SOURCE_FILE = "source.json";

// Откуда сценарий: тот же источник → та же папка (повторная сборка
// отредактированного сценария переиспользует голос и визуал). Для --topic
// источник — сам текст: та же тема даёт у LLM каждый раз новый сценарий.
function runSource(args: Args, script: VideoScript): string {
  if (args.demo) return "demo";
  if (args.script) return `script:${rel(resolveInputPath(args.script) ?? path.resolve(args.script))}`;
  const hash = createHash("sha1").update(JSON.stringify(script.scenes.map((s) => s.narration))).digest("hex").slice(0, 12);
  return `topic:${hash}`;
}

function readSource(dir: string): string | null {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FILE), "utf8")) as { source?: unknown }).source;
    return typeof v === "string" ? v : null;
  } catch {
    return null; // папки нет или она из старой версии (без source.json) — считаем своей
  }
}

// Папка по названию, но чужую не перезаписываем: два черновика с одинаковым
// заголовком (scripts/x.json и x-2.json) или новая тема с тем же названием
// получают out/<slug>-2, -3… — как uniquePath у черновиков. Иначе второй
// ролик молча затёр бы видео, обложку и youtube-result.json первого.
function chooseRunDir(outDir: string, slug: string, source: string): { runDir: string; busy: string | null } {
  let busy: string | null = null;
  for (let i = 1; ; i++) {
    const dir = path.join(outDir, i === 1 ? slug : `${slug}-${i}`);
    const prev = readSource(dir);
    if (prev === null || prev === source) return { runDir: dir, busy };
    busy ??= prev;
  }
}

function buildCost(usage: LlmUsage[], voiceProvider: string, script: VideoScript, credits: (Credit | null)[]) {
  const llmUsd = usage.reduce((a, u) => a + (u.costUsd || 0), 0);
  const chars = script.scenes.reduce((a, s) => a + s.narration.length, 0);
  const voiceNotes: Record<string, string> = {
    edge: "бесплатно (Microsoft Edge TTS)",
    piper: "бесплатно (локально)",
    gemini: "бесплатно в пределах суточной квоты AI Studio (~10 запросов на модель; шорт = 1 запрос)",
    elevenlabs: `списывается ≈${chars} кредитов из месячного лимита плана`,
    openai: "локальный сервер — бесплатно",
    fish: "локальный сервер — бесплатно",
  };
  const sources: Record<string, number> = {};
  for (const c of credits) if (c) sources[c.provider] = (sources[c.provider] ?? 0) + 1;
  return {
    currency: "USD",
    totalUsd: Number(llmUsd.toFixed(6)),
    llm: { totalUsd: Number(llmUsd.toFixed(6)), calls: usage },
    voice: { provider: voiceProvider, characters: chars, costUsd: 0, note: voiceNotes[voiceProvider] ?? "" },
    visuals: { sources, costUsd: 0, note: "стоки и бесплатные квоты генерации" },
    render: { costUsd: 0, note: process.env.GITHUB_ACTIONS ? "GitHub Actions (минуты из квоты аккаунта)" : "локально" },
  };
}

type Result = {
  slug: string;
  title: string;
  format: string;
  durationSec: number;
  runDir: string;
  voiceProvider: string;
  files: Record<string, string | null>;
  costUsd: number;
  totalSec: number;
  timings: { step: string; sec: number }[];
  youtube: UploadResult | null;
  instagram: { mediaId: string; permalink: string | null; publishedAt: string; duplicate: boolean } | null;
};

function printSummary(r: Result, render: RenderResult | null) {
  console.log("\n────────────────────────────────────────");
  console.log(`Готово: «${r.title}»`);
  console.log(`  длительность ролика: ${r.durationSec.toFixed(1)} с · озвучка: ${r.voiceProvider} · стоимость: $${r.costUsd.toFixed(4)}`);
  if (render) {
    const loud = render.loudness ? `, ${render.loudness.outputLufs.toFixed(1)} LUFS` : "";
    console.log(`  видео:     ${r.files.video}  (${render.width}×${render.height}, ${(fs.statSync(render.videoFile).size / 1048576).toFixed(1)} МБ${loud})`);
    if (r.files.thumbnail) console.log(`  обложка:   ${r.files.thumbnail}`);
    if (r.files.cover) console.log(`  Reels:     ${r.files.cover} + ${r.files.instagramCaption}`);
  } else console.log(`  props:     ${r.files.props}  (рендер: npm run make -- --script ${r.files.script})`);
  console.log(`  субтитры:  ${r.files.captions}`);
  console.log(`  описание:  ${r.files.description}`);
  console.log(`  стоимость: ${r.files.cost}`);
  if (r.youtube) console.log(`  YouTube:   ${r.youtube.url} (${r.youtube.privacy}${r.youtube.publishAt ? `, выйдет ${r.youtube.publishAt}` : ""}) · редактировать: ${r.youtube.studioUrl}`);
  if (r.instagram) console.log(`  Instagram: ${r.instagram.permalink ?? r.instagram.mediaId}${r.instagram.duplicate ? " (уже был опубликован)" : ""}`);
  console.log(`  общее время: ${fmtDuration(r.totalSec * 1000)}  (${r.timings.map((t) => `${t.step.split(" (")[0].toLowerCase()} ${t.sec} с`).join(", ")})`);
}

function summaryMarkdown(r: Result, render: RenderResult | null, script: VideoScript): string {
  const lines = [
    `## 🎬 ${escapeMd(r.title)}`,
    "",
    "| | |",
    "|---|---|",
    `| Формат | ${r.format === "shorts" ? "Shorts 1080×1920" : "горизонтальный 1920×1080"} |`,
    `| Длительность | ${r.durationSec.toFixed(1)} с, ${script.scenes.length} сцен |`,
    `| Озвучка | ${r.voiceProvider} |`,
    `| Стоимость | $${r.costUsd.toFixed(4)} |`,
    `| Время сборки | ${fmtDuration(r.totalSec * 1000)}${render ? ` (рендер ${fmtDuration(render.renderMs)})` : ""} |`,
    `| Папка | \`video-studio/${r.runDir}\` |`,
  ];
  if (r.youtube) lines.push(`| YouTube | ${r.youtube.url} (${r.youtube.privacy}${r.youtube.publishAt ? `, выйдет ${r.youtube.publishAt}` : ""}) |`);
  if (r.instagram) lines.push(`| Instagram | ${r.instagram.permalink ?? r.instagram.mediaId} |`);
  lines.push("", "<details><summary>Этапы</summary>", "", ...r.timings.map((t) => `- ${escapeMd(t.step)}: ${t.sec} с`), "", "</details>", "");
  return lines.join("\n");
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0)) // edge-tts может держать таймеры — выходим явно
  .catch(fail);
