// Рендер готовых props в MP4 и обложку PNG через Remotion. Всё в Node:
// системный ffmpeg не нужен (Remotion везёт свой), браузер — Chrome Headless
// Shell, который Remotion скачивает сам (или свой через переменные окружения).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { RenderInternals, ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { FPS, type VideoProps } from "../types";
import { projectRoot } from "./audio/paths";

export type Log = (msg: string) => void;

export interface BrowserOptions {
  browserExecutable?: string;
  chromeMode?: "headless-shell" | "chrome-for-testing";
}

// Ассеты проекта (assets/**) → <runDir>/public/assets. Копия, а не ссылка:
// симлинки на Windows требуют прав администратора или режима разработчика.
export function preparePublicDir(runDir: string): string {
  const publicDir = path.join(runDir, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const assets = path.join(projectRoot(), "assets");
  if (fs.existsSync(assets)) {
    fs.rmSync(path.join(publicDir, "assets"), { recursive: true, force: true });
    fs.cpSync(assets, path.join(publicDir, "assets"), { recursive: true });
  }
  return publicDir;
}

function chromeModeFromEnv(): BrowserOptions["chromeMode"] | undefined {
  const raw = process.env.REMOTION_CHROME_MODE?.trim();
  if (!raw) return undefined;
  if (raw === "headless-shell" || raw === "chrome-for-testing") return raw;
  throw new Error(`REMOTION_CHROME_MODE="${raw}" — допустимо headless-shell или chrome-for-testing.`);
}

// Только проверка переменных (без скачивания) — чтобы упасть до долгих шагов.
export function checkBrowserEnv(): void {
  const exe = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();
  chromeModeFromEnv();
  if (exe && !fs.existsSync(exe)) {
    throw new Error(`REMOTION_BROWSER_EXECUTABLE указывает на несуществующий файл: ${exe}\nУберите переменную — Remotion скачает Chrome Headless Shell сам.`);
  }
}

// REMOTION_BROWSER_EXECUTABLE (+ REMOTION_CHROME_MODE) — свой Chrome/Chromium.
// Иначе ensureBrowser(): один раз скачивает Chrome Headless Shell (~100 МБ)
// в node_modules/.remotion — так работает на ПК и в GitHub Actions.
export async function getBrowserOptions(log: Log = console.log): Promise<BrowserOptions> {
  checkBrowserEnv();
  const exe = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();
  const chromeMode = chromeModeFromEnv();
  if (exe) return { browserExecutable: exe, chromeMode: chromeMode ?? "headless-shell" };

  // Ошибка скачивания у Remotion вылетает НЕПЕРЕХВАТЫВАЕМЫМ исключением и
  // оставляет download.lock — ловим глобально, убираем замок и объясняем.
  const lockDir = path.join(projectRoot(), "node_modules", ".remotion");
  let lastShown = -25;
  const fail = (err: unknown): never => {
    for (const mode of ["chrome-headless-shell", "chrome-for-testing"]) fs.rmSync(path.join(lockDir, mode, "download.lock"), { force: true });
    throw new Error(
      `Не удалось подготовить браузер для рендера: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}\n` +
        "  Нужен доступ к remotion.media или storage.googleapis.com (скачивается один раз, ~100 МБ).\n" +
        "  Или укажите свой Chrome/Chromium: REMOTION_BROWSER_EXECUTABLE=<путь к файлу> и REMOTION_CHROME_MODE=chrome-for-testing (обычный Chrome) | headless-shell.",
    );
  };
  let rejectUncaught: ((e: unknown) => void) | null = null;
  const onUncaught = (e: unknown) => rejectUncaught?.(e);
  // На время скачивания чужие глобальные обработчики (CLI завершает процесс
  // по unhandledRejection) снимаем — иначе вместо подсказки будет сырой стек.
  type Ev = "uncaughtException"; // у обоих событий совместимая сигнатура (ошибка первым аргументом)
  const saved = (["uncaughtException", "unhandledRejection"] as Ev[]).map((ev) => {
    const ls = process.listeners(ev);
    process.removeAllListeners(ev);
    process.on(ev, onUncaught);
    return { ev, ls };
  });
  try {
    await new Promise<void>((resolve, reject) => {
      rejectUncaught = reject;
      ensureBrowser({
        logLevel: "warn",
        chromeMode: chromeMode ?? "headless-shell",
        onBrowserDownload: () => {
          log("[браузер] Скачиваю Chrome Headless Shell для рендера (один раз)…");
          return {
            version: null,
            onProgress: ({ percent, alreadyAvailable }) => {
              if (alreadyAvailable) return;
              const p = Math.round(percent * 100);
              // 100% Remotion сообщает много раз (пока распаковывает) — печатаем один.
              if (p - lastShown >= 25 || (p === 100 && lastShown < 100)) {
                lastShown = p;
                log(`[браузер] ${p}%`);
              }
            },
          };
        },
      }).then(() => resolve(), reject);
    });
  } catch (e) {
    fail(e);
  } finally {
    for (const { ev, ls } of saved) {
      process.removeListener(ev, onUncaught);
      for (const l of ls) process.on(ev, l);
    }
  }
  return chromeMode ? { chromeMode } : {};
}

// ---- Качество кодирования ----
// YouTube перекодирует любой загруженный ролик, и чем чище исходник, тем меньше
// артефактов после его сжатия (стоковое видео, тёмные градиенты, мелкий текст).
// Рекомендация YouTube для 1080p30 SDR — ≈ 8 Мбит/с, AAC-LC 48 кГц, GOP в
// половину частоты кадров, moov в начале файла (faststart: телефон начинает
// играть сразу) — faststart Remotion для .mp4 делает сам.
//   VIDEO_QUALITY = high (по умолчанию) | max | standard (прежнее: CRF 21, быстрее)
//   VIDEO_CRF (0–51, меньше — лучше), VIDEO_BITRATE (например 16M — вместо CRF),
//   X264_PRESET (ultrafast … veryslow) — тонкая настройка поверх пресета.
export type VideoQuality = "standard" | "high" | "max";
export const X264_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;
export type X264Preset = (typeof X264_PRESETS)[number];

type Rate = `${number}${"k" | "K" | "M"}`; // формат битрейта у Remotion: "16M", "320k"

export interface EncoderSettings {
  quality: VideoQuality;
  crf: number | null; // постоянное качество
  videoBitrate: Rate | null; // либо средний битрейт (тогда crf = null)
  encodingMaxRate: Rate | null;
  encodingBufferSize: Rate | null;
  x264Preset: X264Preset;
  gopSize: number | null;
  audioBitrate: Rate;
  sampleRate: number;
}

const QUALITY_PRESETS: Record<VideoQuality, Omit<EncoderSettings, "quality">> = {
  // Как было до 10.2026: быстрый черновик.
  standard: { crf: 21, videoBitrate: null, encodingMaxRate: null, encodingBufferSize: null, x264Preset: "medium", gopSize: null, audioBitrate: "320k", sampleRate: 48000 },
  // Почти без потерь на глаз: CRF 15, preset slow, ключевой кадр каждые 0,5 с.
  high: { crf: 15, videoBitrate: null, encodingMaxRate: null, encodingBufferSize: null, x264Preset: "slow", gopSize: Math.round(FPS / 2), audioBitrate: "320k", sampleRate: 48000 },
  // Гарантированный поток: средний 16 Мбит/с даже на статичной графике.
  max: { crf: null, videoBitrate: "16M", encodingMaxRate: "24M", encodingBufferSize: "32M", x264Preset: "slow", gopSize: Math.round(FPS / 2), audioBitrate: "320k", sampleRate: 48000 },
};

export function encoderSettings(env: Record<string, string | undefined> = process.env): EncoderSettings {
  const raw = (env.VIDEO_QUALITY ?? "").trim().toLowerCase();
  const quality: VideoQuality = raw === "standard" || raw === "max" || raw === "high" ? raw : "high";
  if (raw && raw !== quality) console.warn(`[рендер] VIDEO_QUALITY="${raw}" не понят — беру high (варианты: high, max, standard).`);
  const s: EncoderSettings = { quality, ...QUALITY_PRESETS[quality] };
  const preset = env.X264_PRESET?.trim().toLowerCase();
  if (preset) {
    if ((X264_PRESETS as readonly string[]).includes(preset)) s.x264Preset = preset as X264Preset;
    else console.warn(`[рендер] X264_PRESET="${preset}" не понят — оставляю ${s.x264Preset}.`);
  }
  const bitrate = env.VIDEO_BITRATE?.trim();
  const crf = Number(env.VIDEO_CRF?.trim());
  if (bitrate && /^\d+(\.\d+)?[kKmM]$/.test(bitrate)) {
    const mbps = parseFloat(bitrate) / (/[kK]$/.test(bitrate) ? 1000 : 1);
    s.crf = null;
    s.videoBitrate = `${Math.round(mbps * 1000)}K`;
    s.encodingMaxRate = `${Math.round(mbps * 1.5 * 1000)}K`;
    s.encodingBufferSize = `${Math.round(mbps * 2 * 1000)}K`;
  } else if (env.VIDEO_CRF?.trim() && Number.isFinite(crf) && crf >= 0 && crf <= 51) {
    s.crf = Math.round(crf);
    s.videoBitrate = null;
    s.encodingMaxRate = null;
    s.encodingBufferSize = null;
  }
  return s;
}

// Поля renderMedia из настроек: crf и videoBitrate Remotion вместе не принимает.
export function encoderOptions(s: EncoderSettings) {
  return {
    ...(s.crf !== null ? { crf: s.crf } : { videoBitrate: s.videoBitrate, encodingMaxRate: s.encodingMaxRate, encodingBufferSize: s.encodingBufferSize }),
    x264Preset: s.x264Preset,
    gopSize: s.gopSize,
    audioBitrate: s.audioBitrate,
    sampleRate: s.sampleRate,
  };
}

export const describeEncoder = (s: EncoderSettings): string =>
  `${s.quality}: x264 ${s.crf !== null ? `CRF ${s.crf}` : `${s.videoBitrate}bit/s`}, preset ${s.x264Preset}${s.gopSize ? `, GOP ${s.gopSize}` : ""}, AAC ${s.audioBitrate} ${s.sampleRate / 1000} кГц`;

export interface RenderOptions {
  runDir: string; // publicDir = <runDir>/public — уже со всеми ассетами
  props: VideoProps;
  videoFile?: string; // по умолчанию <runDir>/video.mp4
  thumbnailFile?: string | null; // по умолчанию <runDir>/thumbnail.png; null — без обложки
  concurrency?: number | null;
  crf?: number; // поверх VIDEO_QUALITY
  frameRange?: [number, number] | null; // быстрый предпросмотр части ролика
  colorSpace?: "default" | "bt709";
  log?: Log;
}

export interface RenderResult {
  videoFile: string;
  loudness: LoudnessResult | null;
  thumbnailFile: string | null;
  thumbnailJpg: string | null; // для YouTube, если PNG больше 2 МБ
  frames: number;
  durationSec: number;
  width: number;
  height: number;
  bundleMs: number;
  renderMs: number;
  totalMs: number;
  encoder?: EncoderSettings; // с какими настройками кодировали (для qc.json)
}

const fmtSec = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return s >= 60 ? `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с` : `${s} с`;
};

function envConcurrency(): number | null {
  const raw = process.env.RENDER_CONCURRENCY?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

// Максимум для Remotion — число ядер; лишнее молча урезаем, а не падаем.
function clampConcurrency(c: number | null | undefined): number | null {
  if (c == null) return null;
  const cpus = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(cpus, Math.floor(c)));
}

export async function renderVideo(opts: RenderOptions): Promise<RenderResult> {
  const log = opts.log ?? console.log;
  const t0 = Date.now();
  const publicDir = path.join(opts.runDir, "public");
  if (!fs.existsSync(publicDir)) throw new Error(`Нет папки ${publicDir} — сначала подготовьте ассеты (preparePublicDir).`);
  const videoFile = opts.videoFile ?? path.join(opts.runDir, "video.mp4");
  const thumbnailFile = opts.thumbnailFile === undefined ? path.join(opts.runDir, "thumbnail.png") : opts.thumbnailFile;
  const inputProps = opts.props as unknown as Record<string, unknown>;

  const browser = await getBrowserOptions(log);

  // Свой временный каталог бандла и обязательная уборка: иначе в temp копятся
  // папки по ~30 МБ на каждый запуск. Кэш webpack (node_modules/.cache)
  // остаётся — повторная сборка ~2 с вместо ~13.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-studio-bundle-"));
  const { cancelSignal, cancel } = makeCancelSignal();
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    log("\n[рендер] Прерываю по Ctrl+C…");
    cancel();
  };
  process.once("SIGINT", onSigint);
  try {
    let lastBundle = -1;
    const serveUrl = await bundle({
      entryPoint: path.join(projectRoot(), "src", "remotion", "index.ts"),
      publicDir,
      outDir,
      enableCaching: true,
      onProgress: (p) => {
        const step = Math.floor(p / 50);
        if (step > lastBundle) {
          lastBundle = step;
          if (p < 100) log(`[рендер] сборка композиции… ${Math.round(p)}%`);
        }
      },
    });
    const bundleMs = Date.now() - t0;
    log(`[рендер] композиция собрана за ${fmtSec(bundleMs / 1000)}`);

    const composition = await selectComposition({ serveUrl, id: "Video", inputProps, ...browser, logLevel: "warn" });
    const range = opts.frameRange
      ? ([Math.max(0, opts.frameRange[0]), Math.min(composition.durationInFrames - 1, opts.frameRange[1])] as [number, number])
      : null;
    const frames = range ? range[1] - range[0] + 1 : composition.durationInFrames;
    const concurrency = clampConcurrency(opts.concurrency ?? envConcurrency());
    log(
      `[рендер] ${composition.width}×${composition.height}, ${frames} кадров (${fmtSec(frames / FPS)}), ` +
        `потоков: ${concurrency ?? "авто"}, ядер: ${typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length}`,
    );

    fs.mkdirSync(path.dirname(videoFile), { recursive: true });
    const enc = encoderSettings();
    if (opts.crf !== undefined) Object.assign(enc, { crf: opts.crf, videoBitrate: null, encodingMaxRate: null, encodingBufferSize: null });
    log(`[рендер] кодирование — ${describeEncoder(enc)}`);
    const tr = Date.now();
    let lastPct = -1;
    let lastAt = 0;
    let encodingLogged = false;
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      ...encoderOptions(enc),
      // JPEG 90 вместо 80: на тёмных градиентах фона меньше «ступенек».
      imageFormat: "jpeg",
      jpegQuality: 90,
      pixelFormat: "yuv420p",
      // bt709 + ограниченный диапазон — стандарт для YouTube и плееров; по
      // умолчанию Remotion 4 пишет yuvj420p (полный диапазон, теги BT.601).
      colorSpace: opts.colorSpace ?? "bt709",
      frameRange: range,
      outputLocation: videoFile,
      overwrite: true,
      concurrency,
      cancelSignal,
      ...browser,
      logLevel: "warn",
      onProgress: ({ progress, renderedFrames, renderedDoneIn, stitchStage }) => {
        const now = Date.now();
        const pct = Math.floor(progress * 100);
        // Не чаще раза в 10 % или 30 с — лог в CI остаётся читаемым.
        if (Math.floor(pct / 10) > Math.floor(lastPct / 10) || now - lastAt > 30_000) {
          lastPct = pct;
          lastAt = now;
          const elapsed = (now - tr) / 1000;
          const fps = renderedFrames / Math.max(0.001, elapsed);
          const eta = progress > 0.02 ? (elapsed / progress) * (1 - progress) : null;
          log(
            `[рендер] ${pct}% · кадры ${renderedFrames}/${frames} · ${fps.toFixed(1)} к/с` + (eta !== null && pct < 100 ? ` · осталось ≈ ${fmtSec(eta)}` : ""),
          );
        }
        if (renderedDoneIn !== null && stitchStage === "muxing" && !encodingLogged) {
          encodingLogged = true;
          log("[рендер] кадры готовы, свожу звук и видео…");
        }
      },
    });
    const renderMs = Date.now() - tr;
    log(`[рендер] видео готово за ${fmtSec(renderMs / 1000)} (${(frames / (renderMs / 1000)).toFixed(1)} к/с с кодированием)`);
    const loudness = await normalizeLoudness(videoFile, log);

    let thumbnailJpg: string | null = null;
    if (thumbnailFile) {
      // Обложки прошлого запуска в той же папке удаляем заранее: иначе при сбое
      // renderStill (или когда JPEG в этот раз не нужен) старый файл со
      // старым текстом ушёл бы на YouTube как свежий.
      fs.rmSync(thumbnailFile, { force: true });
      fs.rmSync(thumbnailFile.replace(/\.png$/i, "") + ".jpg", { force: true });
      try {
        const thumb = await selectComposition({ serveUrl, id: "Thumbnail", inputProps, ...browser, logLevel: "warn" });
        await renderStill({ serveUrl, composition: thumb, inputProps, output: thumbnailFile, frame: 0, imageFormat: "png", overwrite: true, ...browser, logLevel: "warn" });
        // YouTube принимает обложки до 2 МБ — при необходимости делаем JPEG.
        if (fs.statSync(thumbnailFile).size > 1.9 * 1024 * 1024) {
          thumbnailJpg = thumbnailFile.replace(/\.png$/i, "") + ".jpg";
          await renderStill({ serveUrl, composition: thumb, inputProps, output: thumbnailJpg, frame: 0, imageFormat: "jpeg", jpegQuality: 90, overwrite: true, ...browser, logLevel: "warn" });
        }
      } catch (e) {
        // Обложка — не повод терять готовое видео.
        log(`[рендер] обложку сделать не удалось: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }

    return {
      videoFile,
      loudness,
      thumbnailFile: thumbnailFile && fs.existsSync(thumbnailFile) ? thumbnailFile : null,
      thumbnailJpg,
      frames,
      durationSec: frames / FPS,
      width: composition.width,
      height: composition.height,
      bundleMs,
      renderMs,
      totalMs: Date.now() - t0,
      encoder: enc,
    };
  } catch (e) {
    if (interrupted) throw new Error("Рендер прерван пользователем.");
    throw e;
  } finally {
    process.removeListener("SIGINT", onSigint);
    // Уборка не должна превращать готовый рендер в ошибку: на Windows
    // антивирус/индексатор держит свежие файлы (EBUSY/EPERM) — повторяем и
    // в крайнем случае просто сообщаем (как deleteDirectory у самого Remotion).
    try {
      fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      log(`[рендер] не удалось удалить временную папку ${outDir} (${e instanceof Error ? e.message : String(e)}) — удалите её вручную`);
    }
  }
}

// ---- Громкость ----
// YouTube приводит громкие ролики к ~−14 LUFS, но тихие НЕ поднимает: микс с
// голосом −18 dBFS RMS звучит заметно тише соседних Shorts. Поднимаем общий
// уровень статическим усилением (без компрессии) до цели, но не выше
// true peak −1,5 dBTP. Используем ffmpeg, который везёт сам Remotion, —
// системный не нужен; видео копируется без перекодирования.

export interface LoudnessResult {
  inputLufs: number;
  inputTruePeak: number;
  gainDb: number;
  outputLufs: number; // расчётная
}

const TRUE_PEAK_CEILING = -1.5; // с запасом: перекодирование AAC добавляет ~0,1–0,3 дБ к пику

function loudnessTarget(): number | null {
  const raw = process.env.LOUDNESS_TARGET?.trim().toLowerCase();
  if (raw === "off" || raw === "none" || raw === "0") return null;
  const n = raw ? Number(raw.replace(",", ".")) : -14;
  return Number.isFinite(n) && n < 0 && n > -40 ? n : -14;
}

async function ff(args: string[]): Promise<string> {
  const proc = RenderInternals.callFf({ bin: "ffmpeg", args, indent: false, logLevel: "error", binariesDirectory: null, cancelSignal: undefined });
  const r = await proc;
  return `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
}

export async function normalizeLoudness(videoFile: string, log: Log = console.log): Promise<LoudnessResult | null> {
  const target = loudnessTarget();
  if (target === null) return null;
  const tmp = videoFile.replace(/\.mp4$/i, "") + ".loudness.mp4";
  try {
    // 1-й проход: замер (loudnorm печатает JSON с input_i / input_tp).
    const out = await ff(["-hide_banner", "-nostats", "-i", videoFile, "-map", "0:a:0", "-af", `loudnorm=I=${target}:TP=${TRUE_PEAK_CEILING}:print_format=json`, "-f", "null", "-"]);
    const json = out.slice(out.lastIndexOf("{"), out.lastIndexOf("}") + 1);
    const m = JSON.parse(json) as { input_i: string; input_tp: string };
    const inputLufs = Number(m.input_i);
    const inputTruePeak = Number(m.input_tp);
    if (!Number.isFinite(inputLufs) || !Number.isFinite(inputTruePeak) || inputLufs < -70) return null; // тишина
    const gainDb = Math.round(Math.min(target - inputLufs, TRUE_PEAK_CEILING - inputTruePeak) * 10) / 10;
    const result = { inputLufs, inputTruePeak, gainDb, outputLufs: Math.round((inputLufs + gainDb) * 10) / 10 };
    if (Math.abs(gainDb) < 0.5) {
      log(`[звук] громкость ${inputLufs.toFixed(1)} LUFS — в норме`);
      return { ...result, gainDb: 0, outputLufs: inputLufs };
    }
    // 2-й проход: только звук перекодируется, видео — копия; moov в начало
    // файла (+faststart) — ролик начинает играть до полной загрузки.
    await ff(["-hide_banner", "-nostats", "-y", "-i", videoFile, "-map", "0", "-c:v", "copy", "-af", `volume=${gainDb}dB`, "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", tmp]);
    fs.renameSync(tmp, videoFile);
    log(`[звук] громкость ${inputLufs.toFixed(1)} → ${result.outputLufs.toFixed(1)} LUFS (${gainDb > 0 ? "+" : ""}${gainDb} дБ, пик ≤ ${TRUE_PEAK_CEILING} dBTP)`);
    return result;
  } catch (e) {
    // Громкость — улучшение, а не условие: исходный файл остаётся как есть
    // (на Windows переименование не пройдёт, если видео открыто в плеере).
    fs.rmSync(tmp, { force: true });
    log(`[звук] выровнять громкость не удалось (${e instanceof Error ? e.message.split("\n")[0] : String(e)}) — оставляю как есть`);
    return null;
  }
}
