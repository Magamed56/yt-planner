// Общие помощники dev-скриптов (stills.ts, preview.ts): браузер, временный
// publicDir с ассетами проекта и бандл композиции. Только Node.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser } from "@remotion/renderer";
import type { VideoScript } from "../types";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DEV = path.join(ROOT, "out", "dev");

export function readDemoScript(): VideoScript {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "examples", "demo-ru.json"), "utf8")) as VideoScript;
}

export interface BrowserOpts {
  browserExecutable?: string;
  chromeMode?: "headless-shell" | "chrome-for-testing";
}

// REMOTION_BROWSER_EXECUTABLE / REMOTION_CHROME_MODE — для песочниц и CI со
// своим Chromium. Без них Remotion сам скачивает headless shell (ensureBrowser)
// в node_modules/.remotion — так работает на GitHub Actions и на ПК.
export async function getBrowserOpts(): Promise<BrowserOpts> {
  const exe = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();
  const modeRaw = process.env.REMOTION_CHROME_MODE?.trim();
  const chromeMode = modeRaw === "chrome-for-testing" || modeRaw === "headless-shell" ? modeRaw : undefined;
  if (exe) {
    if (!fs.existsSync(exe)) throw new Error(`REMOTION_BROWSER_EXECUTABLE указывает на несуществующий файл: ${exe}`);
    return { browserExecutable: exe, chromeMode: chromeMode ?? "headless-shell" };
  }
  if (!chromeMode) {
    console.log("[браузер] REMOTION_BROWSER_EXECUTABLE не задан — проверяю/скачиваю Chrome Headless Shell (один раз)…");
    // Ошибка скачивания у Remotion вылетает как НЕПЕРЕХВАТЫВАЕМОЕ исключение
    // (try/catch не ловит) и оставляет download.lock — ловим глобально,
    // убираем замок и объясняем, что делать.
    const lock = path.join(ROOT, "node_modules", ".remotion", "chrome-headless-shell", "download.lock");
    const onFail = (err: unknown) => {
      fs.rmSync(lock, { force: true });
      console.error(
        `[браузер] не удалось скачать Chrome Headless Shell: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}\n` +
          "  Проверьте интернет (нужен remotion.media или storage.googleapis.com) или укажите свой Chrome/Chromium:\n" +
          "  REMOTION_BROWSER_EXECUTABLE=<путь> и REMOTION_CHROME_MODE=headless-shell | chrome-for-testing",
      );
      process.exit(1);
    };
    process.once("uncaughtException", onFail);
    try {
      await ensureBrowser({ logLevel: "warn" });
    } catch (e) {
      onFail(e);
    } finally {
      process.removeListener("uncaughtException", onFail);
    }
  }
  return chromeMode ? { chromeMode } : {};
}

// Временный publicDir: ассеты проекта копируются под "assets/", как это
// делает боевой рендер; extra — что ещё положить (голос, музыка, визуалы).
export function preparePublicDir(name: string): string {
  const dir = path.join(os.tmpdir(), `video-studio-dev-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const assets = path.join(ROOT, "assets");
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(dir, "assets"), { recursive: true });
  return dir;
}

// Бандл кладём в фиксированную папку (а не новый mkdtemp на каждый запуск):
// иначе в temp копятся десятки папок по ~30 МБ.
export async function bundleComposition(publicDir: string, name = "dev"): Promise<string> {
  const t0 = Date.now();
  let last = -10;
  const outDir = path.join(os.tmpdir(), `video-studio-dev-bundle-${name}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "src", "remotion", "index.ts"),
    publicDir,
    outDir,
    onProgress: (p) => {
      if (p - last >= 25 || p === 100) {
        last = p;
        process.stdout.write(`\r[бандл] ${Math.round(p)}%   `);
      }
    },
  });
  process.stdout.write(`\n[бандл] готов за ${((Date.now() - t0) / 1000).toFixed(1)} с\n`);
  return serveUrl;
}

// Аргументы вида --key=value / --flag.
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? "true";
  }
  return out;
}

// ---- Генерация тестового звука (WAV PCM16 mono) без ffmpeg ----

export function writeWav(file: string, samples: Float32Array, sampleRate: number): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

const SR = 24000;

// «Голос»: на каждое слово — тихий гудок с огибающей. Достаточно, чтобы
// проверить синхронизацию и приглушение музыки по осциллограмме.
export function synthVoice(words: { startMs: number; endMs: number }[], durationMs: number): { samples: Float32Array; sampleRate: number } {
  const n = Math.ceil((durationMs / 1000) * SR);
  const s = new Float32Array(n);
  words.forEach((w, wi) => {
    const a = Math.floor((w.startMs / 1000) * SR);
    const b = Math.min(n, Math.floor((w.endMs / 1000) * SR));
    const f = 170 + (wi % 3) * 25;
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR;
      const len = (b - a) / SR;
      const env = Math.min(1, t / 0.02, (len - t) / 0.03);
      s[i] = 0.32 * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t));
    }
  });
  return { samples: s, sampleRate: SR };
}

// Музыкальная «подложка»: мягкий аккордовый пэд, 8 с, зацикливается.
export function synthMusic(seconds = 8): { samples: Float32Array; sampleRate: number } {
  const n = Math.ceil(seconds * SR);
  const s = new Float32Array(n);
  const chords = [
    [220, 277.18, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
    [196, 246.94, 329.63],
  ];
  const per = n / chords.length;
  for (let i = 0; i < n; i++) {
    const c = chords[Math.floor(i / per)];
    const t = i / SR;
    const local = (i % per) / per;
    const env = Math.min(1, local / 0.08, (1 - local) / 0.08);
    let v = 0;
    for (const f of c) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t);
    s[i] = 0.12 * env * v;
  }
  return { samples: s, sampleRate: SR };
}

// Свист перехода: шум с нарастающей и спадающей огибающей и «полётом» фильтра.
export function synthWhoosh(seconds = 0.6): { samples: Float32Array; sampleRate: number } {
  const n = Math.ceil(seconds * SR);
  const s = new Float32Array(n);
  let lp = 0;
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    const p = i / n;
    const cutoff = 0.02 + 0.25 * Math.sin(Math.PI * p);
    lp += cutoff * (white - lp);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, p * 1.25)), 2);
    s[i] = 0.9 * env * lp;
  }
  return { samples: s, sampleRate: SR };
}
