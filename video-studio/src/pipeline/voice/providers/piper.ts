// Piper (VITS) — локально и офлайн, через sherpa-onnx-node. Бесплатно, без
// сети после первой загрузки модели (~65 МБ на голос). Качество проще, чем у
// нейроголосов Edge/Gemini, зато работает всегда: запасной вариант для CI и
// для тех, у кого облачные TTS заблокированы.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { envPath } from "../../audio/paths";
import { TtsError, linkedAbort, warnOnce } from "../http";
import type { RawProvider } from "../provider";

export const PIPER_DEFAULT_VOICE = "ru_RU-dmitri-medium";
export const PIPER_RU_VOICES = ["dmitri", "irina", "denis", "ruslan"];
const MODELS_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

// Типы ровно той части sherpa-onnx-node, что нам нужна (у пакета нет .d.ts).
interface GeneratedAudio {
  samples: Float32Array;
  sampleRate: number;
}
interface OfflineTtsInstance {
  sampleRate: number;
  generateAsync(req: { text: string; sid: number; speed: number }): Promise<GeneratedAudio>;
}
interface SherpaModule {
  OfflineTts: { createAsync(config: unknown): Promise<OfflineTtsInstance> };
}

export function resolvePiperVoice(requested: string | undefined): string {
  const v = requested?.trim().replace(/^vits-piper-/, "");
  if (!v) return PIPER_DEFAULT_VOICE;
  if (PIPER_RU_VOICES.includes(v.toLowerCase())) return `ru_RU-${v.toLowerCase()}-medium`;
  if (/^[a-z]{2,3}_[A-Z]{2}-[A-Za-z0-9_]+-(x_low|low|medium|high)$/.test(v)) return v;
  // Голос Edge (чаще всего — при автозамене Edge → Piper): сохраняем хотя бы
  // пол диктора, иначе женский голос канала молча стал бы мужским.
  if (/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(v)) {
    const female = /Svetlana|Dariya|Darya/i.test(v);
    const piper = female ? "ru_RU-irina-medium" : PIPER_DEFAULT_VOICE;
    warnOnce(
      `piper-voice-${v}`,
      `[озвучка] Голос Edge "${v}" у Piper недоступен — использую ${female ? "женский" : "мужской"} ${piper}` +
        (female ? " (лицензия датасета irina не указана — см. README)." : "."),
    );
    return piper;
  }
  warnOnce(
    `piper-voice-${v}`,
    `[озвучка] Голос "${v}" не похож на голос Piper — использую ${PIPER_DEFAULT_VOICE}. Русские голоса Piper: ${PIPER_RU_VOICES.map((n) => `ru_RU-${n}-medium`).join(", ")}.`,
  );
  return PIPER_DEFAULT_VOICE;
}

export function piperModelDir(voice: string): string {
  return path.join(envPath("MODELS_DIR", "models"), `vits-piper-${voice}`);
}

const modelReady = new Map<string, Promise<string>>();

// Модель скачивается один раз за процесс (параллельные сцены ждут одну загрузку).
export function ensurePiperModel(voice: string): Promise<string> {
  let p = modelReady.get(voice);
  if (!p) {
    p = downloadModel(voice).catch((e: unknown) => {
      modelReady.delete(voice);
      throw e;
    });
    modelReady.set(voice, p);
  }
  return p;
}

// Метка «распаковано до конца»: пишется только после того, как tar вышел с
// кодом 0. Проверять одни .onnx и tokens.txt нельзя — в архиве они идут
// ПЕРЕД ~390 файлами espeak-ng-data, и прерванная распаковка (Ctrl+C,
// антивирус, нет места) выглядела бы готовой моделью навсегда.
const COMPLETE_MARKER = ".complete";

function modelComplete(dir: string, voice: string): boolean {
  if (existsSync(path.join(dir, COMPLETE_MARKER))) return true;
  // Папку могли распаковать вручную (так советуют сообщения ниже) — тогда
  // проверяем все нужные файлы, включая данные espeak и последний член архива.
  const need = [`${voice}.onnx`, `${voice}.onnx.json`, "tokens.txt", path.join("espeak-ng-data", "phontab"), path.join("espeak-ng-data", "phondata")];
  return need.every((f) => existsSync(path.join(dir, f)));
}

class TarExitError extends TtsError {}

async function downloadModel(voice: string): Promise<string> {
  const dir = piperModelDir(voice);
  if (modelComplete(dir, voice)) return dir;
  const root = path.dirname(dir);
  await mkdir(root, { recursive: true });
  const name = `vits-piper-${voice}.tar.bz2`;
  const url = `${MODELS_URL}/${name}`;
  const archive = path.join(root, name);
  for (let attempt = 1; ; attempt++) {
    // Архив прошлой попытки уже скачан целиком (.part переименовывается только
    // после успешной загрузки), а распаковка не дошла до конца — берём его.
    const leftover = existsSync(archive);
    if (leftover) console.log(`[озвучка] Распаковываю ранее скачанный ${name}…`);
    else await fetchArchive(voice, url, archive, root);
    await rm(dir, { recursive: true, force: true }); // остатки прерванной распаковки
    try {
      await extractTarBz2(archive, root);
      break;
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      // Старый архив оказался битым — один раз качаем заново.
      if (leftover && attempt === 1 && e instanceof TarExitError) {
        await rm(archive, { force: true });
        continue;
      }
      throw e;
    }
  }
  await rm(archive, { force: true });
  if (!modelComplete(dir, voice)) {
    throw new TtsError(`Piper: после распаковки в ${dir} нет ${voice}.onnx, tokens.txt или espeak-ng-data. Удалите папку — голос скачается заново.`);
  }
  await writeFile(path.join(dir, COMPLETE_MARKER), "");
  console.log(`[озвучка] Голос ${voice} готов.`);
  return dir;
}

async function fetchArchive(voice: string, url: string, archive: string, root: string): Promise<void> {
  const part = archive + ".part";
  console.log(`[озвучка] Скачиваю голос Piper ${voice} (~65 МБ) в ${root}…`);

  // Таймаут «простоя»: если данные не идут 60 с — обрываем, а не ждём вечно.
  const idleMs = 60_000;
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), idleMs);
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), idleMs);
  };
  try {
    const { signal, cleanup } = linkedAbort(30 * 60_000, ctrl.signal);
    try {
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new TtsError(`Piper: не удалось скачать модель (HTTP ${res.status}) ${url}. Проверьте имя голоса TTS_VOICE.`);
      const total = Number(res.headers.get("content-length")) || 0;
      let got = 0;
      let lastPct = -10;
      const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
      body.on("data", (chunk: Buffer) => {
        bump();
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (total && pct >= lastPct + 20) {
          lastPct = pct;
          console.log(`[озвучка]   ${pct}% (${(got / 1e6).toFixed(0)} МБ)`);
        }
      });
      await pipeline(body, createWriteStream(part));
    } finally {
      cleanup();
    }
  } catch (e) {
    await rm(part, { force: true });
    if (e instanceof TtsError) throw e;
    throw new TtsError(
      `Piper: загрузка модели прервалась (${(e as Error).message}). Скачайте вручную ${url} и распакуйте в ${root}.`,
      { cause: e },
    );
  } finally {
    clearTimeout(idle);
  }
  await rename(part, archive);
}

// В Node нет bzip2, поэтому распаковываем системным tar: он есть в Windows 10+
// (bsdtar), macOS и Linux. Запускаем из папки моделей с относительным именем
// архива — так GNU tar из Git Bash не примет «C:» за адрес удалённого хоста.
function extractTarBz2(archive: string, cwd: string): Promise<void> {
  const winTar = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "tar.exe") : "";
  const tar = process.platform === "win32" && winTar && existsSync(winTar) ? winTar : "tar";
  return new Promise((resolve, reject) => {
    const p = spawn(tar, ["-xjf", path.basename(archive)], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e) =>
      reject(new TtsError(`Piper: не найдена утилита tar (${e.message}). Распакуйте ${archive} вручную (например, 7-Zip) в ${cwd}.`, { cause: e })),
    );
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new TarExitError(`Piper: tar не смог распаковать ${archive} (код ${code}): ${err.slice(0, 300)}. Распакуйте вручную в ${cwd}.`)),
    );
  });
}

let sherpa: SherpaModule | null = null;
function loadSherpa(): SherpaModule {
  if (sherpa) return sherpa;
  try {
    sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as SherpaModule;
    return sherpa;
  } catch (e) {
    throw new TtsError(
      `Piper: не загрузился sherpa-onnx-node для ${process.platform}-${process.arch} (${(e as Error).message.split("\n")[0]}). Переустановите зависимости (npm ci) или выберите другой TTS_PROVIDER.`,
      { cause: e },
    );
  }
}

interface Engine {
  tts: OfflineTtsInstance;
  queue: Promise<unknown>; // синтез на одном экземпляре — строго по очереди
}
const engines = new Map<string, Promise<Engine>>();

function getEngine(voice: string): Promise<Engine> {
  let e = engines.get(voice);
  if (!e) {
    e = (async () => {
      const dir = await ensurePiperModel(voice);
      const lib = loadSherpa();
      const create = (d: string) =>
        lib.OfflineTts.createAsync({
          model: {
            vits: { model: path.join(d, `${voice}.onnx`), tokens: path.join(d, "tokens.txt"), dataDir: path.join(d, "espeak-ng-data") },
            numThreads: Math.max(1, Math.min(4, os.cpus().length)),
            provider: "cpu",
            debug: 0,
          },
          maxNumSentences: 1,
        });
      let tts: OfflineTtsInstance;
      try {
        tts = await create(dir);
      } catch (err) {
        // Модель не грузится — почти всегда папка битая (обрезанный .onnx,
        // неполные данные espeak): удаляем и скачиваем заново один раз,
        // вместо английского «Check your config!» на каждом запуске.
        console.warn(`[озвучка] Piper: модель в ${dir} не загрузилась (${(err as Error).message}) — похоже, распакована не полностью. Скачиваю заново…`);
        await rm(dir, { recursive: true, force: true });
        modelReady.delete(voice);
        const again = await ensurePiperModel(voice);
        try {
          tts = await create(again);
        } catch (err2) {
          throw new TtsError(
            `Piper: не удалось загрузить модель из ${again} (${(err2 as Error).message}). Удалите эту папку — голос скачается заново, — или выберите другой TTS_PROVIDER.`,
            { cause: err2 },
          );
        }
      }
      return { tts, queue: Promise.resolve() };
    })().catch((err: unknown) => {
      engines.delete(voice);
      throw err;
    });
    engines.set(voice, e);
  }
  return e;
}

export function piperProvider(): RawProvider {
  return {
    name: "piper",
    output: "wav",
    maxAttempts: 1, // локальный синтез детерминирован: повтор ничего не даст
    resolveVoice: resolvePiperVoice,
    configKey: () => `piper:${process.env.TTS_RATE ?? ""}`,
    async synthesizeRaw(text, ctx) {
      const engine = await getEngine(ctx.voice);
      const run = engine.queue.then(() => engine.tts.generateAsync({ text, sid: 0, speed: ctx.rate }));
      engine.queue = run.catch(() => {});
      const audio = await run;
      if (!audio.samples?.length) throw new TtsError("Piper: модель вернула пустой звук.");
      return { kind: "pcm", audio: { sampleRate: audio.sampleRate, channels: [Float32Array.from(audio.samples)] } };
    },
  };
}
