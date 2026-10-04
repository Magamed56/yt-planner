/**
 * Dev utility: renders a campaign level in video mode on the running dev server
 * and prints draw calls, triangles, GPU resources and mesh counts per view.
 *   tsx tools/perf-probe.ts <level> [waitMs]
 */
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from './browser';
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const lv = process.argv[2] ?? '15';
await page.goto(`http://localhost:5173/?mode=video&level=${lv}&format=long&scenario=CHASE&take=1`, { waitUntil: 'load' });
await page.waitForFunction(() => (window as any).__booted);
await page.waitForTimeout(Number(process.argv[3] ?? 6000));
const r: any = await page.evaluate(`(() => {
  const app = window.__video; const s = app.video.session; const v = s.view; const scene = app.rc.scene;
  const named = {};
  function walk2(o, path, depth) {
    const name = o.name || o.type;
    if (depth <= 2) { let n = 0; o.traverse((x) => { if ((x.isMesh || x.isPoints) && x.visible) n++; }); named[path + '/' + name] = n; }
    if (depth < 2) for (const c of o.children) walk2(c, path + '/' + name, depth + 1);
  }
  walk2(scene, '', 0);
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) s.frame(1 / 60);
  const ms = (performance.now() - t0) / 30;
  return { stats: v.stats(), named, ms, level: s.world.level.seed, theme: s.world.level.theme };
})()`);
console.log(`L${lv} ${r.theme} seed ${r.level} · ${JSON.stringify(r.stats)} · frame ${r.ms.toFixed(1)} ms (incl. SwiftShader GPU)`);
console.log(Object.entries(r.named as Record<string, number>).filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${n}\t${k}`).join('\n'));
await browser.close();
