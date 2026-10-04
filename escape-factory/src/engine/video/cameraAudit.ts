/**
 * Headless camera audit of a video take: plays it frame by frame exactly like
 * the recorder (same director, same collision) and validates every frame.
 */
import { CameraObstacles } from '../camera/CameraObstacles';
import { CameraQualityReport, checkCameraFrame, type CameraQualitySummary } from '../camera/CameraQuality';
import { VideoSession, type ResolvedVideo } from './VideoSession';

export interface AuditOptions {
  fps?: number;
  /** stop after this many video seconds */
  maxTime?: number;
  /** hook to replace the pose before checking (diagnostics) */
  poseOf?: (s: VideoSession) => import('../camera/CameraDirector').CameraPose;
}

export function auditTakeCamera(r: ResolvedVideo, o: AuditOptions = {}): CameraQualitySummary {
  const fps = o.fps ?? 30;
  const v = new VideoSession(r);
  const gs = v.session;
  const obstacles = new CameraObstacles(gs.world);
  const report = new CameraQualityReport();
  const aspect = r.portrait ? 9 / 16 : r.size.width / r.size.height;
  const maxTime = o.maxTime ?? 240;
  const w = gs.world;
  let after = 0;
  while (v.videoTime < maxTime && after < 3 * fps) {
    v.frame(1 / fps, false);
    if (w.status === 'finished') after++;
    const s = gs.cameraSubject;
    const pose = o.poseOf ? o.poseOf(v) : gs.cameraPose;
    const e = w.enemy;
    const enemy = s.enemy && s.enemy.visible && s.enemy.chasing && e ? { x: s.enemy.x, y: s.enemy.y + e.def.stats.height * 0.5, z: s.enemy.z } : null;
    if (!w.player.isAlive) {
      report.gap(); // death/respawn transitions are not framing errors
      continue;
    }
    const check = checkCameraFrame({ pose, aspect, player: { x: s.x, y: s.y + 1, z: s.z }, playerFeetY: s.y, trackY: s.trackY, enemy, mode: gs.director.mode }, obstacles);
    report.add(check, gs.director.mode, v.videoTime, pose, gs.director.lastCut, { x: s.x, y: s.y, z: s.z });
  }
  v.dispose();
  return report.s;
}
