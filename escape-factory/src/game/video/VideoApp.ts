/**
 * VIDEO MODE runner (?mode=video): bot plays, director films, no UI.
 * Realtime preview of a VideoConfig at its exact output aspect ratio.
 */
import { AudioSystem } from '@engine/audio/AudioSystem';
import { MaterialLibrary } from '@engine/render/materials';
import { RenderContext } from '@engine/render/RenderContext';
import { resolveVideo, VideoSession, type ResolvedVideo } from '@engine/video/VideoSession';
import type { VideoConfig } from '@engine/video/VideoConfig';
import { campaignParams } from '../campaign';
import { registerContent } from '../content';

export class VideoApp {
  readonly rc: RenderContext;
  readonly mats = new MaterialLibrary();
  video: VideoSession | null = null;
  resolved: ResolvedVideo | null = null;
  private audioCtx: AudioContext | null = null;
  private audio: AudioSystem | null = null;
  private last = performance.now();
  private running = false;
  private endTimer = -1;
  loop = true;
  onEnd: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    registerContent();
    this.rc = new RenderContext({ parent, fixedSize: { width: 1080, height: 1920 }, quality: 'high' });
  }

  load(config: VideoConfig): ResolvedVideo {
    this.video?.dispose();
    this.resolved = resolveVideo(config, { campaign: (n) => campaignParams(n, config.enemy) });
    this.rc.setFixedSize(previewSize(this.resolved.size));
    this.video = new VideoSession(this.resolved, { rc: this.rc, mats: this.mats, audio: this.audio });
    if (this.audio && config.music !== 'off') this.audio.startMusic(this.resolved.theme.music, this.resolved.level.seed);
    this.endTimer = -1;
    return this.resolved;
  }

  enableAudio(): void {
    if (this.audioCtx) return;
    try {
      this.audioCtx = new AudioContext();
      this.audio = new AudioSystem(this.audioCtx);
      if (this.resolved) this.load(this.resolved.config);
    } catch {
      /* no audio */
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const v = this.video;
      if (v) {
        v.frame(dt);
        const w = v.world;
        const cfg = this.resolved!.config;
        const done = (w.status === 'finished' && w.time - w.finishTime > 3) || (cfg.highlight === 'start' && v.videoTime > cfg.duration);
        if (done && this.endTimer < 0) {
          this.endTimer = 0.5;
        }
        if (this.endTimer >= 0) {
          this.endTimer -= dt;
          if (this.endTimer <= 0) {
            this.onEnd?.();
            if (this.loop) this.load(cfg);
          }
        }
      }
      if (this.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }
}

/** Preview at a reduced but proportional resolution (recording uses the exact size). */
export function previewSize(size: { width: number; height: number }): { width: number; height: number } {
  const k = Math.min(1, 1280 / Math.max(size.width, size.height));
  return { width: Math.round(size.width * k), height: Math.round(size.height * k) };
}
