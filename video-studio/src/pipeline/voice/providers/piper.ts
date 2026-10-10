// Piper (VITS) — локально и офлайн, через sherpa-onnx-node. Бесплатно, без
// сети после первой загрузки модели (~65 МБ на голос). Качество проще, чем у
// нейроголосов Edge/Gemini, зато работает всегда: запасной вариант для CI и
// для тех, у кого облачные TTS заблокированы.

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { envPath } from "../../audio/paths";
import { LANGS } from "../../lang";
import { TtsError, warnOnce } from "../http";
import { downloadTarModel, tarModelReady, type TarModel } from "../model-download";
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
  // Ролик не на русском (TTS_LANGUAGE): голос Piper того же языка, если он есть.
  const langVoice = LANGS[(process.env.TTS_LANGUAGE ?? "").trim().toLowerCase()]?.piperVoice ?? null;
  if (!v) return langVoice ?? PIPER_DEFAULT_VOICE;
  if (PIPER_RU_VOICES.includes(v.toLowerCase())) return `ru_RU-${v.toLowerCase()}-medium`;
  if (/^[a-z]{2,3}_[A-Z]{2}-[A-Za-z0-9_]+-(x_low|low|medium|high)$/.test(v)) return v;
  // Голос Edge другого языка (en-US-…Neural при автозамене Edge → Piper) — Piper того же языка.
  const edgeLang = /^([a-z]{2})-[A-Z]{2}-\w+Neural$/.exec(v)?.[1];
  if (edgeLang && edgeLang !== "ru" && LANGS[edgeLang]?.piperVoice) return LANGS[edgeLang]!.piperVoice!;
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

function modelComplete(dir: string, voice: string): boolean {
  // Папку могли распаковать вручную (так советуют сообщения загрузчика) — тогда
  // проверяем все нужные файлы, включая данные espeak и последний член архива.
  const need = [`${voice}.onnx`, `${voice}.onnx.json`, "tokens.txt", path.join("espeak-ng-data", "phontab"), path.join("espeak-ng-data", "phondata")];
  return need.every((f) => existsSync(path.join(dir, f)));
}

async function downloadModel(voice: string): Promise<string> {
  const model: TarModel = {
    label: "Piper",
    title: `голос Piper ${voice} (~65 МБ)`,
    url: `${MODELS_URL}/vits-piper-${voice}.tar.bz2`,
    dir: piperModelDir(voice),
    complete: (d) => modelComplete(d, voice),
    httpHint: "Проверьте имя голоса TTS_VOICE.",
  };
  if (tarModelReady(model)) return model.dir;
  const dir = await downloadTarModel(model);
  console.log(`[озвучка] Голос ${voice} готов.`);
  return dir;
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
