// Dev: отрендерить контрольные кадры каждой сцены демо-ролика + обложку в PNG,
// чтобы глазами проверить вёрстку, не собирая видео целиком.
//
//   npx tsx src/dev/stills.ts
//   npx tsx src/dev/stills.ts --variants=shorts-midnight --scenes=1,4 --frames=mid
//
// Результат: out/dev/stills/<вариант>/<NN>-<kind>-<момент>.png и thumbnail-*.png
import fs from "node:fs";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { buildFixtureProps } from "../remotion/fixtures/buildFixture";
import type { Format, SceneVisual, ThemeName, VideoProps } from "../types";
import { OUT_DEV, bundleComposition, getBrowserOpts, parseArgs, preparePublicDir, readDemoScript } from "./devRender";

const SAMPLE_IMAGE_URL = "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/starry_night.jpg"; // public domain (Ван Гог)

// Пробуем скачать картинку-пример для проверки MediaLayer; не вышло — без неё.
async function fetchSample(cacheDir: string): Promise<string | null> {
  const file = path.join(cacheDir, "sample.jpg");
  if (fs.existsSync(file)) return file;
  try {
    const ctrl = AbortSignal.timeout(15000);
    const res = await fetch(SAMPLE_IMAGE_URL, { signal: ctrl });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch (e) {
    console.warn(`[stills] пример картинки не скачался (${String(e)}) — сцены с визуалом пропущены`);
    return null;
  }
}

interface Variant {
  name: string;
  format: Format;
  theme: ThemeName;
  withVisual: boolean;
  showCaptions: boolean;
}

const VARIANTS: Variant[] = [
  { name: "shorts-midnight", format: "shorts", theme: "midnight", withVisual: false, showCaptions: true },
  { name: "landscape-sunset", format: "landscape", theme: "sunset", withVisual: false, showCaptions: true },
  { name: "shorts-emerald-visual", format: "shorts", theme: "emerald", withVisual: true, showCaptions: true },
  { name: "shorts-mono", format: "shorts", theme: "mono", withVisual: false, showCaptions: false },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wanted = args.variants ? args.variants.split(",") : VARIANTS.map((v) => v.name);
  const sceneFilter = args.scenes ? new Set(args.scenes.split(",").map((s) => Number(s) - 1)) : null;
  const moments = (args.frames ?? "early,mid,late").split(",");
  const thumbs = args.thumb !== "false";

  const publicDir = preparePublicDir("stills");
  const sample = await fetchSample(path.join(OUT_DEV, "cache"));
  if (sample) {
    fs.mkdirSync(path.join(publicDir, "visuals"), { recursive: true });
    fs.copyFileSync(sample, path.join(publicDir, "visuals", "sample.jpg"));
  }
  const serveUrl = await bundleComposition(publicDir);
  const browserOpts = await getBrowserOpts();
  const browser = await openBrowser("chrome", { ...browserOpts, logLevel: "warn" });
  const script = readDemoScript();
  const outRoot = path.join(OUT_DEV, "stills");
  let count = 0;
  const t0 = Date.now();

  try {
    for (const v of VARIANTS.filter((x) => wanted.includes(x.name))) {
      const visual = (id: string): SceneVisual => {
        if (!v.withVisual || !sample) return { type: "none" };
        // Визуал на media-сцене (крупно) и на statement (приглушённым фоном).
        return id === "s5" || id === "s3" ? { type: "image", src: "visuals/sample.jpg" } : { type: "none" };
      };
      const props: VideoProps = buildFixtureProps(script, { format: v.format, theme: v.theme, visual, showCaptions: v.showCaptions });
      const inputProps = props as unknown as Record<string, unknown>;
      const dir = path.join(outRoot, v.name);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const composition = await selectComposition({ serveUrl, id: "Video", inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });

      for (const [i, s] of props.scenes.entries()) {
        if (sceneFilter && !sceneFilter.has(i)) continue;
        const voiceFrames = Math.ceil((s.audioDurationMs / 1000) * 30);
        const at: Record<string, number> = {
          early: 10,
          mid: s.audioStartFrame + Math.round(voiceFrames * 0.55),
          late: s.durationInFrames - (i === props.scenes.length - 1 ? 2 : props.transitionFrames + 1),
          trans: s.durationInFrames - Math.round(props.transitionFrames / 2),
        };
        for (const m of moments) {
          if (at[m] === undefined) continue;
          if (m === "trans" && i === props.scenes.length - 1) continue;
          const frame = Math.min(props.durationInFrames - 1, s.startFrame + Math.max(0, at[m]));
          const output = path.join(dir, `${String(i + 1).padStart(2, "0")}-${s.kind}-${m}.png`);
          await renderStill({ serveUrl, composition, inputProps, frame, output, imageFormat: "png", puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
          count++;
          console.log(`[stills] ${path.relative(OUT_DEV, output)} (кадр ${frame})`);
        }
      }
      if (thumbs) {
        const thumbComp = await selectComposition({ serveUrl, id: "Thumbnail", inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
        const output = path.join(outRoot, `thumbnail-${v.name}.png`);
        await renderStill({ serveUrl, composition: thumbComp, inputProps, frame: 0, output, imageFormat: "png", puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
        count++;
        console.log(`[stills] ${path.relative(OUT_DEV, output)}`);
      }
    }
  } finally {
    await browser.close({ silent: true });
  }
  console.log(`[stills] готово: ${count} PNG за ${((Date.now() - t0) / 1000).toFixed(1)} с → ${outRoot}`);
}

main().catch((e) => {
  console.error(`[stills] ошибка: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
