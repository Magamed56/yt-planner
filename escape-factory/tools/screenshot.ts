/**
 * Dev utility: opens a URL of the running dev server in headless Chromium and
 * saves a screenshot. Usage: tsx tools/screenshot.ts "<url>" out.png [w] [h] [waitMs]
 */
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from './browser';

const [url = 'http://localhost:5173/', out = 'out/screenshot.png', w = '1280', h = '720', wait = '1500'] =
  process.argv.slice(2);

const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs: string[] = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
console.log('saved', out);
await browser.close();
