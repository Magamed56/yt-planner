// Dev: собрать демо-ролик целиком в out/dev/preview.mp4 — с синтетическим
// «голосом» (гудки по таймингам слов), музыкальной подложкой и свистом
// переходов, чтобы проверить синхронизацию, приглушение музыки и скорость.
//
//   npx tsx src/dev/preview.ts
//   npx tsx src/dev/preview.ts --format=landscape --theme=sunset --frames=0-299 --concurrency=4
//   npx tsx src/dev/preview.ts --visual        (картинка/клип-пример на сценах s3/s5)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { buildFixtureProps } from "../remotion/fixtures/buildFixture";
import { FPS, THEME_NAMES, type Format, type SceneVisual, type ThemeName } from "../types";
import {
  OUT_DEV,
  bundleComposition,
  getBrowserOpts,
  parseArgs,
  preparePublicDir,
  readDemoScript,
  synthMusic,
  synthVoice,
  synthWhoosh,
  writeWav,
} from "./devRender";

const SAMPLE_IMAGE_URL = "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/starry_night.jpg";

async function fetchSample(file: string): Promise<boolean> {
  if (fs.existsSync(file)) return true;
  try {
    const res = await fetch(SAMPLE_IMAGE_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (e) {
    console.warn(`[preview] пример картинки не скачался (${String(e)}) — без визуалов`);
    return false;
  }
}

// Только для dev-проверки <OffthreadVideo> в <Loop>: клип из картинки через
// системный ffmpeg, если он есть. Боевой код ffmpeg не требует.
function makeClip(image: string, out: string): boolean {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-loop", "1", "-i", image, "-t", "2.5", "-vf", "scale=1280:-2,zoompan=z='1+0.0015*on':d=1:s=1280x1024:fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", out],
    { stdio: "inherit" },
  );
  return r.status === 0 && fs.existsSync(out);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const format: Format = args.format === "landscape" ? "landscape" : "shorts";
  const theme: ThemeName = THEME_NAMES.includes(args.theme as ThemeName) ? (args.theme as ThemeName) : "midnight";
  const concurrency = args.concurrency ? Number(args.concurrency) : null;
  const out = path.resolve(args.out ?? path.join(OUT_DEV, format === "shorts" ? "preview.mp4" : "preview-landscape.mp4"));

  const script = readDemoScript();
  const publicDir = preparePublicDir("preview");

  // Визуалы-примеры (по флагу --visual)
  let visual: ((id: string) => SceneVisual) | undefined;
  if (args.visual) {
    const cached = path.join(OUT_DEV, "cache", "sample.jpg");
    if (await fetchSample(cached)) {
      fs.mkdirSync(path.join(publicDir, "visuals"), { recursive: true });
      fs.copyFileSync(cached, path.join(publicDir, "visuals", "sample.jpg"));
      const clip = path.join(publicDir, "visuals", "clip.mp4");
      const hasClip = makeClip(cached, clip);
      visual = (id) =>
        id === "s5"
          ? hasClip
            ? { type: "video", src: "visuals/clip.mp4", durationSec: 2.5 }
            : { type: "image", src: "visuals/sample.jpg" }
          : id === "s3"
            ? { type: "image", src: "visuals/sample.jpg" }
            : { type: "none" };
    }
  }

  // Сначала props с оценочными таймингами, затем по ним — WAV «голоса».
  const props = buildFixtureProps(script, {
    format,
    theme,
    visual,
    audioSrc: (id) => `voice/${id}.wav`,
    music: { src: "music/pad.wav", volume: 0.32, duckedVolume: 0.08 },
    whooshSrc: "sfx/whoosh.wav",
  });
  for (const s of props.scenes) {
    const v = synthVoice(s.words, s.audioDurationMs);
    writeWav(path.join(publicDir, "voice", `${s.id}.wav`), v.samples, v.sampleRate);
  }
  const m = synthMusic(8);
  writeWav(path.join(publicDir, "music", "pad.wav"), m.samples, m.sampleRate);
  const w = synthWhoosh(0.6);
  writeWav(path.join(publicDir, "sfx", "whoosh.wav"), w.samples, w.sampleRate);

  const serveUrl = await bundleComposition(publicDir);
  const browserOpts = await getBrowserOpts();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: "Video", inputProps, ...browserOpts, logLevel: "warn" });

  let frameRange: [number, number] | null = null;
  if (args.frames) {
    const [a, b] = args.frames.split("-").map(Number);
    frameRange = [Math.max(0, a), Math.min(composition.durationInFrames - 1, b)];
  }
  const total = frameRange ? frameRange[1] - frameRange[0] + 1 : composition.durationInFrames;
  console.log(
    `[preview] ${composition.width}×${composition.height}, ${total} кадров (${(total / FPS).toFixed(1)} с), CPU: ${os.cpus().length}, concurrency: ${concurrency ?? "по умолчанию"}`,
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const t0 = Date.now();
  let lastLog = 0;
  let renderedAt = 0;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    audioCodec: "aac",
    crf: 20,
    outputLocation: out,
    frameRange,
    concurrency,
    ...browserOpts,
    logLevel: "warn",
    onProgress: ({ renderedFrames, encodedFrames, progress, renderedDoneIn }) => {
      if (renderedDoneIn !== null && !renderedAt) renderedAt = Date.now();
      const now = Date.now();
      if (now - lastLog > 5000) {
        lastLog = now;
        const sec = (now - t0) / 1000;
        console.log(`[preview] ${Math.round(progress * 100)}% кадров ${renderedFrames}/${total}, закодировано ${encodedFrames}, ${(renderedFrames / sec).toFixed(1)} к/с`);
      }
    },
  });
  const sec = (Date.now() - t0) / 1000;
  console.log(`[preview] готово за ${sec.toFixed(1)} с → ${(total / sec).toFixed(1)} кадров/с (с кодированием и звуком) → ${out}`);
}

main().catch((e) => {
  console.error(`[preview] ошибка: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
