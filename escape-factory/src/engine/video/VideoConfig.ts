/**
 * Video configuration (video_001.json …): everything needed to reproduce a
 * video exactly — level, seed, difficulty, character, enemy, scenario, take,
 * camera style, duration, format, music, voice, captions and scripted events.
 */
import type { CameraMode } from '../camera/CameraDirector';
import type { ForcedMistakeKind } from '../bot/BotProfile';

export const VIDEO_SCENARIOS = ['CHASE', 'NEAR_DEATH', 'PERFECT_RUN', 'FAIL', 'IMPOSSIBLE', 'BOSS_ESCAPE', 'CHAOS'] as const;
export type VideoScenario = (typeof VIDEO_SCENARIOS)[number];

export const VIDEO_FORMATS = { short: { width: 1080, height: 1920 }, long: { width: 1920, height: 1080 }, square: { width: 1080, height: 1080 } } as const;
export type VideoFormat = keyof typeof VIDEO_FORMATS;

export type CameraStyleName = 'dynamic' | 'smooth' | 'classic' | 'shorts' | 'gameplay';

export interface CaptionSpec {
  /** video seconds (segment-local in edits) */
  at: number;
  /** alternatively: show when the take's simulation clock reaches this time */
  atSim?: number;
  duration: number;
  text: string;
  style?: 'hook' | 'title' | 'label' | 'outro';
}

export interface VoiceLine {
  at: number;
  text: string;
}

export type ScriptedEvent =
  | { at?: number; atS?: number; type: 'camera'; mode: CameraMode; hold?: number; slowmo?: number }
  | { at?: number; atS?: number; type: 'forceMistake'; kind: ForcedMistakeKind; duration?: number }
  | { at?: number; atS?: number; type: 'caption'; text: string; duration?: number }
  | { at?: number; atS?: number; type: 'ALARM' | 'LIGHTS_FLICKER' | 'ENEMY_ROAR' | 'SURPRISE' };

export interface VideoConfig {
  id: string;
  title: string;
  /** title recipe id this config was generated from (optional) */
  recipe?: string;
  /** campaign level number (fills seed/difficulty/theme unless overridden) */
  level?: number;
  seed: number;
  difficulty: number | string;
  length?: number;
  theme: string;
  character: string;
  enemy: string;
  scenario: VideoScenario;
  /** 1..6 — PERFECT, ONE_FAIL, NEAR_DEATH, FAST_RUN, CHAOS, ENEMY_ALMOST_CATCHES */
  take: number;
  /** extra seed for the bot / runtime randomness */
  takeSeed?: number;
  cameraStyle: CameraStyleName;
  /** target duration in seconds */
  duration: number;
  format: VideoFormat;
  fps: number;
  /** 'auto' = theme music, 'off', or a theme id to borrow its music */
  music: string;
  voice: { enabled: boolean; voice?: string; lines: VoiceLine[] };
  captions: CaptionSpec[];
  events: ScriptedEvent[];
  /** shorts: automatically pick the most interesting window */
  highlight: 'auto' | 'start' | 'full';
  /** extra generator flags (boss, chaos, more:CRUSHER …) */
  specialEvents?: string[];
  /** YouTube metadata suggestions */
  meta?: { description?: string; tags?: string[] };
}

export const DEFAULT_VIDEO: VideoConfig = {
  id: 'video',
  title: 'Can I Escape The Factory?',
  seed: 1001,
  difficulty: 'EASY',
  theme: 'FACTORY',
  character: 'pip',
  enemy: 'grumbo',
  scenario: 'CHASE',
  take: 1,
  cameraStyle: 'dynamic',
  duration: 35,
  format: 'short',
  fps: 30,
  music: 'auto',
  voice: { enabled: false, lines: [] },
  captions: [],
  events: [],
  highlight: 'auto',
};

export interface ValidationResult {
  config: VideoConfig;
  errors: string[];
  warnings: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates raw JSON, fills defaults and reports problems (never throws). */
export function validateVideoConfig(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') errors.push('config must be an object');
  const c: VideoConfig = { ...DEFAULT_VIDEO, voice: { ...DEFAULT_VIDEO.voice }, captions: [], events: [] };
  const str = (k: keyof VideoConfig) => {
    if (r[k] === undefined) return;
    if (typeof r[k] !== 'string') errors.push(`${k} must be a string`);
    else (c as unknown as Record<string, unknown>)[k] = r[k];
  };
  for (const k of ['id', 'title', 'recipe', 'theme', 'character', 'enemy', 'music'] as const) str(k);
  if (r.level !== undefined) {
    if (!isNum(r.level) || r.level < 1 || r.level > 100) errors.push('level must be 1..100');
    else c.level = Math.round(r.level);
  }
  if (r.seed !== undefined) {
    if (!isNum(r.seed)) errors.push('seed must be a number');
    else c.seed = Math.round(r.seed);
  } else if (c.level) c.seed = 1000 + c.level;
  if (r.difficulty !== undefined) {
    const d = r.difficulty;
    const ok = (isNum(d) && d >= 1 && d <= 5) || (typeof d === 'string' && ['EASY', 'NORMAL', 'HARD', 'INSANE', 'IMPOSSIBLE'].includes(d.toUpperCase()));
    if (!ok) errors.push('difficulty must be 1..5 or EASY|NORMAL|HARD|INSANE|IMPOSSIBLE');
    else c.difficulty = typeof d === 'string' ? d.toUpperCase() : d;
  }
  if (r.length !== undefined) {
    if (!isNum(r.length) || r.length < 6 || r.length > 80) errors.push('length must be 6..80 modules');
    else c.length = Math.round(r.length);
  }
  if (r.scenario !== undefined) {
    const sc = String(r.scenario).toUpperCase();
    if (!(VIDEO_SCENARIOS as readonly string[]).includes(sc)) errors.push(`scenario must be one of ${VIDEO_SCENARIOS.join(', ')}`);
    else c.scenario = sc as VideoScenario;
  }
  if (r.take !== undefined) {
    if (!isNum(r.take) || r.take < 1 || r.take > 6) errors.push('take must be 1..6');
    else c.take = Math.round(r.take);
  }
  if (r.takeSeed !== undefined) {
    if (!isNum(r.takeSeed)) errors.push('takeSeed must be a number');
    else c.takeSeed = Math.round(r.takeSeed);
  }
  if (r.cameraStyle !== undefined) {
    if (!['dynamic', 'smooth', 'classic', 'shorts', 'gameplay'].includes(String(r.cameraStyle))) errors.push('cameraStyle must be dynamic|smooth|classic|shorts|gameplay');
    else c.cameraStyle = r.cameraStyle as CameraStyleName;
  }
  if (r.format !== undefined) {
    if (!(String(r.format) in VIDEO_FORMATS)) errors.push('format must be short|long|square');
    else c.format = r.format as VideoFormat;
  }
  if (r.duration !== undefined) {
    if (!isNum(r.duration) || r.duration < 5 || r.duration > 3600) errors.push('duration must be 5..3600 seconds');
    else c.duration = r.duration;
  } else if (c.format === 'long') c.duration = 600;
  if (r.fps !== undefined) {
    if (!isNum(r.fps) || ![24, 25, 30, 48, 50, 60].includes(r.fps)) errors.push('fps must be 24|25|30|48|50|60');
    else c.fps = r.fps;
  }
  if (r.highlight !== undefined) {
    if (!['auto', 'start', 'full'].includes(String(r.highlight))) errors.push('highlight must be auto|start|full');
    else c.highlight = r.highlight as VideoConfig['highlight'];
  } else if (c.format === 'long') c.highlight = 'full';
  if (r.voice !== undefined) {
    const v = r.voice as Record<string, unknown>;
    if (typeof v !== 'object' || v === null) errors.push('voice must be an object');
    else {
      c.voice = { enabled: !!v.enabled, voice: typeof v.voice === 'string' ? v.voice : undefined, lines: [] };
      if (Array.isArray(v.lines))
        for (const l of v.lines as Array<Record<string, unknown>>) {
          if (!isNum(l.at) || typeof l.text !== 'string') errors.push('voice.lines[] needs {at:number, text:string}');
          else c.voice.lines.push({ at: l.at, text: l.text });
        }
    }
  }
  if (r.captions !== undefined) {
    if (!Array.isArray(r.captions)) errors.push('captions must be an array');
    else
      for (const cap of r.captions as Array<Record<string, unknown>>) {
        if (!isNum(cap.at) || typeof cap.text !== 'string') errors.push('captions[] needs {at:number, text:string}');
        else c.captions.push({ at: cap.at, duration: isNum(cap.duration) ? cap.duration : 1.6, text: cap.text, style: (cap.style as CaptionSpec['style']) ?? 'label' });
      }
  }
  if (r.events !== undefined) {
    if (!Array.isArray(r.events)) errors.push('events must be an array');
    else
      for (const e of r.events as Array<Record<string, unknown>>) {
        if (typeof e.type !== 'string') {
          errors.push('events[] needs a type');
          continue;
        }
        if (!isNum(e.at) && !isNum(e.atS)) errors.push(`event ${e.type} needs "at" (seconds) or "atS" (track metres)`);
        else c.events.push(e as unknown as ScriptedEvent);
      }
  }
  if (r.specialEvents !== undefined) {
    if (!Array.isArray(r.specialEvents)) errors.push('specialEvents must be an array of strings');
    else c.specialEvents = (r.specialEvents as unknown[]).map(String);
  }
  if (r.meta !== undefined && typeof r.meta === 'object') c.meta = r.meta as VideoConfig['meta'];
  // remember which keys the author set explicitly (campaign levels fill the rest)
  Object.defineProperty(c, '_explicit', { value: Object.keys(r), enumerable: false });
  if (c.format === 'short' && c.duration > 60) warnings.push('YouTube Shorts must be ≤ 60 s (recommended 25–40 s)');
  if (c.format === 'short' && (c.duration < 15 || c.duration > 45)) warnings.push('recommended Shorts length is 25–40 s');
  return { config: c, errors, warnings };
}
