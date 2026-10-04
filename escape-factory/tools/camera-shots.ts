/**
 * Dev utility: renders exact moments of video takes in headless Chromium through
 * the real record pipeline (EditRunner), with and without camera collision, and
 * tiles them into one image for visual camera QA.
 *   tsx tools/camera-shots.ts out.png "level:format:scenario:take:simTime" …
 * Needs the dev server on :5173 (npm run dev).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from './browser';

const [out = 'out/camera_shots.png', ...specs] = process.argv.slice(2);
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: 960, height: 960 } });
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto('http://localhost:5173/?mode=record', { waitUntil: 'load' });
await page.waitForFunction(() => (window as unknown as { __recorder?: unknown }).__recorder);
const dir = join(dirname(out), 'camera_shots');
mkdirSync(dir, { recursive: true });
const rows: string[] = [];
for (const spec of specs) {
  const [level, format, scenario, take, t] = spec.split(':');
  const files: string[] = [];
  for (const collide of [false, true]) {
    const url: string = await page.evaluate(
      `(async () => {
        const { EditRunner } = await import('/src/engine/video/Edit.ts');
        const { resolver } = await import('/src/game/video/RecordMode.ts');
        const { validateVideoConfig } = await import('/src/engine/video/VideoConfig.ts');
        const { RenderContext } = await import('/src/engine/render/RenderContext.ts');
        const { MaterialLibrary } = await import('/src/engine/render/materials.ts');
        const cfg = validateVideoConfig({ level: ${Number(level)}, format: '${format}', scenario: '${scenario}', take: ${Number(take)}, cameraStyle: 'dynamic' }).config;
        const size = cfg.format === 'short' ? { width: 360, height: 640 } : { width: 640, height: 360 };
        window.__shotRc?.dispose();
        const rc = (window.__shotRc = new RenderContext({ parent: document.body, fixedSize: size, quality: 'high' }));
        const plan = { id: 's', title: 's', kind: 'short', format: cfg.format, width: size.width, height: size.height, fps: 30, sources: [cfg], duration: 0, chapters: [], music: 'off', meta: {},
          segments: [{ from: ${Number(t)} - 1.5, to: ${Number(t)}, kind: 'main', captions: [] }] };
        const r = new EditRunner(plan, resolver, { rc, mats: new MaterialLibrary() });
        let url = '';
        for (let i = 0; i < 400; i++) {
          if (r.video) r.video.session.camCollision.enabled = ${collide};
          const info = r.step(true);
          url = rc.canvas.toDataURL('image/jpeg', 0.9);
          if (info.done) break;
        }
        return url;
      })()`,
    );
    const f = join(dir, `${spec.replace(/[:.]/g, '_')}_${collide ? 'on' : 'off'}.jpg`);
    writeFileSync(f, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    files.push(f);
  }
  rows.push(...files);
  console.log('rendered', spec);
}
await browser.close();
// tile: one row per moment (collision off | on), scaled to a common height
const inputs = rows.flatMap((f) => ['-i', f]);
const n = rows.length;
const scaled = rows.map((_, i) => `[${i}]scale=-2:300[v${i}]`).join(';');
const pairs = Array.from({ length: n / 2 }, (_, k) => `[v${2 * k}][v${2 * k + 1}]hstack=2[r${k}]`).join(';');
const stack = n / 2 > 1 ? `;${Array.from({ length: n / 2 }, (_, k) => `[r${k}]`).join('')}xstack=inputs=${n / 2}:layout=${Array.from({ length: n / 2 }, (_, k) => `0_${k === 0 ? 0 : Array.from({ length: k }, (_, j) => `h${j}`).join('+')}`).join('|')}:fill=black` : '';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${scaled};${pairs}${stack}`, out]);
console.log('saved', out);
