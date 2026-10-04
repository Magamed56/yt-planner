/**
 * RECORDER CLI — renders a VideoConfig (or a long-form compilation) to MP4.
 *
 *   npm run record -- videos/video_001.json              # one Short (1080×1920)
 *   npm run record -- videos/                            # every config in a folder
 *   npm run record -- --json '{"level":5,"scenario":"FAIL"}'
 *   npm run record -- --long 10 --start 11               # 10-minute long video (1920×1080)
 *
 * Options: --out <dir> (default out/videos) · --scale 0.5 (draft: render at half
 * size, upscale) · --quality 0.9 (JPEG) · --fps 30 · --crf 18 · --gpu (use the
 * real GPU instead of SwiftShader) · --no-audio · --plan-only
 *
 * Pipeline: Vite (in-process) → headless Chromium ?mode=record → frame-exact
 * JPEG frames → ffmpeg (H.264) ; soundtrack rendered offline (OfflineAudioContext)
 * → AAC ; outputs <id>.mp4, <id>.json (metadata, chapters, events), <id>.srt,
 * <id>.jpg (thumbnail at the climax).
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { chromiumLaunchOptions } from './browser';

interface Args {
  inputs: string[];
  json?: string;
  long?: number;
  start?: number;
  out: string;
  scale: number;
  quality: number;
  fps?: number;
  crf: number;
  gpu: boolean;
  audio: boolean;
  planOnly: boolean;
  id?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { inputs: [], out: 'out/videos', scale: 1, quality: 0.9, crf: 18, gpu: false, audio: true, planOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    switch (k) {
      case '--json': a.json = v(); break;
      case '--long': a.long = Number(argv[i + 1] && !argv[i + 1].startsWith('--') ? v() : 5); break;
      case '--start': a.start = Number(v()); break;
      case '--out': a.out = v(); break;
      case '--scale': a.scale = Number(v()); break;
      case '--quality': a.quality = Number(v()); break;
      case '--fps': a.fps = Number(v()); break;
      case '--crf': a.crf = Number(v()); break;
      case '--id': a.id = v(); break;
      case '--gpu': a.gpu = true; break;
      case '--no-audio': a.audio = false; break;
      case '--plan-only': a.planOnly = true; break;
      default: a.inputs.push(k);
    }
  }
  return a;
}

function collectConfigs(a: Args): Array<{ name: string; raw: Record<string, unknown> }> {
  const out: Array<{ name: string; raw: Record<string, unknown> }> = [];
  if (a.json) out.push({ name: 'cli', raw: JSON.parse(a.json) });
  for (const inp of a.inputs) {
    const p = resolve(inp);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).filter((f) => f.endsWith('.json')).sort()) out.push({ name: f, raw: JSON.parse(readFileSync(join(p, f), 'utf8')) });
    } else out.push({ name: basename(p), raw: JSON.parse(readFileSync(p, 'utf8')) });
  }
  if (!out.length && a.long) out.push({ name: 'long', raw: {} });
  return out;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}\n${err}`))));
  });
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const srtTime = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

async function recordOne(page: Page, raw: Record<string, unknown>, a: Args): Promise<void> {
  // long-form: from the CLI (--long N) or from the config file ("long": {"minutes": 10, "startLevel": 1})
  const fileLong = raw.long as { minutes: number; startLevel?: number } | undefined;
  const long = a.long ? { minutes: a.long, startLevel: a.start } : fileLong;
  if ('long' in raw) {
    raw = { ...raw };
    delete raw.long;
  }
  const opts = { scale: a.scale, quality: a.quality, fps: a.fps, long };
  if (a.long) raw = { id: a.id ?? `long_${a.long}min_L${a.start ?? 1}`, title: '', ...raw };
  else if (a.id) raw = { ...raw, id: a.id };
  const t0 = Date.now();
  const init = await page.evaluate(([r, o]) => (window as any).__recorder.init(r, o), [raw, opts] as const);
  if (init.errors.length) throw new Error(`config errors: ${init.errors.join('; ')}`);
  for (const w of init.warnings) console.warn(`  warning: ${w}`);
  console.log(`▶ ${init.id} "${init.title}" ${init.width}x${init.height}@${init.fps} · ${init.duration.toFixed(1)} s · ${init.frames} frames (render ${init.renderWidth}x${init.renderHeight}) · planned in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  mkdirSync(a.out, { recursive: true });
  const base = join(a.out, init.id);
  if (a.planOnly) {
    const meta = await page.evaluate(() => (window as any).__recorder.planJson);
    writeFileSync(`${base}.plan.json`, JSON.stringify(meta, null, 2));
    return;
  }
  const videoTmp = `${base}.video.mp4`;
  const vf = init.renderWidth !== init.width ? ['-vf', `scale=${init.width}:${init.height}:flags=lanczos`] : [];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(init.fps), '-c:v', 'mjpeg', '-i', '-', ...vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(a.crf), '-pix_fmt', 'yuv420p', '-r', String(init.fps), '-movflags', '+faststart', videoTmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg video exited ${c}`)))));
  let frames = 0;
  let last = Date.now();
  const tr = Date.now();
  for (;;) {
    const batch = await page.evaluate((n) => (window as any).__recorder.next(n), 6);
    for (const f of batch.frames) {
      if (!ff.stdin.write(Buffer.from(f, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      frames++;
    }
    if (Date.now() - last > 4000 || batch.done) {
      last = Date.now();
      const fps = frames / ((Date.now() - tr) / 1000);
      process.stdout.write(`  frames ${frames}/${init.frames} (${((frames / Math.max(1, init.frames)) * 100).toFixed(0)}%) · ${fps.toFixed(1)} fps · eta ${fmtTime(Math.max(0, init.frames - frames) / Math.max(0.1, fps))}\n`);
    }
    if (batch.done) break;
  }
  ff.stdin.end();
  await ffDone;
  const meta = await page.evaluate(() => (window as any).__recorder.meta());
  const duration = frames / init.fps;
  // soundtrack
  let audioPath: string | null = null;
  if (a.audio && raw.music !== 'off') {
    audioPath = `${base}.pcm`;
    const ws = createWriteStream(audioPath);
    const chunk = 30;
    for (let t = 0; t < duration; t += chunk) {
      const b64: string = await page.evaluate(([f, to]) => (window as any).__recorder.audio(f, to), [t, Math.min(duration, t + chunk)] as const);
      ws.write(Buffer.from(b64, 'base64'));
    }
    await new Promise<void>((r) => ws.end(r));
  }
  const final = `${base}.mp4`;
  if (audioPath) {
    await run('ffmpeg', ['-y', '-i', videoTmp, '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-t', duration.toFixed(3), '-movflags', '+faststart', final]);
    rmSync(audioPath);
    rmSync(videoTmp);
  } else {
    rmSync(final, { force: true });
    await run('ffmpeg', ['-y', '-i', videoTmp, '-c', 'copy', final]);
    rmSync(videoTmp);
  }
  // thumbnail at the climax (or the middle)
  const caps = meta.captions as Array<{ start: number; style: string }>;
  const label = caps.find((c) => c.style === 'label' && c.start > 1.5);
  const thumbT = label ? Math.min(duration - 0.5, label.start + 0.5) : duration * 0.4;
  await run('ffmpeg', ['-y', '-ss', Math.max(0, thumbT).toFixed(2), '-i', final, '-frames:v', '1', '-q:v', '3', `${base}.jpg`]).catch(() => {});
  // subtitles + chapters + metadata
  const srt = (meta.captions as Array<{ start: number; end: number; text: string }>).map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
  writeFileSync(`${base}.srt`, srt);
  const chapters = (meta.chapters as Array<{ t: number; title: string }>).map((c, i) => `${fmtTime(i === 0 ? 0 : c.t)} ${c.title}`).join('\n');
  const m = meta.meta as { description?: string; tags?: string[] };
  const description = [m.description ?? '', chapters ? `\nChapters:\n${chapters}` : '', '\nMade with ESCAPE FACTORY (procedural levels, bot gameplay, auto-directed camera).'].join('\n').trim();
  writeFileSync(`${base}.json`, JSON.stringify({ ...meta, file: basename(final), youtube: { title: meta.title, description, tags: m.tags ?? [] } }, null, 2));
  const size = statSync(final).size / 1e6;
  console.log(`✔ ${final} · ${duration.toFixed(1)} s · ${size.toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)} s total`);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const configs = collectConfigs(a);
  if (!configs.length) {
    console.error('usage: npm run record -- <config.json|dir> | --json <config> | --long <minutes> [--start N]');
    process.exit(2);
  }
  const root = resolve(import.meta.dirname, '..');
  const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${server.config.server.port}/`;
  const browser = await chromium.launch(chromiumLaunchOptions({ gpu: a.gpu }));
  let failed = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
    page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && console.error(`[console] ${m.text()}`));
    await page.goto(`${url}?mode=record`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).__recorder, null, { timeout: 60000 });
    for (const c of configs) {
      try {
        await recordOne(page, c.raw, a);
      } catch (e) {
        failed++;
        console.error(`✘ ${c.name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (!existsSync(a.out)) mkdirSync(a.out, { recursive: true });
  process.exit(failed ? 1 : 0);
}

await main();
