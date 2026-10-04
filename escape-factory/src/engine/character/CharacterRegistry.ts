import type { CharacterDef } from './CharacterDef';

/** Global registry; games register their roster at startup. */
export class CharacterRegistry {
  private readonly map = new Map<string, CharacterDef>();
  private defaultId = '';

  register(def: CharacterDef, isDefault = false): void {
    this.map.set(def.id, def);
    if (isDefault || !this.defaultId) this.defaultId = def.id;
  }

  get(id: string | undefined): CharacterDef {
    const d = (id && this.map.get(id)) || this.map.get(this.defaultId);
    if (!d) throw new Error('No characters registered');
    return d;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  list(): CharacterDef[] {
    return [...this.map.values()];
  }

  get defaultCharacter(): string {
    return this.defaultId;
  }
}

export const characters = new CharacterRegistry();
