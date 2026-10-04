/**
 * Enemy System definitions. Behaviour (the brain) is shared; an EnemyDef only
 * provides stats, look, voice and per-theme costume parts.
 */
import type { ModelPart, ModelSpec } from '../character/ModelSpec';

export interface EnemyDef {
  id: string;
  name: string;
  description: string;
  stats: {
    /** multiplier on difficulty hunt speed */
    speedMul: number;
    /** caught when the gap along the track is below this (m) */
    catchDistance: number;
    /** ENEMY_NEAR fires below this gap (m) */
    nearDistance: number;
    height: number;
    width: number;
  };
  model: ModelSpec;
  anim: { stomp: number; armSwing: number; bodySway: number };
  voice: { pitch: number; type: 'growl' | 'honk' | 'screech' | 'rumble' };
  /** extra costume parts per theme id (e.g. pumpkin hat for HALLOWEEN) */
  themeParts?: Record<string, ModelPart[]>;
  color: string;
}

export class EnemyRegistry {
  private readonly map = new Map<string, EnemyDef>();
  private defaultId = '';
  register(def: EnemyDef, isDefault = false): void {
    this.map.set(def.id, def);
    if (isDefault || !this.defaultId) this.defaultId = def.id;
  }
  get(id: string | undefined): EnemyDef {
    const d = (id && this.map.get(id)) || this.map.get(this.defaultId);
    if (!d) throw new Error('No enemies registered');
    return d;
  }
  has(id: string): boolean {
    return this.map.has(id);
  }
  list(): EnemyDef[] {
    return [...this.map.values()];
  }
}

export const enemies = new EnemyRegistry();
