/**
 * Edits: a video = an ordered list of segments cut from one or more
 * deterministic takes. The EditRunner plays an edit frame by frame at an
 * exact fps — headless (measuring, audio timeline) or rendered (recording).
 * Because every take is a pure function of its config, a segment can start
 * anywhere: the runner silently fast-forwards the take to the cut point.
 */
import { AudioTimeline } from '../audio/AudioTimeline';
import type { GameEvent } from '../events/GameEvents';
import type { MaterialLibrary } from '../render/materials';
import type { RenderContext } from '../render/RenderContext';
import type { EditSegment } from './ShortsPlanner';
import type { VideoConfig, VideoFormat } from './VideoConfig';
import { VideoSession, type ResolvedVideo } from './VideoSession';

export interface Chapter {
  t: number;
  title: string;
}

export interface EditPlan {
  id: string;
  title: string;
  kind: 'short' | 'long';
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  /** takes the segments are cut from */
  sources: VideoConfig[];
  segments: EditSegment[];
  /** filled by `measureEdit` (video seconds) */
  duration: number;
  chapters: Chapter[];
  music: 'auto' | 'off';
  meta: {
    description?: string;
    tags?: string[];
    hook?: string;
    ending?: string;
    climax?: number;
    voice?: Array<{ at: number; text: string }>;
    [k: string]: unknown;
  };
}

export type Resolver = (config: VideoConfig) => ResolvedVideo;

export interface RunnerOptions {
  rc?: RenderContext;
  mats?: MaterialLibrary;
  /** collect the soundtrack timeline */
  timeline?: AudioTimeline;
}

export interface FrameInfo {
  /** global video time at the end of this frame */
  t: number;
  frame: number;
  segment: number;
  /** 0..1 white flash for transitions between segments */
  flash: number;
  done: boolean;
}

/** Plays an edit at its exact frame rate. */
export class EditRunner {
  readonly timeline: AudioTimeline | null;
  video: VideoSession | null = null;
  seg = -1;
  t = 0;
  frameIndex = 0;
  segT = 0;
  done = false;
  /** video start time of each segment (known after it starts) */
  readonly segStart: number[] = [];
  /** real event log in edit time */
  readonly events: Array<{ t: number; type: string; segment: number }> = [];
  /** caption spans in edit time (subtitles / metadata) */
  readonly captions: Array<{ start: number; end: number; text: string; style: string }> = [];
  private readonly resolvedCache = new Map<number, ResolvedVideo>();
  private pending: GameEvent[] = [];
  private off: (() => void) | null = null;
  private musicKey = '';

  constructor(
    readonly plan: EditPlan,
    private readonly resolve: Resolver,
    private readonly o: RunnerOptions = {},
  ) {
    this.timeline = o.timeline ?? null;
  }

  private resolved(i: number): ResolvedVideo {
    let r = this.resolvedCache.get(i);
    if (!r) {
      r = this.resolve(this.plan.sources[i]);
      this.resolvedCache.set(i, r);
    }
    return r;
  }

  private begin(i: number): void {
    this.off?.();
    this.video?.dispose();
    this.seg = i;
    this.segT = 0;
    this.segStart[i] = this.t;
    const s = this.plan.segments[i];
    const r = this.resolved(s.source ?? 0);
    const v = new VideoSession(r, { rc: this.o.rc, mats: this.o.mats, captions: s.captions, timeOffset: this.t });
    v.fastForward(s.from);
    if (s.camera || (s.slowmo && s.slowmo < 1)) {
      const len = s.to - s.from;
      v.session.director.request(s.camera ?? 'DRAMATIC', 90, len / (s.slowmo ?? 1), 'edit', true, null, s.slowmo ?? 1, len / (s.slowmo ?? 1));
    }
    this.video = v;
    this.off = v.world.events.onAny((e) => this.pending.push(e));
    if (this.timeline) {
      if (i > 0) this.timeline.cue({ t: this.t, name: 'whoosh', gain: 0.7, pitch: 1.3 });
      const key = `${r.theme.id}:${r.level.seed}`;
      if (this.plan.music !== 'off' && (key !== this.musicKey || s.kind === 'level')) {
        this.timeline.startMusic(this.t, r.theme.music, r.level.seed);
        this.musicKey = key;
      }
    }
  }

  /** Advances one frame. Returns frame info (render happens inside when a RenderContext was given). */
  step(draw = true): FrameInfo {
    if (this.done) return { t: this.t, frame: this.frameIndex, segment: this.seg, flash: 0, done: true };
    if (this.seg < 0) this.begin(0);
    const dt = 1 / this.plan.fps;
    const v = this.video!;
    const w = v.world;
    const simA = w.time;
    const t0 = this.t;
    this.pending.length = 0;
    v.frame(dt, draw);
    const simB = w.time;
    this.t += dt;
    this.segT += dt;
    this.frameIndex++;
    // map simulation-time events to exact video time (slow motion aware)
    const span = Math.max(1e-6, simB - simA);
    for (const e of this.pending) {
      const vt = t0 + dt * Math.min(1, Math.max(0, (e.t - simA) / span));
      this.events.push({ t: vt, type: e.type, segment: this.seg });
      if (this.timeline) {
        const b = w.player.body;
        this.timeline.record(e, { x: b.x, z: b.z, yaw: v.session.heading }, vt);
      }
    }
    this.timeline?.frame(w, dt, this.t);
    const cap = v.currentCaption;
    const last = this.captions[this.captions.length - 1];
    if (cap) {
      if (last && last.text === cap.text && Math.abs(last.end - t0) < 1e-6) last.end = this.t;
      else this.captions.push({ start: t0, end: this.t, text: cap.text, style: cap.style });
    }
    const s = this.plan.segments[this.seg];
    const flash = this.seg > 0 ? Math.max(0, 1 - this.segT / 0.22) : 0;
    const maxVideo = s.maxVideo ?? ((s.to - s.from) / Math.min(1, s.slowmo ?? 1)) * 1.6 + 4;
    const lingerDone = w.status === 'finished' && w.time - w.finishTime > (s.linger ?? 3.2);
    if (w.time >= s.to - 1e-9 || this.segT >= maxVideo || lingerDone) {
      if (this.seg + 1 < this.plan.segments.length) this.begin(this.seg + 1);
      else this.finish();
    }
    return { t: this.t, frame: this.frameIndex, segment: this.seg, flash, done: this.done };
  }

  private finish(): void {
    this.done = true;
    this.off?.();
    this.off = null;
    this.video?.dispose();
    this.video = null;
  }

  dispose(): void {
    this.finish();
  }
}

/**
 * Plays the edit headlessly to learn its exact duration, segment start times
 * and chapter positions (and optionally the audio timeline).
 */
export interface EditMeasure {
  duration: number;
  segStart: number[];
  frames: number;
  events: EditRunner['events'];
  captions: EditRunner['captions'];
}

export function measureEdit(plan: EditPlan, resolve: Resolver, timeline?: AudioTimeline): EditMeasure {
  const r = new EditRunner(plan, resolve, { timeline });
  let guard = 0;
  while (!r.done && guard++ < plan.fps * 60 * 30) r.step(false);
  r.dispose();
  return { duration: r.t, segStart: r.segStart.slice(), frames: r.frameIndex, events: r.events, captions: r.captions };
}
