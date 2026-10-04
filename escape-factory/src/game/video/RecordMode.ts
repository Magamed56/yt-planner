/**
 * RECORD MODE (?mode=record): a deterministic, frame-exact renderer driven by
 * tools/record.ts through `window.__recorder`. Frames are rendered at the
 * exact output resolution with fixed 1/fps steps (never wall-clock), JPEG
 * encoded and pulled by the CLI, which pipes them into ffmpeg. The soundtrack
 * is synthesised afterwards from the recorded audio timeline.
 */
import { AudioTimeline, toPcm16 } from '@engine/audio/AudioTimeline';
import { EditRunner, measureEdit, type EditPlan, type Resolver } from '@engine/video/Edit';
import { planShortEdit } from '@engine/video/plans';
import { DEFAULT_VIDEO, validateVideoConfig, type VideoConfig } from '@engine/video/VideoConfig';
import { resolveVideo } from '@engine/video/VideoSession';
import { MaterialLibrary } from '@engine/render/materials';
import { RenderContext } from '@engine/render/RenderContext';
import { campaignParams } from '../campaign';
import { registerContent } from '../content';
import { RECIPES } from '../recipes';
import { planLongVideo, type LongOptions } from './longPlan';

export interface RecordOptions {
  /** render scale (0.5 = draft at half resolution, upscaled by ffmpeg) */
  scale?: number;
  /** JPEG quality 0..1 */
  quality?: number;
  /** long video: minutes (5/10/15/20) */
  long?: LongOptions;
  /** override fps */
  fps?: number;
}

export interface RecordInit {
  id: string;
  title: string;
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
  fps: number;
  frames: number;
  duration: number;
  errors: string[];
  warnings: string[];
}

export const resolver: Resolver = (c: VideoConfig) => resolveVideo(c, { campaign: (n) => campaignParams(n, c.enemy) });

export function planFor(config: VideoConfig, long?: LongOptions): EditPlan {
  if (long) return planLongVideo({ ...long, title: config.title && config.title !== DEFAULT_VIDEO.title ? config.title : undefined, base: config }, resolver);
  const recipe = RECIPES.find((r) => r.id === config.recipe);
  return planShortEdit(config, resolver, recipe ? { hook: recipe.hook, climax: recipe.climax, outro: recipe.outro, focus: recipe.focus } : {});
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

class Recorder {
  rc: RenderContext | null = null;
  readonly mats = new MaterialLibrary();
  plan: EditPlan | null = null;
  runner: EditRunner | null = null;
  timeline: AudioTimeline | null = null;
  quality = 0.9;
  totalFrames = 0;
  private comp: HTMLCanvasElement | null = null;

  constructor(private readonly root: HTMLElement) {
    registerContent();
  }

  init(raw: unknown, o: RecordOptions = {}): RecordInit {
    const v = validateVideoConfig(raw);
    const config = v.config;
    if (o.fps) config.fps = o.fps;
    const plan = planFor(config, o.long);
    this.plan = plan;
    const scale = Math.min(1, Math.max(0.25, o.scale ?? 1));
    const rw = Math.round((plan.width * scale) / 2) * 2;
    const rh = Math.round((plan.height * scale) / 2) * 2;
    this.quality = o.quality ?? 0.9;
    this.rc?.dispose();
    this.rc = new RenderContext({ parent: this.root, fixedSize: { width: rw, height: rh }, quality: 'high' });
    this.timeline = new AudioTimeline();
    this.runner = new EditRunner(plan, resolver, { rc: this.rc, mats: this.mats, timeline: this.timeline });
    this.totalFrames = Math.round(plan.duration * plan.fps);
    return {
      id: plan.id,
      title: plan.title,
      width: plan.width,
      height: plan.height,
      renderWidth: rw,
      renderHeight: rh,
      fps: plan.fps,
      frames: this.totalFrames,
      duration: plan.duration,
      errors: v.errors,
      warnings: v.warnings,
    };
  }

  /** Renders up to `n` frames; returns them as base64 JPEG. */
  next(n: number): { frames: string[]; done: boolean; frame: number; t: number } {
    const r = this.runner!;
    const frames: string[] = [];
    const canvas = this.rc!.canvas;
    for (let i = 0; i < n && !r.done; i++) {
      const info = r.step(true);
      frames.push(this.capture(canvas, info.flash));
    }
    return { frames, done: r.done, frame: r.frameIndex, t: r.t };
  }

  private capture(canvas: HTMLCanvasElement, flash: number): string {
    let src: HTMLCanvasElement = canvas;
    if (flash > 0.01) {
      // segment transition: quick white flash composited over the frame
      const c = (this.comp ??= document.createElement('canvas'));
      c.width = canvas.width;
      c.height = canvas.height;
      const g = c.getContext('2d')!;
      g.drawImage(canvas, 0, 0);
      g.fillStyle = `rgba(255,255,255,${(flash * 0.85).toFixed(3)})`;
      g.fillRect(0, 0, c.width, c.height);
      src = c;
    }
    const url = src.toDataURL('image/jpeg', this.quality);
    return url.slice(url.indexOf(',') + 1);
  }

  /** The current edit plan (serialisable). */
  get planJson(): EditPlan | null {
    return this.plan;
  }

  /** Soundtrack chunk [from, to) as base64 s16le stereo PCM at `rate`. */
  async audio(from: number, to: number, rate = 48000): Promise<string> {
    const [L, R] = await this.timeline!.render(from, to, rate);
    return b64(toPcm16(L, R));
  }

  meta(): Record<string, unknown> {
    const plan = this.plan!;
    const r = this.runner!;
    const chapters = plan.segments
      .map((s, i) => (s.chapter ? { t: r.segStart[i] ?? 0, title: s.chapter } : null))
      .filter((c): c is { t: number; title: string } => !!c);
    return {
      id: plan.id,
      title: plan.title,
      kind: plan.kind,
      format: plan.format,
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      duration: r.t,
      frames: r.frameIndex,
      chapters,
      segments: plan.segments.map((s, i) => ({ ...s, videoStart: r.segStart[i] ?? null })),
      captions: r.captions,
      events: r.events.filter((e) => e.type !== 'PLAYER_STEP' && e.type !== 'ENEMY_STEP' && e.type !== 'COIN_COLLECT'),
      sources: plan.sources,
      meta: plan.meta,
    };
  }

  /** Headless measurement only (no rendering) — used by plan:videos and tests. */
  measure(raw: unknown, o: RecordOptions = {}): Record<string, unknown> {
    const config = validateVideoConfig(raw).config;
    const plan = planFor(config, o.long);
    const m = measureEdit(plan, resolver);
    return { plan, duration: m.duration, captions: m.captions };
  }
}

export function installRecorder(root: HTMLElement): void {
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  const rec = new Recorder(root);
  (window as unknown as { __recorder: Recorder }).__recorder = rec;
}
