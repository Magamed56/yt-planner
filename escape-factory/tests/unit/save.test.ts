import { describe, expect, it } from 'vitest';
import { MemoryStorage, SaveSystem, SAVE_VERSION } from '../../src/engine/save/SaveSystem';

describe('SaveSystem', () => {
  it('starts with defaults and persists across instances', () => {
    const st = new MemoryStorage();
    const a = new SaveSystem(st);
    expect(a.data.completedLevels).toEqual([]);
    expect(a.data.unlockedCharacters).toContain('pip');
    a.recordRun({ level: 1, time: 42.5, deaths: 2, coins: 10, completed: true, caught: 1 });
    const b = new SaveSystem(st);
    expect(b.data.completedLevels).toEqual([1]);
    expect(b.data.bestTimes['1']).toBe(42.5);
    expect(b.data.deaths).toBe(2);
    expect(b.data.coins).toBe(10);
    expect(b.data.stats.caught).toBe(1);
  });

  it('tracks best times and prevents coin farming', () => {
    const s = new SaveSystem(new MemoryStorage());
    s.recordRun({ level: 3, time: 50, deaths: 0, coins: 8, completed: true, caught: 0 });
    const o = s.recordRun({ level: 3, time: 45, deaths: 1, coins: 8, completed: true, caught: 0 });
    expect(o.newBest).toBe(true);
    expect(o.coinsEarned).toBe(0);
    expect(s.data.coins).toBe(8);
    const o2 = s.recordRun({ level: 3, time: 60, deaths: 0, coins: 12, completed: true, caught: 0 });
    expect(o2.newBest).toBe(false);
    expect(o2.coinsEarned).toBe(4);
    expect(s.data.bestTimes['3']).toBe(45);
  });

  it('unlocks levels sequentially and characters with coins', () => {
    const s = new SaveSystem(new MemoryStorage());
    expect(s.isLevelUnlocked(1)).toBe(true);
    expect(s.isLevelUnlocked(2)).toBe(false);
    s.recordRun({ level: 1, time: 30, deaths: 0, coins: 50, completed: true, caught: 0 });
    expect(s.isLevelUnlocked(2)).toBe(true);
    expect(s.highestUnlocked).toBe(2);
    expect(s.unlockCharacter('robot', 40)).toBe(true);
    expect(s.data.coins).toBe(10);
    expect(s.unlockCharacter('cat', 60)).toBe(false);
    s.selectCharacter('robot');
    expect(s.data.selectedCharacter).toBe('robot');
    expect(s.unlockTheme('NIGHT')).toBe(true);
    expect(s.data.unlockedThemes).toContain('NIGHT');
  });

  it('migrates old saves and survives corrupt data', () => {
    const st = new MemoryStorage();
    st.save('escape-factory/save', JSON.stringify({ version: 1, completedLevels: [1, 2], coins: 5, stats: { runs: 3, finishes: 2, playTime: 10 } }));
    const s = new SaveSystem(st);
    expect(s.data.version).toBe(SAVE_VERSION);
    expect(s.data.completedLevels).toEqual([1, 2]);
    expect(s.data.bestCoins).toEqual({});
    expect(s.data.stats.caught).toBe(0);
    st.save('escape-factory/save', '{not json');
    expect(new SaveSystem(st).data.completedLevels).toEqual([]);
  });
});
