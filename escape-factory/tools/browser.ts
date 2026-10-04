import { existsSync } from 'node:fs';
import type { LaunchOptions } from 'playwright';

/**
 * Chromium launch options tuned for deterministic WebGL rendering in headless
 * environments (CI, cloud containers). Uses SwiftShader when no GPU exists.
 * Honors PW_CHROMIUM_PATH, falls back to the pre-installed browser if present.
 */
export function chromiumLaunchOptions(o: { gpu?: boolean } = {}): LaunchOptions {
  const candidates = [
    process.env.PW_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean) as string[];
  const executablePath = candidates.find((p) => existsSync(p));
  return {
    executablePath,
    args: [
      ...(o.gpu ? ['--use-gl=angle', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required',
    ],
  };
}
