import { expect, test } from '@playwright/test';

test('video mode hides UI, uses the format aspect and the bot plays', async ({ page }) => {
  await page.goto('/?mode=video&level=2&scenario=CHASE&format=short');
  await page.waitForFunction(() => (window as unknown as { __booted?: boolean }).__booted === true);
  await page.waitForTimeout(2500);
  expect(await page.locator('#ui').count()).toBe(0);
  const info = await page.evaluate(() => {
    const v = (window as unknown as { __video: { video: { world: { playerS: number; time: number } }; rc: { size: { width: number; height: number } } } }).__video;
    return { s: v.video.world.playerS, t: v.video.world.time, size: v.rc.size };
  });
  expect(info.size.height).toBeGreaterThan(info.size.width);
  expect(info.t).toBeGreaterThan(1);
  expect(info.s).toBeGreaterThan(4);
});

test('studio loads and previews', async ({ page }) => {
  await page.goto('/?mode=studio');
  await page.waitForFunction(() => (window as unknown as { __booted?: boolean }).__booted === true);
  await expect(page.getByText('VIDEO STUDIO')).toBeVisible();
  await page.selectOption('#scenario', 'NEAR_DEATH');
  await page.click('#go');
  await expect(page.locator('#out')).toContainText('NEAR_DEATH');
});
