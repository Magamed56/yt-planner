/**
 * Turns a VideoConfig into a concrete EditPlan (which take, which seconds,
 * which captions), measured to the exact frame.
 */
import { measureEdit, type EditPlan, type Resolver } from './Edit';
import { interestCurve, peaks, type Focus } from './Highlights';
import { SCENARIOS } from './Scenarios';
import { planShort, type EditSegment } from './ShortsPlanner';
import { VIDEO_FORMATS, type VideoConfig } from './VideoConfig';
import { simulateTake } from './VideoSession';

export interface ShortTexts {
  hook?: string;
  climax?: string;
  outro?: string;
  focus?: Focus;
}

export const SHORT_MIN = 25;
export const SHORT_MAX = 40;

/** Shorts: best 25–40 s window of the take (+ cold open), hook in the first second. */
export function planShortEdit(config: VideoConfig, resolve: Resolver, texts: ShortTexts = {}): EditPlan {
  const r = resolve(config);
  const take = simulateTake(r);
  const sc = SCENARIOS[config.scenario];
  const target = Math.min(SHORT_MAX, Math.max(SHORT_MIN, config.duration));
  const hookCap = config.captions.find((c) => c.style === 'hook');
  const hook = hookCap?.text ?? texts.hook;
  const focus: Focus[] = [...new Set([...(texts.focus ? [texts.focus] : []), ...sc.focus])];
  const extraCaps = config.captions.filter((c) => c !== hookCap);
  let segments: EditSegment[];
  let ending = 'loop';
  let climax = 0;
  if (config.highlight === 'auto') {
    // the moment the title promises
    const firstOf = (...types: string[]) => take.events.find((e) => types.includes(e.type))?.t;
    const grab = firstOf('ENEMY_GRAB') ?? firstOf('PLAYER_DEATH');
    let endAt: number | undefined;
    let contain: number | undefined;
    if (config.scenario === 'FAIL' && grab !== undefined) endAt = grab + 2.8;
    else if (texts.focus === 'fail' || sc.focus[0] === 'fail') contain = firstOf('PLAYER_DEATH', 'ENEMY_GRAB');
    else if (texts.focus === 'boss' || config.scenario === 'BOSS_ESCAPE') contain = firstOf('BOSS_START');
    else if (texts.focus === 'surprise') contain = firstOf('FLOOR_COLLAPSE', 'DOOR_CLOSE', 'ENEMY_BLOCK', 'TRAP_TRIGGER', 'SURPRISE');
    const p = planShort(take.events, take.time, { duration: target, focus, hook, climaxCaption: texts.climax, outro: texts.outro, coldOpen: true, endAt, contain });
    segments = p.segments;
    ending = p.ending;
    climax = p.climax;
    const wantFailEnding = config.scenario === 'FAIL';
    const main = segments[segments.length - 1];
    if (texts.outro && (ending === 'fail') !== wantFailEnding) main.captions = main.captions.filter((c) => c.style !== 'outro');
  } else {
    const to = config.highlight === 'full' ? take.time : Math.min(take.time, target);
    segments = [{ from: 0, to, kind: 'main', captions: hook ? [{ at: 0, duration: 1.6, text: hook, style: 'hook' }] : [] }];
  }
  const main = segments[segments.length - 1];
  main.captions.push(...extraCaps);
  const fmt = VIDEO_FORMATS[config.format];
  const plan: EditPlan = {
    id: config.id,
    title: config.title,
    kind: 'short',
    format: config.format,
    width: fmt.width,
    height: fmt.height,
    fps: config.fps,
    sources: [config],
    segments,
    duration: 0,
    chapters: [],
    music: config.music === 'off' ? 'off' : 'auto',
    meta: { ...config.meta, hook, ending, climax, voice: config.voice.enabled ? config.voice.lines : [] },
  };
  if (config.highlight !== 'auto') {
    plan.duration = measureEdit(plan, resolve).duration;
    return plan;
  }
  // fit the exact (slow-motion aware) length into the Shorts window
  const lo = SHORT_MIN;
  const hi = Math.min(SHORT_MAX, target + 3);
  for (let i = 0; i < 4; i++) {
    const m = measureEdit(plan, resolve);
    plan.duration = m.duration;
    if (m.duration > hi) main.from = Math.min(main.to - 8, main.from + (m.duration - target));
    else if (m.duration < lo && main.from > 0) main.from = Math.max(0, main.from - (target - m.duration));
    else if (m.duration < lo && main.to < take.time && plan.meta.ending !== 'fail') main.to = Math.min(take.time, main.to + (target - m.duration));
    else break;
  }
  plan.duration = measureEdit(plan, resolve).duration;
  // short level? end with a slow-motion instant replay of the best moment
  if (plan.duration < lo) {
    const curve = interestCurve(take.events, take.time, focus);
    const finish = take.events.find((e) => e.type === 'PLAYER_FINISH')?.t ?? Infinity;
    const best = peaks(curve, 4, 2).filter((t) => Math.abs(t - finish) > 1.2 && t > 1.5).sort((a, b) => curve.values[Math.round(b / curve.step)] - curve.values[Math.round(a / curve.step)])[0];
    const at = best ?? climax;
    const need = lo - plan.duration + 1;
    const half = Math.min(3, Math.max(1.4, need * 0.5 * 0.5));
    plan.segments.push({ from: Math.max(0, at - half), to: at + half, kind: 'replay', camera: 'CLOSE', slowmo: 0.5, captions: [{ at: 0, duration: 1.8, text: 'REPLAY!', style: 'label' }] });
    plan.meta.replay = at;
    plan.duration = measureEdit(plan, resolve).duration;
  }
  return plan;
}
