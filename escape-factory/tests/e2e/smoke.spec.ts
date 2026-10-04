import { expect, test } from '@playwright/test';

type W = Window & {
  __booted?: boolean;
  __app?: { session: { world: { time: number; playerS: number; status: string }; paused: boolean } };
};

test('menu boots and renders a non-blank 3D scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as W).__booted === true);
  await expect(page.locator('#ui .screen.show h1.logo')).toBeVisible();
  await page.waitForTimeout(800);
  const varied = await page.evaluate(() => {
    // render now and read back in the same task (drawing buffer is not preserved)
    (window as unknown as { __app: { session: { frame(dt: number): void } } }).__app.session.frame(1 / 60);
    const c = document.querySelector('#app canvas') as HTMLCanvasElement;
    const g = document.createElement('canvas');
    g.width = 32;
    g.height = 18;
    const ctx = g.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 32, 18);
    const d = ctx.getImageData(0, 0, 32, 18).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return set.size;
  });
  expect(varied).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('level 1 is playable with the keyboard and can be paused', async ({ page }) => {
  await page.goto('/?level=1');
  await page.waitForFunction(() => (window as W).__booted === true);
  await expect(page.locator('#ui .hud.show')).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const s = await page.evaluate(() => {
    const w = (window as W).__app!.session.world;
    return { t: w.time, s: w.playerS };
  });
  expect(s.t).toBeGreaterThan(1);
  expect(s.s).toBeGreaterThan(5);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ui .screen.show h2', { hasText: 'PAUSED' })).toBeVisible();
  const t1 = await page.evaluate(() => (window as W).__app!.session.world.time);
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => (window as W).__app!.session.world.time);
  expect(t2).toBe(t1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const t3 = await page.evaluate(() => (window as W).__app!.session.world.time);
  expect(t3).toBeGreaterThan(t2);
});
