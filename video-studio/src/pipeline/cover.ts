// Обложка для Reels (cover.jpg, 1080×1920): кадр самой композиции Video в
// «сильный» момент — конец хука, когда фраза уже целиком на экране, но
// переход ещё не начался. Субтитры и полоску прогресса на обложке прячем.
// Тот же момент уходит в Instagram как thumb_offset — обложка в сетке
// профиля совпадает с файлом, который можно поставить вручную.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { FPS, type VideoProps } from "../types";
import { projectRoot } from "./audio/paths";
import { getBrowserOptions, type Log } from "./render";

export function coverFrame(props: Pick<VideoProps, "scenes" | "transitionFrames" | "durationInFrames">): number {
  const hook = props.scenes.find((s) => s.kind === "hook") ?? props.scenes[0];
  if (!hook) return 0;
  const end = hook.startFrame + hook.durationInFrames - (props.scenes.length > 1 ? props.transitionFrames : 0) - 2;
  const earliest = hook.startFrame + hook.audioStartFrame + Math.round(FPS * 0.8);
  return Math.max(0, Math.min(props.durationInFrames - 1, Math.max(earliest, end)));
}

export const frameToMs = (frame: number): number => Math.round((frame / FPS) * 1000);

export async function renderCover(opts: { runDir: string; props: VideoProps; file?: string; frame?: number; log?: Log }): Promise<{ file: string; frame: number; ms: number }> {
  const log = opts.log ?? console.log;
  const publicDir = path.join(opts.runDir, "public");
  const file = opts.file ?? path.join(opts.runDir, "cover.jpg");
  const frame = opts.frame ?? coverFrame(opts.props);
  fs.rmSync(file, { force: true }); // старая обложка не должна выдать себя за новую
  const browser = await getBrowserOptions(log);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-studio-cover-"));
  try {
    // Бандл с кэшем webpack — после рендера ролика это пара секунд.
    const serveUrl = await bundle({ entryPoint: path.join(projectRoot(), "src", "remotion", "index.ts"), publicDir, outDir, enableCaching: true });
    const inputProps = { ...opts.props, showCaptions: false, showProgressBar: false } as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "Video", inputProps, ...browser, logLevel: "warn" });
    await renderStill({ serveUrl, composition, inputProps, output: file, frame, imageFormat: "jpeg", jpegQuality: 92, overwrite: true, ...browser, logLevel: "warn" });
    return { file, frame, ms: frameToMs(frame) };
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // временная папка — не повод ронять готовый ролик (Windows держит файлы)
    }
  }
}
