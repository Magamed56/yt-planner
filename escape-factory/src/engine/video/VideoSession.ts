/**
 * VIDEO MODE: resolves a VideoConfig into a playable session where the BOT
 * plays, the CameraDirector films, UI is absent and captions/scripted events
 * are applied. Works headless (analysis, take search) or rendered.
 */
import type { AudioSystem } from '../audio/AudioSystem';
import { BotController } from '../bot/BotController';
import { botProfile, type BotProfile, type ForcedMistake } from '../bot/BotProfile';
import type { DirectorStyle } from '../camera/CameraDirector';
import { CLASSIC_STYLE, GAMEPLAY_STYLE, SHORTS_STYLE, VIDEO_STYLE } from '../camera/styles';
import { characters } from '../character/CharacterRegistry';
import type { CharacterDef } from '../character/CharacterDef';
import { GameSession } from '../core/GameSession';
import { mixSeed, Rng } from '../core/rng';
import type { EnemyTuning } from '../enemy/Enemy';
import { enemies, type EnemyDef } from '../enemy/EnemyDef';
import { emptyInput } from '../input/InputState';
import { ProxyInput } from '../input/ProxyInput';
import { generateLevel, type LevelGenParams } from '../level/LevelGenerator';
import type { LevelData } from '../level/types';
import { CaptionLayer } from '../render/CaptionLayer';
import type { MaterialLibrary } from '../render/materials';
import type { RenderContext } from '../render/RenderContext';
import { World } from '../sim/World';
import { themes, type ThemeDef } from '../theme/ThemeDef';
import type { GameEvent } from '../events/GameEvents';
import { SCENARIOS, takePreset } from './Scenarios';
import { VIDEO_FORMATS, type CaptionSpec, type VideoConfig } from './VideoConfig';

export interface ResolvedVideo {
  config: VideoConfig;
  genParams: LevelGenParams;
  level: LevelData;
  character: CharacterDef;
  enemy: EnemyDef | null;
  theme: ThemeDef;
  bot: BotProfile;
  enemyTuning: Partial<EnemyTuning>;
  chaos: number;
  style: DirectorStyle;
  portrait: boolean;
  size: { width: number; height: number };
  takeSeed: number;
}

export interface ResolveOptions {
  /** maps a campaign level number to generator params (provided by the game) */
  campaign?: (level: number) => LevelGenParams;
  /** run headless take search for clean / fail takes (default true) */
  searchTakes?: boolean;
}

export function directorStyleFor(c: VideoConfig): DirectorStyle {
  switch (c.cameraStyle) {
    case 'gameplay':
      return GAMEPLAY_STYLE;
    case 'classic':
      return CLASSIC_STYLE;
    case 'shorts':
      return SHORTS_STYLE;
    case 'smooth':
      return { ...VIDEO_STYLE, name: 'smooth', cutChance: 0.15, baseShot: [5, 8] };
    case 'dynamic':
    default:
      return c.format === 'short' ? SHORTS_STYLE : VIDEO_STYLE;
  }
}

/** Builds level + performance parameters for a config (deterministic). */
export function resolveVideo(config: VideoConfig, opts: ResolveOptions = {}): ResolvedVideo {
  const sc = SCENARIOS[config.scenario];
  const take = takePreset(config.take);
  const base: LevelGenParams = config.level && opts.campaign ? opts.campaign(config.level) : { seed: config.seed, difficulty: config.difficulty };
  const explicit = new Set((config as VideoConfig & { _explicit?: string[] })._explicit ?? Object.keys(config));
  const genParams: LevelGenParams = {
    ...base,
    seed: config.seed,
    difficulty: sc.difficulty ?? (explicit.has('difficulty') || !config.level ? config.difficulty : base.difficulty),
    theme: explicit.has('theme') || !config.level ? config.theme : base.theme ?? config.theme,
    enemy: config.enemy,
    length: config.length ?? base.length,
    specialEvents: [...new Set([...(base.specialEvents ?? []), ...sc.specialEvents, ...(config.specialEvents ?? [])])],
  };
  const level = generateLevel(genParams);
  const theme = themes.get(level.theme);
  const character = characters.get(config.character);
  const enemy = config.enemy === 'none' ? null : enemies.get(config.enemy);
  const bot = botProfile({ ...sc.bot, ...take.bot, name: `${sc.id}/${take.id}` });
  const enemyTuning = { ...sc.enemy, ...take.enemy };
  const chaos = Math.max(sc.chaos, take.chaos ?? 0);
  const fmt = VIDEO_FORMATS[config.format];
  let takeSeed = config.takeSeed ?? mixSeed(config.seed, config.take, config.scenario);
  // scripted / automatic forced mistakes
  const forced: ForcedMistake[] = [];
  for (const e of config.events) if (e.type === 'forceMistake' && e.atS !== undefined) forced.push({ atS: e.atS, kind: e.kind, duration: e.duration });
  const wantFail = take.wantFail ?? sc.wantFail;
  if (wantFail && !forced.length) {
    const pick = pickDramaticMistake(level, new Rng(takeSeed), config.scenario === 'FAIL' ? 'caught' : 'any');
    if (pick) forced.push(pick);
  }
  if (forced.length) bot.forced = forced;
  const resolved: ResolvedVideo = {
    config,
    genParams,
    level,
    character,
    enemy,
    theme,
    bot,
    enemyTuning,
    chaos,
    style: directorStyleFor(config),
    portrait: config.format === 'short',
    size: { ...fmt },
    takeSeed,
  };
  // clean takes: try a few take seeds until the bot finishes without dying
  const wantClean = (take.wantClean ?? false) || sc.wantClean;
  if (wantClean && opts.searchTakes !== false && config.takeSeed === undefined) {
    for (let i = 0; i < 8; i++) {
      const res = simulateTake({ ...resolved, takeSeed: takeSeed + i * 7919 }, 400);
      if (res.finished && res.deaths === 0) {
        takeSeed = takeSeed + i * 7919;
        break;
      }
    }
    resolved.takeSeed = takeSeed;
  }
  return resolved;
}

/**
 * Picks a dramatic place for a scripted mistake. 'caught': freeze on solid
 * ground in the second half of a chase so Grumbo catches up (he deliberately
 * slows at gaps, so never right before a jump). 'any': a catch, a botched jump
 * into a gap, or rushing a hazard gate — whatever the level offers.
 */
export function pickDramaticMistake(level: LevelData, rng: Rng, prefer: 'caught' | 'any' = 'any'): ForcedMistake | null {
  const total = level.spine[level.spine.length - 1].s;
  const blocked: Array<[number, number]> = [];
  for (const h of level.hints) {
    if (h.kind === 'jump') blocked.push([h.s - 3, h.landS + 2]);
    else if (h.kind === 'gate' || h.kind === 'arena') blocked.push([h.s0 - 2, h.s1 + 2]);
  }
  const chaseGround: number[] = [];
  for (const m of level.modules) {
    // plain running ground only (conveyors would carry the frozen runner away)
    if (!m.tags.includes('chase') || !['STRAIGHT', 'TURN', 'CHASE'].includes(m.type) || m.s0 < total * 0.12 || m.s1 > total * 0.94) continue;
    for (let s = m.s0 + 2; s <= m.s1 - 6; s += 1) if (!blocked.some(([a, b]) => s + 7 > a && s < b)) chaseGround.push(s);
  }
  const late = chaseGround.filter((s) => s > total * 0.4);
  // frozen long enough for Grumbo to close any chase gap (the catch ends it early)
  const caught = (): ForcedMistake | null => (chaseGround.length ? { atS: rng.pick(late.length ? late : chaseGround), kind: 'stop', duration: 4.5 } : null);
  if (prefer === 'caught') {
    const c = caught();
    if (c) return c;
  }
  const staticIds = new Set(level.pieces.filter((p) => p.type === 'solid' && !p.motion && !p.vanish).map((p) => p.id));
  const jumps = level.hints.filter((h): h is Extract<typeof h, { kind: 'jump' }> => h.kind === 'jump' && h.s > total * 0.25 && h.s < total * 0.9 && staticIds.has(h.targetId));
  const gates = level.hints.filter((h): h is Extract<typeof h, { kind: 'gate' }> => h.kind === 'gate' && h.s0 > total * 0.25 && h.s1 < total * 0.9);
  const options: Array<() => ForcedMistake | null> = [];
  if (chaseGround.length) options.push(caught);
  if (jumps.length) options.push(() => ({ atS: rng.pick(jumps).s, kind: 'lateJump', duration: 1.6 }));
  if (gates.length) options.push(() => ({ atS: rng.pick(gates).s0 - 0.5, kind: 'gateRush', duration: 1.6 }));
  if (!options.length) return null;
  return rng.pick(options)();
}

export interface TakeResult {
  finished: boolean;
  deaths: number;
  time: number;
  finishTime: number;
  events: GameEvent[];
  catches: number;
}

/** Runs a take headlessly (fast) — used for take search and highlight analysis. */
export function simulateTake(r: ResolvedVideo, maxTime = 600): TakeResult {
  const world = new World({ level: r.level, character: r.character, enemy: r.enemy, chaos: r.chaos, enemyTuning: r.enemyTuning, runtimeSeed: r.takeSeed, physicsMods: r.theme.physics });
  world.triggers.chaos = r.chaos;
  const bot = new BotController(world, { ...r.bot, forced: r.bot.forced ? [...r.bot.forced] : undefined }, r.takeSeed);
  const inp = emptyInput();
  while (world.status === 'running' && world.time < maxTime && !bot.stats.givenUp) {
    bot.sample(inp);
    world.step(inp);
  }
  // let the finish celebration play a little for highlight windows
  for (let i = 0; i < 180 && world.status === 'finished'; i++) {
    bot.sample(inp);
    world.step(inp);
  }
  return { finished: world.status === 'finished', deaths: world.deaths, time: world.time, finishTime: world.finishTime, events: world.events.log.slice(), catches: world.enemy?.catches ?? 0 };
}

export interface VideoSessionOptions {
  rc?: RenderContext;
  mats?: MaterialLibrary;
  audio?: AudioSystem | null;
  /** replaces the config captions (edit segments supply their own, in segment time) */
  captions?: CaptionSpec[];
  /** video-time offset of this session inside the final edit (for `at`-timed script events) */
  timeOffset?: number;
}

export class VideoSession {
  readonly session: GameSession;
  readonly bot: BotController;
  readonly captions: CaptionLayer | null;
  videoTime = 0;
  private readonly firedScript = new Set<number>();
  private readonly captionList: CaptionSpec[];
  private readonly timeOffset: number;
  /** captions only appear after fast-forward (segment-local clock starts at 0) */
  private captionClock = 0;
  private ffwd = false;
  /** caption visible on the current frame (for subtitles / metadata) */
  currentCaption: { text: string; style: string } | null = null;
  private readonly simCaptionStart = new Map<CaptionSpec, number>();

  constructor(
    readonly resolved: ResolvedVideo,
    o: VideoSessionOptions = {},
  ) {
    const r = resolved;
    const proxy = new ProxyInput();
    this.session = new GameSession({
      level: r.level,
      character: r.character,
      enemy: r.enemy,
      theme: r.theme,
      input: proxy,
      style: r.style,
      rc: o.rc,
      mats: o.mats,
      audio: o.audio ?? null,
      portrait: r.portrait,
      world: { chaos: r.chaos, enemyTuning: r.enemyTuning, runtimeSeed: r.takeSeed },
    });
    this.session.world.triggers.chaos = r.chaos;
    this.bot = new BotController(this.session.world, { ...r.bot, forced: r.bot.forced ? [...r.bot.forced] : undefined }, r.takeSeed);
    proxy.target = this.bot;
    this.captions = o.rc ? new CaptionLayer(o.rc.camera, r.portrait) : null;
    this.captionList = o.captions ?? r.config.captions;
    this.timeOffset = o.timeOffset ?? 0;
  }

  get world(): World {
    return this.session.world;
  }

  /** Advances by `dt` seconds of video time (`draw=false`: simulate + film without GPU work). */
  frame(dt: number, draw = true): void {
    this.videoTime += dt;
    this.captionClock += dt;
    this.applyScript();
    this.session.frame(dt, draw);
    const cap = this.ffwd ? null : this.activeCaption();
    this.currentCaption = cap;
    if (this.captions) {
      this.captions.set(cap?.text ?? null, cap?.style, this.captionClock);
      this.captions.update(this.captionClock);
    }
  }

  /**
   * Plays (unrendered) until simulation time `simTime`, keeping the camera
   * director and visuals warm so the first recorded frame looks continuous.
   * Resets the caption clock so segment captions start at 0.
   */
  fastForward(simTime: number, dt = 1 / 60): void {
    const w = this.session.world;
    let guard = 0;
    this.ffwd = true;
    while (w.time + 1e-9 < simTime && guard++ < 200000) this.frame(dt, false);
    this.ffwd = false;
    this.captionClock = 0;
    // sim-anchored captions that belong before the cut never show
    for (const c of this.captionList) if (c.atSim !== undefined && c.atSim < w.time - 0.25) this.simCaptionStart.set(c, -1e9);
    this.scriptCaption = null;
  }

  private scriptCaption: { text: string; until: number } | null = null;

  private activeCaption(): { text: string; style: string } | null {
    if (this.scriptCaption && this.captionClock < this.scriptCaption.until) return { text: this.scriptCaption.text, style: 'label' };
    const t = this.captionClock;
    const simT = this.session.world.time;
    for (const c of this.captionList) {
      let at = c.at;
      if (c.atSim !== undefined) {
        // sim-anchored: starts on the frame the take reaches atSim (slow-motion safe)
        let start = this.simCaptionStart.get(c);
        if (start === undefined && simT >= c.atSim && !this.ffwd) {
          start = t;
          this.simCaptionStart.set(c, t);
        }
        if (start === undefined) continue;
        at = start;
      }
      if (t >= at && t < at + c.duration) return { text: c.text, style: c.style ?? 'label' };
    }
    return null;
  }

  private applyScript(): void {
    const w = this.session.world;
    const ev = this.resolved.config.events;
    for (let i = 0; i < ev.length; i++) {
      if (this.firedScript.has(i)) continue;
      const e = ev[i];
      // `at` = time in the final edit; never fires while fast-forwarding to a segment
      const due = (e.at !== undefined && !this.ffwd && this.captionClock + this.timeOffset >= e.at) || (e.atS !== undefined && w.playerS >= e.atS);
      if (!due || e.type === 'forceMistake') continue;
      this.firedScript.add(i);
      const pos = w.playerPos();
      switch (e.type) {
        case 'camera':
          this.session.director.request(e.mode, 50, e.hold ?? 2, 'script', true, null, e.slowmo ?? 1, e.hold ?? 2);
          break;
        case 'caption':
          this.scriptCaption = { text: e.text, until: this.captionClock + (e.duration ?? 1.6) };
          break;
        case 'ALARM':
          w.events.emit('ALARM', { pos, duration: 3 });
          break;
        case 'LIGHTS_FLICKER':
          w.events.emit('LIGHTS_FLICKER', { pos, duration: 1.6 });
          break;
        case 'ENEMY_ROAR':
          w.events.emit('ENEMY_ROAR', { pos });
          break;
        case 'SURPRISE':
          w.events.emit('SURPRISE', { pos, kind: 'script' });
          break;
      }
    }
  }

  dispose(): void {
    this.captions?.dispose();
    this.session.dispose();
  }
}
