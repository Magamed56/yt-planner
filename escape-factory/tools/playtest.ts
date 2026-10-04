/**
 * Dev utility: opens the game, holds keys, takes screenshots.
 * Usage: tsx tools/playtest.ts "<url>" out/prefix [seconds] [keys...]
 */
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from './browser';

const [url = 'http://localhost:5173/?level=1', prefix = 'out/play', secs = '4', ...keys] = process.argv.slice(2);
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs: string[] = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
for (const k of keys.length ? keys : ['KeyW']) await page.keyboard.down(k);
const n = Number(secs);
for (let i = 0; i < n; i++) {
  await page.waitForTimeout(1000);
  if (i % 2 === 1) {
    await page.keyboard.press('Space');
  }
  await page.screenshot({ path: `${prefix}_${i}.png` });
}
const state = await page.evaluate(() => {
  const app = (window as unknown as { __app?: { session?: { world: { summary(): unknown } } } }).__app;
  return app?.session?.world.summary();
});
console.log(JSON.stringify(state));
console.log(logs.filter((l) => !l.includes('vite')).join('\n'));
await browser.close();
