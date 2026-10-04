/**
 * Long-form planner (1920×1080, 5/10/15/20 min): auto-assembles a video from
 * consecutive levels, each played with a different scenario/take so the
 * compilation keeps changing (chase → near death → speedrun → fail+retry →
 * chaos …, boss levels as set-pieces). Starts with a cold open of the best
 * moment, then one chapter per level, ends with a teaser outro.
 */
import { measureEdit, type EditPlan, type Resolver } from './Edit';
import { coldOpenCamera, interestCurve, peaks } from './Highlights';
import type { EditSegment } from './ShortsPlanner';
import { VIDEO_FORMATS, type VideoConfig, type VideoScenario } from './VideoConfig';
import { simulateTake, type TakeResult } from './VideoSession';

export interface ChapterProgram {
  scenario: VideoScenario;
  take: number;
  /** short label used in chapter titles ("CHASE", "SPEEDRUN" …) */
  label: string;
}

export const DEFAULT_PROGRAM: ChapterProgram[] = [
  { scenario: 'CHASE', take: 1, label: 'Chase' },
  { scenario: 'NEAR_DEATH', take: 3, label: 'Near Death' },
  { scenario: 'PERFECT_RUN', take: 4, label: 'Speedrun' },
  { scenario: 'FAIL', take: 2, label: 'Fail & Retry' },
  { scenario: 'CHASE', take: 6, label: 'Almost Caught' },
  { scenario: 'CHAOS', take: 5, label: 'Chaos' },
];

export const BOSS_PROGRAM: ChapterProgram = { scenario: 'BOSS_ESCAPE', take: 1, label: 'Boss' };

export interface LongPlanOptions {
  minutes: number;
  base: VideoConfig;
  startLevel?: number;
  title?: string;
  program?: ChapterProgram[];
  /** level number → config fields (level, seed, difficulty, theme) */
  levelConfig: (n: number) => Partial<VideoConfig>;
  levelTitle?: (n: number) => string;
  isBossLevel?: (n: number) => boolean;
  maxLevel?: number;
  /** longest single chapter (s); longer runs keep their opening + ending */
  maxChapter?: number;
}

interface Chapter {
  n: number;
  config: VideoConfig;
  take: TakeResult;
  prog: ChapterProgram;
  end: number;
}

export function planLong(o: LongPlanOptions, resolve: Resolver): EditPlan {
  const target = Math.max(1, o.minutes) * 60;
  const program = o.program ?? DEFAULT_PROGRAM;
  const maxChapter = o.maxChapter ?? 150;
  const maxLevel = o.maxLevel ?? 100;
  const start = Math.max(1, o.startLevel ?? o.base.level ?? 1);
  const chapters: Chapter[] = [];
  let est = 6;
  let n = start;
  let pi = 0;
  const addChapter = (): boolean => {
    if (n > maxLevel) return false;
    const boss = o.isBossLevel?.(n) ?? false;
    const prog = boss ? BOSS_PROGRAM : program[pi++ % program.length];
    const config: VideoConfig = {
      ...o.base,
      ...o.levelConfig(n),
      id: `${o.base.id}_L${String(n).padStart(3, '0')}`,
      scenario: prog.scenario,
      take: prog.take,
      format: 'long',
      highlight: 'full',
      captions: [],
      events: [],
      takeSeed: undefined,
    };
    const take = simulateTake(resolve(config));
    const end = take.finished ? Math.min(take.time, take.finishTime + 2.8) : take.time;
    chapters.push({ n, config, take, prog, end });
    est += Math.min(end, maxChapter) + 0.3;
    n++;
    return true;
  };
  while (est < target && addChapter()) {
    /* fill */
  }
  const build = (): EditPlan => buildPlan(o, chapters, maxChapter, target);
  let plan = build();
  // exact measurement, then one correction pass (trim / extend the last chapter)
  for (let iter = 0; iter < 4; iter++) {
    const m = measureEdit(plan, resolve);
    plan.duration = m.duration;
    const over = m.duration - target * 1.03;
    const under = target * 0.97 - m.duration;
    if (over > 0) {
      const last = plan.segments[plan.segments.length - 1];
      const len = last.to - last.from;
      if (len - over >= 20) {
        last.from += over;
        last.captions = last.captions.filter((c) => c.atSim !== undefined);
        if (last.chapter) last.captions.unshift({ at: 0.3, duration: 2.2, text: last.chapter.toUpperCase(), style: 'title' });
      } else if (chapters.length > 1) {
        chapters.pop();
        plan = build();
      } else break;
    } else if (under > 0 && addChapter()) plan = build();
    else break;
  }
  plan.duration = measureEdit(plan, resolve).duration;
  return plan;
}

function buildPlan(o: LongPlanOptions, chapters: Chapter[], maxChapter: number, target: number): EditPlan {
  const segments: EditSegment[] = [];
  const fmt = VIDEO_FORMATS.long;
  const first = chapters[0]?.n ?? 1;
  const lastN = chapters[chapters.length - 1]?.n ?? first;
  const title = o.title ?? `${o.base.title || 'Escape Factory'} — Levels ${first}-${lastN}`;
  // cold open: the single most intense moment of the whole compilation
  let best = { score: -1, ci: 0, t: 0 };
  chapters.forEach((c, ci) => {
    const curve = interestCurve(c.take.events, c.take.time, ['chase', 'nearDeath', 'boss']);
    for (const t of peaks(curve, 3, 3)) {
      const v = curve.values[Math.round(t / curve.step)];
      if (v > best.score && t > 3 && t < c.end - 1) best = { score: v, ci, t };
    }
  });
  if (chapters.length) {
    segments.push({
      source: best.ci,
      from: Math.max(0, best.t - 2.2),
      to: best.t + 2.4,
      kind: 'coldOpen',
      camera: coldOpenCamera(chapters[best.ci].take.events, best.t),
      slowmo: 0.7,
      captions: [{ at: 0.1, duration: 3.4, text: o.base.captions.find((c) => c.style === 'hook')?.text ?? 'CAN I SURVIVE THIS?!', style: 'hook' }],
      chapter: 'Intro',
    });
  }
  chapters.forEach((c, ci) => {
    const name = `${o.levelTitle?.(c.n) ?? `Level ${c.n}`} · ${c.prog.label}`;
    const cap = { at: 0.3, duration: 2.2, text: (o.levelTitle?.(c.n) ?? `LEVEL ${c.n}`).toUpperCase(), style: 'title' as const };
    const isLast = ci === chapters.length - 1;
    const outro = isLast && c.take.finished ? [{ at: -1, atSim: c.take.finishTime + 0.6, duration: 2.6, text: c.n < (o.maxLevel ?? 100) ? `LEVEL ${c.n + 1} NEXT!` : 'THE END!', style: 'outro' as const }] : [];
    const fail = c.take.events.find((e) => e.type === 'PLAYER_DEATH');
    const failCap = fail ? [{ at: -1, atSim: fail.t + 0.4, duration: 1.6, text: c.prog.scenario === 'FAIL' ? 'NOOO!' : 'OOPS!', style: 'label' as const }] : [];
    if (c.end <= maxChapter) {
      segments.push({ source: ci, from: 0, to: c.end, kind: 'level', captions: [cap, ...failCap, ...outro], chapter: name, linger: isLast ? 4 : 2.6 });
    } else {
      // long run: opening 14 s, flash-cut to the decisive final stretch
      segments.push({ source: ci, from: 0, to: 14, kind: 'level', captions: [cap], chapter: name });
      segments.push({ source: ci, from: c.end - (maxChapter - 14), to: c.end, kind: 'main', captions: [...failCap, ...outro], linger: isLast ? 4 : 2.6 });
    }
  });
  return {
    id: o.base.id,
    title,
    kind: 'long',
    format: 'long',
    width: fmt.width,
    height: fmt.height,
    fps: o.base.fps,
    sources: chapters.map((c) => c.config),
    segments,
    duration: 0,
    chapters: [],
    music: o.base.music === 'off' ? 'off' : 'auto',
    meta: {
      ...o.base.meta,
      target,
      levels: chapters.map((c) => ({ level: c.n, scenario: c.prog.scenario, take: c.prog.take, finished: c.take.finished, deaths: c.take.deaths })),
    },
  };
}
