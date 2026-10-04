/** Renders every camera mode on the sandbox chase and tiles them into one image. */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { chromiumLaunchOptions } from './browser';

const MODES = ['FOLLOW', 'SIDE', 'FRONT', 'BACK', 'TOP', 'LOW', 'WIDE', 'CLOSE', 'CHASE', 'DRAMATIC', 'IMPACT', 'SLOW', 'FINISH'];
const base = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const files: string[] = [];
for (const m of MODES) {
  await page.goto(`${base}?mode=sandbox&flat&auto&cam=${m}`, { waitUntil: 'load' });
  await page.waitForTimeout(3200);
  const f = `out/cam_${m}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
await browser.close();
const inputs = files.flatMap((f) => ['-i', f]);
const n = files.length;
const layout = files.map((_, i) => `${(i % 4) * 480}_${Math.floor(i / 4) * 270}`).join('|');
const labels = files.map((_, i) => `[${i}:v]drawtext=text='${MODES[i]}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6[v${i}]`).join(';');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${labels};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=black`, 'out/camera_gallery.png']);
console.log('saved out/camera_gallery.png');
