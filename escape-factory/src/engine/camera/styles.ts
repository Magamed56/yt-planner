/**
 * Director styles: data tables of event → shot rules and coverage rotations.
 * Gameplay keeps the player in control; video/shorts styles are cinematic.
 */
import type { DirectorStyle, ShotRule } from './CameraDirector';

const nearPlayer = (r: number): ShotRule['when'] => (e, s) => {
  const p = (e.payload as { pos?: { x: number; z: number } }).pos;
  return !p || Math.hypot(p.x - s.x, p.z - s.z) < r;
};

/** PLAY: follow camera; only short, big cinematic beats (controls stay track-relative). */
export const GAMEPLAY_STYLE: DirectorStyle = {
  name: 'gameplay',
  base: ['FOLLOW'],
  chaseBase: ['FOLLOW'],
  baseShot: [999, 999],
  allowSlowmo: false,
  cutChance: 0,
  rules: [
    { event: 'PLAYER_FINISH', mode: 'FINISH', priority: 9, hold: 4 },
    { event: 'ENEMY_GRAB', mode: 'CLOSE', priority: 8, hold: 1.6, cut: true },
    { event: 'BOSS_START', mode: 'WIDE', priority: 6, hold: 1.0, cut: true, cooldown: 30 },
    { event: 'PLAYER_RESPAWN', mode: 'FOLLOW', priority: 10, hold: 0.1, cut: true },
  ],
};

/** CINEMATIC GAMEPLAY: optional richer moments for players who enable it. */
export const CINEMATIC_PLAY_STYLE: DirectorStyle = {
  ...GAMEPLAY_STYLE,
  name: 'cinematicPlay',
  rules: [
    ...GAMEPLAY_STYLE.rules,
    { event: 'CHASE_START', mode: 'FRONT', priority: 5, hold: 0.9, cut: true, cooldown: 20 },
    { event: 'FINAL_ESCAPE', mode: 'CHASE', priority: 5, hold: 1.0, cut: true },
  ],
};

/** VIDEO: full automatic cinematography for YouTube long-form. */
export const VIDEO_STYLE: DirectorStyle = {
  name: 'video',
  base: ['FOLLOW', 'SIDE', 'FOLLOW', 'BACK', 'FOLLOW', 'LOW', 'FOLLOW', 'TOP'],
  chaseBase: ['CHASE', 'FOLLOW', 'FRONT', 'CHASE', 'SIDE'],
  baseShot: [3.0, 5.5],
  allowSlowmo: true,
  cutChance: 0.55,
  rules: [
    { event: 'PLAYER_FINISH', mode: 'FINISH', priority: 10, hold: 4, cut: true, slowmo: 0.5, slowmoTime: 1.2 },
    { event: 'ENEMY_GRAB', mode: 'IMPACT', priority: 10, hold: 2.2, cut: true, slowmo: 0.3, slowmoTime: 1.2 },
    { event: 'PLAYER_DEATH', mode: 'IMPACT', priority: 9, hold: 1.8, cut: true, slowmo: 0.35, slowmoTime: 1.0 },
    { event: 'PLAYER_NEAR_DEATH', mode: 'DRAMATIC', priority: 8, hold: 1.6, cut: true, slowmo: 0.35, slowmoTime: 0.9, cooldown: 3 },
    { event: 'FINAL_ESCAPE', mode: 'WIDE', priority: 8, hold: 1.8, cut: true },
    { event: 'BOSS_START', mode: 'WIDE', priority: 8, hold: 2.4, cut: true },
    { event: 'ENEMY_APPEAR', mode: 'WIDE', priority: 7, hold: 2.0, cut: true, cooldown: 4 },
    { event: 'CHASE_START', mode: 'FRONT', priority: 7, hold: 1.8, cut: true },
    { event: 'ENEMY_NEAR', mode: 'CHASE', priority: 6, hold: 2.2, cut: true, cooldown: 3 },
    { event: 'ENEMY_RETREAT', mode: 'FRONT', priority: 7, hold: 1.8, cut: true, slowmo: 0.5, slowmoTime: 0.8 },
    { event: 'ENEMY_BLOCK', mode: 'WIDE', priority: 7, hold: 1.6, cut: true },
    { event: 'FLOOR_COLLAPSE', mode: 'FRONT', priority: 6, hold: 1.8, cut: true },
    { event: 'OBSTACLE_BREAK', mode: 'IMPACT', priority: 5, hold: 1.0, cut: true, slowmo: 0.5, slowmoTime: 0.5, cooldown: 6, when: nearPlayer(6) },
    { event: 'DOOR_CLOSE', mode: 'IMPACT', priority: 5, hold: 1.2, cut: true, cooldown: 4, when: nearPlayer(14) },
    { event: 'PLAYER_FALL', mode: 'FOLLOW', priority: 6, hold: 1.5 },
    { event: 'SPINNER_HIT', mode: 'IMPACT', priority: 6, hold: 1.0, cut: true, slowmo: 0.4, slowmoTime: 0.6 },
    { event: 'PLAYER_JUMP', mode: 'SIDE', priority: 3, hold: 1.2, chance: 0.25, cooldown: 5 },
    { event: 'PLAYER_JUMP', mode: 'SLOW', priority: 3, hold: 1.4, slowmo: 0.45, slowmoTime: 0.9, chance: 0.12, cooldown: 12 },
    { event: 'ENEMY_ROAR', mode: 'CHASE', priority: 4, hold: 1.4, cut: true, cooldown: 5 },
    { event: 'CHECKPOINT_REACHED', mode: 'LOW', priority: 3, hold: 1.4, cooldown: 8 },
    { event: 'BOSS_ATTACK', mode: 'WIDE', priority: 3, hold: 1.4, cooldown: 4 },
    { event: 'PLAYER_RESPAWN', mode: 'FOLLOW', priority: 10, hold: 0.8, cut: true },
  ],
};

/** SHORTS: vertical, faster cutting, tighter framing, more chase. */
export const SHORTS_STYLE: DirectorStyle = {
  ...VIDEO_STYLE,
  name: 'shorts',
  base: ['FOLLOW', 'BACK', 'FOLLOW', 'SIDE', 'LOW'],
  chaseBase: ['CHASE', 'FRONT', 'CHASE', 'FOLLOW'],
  baseShot: [2.0, 3.5],
  cutChance: 0.75,
};

/** CLASSIC: mostly follow, minimal cuts (tutorial / calm videos). */
export const CLASSIC_STYLE: DirectorStyle = {
  ...VIDEO_STYLE,
  name: 'classic',
  base: ['FOLLOW'],
  chaseBase: ['FOLLOW', 'CHASE'],
  baseShot: [8, 12],
  cutChance: 0.2,
  rules: VIDEO_STYLE.rules.filter((r) => r.priority >= 7),
};

export const DIRECTOR_STYLES: Record<string, DirectorStyle> = {
  gameplay: GAMEPLAY_STYLE,
  cinematicPlay: CINEMATIC_PLAY_STYLE,
  video: VIDEO_STYLE,
  dynamic: VIDEO_STYLE,
  shorts: SHORTS_STYLE,
  classic: CLASSIC_STYLE,
};
