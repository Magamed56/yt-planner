/**
 * Save System: progress, records, currency and unlocks, persisted through a
 * pluggable storage adapter (localStorage in browsers, memory in tests/Node).
 * Versioned with forward migrations.
 */

export interface GameSettings {
  master: number;
  music: number;
  sfx: number;
  quality: 'low' | 'medium' | 'high';
  shake: boolean;
  cinematicCamera: boolean;
  showFps: boolean;
}

export interface SaveData {
  version: number;
  completedLevels: number[];
  bestTimes: Record<string, number>;
  bestCoins: Record<string, number>;
  deaths: number;
  deathsByLevel: Record<string, number>;
  coins: number;
  unlockedCharacters: string[];
  unlockedThemes: string[];
  selectedCharacter: string;
  settings: GameSettings;
  stats: { runs: number; finishes: number; playTime: number; caught: number };
}

export interface StorageAdapter {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  private readonly m = new Map<string, string>();
  load(key: string): string | null {
    return this.m.get(key) ?? null;
  }
  save(key: string, value: string): void {
    this.m.set(key, value);
  }
  remove(key: string): void {
    this.m.delete(key);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  load(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  save(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* quota / privacy mode: ignore */
    }
  }
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export const SAVE_VERSION = 2;

export function defaultSave(defaults: { character?: string; themes?: string[]; characters?: string[] } = {}): SaveData {
  return {
    version: SAVE_VERSION,
    completedLevels: [],
    bestTimes: {},
    bestCoins: {},
    deaths: 0,
    deathsByLevel: {},
    coins: 0,
    unlockedCharacters: defaults.characters ?? [defaults.character ?? 'pip'],
    unlockedThemes: defaults.themes ?? ['FACTORY'],
    selectedCharacter: defaults.character ?? 'pip',
    settings: { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', shake: true, cinematicCamera: true, showFps: false },
    stats: { runs: 0, finishes: 0, playTime: 0, caught: 0 },
  };
}

type Migration = (d: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: introduced bestCoins and stats.caught
  1: (d) => ({ ...d, bestCoins: d.bestCoins ?? {}, stats: { caught: 0, ...(d.stats as object) }, version: 2 }),
};

export interface RunRecord {
  level: number;
  time: number;
  deaths: number;
  coins: number;
  completed: boolean;
  caught: number;
}

export interface RunOutcome {
  newBest: boolean;
  firstClear: boolean;
  coinsEarned: number;
}

export class SaveSystem {
  data: SaveData;

  constructor(
    private readonly storage: StorageAdapter = new LocalStorageAdapter(),
    private readonly key = 'escape-factory/save',
    private readonly defaults: Parameters<typeof defaultSave>[0] = {},
  ) {
    this.data = this.load();
  }

  load(): SaveData {
    const raw = this.storage.load(this.key);
    if (!raw) return defaultSave(this.defaults);
    try {
      let d = JSON.parse(raw) as Record<string, unknown>;
      let v = Number(d.version ?? 1);
      while (v < SAVE_VERSION && MIGRATIONS[v]) {
        d = MIGRATIONS[v](d);
        v = Number(d.version);
      }
      const base = defaultSave(this.defaults);
      return { ...base, ...(d as Partial<SaveData>), settings: { ...base.settings, ...((d.settings as object) ?? {}) }, version: SAVE_VERSION };
    } catch {
      return defaultSave(this.defaults);
    }
  }

  save(): void {
    this.storage.save(this.key, JSON.stringify(this.data));
  }

  reset(): void {
    this.data = defaultSave(this.defaults);
    this.save();
  }

  recordRun(r: RunRecord): RunOutcome {
    const d = this.data;
    const k = String(r.level);
    d.stats.runs++;
    d.stats.playTime += r.time;
    d.stats.caught += r.caught;
    d.deaths += r.deaths;
    d.deathsByLevel[k] = (d.deathsByLevel[k] ?? 0) + r.deaths;
    let newBest = false;
    let firstClear = false;
    let coinsEarned = 0;
    if (r.completed) {
      d.stats.finishes++;
      if (!d.completedLevels.includes(r.level)) {
        d.completedLevels.push(r.level);
        d.completedLevels.sort((a, b) => a - b);
        firstClear = true;
      }
      if (d.bestTimes[k] === undefined || r.time < d.bestTimes[k]) {
        d.bestTimes[k] = r.time;
        newBest = true;
      }
      // only coins above the previous best for this level are banked (no farming)
      const prev = d.bestCoins[k] ?? 0;
      if (r.coins > prev) {
        coinsEarned = r.coins - prev;
        d.coins += coinsEarned;
        d.bestCoins[k] = r.coins;
      }
    }
    this.save();
    return { newBest, firstClear, coinsEarned };
  }

  isLevelUnlocked(level: number): boolean {
    if (level <= 1) return true;
    return this.data.completedLevels.includes(level - 1) || this.data.completedLevels.includes(level);
  }

  get highestUnlocked(): number {
    let n = 1;
    while (this.isLevelUnlocked(n + 1)) n++;
    return n;
  }

  /** Buys a character with coins. Returns true on success (or already owned). */
  unlockCharacter(id: string, cost: number): boolean {
    const d = this.data;
    if (d.unlockedCharacters.includes(id)) return true;
    if (d.coins < cost) return false;
    d.coins -= cost;
    d.unlockedCharacters.push(id);
    this.save();
    return true;
  }

  unlockTheme(id: string): boolean {
    if (this.data.unlockedThemes.includes(id)) return false;
    this.data.unlockedThemes.push(id);
    this.save();
    return true;
  }

  selectCharacter(id: string): void {
    if (!this.data.unlockedCharacters.includes(id)) return;
    this.data.selectedCharacter = id;
    this.save();
  }

  updateSettings(s: Partial<GameSettings>): void {
    this.data.settings = { ...this.data.settings, ...s };
    this.save();
  }
}
