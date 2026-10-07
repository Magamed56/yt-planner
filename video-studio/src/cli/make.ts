// Одна команда → готовый ролик:
//   тема (LLM) или готовый JSON → озвучка → визуал → музыка → props →
//   субтитры/описание/стоимость → рендер MP4 + обложка → (YouTube).
//
//   npm run make -- --demo
//   npm run make -- --topic "Почему мы забываем" --format shorts
//   npm run make -- --script scripts/pochemu-my-zabyvaem.json --upload youtube --privacy private
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { FPS, THEME_NAMES, type Format, type ThemeName, type VideoScript } from "../types";
import type { Credit, LlmUsage, VisualResult, VoiceProvider, VoiceResult } from "../pipeline/contracts";
import { makeWhoosh, prepareMusic } from "../pipeline/audio/index";
import { buildYoutubeMeta, descriptionTxt } from "../pipeline/meta";
import { buildVideoProps, estimateDurationMs } from "../pipeline/props";
import { checkBrowserEnv, preparePublicDir, renderVideo, type RenderResult } from "../pipeline/render";
import { generateScript, lintScript, ScriptGenerationError } from "../pipeline/script/index";
import { slugify } from "../pipeline/slug";
import { captionsToSrt } from "../pipeline/srt";
import { findVisual } from "../pipeline/visuals/index";
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
import { loadScriptFile } from "./scriptFile";

const HELP = `Сборка ролика одной командой.

  npm run make -- --demo                         демо-сценарий examples/demo-ru.json
  npm run make -- --topic "тема"                 сценарий напишет LLM (по умолчанию бесплатный Gemini)
  npm run make -- --script scripts/<файл>.json   свой или отредактированный сценарий

Параметры:
  --format shorts|landscape    формат (по умолчанию из сценария, для --topic — shorts)
  --theme  midnight|sunset|emerald|mono   палитра (по умолчанию из сценария)
  --voice  auto|gemini|edge|piper|elevenlabs|openai|fish   провайдер озвучки (иначе TTS_PROVIDER; auto — Gemini при ключе, иначе Edge)
  --notes  "..."               пожелания к сценарию (только с --topic)
  --seconds N                  желаемая длительность (только с --topic)
  --mood   calm|inspiring|upbeat|tech|dark   настроение музыки (иначе MUSIC_MOOD)
  --out    out/                куда класть папку ролика (по умолчанию out/)
  --no-render                  только подготовить звук, визуал и props.json
  --concurrency N              сколько кадров рендерить параллельно (иначе RENDER_CONCURRENCY / авто)
  --upload youtube             загрузить на YouTube после рендера
  --privacy private|unlisted|public   видимость на YouTube (по умолчанию private)
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
  notes?: string;
  seconds?: number;
  mood?: string;
  out: string;
  render: boolean;
  concurrency?: number;
  upload?: "youtube";
  privacy: Privacy;
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
        notes: { type: "string" },
        seconds: { type: "string" },
        mood: { type: "string" },
        out: { type: "string" },
        "no-render": { type: "boolean", default: false },
        concurrency: { type: "string" },
        upload: { type: "string" },
        privacy: { type: "string" },
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
  const upload = str("upload");
  if (upload && upload !== "youtube" && upload !== "none") throw new UserError(`--upload: пока поддерживается только youtube (релизы GitHub делает workflow).`);
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
    notes: str("notes"),
    seconds: num("seconds"),
    mood: str("mood"),
    out: path.resolve(str("out") ?? path.join(ROOT, "out")),
    render: !values["no-render"],
    concurrency: num("concurrency"),
    upload: upload === "youtube" ? "youtube" : undefined,
    privacy,
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

  console.log("video-studio · сборка ролика");
  if (envFile) console.log(`  настройки: ${rel(envFile)}`);

  // Проверки до долгих шагов: ключи и браузер.
  let voice = getVoiceProvider(args.voice);
  if (args.upload === "youtube") {
    const missing = missingYoutubeEnv();
    if (missing.length) throw new UserError(`--upload youtube: не заданы ${missing.join(", ")}.\n${youtubeEnvHelp()}`);
  }
  if (args.render) checkBrowserEnv();

  const steps = new Steps(7 + (args.upload ? 1 : 0));
  const usage: LlmUsage[] = [];

  // 1. Сценарий
  let script = await steps.run("Сценарий", async () => {
    let s: VideoScript;
    if (args.topic) {
      const format = args.format ?? "shorts";
      console.log(`  тема: «${args.topic}», формат: ${format}`);
      let r: Awaited<ReturnType<typeof generateScript>>;
      try {
        r = await generateScript({ topic: args.topic, format, language: "ru", notes: args.notes, targetSeconds: args.seconds });
      } catch (e) {
        if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, args.out);
        throw e;
      }
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
  voices = await steps.run("Озвучка", async () => {
    console.log(`  провайдер: ${voice.name}`);
    const fallbacks = fallbackProviderNames(voice.name);
    for (;;) {
      try {
        return await synthesizeAll(voice, script, publicDir);
      } catch (e) {
        const fb = fallbacks.shift();
        if (!fb) {
          const alt = voice.name === "piper" ? "--voice edge" : "--voice piper (офлайн)";
          throw new UserError(`Озвучка через ${voice.name} не удалась: ${errText(e)}\n  Попробуйте другой провайдер: ${alt}. Все варианты — npm run make -- --help.`);
        }
        // Весь ролик заново — чтобы в нём был один голос, а не два.
        console.warn(`  ⚠ ${voice.name} не работает: ${errText(e).split("\n")[0]}\n  Озвучиваю весь ролик запасным провайдером ${fb} (TTS_FALLBACK=none — отключить).`);
        voice = getVoiceProvider(fb);
      }
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
    const keys = script.scenes.map((scene) => visualKey(scene, format, process.env));
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
        r = await findVisual(scene, { format, publicDir, sceneIndex: i, minDurationSec: minDur(i), usedIds });
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
  const { music, whooshSrc } = await steps.run("Музыка и звук перехода", async () => {
    fs.rmSync(path.join(publicDir, "music"), { recursive: true, force: true });
    fs.rmSync(path.join(publicDir, "sfx"), { recursive: true, force: true });
    const durationMs = estimateDurationMs(voices.map((v) => v.durationMs));
    const music = await prepareMusic(publicDir, { durationMs, mood: args.mood || process.env.MUSIC_MOOD?.trim() || undefined, seed: slug });
    if (!music) console.log("  без музыки (MUSIC=none)");
    const whooshSrc = await makeWhoosh(publicDir);
    return { music, whooshSrc };
  });

  // 5. Props композиции
  const props = await steps.run("Сборка таймлинии (props.json)", async () => {
    const p = buildVideoProps({ script, publicDir, voices, visuals, music, whooshSrc, format, theme: script.theme });
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
    });
    const description = path.join(runDir, "description.txt");
    fs.writeFileSync(description, descriptionTxt(meta));
    writeJson(path.join(runDir, "youtube.json"), meta);
    const cost = buildCost(usage, voice.name, script, visuals.map((v) => v.credit));
    writeJson(path.join(runDir, "cost.json"), cost);
    console.log(`  стоимость запуска: $${cost.totalUsd.toFixed(4)}${cost.totalUsd === 0 ? " (всё бесплатно)" : ""}`);
    return { srt, description, meta, cost };
  });

  // 7. Рендер
  let render: RenderResult | null = null;
  if (args.render) {
    render = await steps.run("Рендер видео и обложки", () => renderVideo({ runDir, props, concurrency: args.concurrency }));
  } else steps.skip("Рендер видео и обложки", "--no-render");

  // 8. YouTube
  let youtube: UploadResult | null = null;
  if (args.upload === "youtube") {
    if (!render) steps.skip("Загрузка на YouTube", "нет видео: указан --no-render");
    else {
      const r = render;
      youtube = await steps.run("Загрузка на YouTube", () =>
        uploadToYoutube({ videoFile: r.videoFile, thumbnailFile: r.thumbnailJpg ?? r.thumbnailFile, meta: files.meta, privacy: args.privacy }),
      );
      writeYoutubeResult(runDir, youtube);
      if (args.privacy !== "private" && youtube.privacy === "private") {
        console.warn("  ⚠ YouTube оставил видео приватным: загрузки из непроверенных проектов Google Cloud всегда приватные — смените видимость в YouTube Studio.");
      }
    }
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
    },
    costUsd: files.cost.totalUsd,
    renderSec: render ? Number((render.renderMs / 1000).toFixed(1)) : null,
    loudnessLufs: render?.loudness?.outputLufs ?? null,
    totalSec: Number((totalMs / 1000).toFixed(1)),
    timings: steps.timings.map((t) => ({ step: t.name, sec: Number((t.ms / 1000).toFixed(1)) })),
    youtube,
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
  });
  ghSummary(summaryMarkdown(result, render, script));
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
};

function printSummary(r: Result, render: RenderResult | null) {
  console.log("\n────────────────────────────────────────");
  console.log(`Готово: «${r.title}»`);
  console.log(`  длительность ролика: ${r.durationSec.toFixed(1)} с · озвучка: ${r.voiceProvider} · стоимость: $${r.costUsd.toFixed(4)}`);
  if (render) {
    const loud = render.loudness ? `, ${render.loudness.outputLufs.toFixed(1)} LUFS` : "";
    console.log(`  видео:     ${r.files.video}  (${render.width}×${render.height}, ${(fs.statSync(render.videoFile).size / 1048576).toFixed(1)} МБ${loud})`);
    if (r.files.thumbnail) console.log(`  обложка:   ${r.files.thumbnail}`);
  } else console.log(`  props:     ${r.files.props}  (рендер: npm run make -- --script ${r.files.script})`);
  console.log(`  субтитры:  ${r.files.captions}`);
  console.log(`  описание:  ${r.files.description}`);
  console.log(`  стоимость: ${r.files.cost}`);
  if (r.youtube) console.log(`  YouTube:   ${r.youtube.url} (${r.youtube.privacy}) · редактировать: ${r.youtube.studioUrl}`);
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
  if (r.youtube) lines.push(`| YouTube | ${r.youtube.url} (${r.youtube.privacy}) |`);
  lines.push("", "<details><summary>Этапы</summary>", "", ...r.timings.map((t) => `- ${escapeMd(t.step)}: ${t.sec} с`), "", "</details>", "");
  return lines.join("\n");
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0)) // edge-tts может держать таймеры — выходим явно
  .catch(fail);
