/**
 * Theme System. A theme re-skins the same level data: environment, lighting,
 * particles, music, decorations, enemy costume and special obstacles.
 */
import type { PhysicsMods } from '../sim/World';
import type { SurfaceType } from '../level/types';

export interface ThemePalette {
  skyTop: string;
  skyHorizon: string;
  fog: string;
  floor: string;
  floorAlt: string;
  edge: string;
  wall: string;
  metal: string;
  pipe: string;
  platform: string;
  moving: string;
  vanish: string;
  trap: string;
  conveyor: string;
  bridge: string;
  hazard: string;
  stripe: string;
  laser: string;
  danger: string;
  accent: string;
  accent2: string;
  checkpoint: string;
  finish: string;
  coin: string;
  pillar: string;
  abyss: string;
  decor: string[];
}

export interface ThemeLighting {
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  ambient: number;
  exposure: number;
  fogNear: number;
  fogFar: number;
}

export type ParticleKind = 'dust' | 'snow' | 'embers' | 'bubbles' | 'stars' | 'leaves' | 'sparkles' | 'ash' | 'none';

export interface ThemeParticles {
  kind: ParticleKind;
  color: string;
  density: number;
  speed: number;
}

export type MusicScale = 'minor' | 'major' | 'dorian' | 'phrygian' | 'pentatonic' | 'harmonicMinor' | 'blues';

export interface ThemeMusic {
  bpm: number;
  /** MIDI root note */
  root: number;
  scale: MusicScale;
  lead: OscillatorType;
  bass: OscillatorType;
  kit: 'factory' | 'spooky' | 'jingle' | 'soft' | 'electro' | 'tribal';
  /** 0..1 how "bouncy/comic" the arrangement is */
  bounce: number;
}

export interface ThemeDecor {
  kind: string;
  weight: number;
}

export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  palette: ThemePalette;
  lighting: ThemeLighting;
  particles: ThemeParticles;
  music: ThemeMusic;
  decorations: ThemeDecor[];
  /** background set dressing style */
  backdrop: 'factory' | 'night' | 'snow' | 'candy' | 'underwater' | 'space' | 'volcano' | 'spooky' | 'lab' | 'xmas';
  /** key into EnemyDef.themeParts */
  enemyVariant: string;
  physics?: PhysicsMods;
  special: {
    /** override surface of plain floors (e.g. ice in WINTER) */
    floorSurface?: SurfaceType;
    /** probability a floor becomes the special surface */
    floorSurfaceChance?: number;
    /** look of falling objects */
    fallerStyle: string;
    /** look of lethal zones */
    zoneStyle: 'acid' | 'lava' | 'void' | 'water' | 'electric';
    /** module weight multipliers */
    moduleWeights?: Record<string, number>;
  };
}

export class ThemeRegistry {
  private readonly map = new Map<string, ThemeDef>();
  private defaultId = '';
  register(def: ThemeDef, isDefault = false): void {
    this.map.set(def.id, def);
    if (isDefault || !this.defaultId) this.defaultId = def.id;
  }
  get(id: string | undefined): ThemeDef {
    const d = (id && this.map.get(id.toUpperCase())) || this.map.get(this.defaultId);
    if (!d) throw new Error('No themes registered');
    return d;
  }
  has(id: string): boolean {
    return this.map.has(id.toUpperCase());
  }
  list(): ThemeDef[] {
    return [...this.map.values()];
  }
}

export const themes = new ThemeRegistry();
