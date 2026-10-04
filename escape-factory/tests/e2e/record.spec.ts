import { expect, test } from '@playwright/test';

type Rec = {
  init: (raw: unknown, o: unknown) => { frames: number; renderWidth: number; renderHeight: number; duration: number; errors: string[] };
  next: (n: number) => { frames: string[]; done: boolean; frame: number };
  audio: (from: number, to: number) => Promise<string>;
  meta: () => { captions: Array<{ text: string; start: number }> };
};

test('record mode renders frame-exact JPEG frames and an offline soundtrack', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/?mode=record');
  await page.waitForFunction(() => (window as unknown as { __recorder?: unknown }).__recorder);
  const init = await page.evaluate(() =>
    (window as unknown as { __recorder: Rec }).__recorder.init(
      { id: 'e2e', level: 1, scenario: 'CHASE', format: 'short', duration: 30, captions: [{ at: 0, duration: 1.5, text: 'CAN I ESCAPE?!', style: 'hook' }] },
      { scale: 0.25, quality: 0.6 },
    ),
  );
  expect(init.errors).toEqual([]);
  expect(init.renderWidth).toBe(270);
  expect(init.renderHeight).toBe(480);
  expect(init.duration).toBeGreaterThanOrEqual(25);
  expect(init.frames).toBe(Math.round(init.duration * 30));
  const batch = await page.evaluate(() => (window as unknown as { __recorder: Rec }).__recorder.next(4));
  expect(batch.frames.length).toBe(4);
  expect(batch.frame).toBe(4);
  // JPEG magic bytes (base64 of FF D8 FF)
  for (const f of batch.frames) expect(f.startsWith('/9j/')).toBe(true);
  // frames differ over time (the game is moving)
  expect(batch.frames[0]).not.toBe(batch.frames[3]);
  const pcm = await page.evaluate(async () => {
    const b64 = await (window as unknown as { __recorder: Rec }).__recorder.audio(0, 1);
    const bin = atob(b64);
    let peak = 0;
    for (let i = 0; i + 1 < bin.length; i += 2) {
      const v = (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)) << 16 >> 16;
      peak = Math.max(peak, Math.abs(v));
    }
    return { bytes: bin.length, peak };
  });
  expect(pcm.bytes).toBe(48000 * 4);
  expect(pcm.peak).toBeGreaterThan(100);
  const meta = await page.evaluate(() => (window as unknown as { __recorder: Rec }).__recorder.meta());
  expect(meta.captions[0].text).toBe('CAN I ESCAPE?!');
});
