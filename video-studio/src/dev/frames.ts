// Dev: отрендерить выбранные кадры ролика (из настоящего props.json или из
// демо-фикстуры) в PNG и, если есть системный ffmpeg, склеить их в
// «контактный лист» JPG — быстро оценить вёрстку и ритм всего ролика.
//
//   npx tsx src/dev/frames.ts --props=out/<slug>/props.json --frames=0,6,12
//   npx tsx src/dev/frames.ts --props=out/<slug>/props.json --frames=scenes --sheet=4
//   npx tsx src/dev/frames.ts --fixture --format=landscape --theme=sunset --frames=every:45
//
// --frames: список кадров через запятую | "scenes" (начало/середина/конец
// каждой сцены) | "every:N" (каждый N-й кадр).
// --theme / --format / --captions=false переопределяют props (тайминг не трогают).
// Результат: out/dev/frames/<name>/fNNNNN.png и sheet.jpg (ffmpeg — только для dev).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { buildFixtureProps } from "../remotion/fixtures/buildFixture";
import { THEME_NAMES, type Format, type ThemeName, type VideoProps } from "../types";
import { OUT_DEV, ROOT, bundleComposition, getBrowserOpts, parseArgs, preparePublicDir, readDemoScript } from "./devRender";

function pickFrames(spec: string, props: VideoProps): number[] {
  const last = props.durationInFrames - 1;
  if (spec === "scenes") {
    const out: number[] = [];
    props.scenes.forEach((s, i) => {
      const voice = Math.ceil((s.audioDurationMs / 1000) * 30);
      const tail = i === props.scenes.length - 1 ? 2 : props.transitionFrames + 1;
      out.push(s.startFrame + 14, s.startFrame + s.audioStartFrame + Math.round(voice * 0.5), s.startFrame + s.durationInFrames - tail);
    });
    return out.map((f) => Math.min(last, Math.max(0, f)));
  }
  const every = spec.match(/^every:(\d+)$/);
  if (every) {
    const n = Math.max(1, Number(every[1]));
    const out: number[] = [];
    for (let f = 0; f <= last; f += n) out.push(f);
    return out;
  }
  return spec
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
    .map((f) => Math.min(last, Math.max(0, Math.round(f))));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let props: VideoProps;
  let publicDir: string;
  let name: string;
  if (args.props) {
    const file = path.resolve(ROOT, args.props);
    props = JSON.parse(fs.readFileSync(file, "utf8")) as VideoProps;
    publicDir = path.join(path.dirname(file), "public");
    name = path.basename(path.dirname(file));
  } else {
    props = buildFixtureProps(readDemoScript());
    publicDir = preparePublicDir("frames");
    name = "fixture";
  }
  if (args.format === "shorts" || args.format === "landscape") props = { ...props, format: args.format as Format };
  if (THEME_NAMES.includes(args.theme as ThemeName)) props = { ...props, theme: args.theme as ThemeName };
  if (args.captions === "false") props = { ...props, showCaptions: false };
  name = args.name ?? `${name}-${props.format}-${props.theme}`;

  const frames = pickFrames(args.frames ?? "scenes", props);
  const outDir = path.join(OUT_DEV, "frames", name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const serveUrl = await bundleComposition(publicDir, "frames");
  const browserOpts = await getBrowserOpts();
  const browser = await openBrowser("chrome", { ...browserOpts, logLevel: "warn" });
  const inputProps = props as unknown as Record<string, unknown>;
  const t0 = Date.now();
  const files: string[] = [];
  try {
    const composition = await selectComposition({ serveUrl, id: "Video", inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
    for (const frame of frames) {
      const output = path.join(outDir, `f${String(frame).padStart(5, "0")}.png`);
      await renderStill({ serveUrl, composition, inputProps, frame, output, imageFormat: "png", puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
      files.push(output);
    }
    if (args.thumb === "true") {
      const thumbComp = await selectComposition({ serveUrl, id: "Thumbnail", inputProps, puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
      await renderStill({ serveUrl, composition: thumbComp, inputProps, frame: 0, output: path.join(outDir, "thumbnail.png"), imageFormat: "png", puppeteerInstance: browser, ...browserOpts, logLevel: "warn" });
    }
  } finally {
    await browser.close({ silent: true });
  }
  console.log(`[frames] ${files.length} PNG за ${((Date.now() - t0) / 1000).toFixed(1)} с → ${outDir}`);

  // Контактный лист: системный ffmpeg (только dev; боевой код его не требует).
  const cols = Number(args.sheet ?? "0");
  if (cols > 0 && files.length > 0) {
    const scale = Number(args.scale ?? (props.format === "shorts" ? "0.25" : "0.2"));
    const rows = Math.ceil(files.length / cols);
    const list = path.join(outDir, "list.txt");
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    const r = spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=iw*${scale}:-2,drawtext=text='%{eif\\:n\\:d}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5,tile=${cols}x${rows}:padding=4:color=gray`, "-frames:v", "1", "-q:v", "4", path.join(outDir, "sheet.jpg")],
      { stdio: "inherit" },
    );
    if (r.status === 0) console.log(`[frames] лист: ${path.join(outDir, "sheet.jpg")} (кадры: ${frames.join(",")})`);
  }
}

main().catch((e) => {
  console.error(`[frames] ошибка: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
