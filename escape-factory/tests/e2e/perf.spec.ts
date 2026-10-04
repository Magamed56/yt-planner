import { expect, test } from '@playwright/test';

type VApp = {
  load: (c: unknown) => unknown;
  resolved: { config: Record<string, unknown> };
  video: { session: { frame: (dt: number) => void; view: { stats: () => { drawCalls: number; geometries: number; textures: number } } } };
  stop: () => void;
};

test('reloading levels does not leak GPU geometries/textures and stays within the draw-call budget', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/?mode=video&level=3&format=long');
  await page.waitForFunction(() => (window as unknown as { __booted?: boolean }).__booted === true);
  const samples = await page.evaluate(async () => {
    const app = (window as unknown as { __video: VApp }).__video;
    app.stop();
    const base = app.resolved.config;
    const out: Array<{ geometries: number; textures: number; drawCalls: number }> = [];
    for (let i = 0; i < 12; i++) {
      const L = [3, 15, 45, 85][i % 4];
      app.load({ ...base, level: L, seed: 1000 + L, theme: ['FACTORY', 'FACTORY', 'CANDY', 'HALLOWEEN'][i % 4] });
      for (let f = 0; f < 12; f++) app.video.session.frame(1 / 30);
      out.push(app.video.session.view.stats());
    }
    return out;
  });
  // the same 4 levels three times
  // round 1 warms bounded shared caches (what is uploaded depends on the first shots);
  // a leak shows as growth from round 2 to round 3
  const texMax1 = Math.max(...samples.slice(0, 8).map((s) => s.textures));
  for (let i = 8; i < 12; i++) {
    expect(samples[i].geometries, `geometries round 3 #${i}`).toBeLessThanOrEqual(samples[i - 4].geometries + 2);
    // sign/label textures live in a bounded text cache: they plateau, never grow per load
    expect(samples[i].textures, `textures round 3 #${i}`).toBeLessThanOrEqual(texMax1);
  }
  for (const s of samples) expect(s.drawCalls).toBeLessThan(300);
  console.log(JSON.stringify(samples));
});
