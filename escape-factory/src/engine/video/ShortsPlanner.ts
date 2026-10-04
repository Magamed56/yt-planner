/**
 * Shorts edit planner (1080×1920, 25–40 s):
 *   0–1 s HOOK · 1–5 ACTION · 5–20 ESCALATION · 20–30 CLIMAX · 30–40 ESCAPE / FAIL / LOOP
 * Never starts with an intro card: if the climax is late, a ~1.3 s cold open
 * (flash-forward of the climax) becomes the first shot.
 */
import type { GameEvent } from '../events/GameEvents';
import { bestWindow, coldOpenCamera, interestCurve, type Focus } from './Highlights';
import type { CaptionSpec } from './VideoConfig';

export interface EditSegment {
  /** simulation time range of this take to show */
  from: number;
  to: number;
  kind: 'coldOpen' | 'main' | 'level' | 'replay';
  /** captions in segment-local video time */
  captions: CaptionSpec[];
  /** force a camera at segment start (cold opens love CLOSE/DRAMATIC) */
  camera?: 'DRAMATIC' | 'CLOSE' | 'CHASE' | 'WIDE';
  /** simulation slow-motion for the whole segment */
  slowmo?: number;
  /** which config/take this segment belongs to (long videos) */
  source?: number;
  /** hard cap on this segment's video length */
  maxVideo?: number;
  /** seconds to keep filming after the finish line */
  linger?: number;
  /** chapter title (long videos) */
  chapter?: string;
}

export interface ShortsPlan {
  segments: EditSegment[];
  duration: number;
  climax: number;
  ending: 'finish' | 'escape' | 'fail' | 'loop';
  score: number;
}

export interface ShortsOptions {
  duration: number;
  focus?: Focus[];
  hook?: string;
  climaxCaption?: string;
  outro?: string;
  coldOpen?: boolean;
  /** the window must contain this simulation time (the moment the title promises) */
  contain?: number;
  /** the window must end here (fail videos end right after the catch) */
  endAt?: number;
}

export function planShort(events: GameEvent[], takeDuration: number, o: ShortsOptions): ShortsPlan {
  const D = Math.min(Math.max(o.duration, 10), 59);
  const curve = interestCurve(events, takeDuration, o.focus ?? []);
  const useCold = o.coldOpen !== false;
  const coldLen = 1.4;
  let mainLen = Math.min(D - (useCold ? coldLen : 0), Math.max(5, takeDuration));
  const endAt = o.endAt !== undefined ? Math.min(o.endAt, takeDuration) : undefined;
  // an early catch: the window simply starts at the beginning of the level
  if (endAt !== undefined && endAt - 0.5 < mainLen) mainLen = Math.max(6, endAt - 0.5);
  let win = bestWindow(curve, events, mainLen, { minStart: 0.5, contain: o.contain, endAt });
  if (!Number.isFinite(win.score)) win = bestWindow(curve, events, mainLen, { minStart: 0.5, contain: o.contain });
  if (!Number.isFinite(win.score)) win = bestWindow(curve, events, mainLen, { minStart: 0.5 });
  const segments: EditSegment[] = [];
  const climaxRel = (win.climax - win.start) / Math.max(1, win.end - win.start);
  const cold = useCold && climaxRel > 0.35 && win.hook < 0.8;
  const ending: ShortsPlan['ending'] =
    o.endAt !== undefined && Math.abs(win.end - o.endAt) < 0.5
      ? 'fail'
      : win.resolution?.type === 'PLAYER_FINISH'
        ? 'finish'
        : win.resolution?.type === 'PLAYER_FAIL'
          ? 'fail'
          : win.resolution
            ? 'escape'
            : 'loop';
  if (cold) {
    segments.push({
      from: Math.max(0, win.climax - 0.8),
      to: Math.max(0, win.climax - 0.8) + coldLen,
      kind: 'coldOpen',
      camera: coldOpenCamera(events, win.climax),
      slowmo: 0.6,
      captions: o.hook ? [{ at: 0, duration: coldLen, text: o.hook, style: 'hook' }] : [],
    });
  }
  const mainCaps: CaptionSpec[] = [];
  if (!cold && o.hook) mainCaps.push({ at: 0, duration: 1.6, text: o.hook, style: 'hook' });
  if (o.climaxCaption) mainCaps.push({ at: -1, atSim: Math.max(win.start + 1.5, win.climax - 0.4), duration: 1.3, text: o.climaxCaption, style: 'label' });
  if (o.outro && win.resolution) mainCaps.push({ at: -1, atSim: win.resolution.t + 0.2, duration: 2, text: o.outro, style: 'outro' });
  segments.push({ from: win.start, to: win.end, kind: 'main', captions: mainCaps });
  const duration = segments.reduce((a, s) => a + (s.to - s.from) / (s.slowmo ?? 1), 0);
  return { segments, duration, climax: win.climax, ending, score: win.score };
}
