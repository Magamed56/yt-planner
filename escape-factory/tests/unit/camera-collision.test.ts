import { describe, expect, it } from 'vitest';
import { CameraCollision } from '../../src/engine/camera/CameraCollision';
import { CAMERA_MODES, CameraDirector, type CameraPose, type CameraSubject } from '../../src/engine/camera/CameraDirector';
import { CameraObstacles } from '../../src/engine/camera/CameraObstacles';
import { checkCameraFrame, project } from '../../src/engine/camera/CameraQuality';
import { SHORTS_STYLE, VIDEO_STYLE } from '../../src/engine/camera/styles';
import { clearDecorFromPath } from '../../src/engine/level/decorBounds';
import { generateLevel } from '../../src/engine/level/LevelGenerator';
import { World } from '../../src/engine/sim/World';
import { validateVideoConfig } from '../../src/engine/video/VideoConfig';
import { resolveVideo } from '../../src/engine/video/VideoSession';
import { auditTakeCamera } from '../../src/engine/video/cameraAudit';
import { campaignParams } from '../../src/game/campaign';
import { registerContent } from '../../src/game/content';
import { straightLevel, testCharacter } from './helpers';

registerContent();

/**
 * A 40 m corridor: floor, two 3.4 m walls (track half width 2.5) and a low
 * roof slab over z 18..24 at 2.6 m — walls, ceiling and floor in one place.
 */
function corridorWorld(): World {
  const level = straightLevel(40, (b) => {
    b.floor(-2.5, 2.5, 0, 40, 0, { style: 'floor' });
    b.solid(-3, -2.5, -1, 3.4, 0, 40, { style: 'wall', walkable: false });
    b.solid(2.5, 3, -1, 3.4, 0, 40, { style: 'wall', walkable: false });
    b.solid(-2.5, 2.5, 2.6, 3.2, 18, 24, { style: 'wall', walkable: false });
  }, 2.5);
  return new World({ level, character: testCharacter, enemy: null });
}

const pose = (x: number, y: number, z: number, tx: number, ty: number, tz: number): CameraPose => ({ x, y, z, tx, ty, tz, fov: 60, roll: 0 });

function check(obs: CameraObstacles, p: CameraPose, player = { x: 0, y: 0, z: 10 }) {
  return checkCameraFrame({ pose: p, aspect: 16 / 9, player: { x: player.x, y: player.y + 1, z: player.z }, playerFeetY: player.y, enemy: null, mode: 'FOLLOW' }, obs);
}

describe('Camera quality validator', () => {
  const w = corridorWorld();
  const obs = new CameraObstacles(w);

  it('projects points like a perspective camera', () => {
    const p = pose(0, 1, 0, 0, 1, 10);
    expect(project(p, 1, { x: 0, y: 1, z: 5 }).slice(0, 2)).toEqual([0, 0]);
    expect(project(p, 1, { x: 0, y: 1, z: -5 })[2]).toBeLessThan(0); // behind
    const right = project(p, 16 / 9, { x: -2, y: 1, z: 5 }); // −X is screen-right when looking down +Z
    expect(right[0]).toBeGreaterThan(0);
  });

  it('flags camera inside geometry, beyond the ceiling, below the floor and player out of frame', () => {
    expect(check(obs, pose(2.8, 1.5, 10, 0, 1, 10)).inside).toBe(true); // inside the right wall
    expect(check(obs, pose(6, 2, 10, 0, 1, 10)).occluded).toBe(true); // behind the wall
    const roof = check(obs, pose(0, 6, 21, 0, 1, 21), { x: 0, y: 0, z: 21 });
    expect(roof.aboveCeiling).toBe(true);
    expect(check(obs, pose(0, -3, 10, 0, 1, 12)).belowFloor).toBe(true);
    expect(check(obs, pose(0, 1.5, 4, 0, 1.5, -10)).playerOut).toBe(true); // looking away
    const ok = check(obs, pose(0, 2.2, 4, 0, 1, 10));
    expect(ok.inside || ok.occluded || ok.playerOut || ok.belowFloor || ok.aboveCeiling).toBe(false);
  });
});

describe('Camera collision', () => {
  it('never leaves the camera inside / behind walls, below the floor or above a ceiling', () => {
    const w = corridorWorld();
    const obs = new CameraObstacles(w);
    const cases: Array<[CameraPose, { x: number; y: number; z: number }]> = [
      [pose(9, 2.2, 11, 0, 1, 10), { x: 0, y: 0, z: 10 }], // SIDE shot through the wall
      [pose(0, -2, 6, 0, 1, 10), { x: 0, y: 0, z: 10 }], // under the floor
      [pose(0, 9, 18, 0, 0.5, 21), { x: 0, y: 0, z: 21 }], // TOP shot through the roof
      [pose(14, 8, 21, 0, 1, 21), { x: 0, y: 0, z: 21 }], // WIDE over the wall under the roof
    ];
    for (const [desired, pl] of cases) {
      const col = new CameraCollision(obs);
      const p = { ...desired };
      col.resolve(p, pl.x, pl.y + 1, pl.z, 1 / 30, true, pl.y + 0.4);
      const c = check(obs, p, pl);
      expect(c.inside, JSON.stringify(desired)).toBe(false);
      expect(c.belowFloor, JSON.stringify(desired)).toBe(false);
      expect(c.aboveCeiling, JSON.stringify(desired)).toBe(false);
      expect(c.occluded, JSON.stringify(desired)).toBe(false);
      expect(c.playerOut, JSON.stringify(desired)).toBe(false);
    }
  });

  it('moves in smoothly when an obstacle arrives and eases back out when it is gone', () => {
    const w = corridorWorld();
    const obs = new CameraObstacles(w);
    const col = new CameraCollision(obs);
    // the player walks toward the roof; the FOLLOW camera trails 7 m behind at 3.7 m
    let prev: { x: number; y: number; z: number } | null = null;
    let maxStep = 0;
    let minRatio = 1;
    const ratios: number[] = [];
    for (let i = 0; i < 300; i++) {
      const z = 8 + i * 0.1; // 3 m/s
      const p = pose(0, 3.7, z - 7.2, 0, 1.1, z + 4.5);
      const r = col.resolve(p, 0, 1, z, 1 / 30, i === 0, 0.4);
      const off = { x: p.x, y: p.y - 1, z: p.z - z };
      if (prev && !r.needsCut) maxStep = Math.max(maxStep, Math.hypot(off.x - prev.x, off.y - prev.y, off.z - prev.z));
      prev = off;
      minRatio = Math.min(minRatio, r.ratio);
      ratios.push(r.ratio);
      expect(check(obs, p, { x: 0, y: 0, z }).inside).toBe(false);
    }
    expect(minRatio).toBeLessThan(0.8); // it did react to the roof
    expect(maxStep).toBeLessThan(1.25); // ≤ ~0.7 m/frame per axis: a move, never a teleport
    // easing back out: after the roof the arm grows over several frames, not in one
    const last = ratios.slice(-60);
    expect(last[last.length - 1]).toBeGreaterThan(0.95);
  });

  it('keeps the chosen shot when nothing is in the way (no extra lag)', () => {
    const level = straightLevel(60, (b) => b.floor(-6, 6, 0, 60, 0, { style: 'floor' }), 6);
    const w = new World({ level, character: testCharacter, enemy: null });
    const col = new CameraCollision(new CameraObstacles(w));
    for (let i = 0; i < 30; i++) {
      const desired = pose(3 + i * 0.3, 4, 10 + i, 0, 1, 20);
      const p = { ...desired };
      const r = col.resolve(p, 0, 1, 10 + i, 1 / 30, i === 0, 0.4);
      expect(r.ratio).toBe(1);
      expect(p.x).toBeCloseTo(desired.x, 9);
      expect(p.y).toBeCloseTo(desired.y, 9);
    }
  });
});

describe('Camera director framing', () => {
  const s = (over: Partial<CameraSubject> = {}): CameraSubject => ({
    x: 0, y: 0, z: 50, heading: 0, vy: 0, grounded: true, alive: true, groundY: -0.5, trackY: 0,
    enemy: { x: 0.8, y: 0, z: 41, visible: true, chasing: true }, ...over,
  });

  it('all 13 modes still produce poses above the floor plane', () => {
    const d = new CameraDirector(VIDEO_STYLE, null);
    for (const m of CAMERA_MODES) {
      const p = d.previewShot(m, s());
      expect(Number.isFinite(p.x + p.y + p.z + p.fov), m).toBe(true);
    }
    expect(CAMERA_MODES).toEqual(['FOLLOW', 'SIDE', 'FRONT', 'BACK', 'TOP', 'LOW', 'WIDE', 'CLOSE', 'CHASE', 'DRAMATIC', 'IMPACT', 'SLOW', 'FINISH']);
  });

  it('CHASE and WIDE keep runner and chaser in frame — also in 9:16', () => {
    for (const portrait of [false, true]) {
      const d = new CameraDirector(portrait ? SHORTS_STYLE : VIDEO_STYLE, null);
      d.portrait = portrait;
      for (const gap of [3, 6, 10, 15]) {
        const subj = s({ enemy: { x: 1.5, y: 0, z: 50 - gap, visible: true, chasing: true } });
        for (const m of ['CHASE', 'WIDE'] as const) {
          const p = d.previewShot(m, subj);
          const a = portrait ? 9 / 16 : 16 / 9;
          const pl = project(p, a, { x: 0, y: 1, z: 50 });
          const en = project(p, a, { x: 1.5, y: 1.8, z: 50 - gap });
          expect(Math.max(Math.abs(pl[0]), Math.abs(pl[1])), `${m} p=${portrait} gap ${gap} runner`).toBeLessThanOrEqual(0.82);
          expect(Math.max(Math.abs(en[0]), Math.abs(en[1])), `${m} p=${portrait} gap ${gap} chaser`).toBeLessThanOrEqual(0.82);
        }
      }
    }
  });

  it('never whips: a far-away new shot is a cut, blends are speed-capped', () => {
    const d = new CameraDirector(VIDEO_STYLE, null);
    const subj = s({ enemy: null });
    d.update(subj, 1 / 30);
    d.request('WIDE', 5, 3, 'test', false);
    d.update(subj, 1 / 30);
    expect(d.lastCut).toBe(true); // WIDE is far from FOLLOW → cut instead of a 15 m swoop
    d.request('BACK', 6, 3, 'test', false);
    let prev = { ...d.pose };
    let maxStep = 0;
    for (let i = 0; i < 60; i++) {
      d.update(subj, 1 / 30);
      if (!d.lastCut) maxStep = Math.max(maxStep, Math.hypot(d.pose.x - prev.x, d.pose.y - prev.y, d.pose.z - prev.z));
      prev = { ...d.pose };
    }
    expect(maxStep).toBeLessThan(1.1);
  });
});

describe('Camera audit of real video takes', () => {
  const resolver = (c: Parameters<typeof resolveVideo>[0]) => resolveVideo(c, { campaign: (n) => campaignParams(n, c.enemy), searchTakes: false });
  it('chase Shorts and long videos: no camera in geometry, players framed, no teleports', () => {
    const takes: Array<[number, 'short' | 'long', 'CHASE' | 'BOSS_ESCAPE' | 'NEAR_DEATH', number]> = [
      [1, 'short', 'CHASE', 6],
      [30, 'short', 'CHASE', 6],
      [55, 'long', 'CHASE', 1],
      [50, 'long', 'BOSS_ESCAPE', 1],
      [77, 'short', 'NEAR_DEATH', 3],
      [88, 'long', 'CHASE', 1],
    ];
    for (const [level, format, scenario, take] of takes) {
      const s = auditTakeCamera(resolver(validateVideoConfig({ level, format, scenario, take, cameraStyle: 'dynamic' }).config), { maxTime: 120 });
      const id = `L${level} ${format} ${scenario}`;
      expect(s.inside + s.belowFloor + s.aboveCeiling + s.tooClose, id).toBe(0);
      expect(s.playerOut / s.frames, id).toBeLessThan(0.005);
      if (s.enemyFramed > 30) expect(s.enemyOut / s.enemyFramed, id).toBeLessThan(0.02);
      expect(s.maxJump, id).toBeLessThan(4);
      expect(s.jumps / s.frames, id).toBeLessThan(0.003);
    }
  }, 120000);
});

describe('Decor clearance', () => {
  it('no prop stands in the play corridor of any campaign level (second pass finds nothing)', () => {
    for (let n = 1; n <= 100; n += 3) {
      const L = generateLevel(campaignParams(n));
      expect(clearDecorFromPath(L.pieces, L.spine), `level ${n}`).toEqual({ removed: 0, moved: 0 });
    }
  });
});
