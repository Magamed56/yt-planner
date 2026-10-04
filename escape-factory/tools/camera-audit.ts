/**
 * Camera quality audit over a set of video takes (headless):
 *   tsx tools/camera-audit.ts [levels=1,5,12,25,33,45,55,64,77,88,95 | 1-100] [--all] [--raw] [--quiet]
 * (--all: 8 scenario/format variants per level instead of 2)
 * Prints per-take and total counts of camera-inside-geometry, below-floor,
 * beyond-ceiling, occluded, player-out-of-frame, enemy-out-of-frame (CHASE/WIDE)
 * and the biggest uncut camera jump. Exit 1 if hard errors remain.
 */
import { validateVideoConfig, type VideoScenario } from '../src/engine/video/VideoConfig';
import { resolveVideo } from '../src/engine/video/VideoSession';
import { auditTakeCamera } from '../src/engine/video/cameraAudit';
import { campaignParams } from '../src/game/campaign';
import { registerContent } from '../src/game/content';

registerContent();
const args = process.argv.slice(2);
// "1,5,12" or ranges "1-100"
const levels = (args.find((a) => !a.startsWith('--')) ?? '1,5,12,25,33,45,55,64,77,88,95').split(',').flatMap((p) => {
  const [a, b = a] = p.split('-').map(Number);
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
});
const raw = args.includes('--raw');
const resolver = (c: Parameters<typeof resolveVideo>[0]) => resolveVideo(c, { campaign: (n) => campaignParams(n, c.enemy), searchTakes: false });
const variants: Array<{ format: 'short' | 'long'; scenario: VideoScenario; take: number }> = args.includes('--all')
  ? [
      { format: 'short', scenario: 'CHASE', take: 6 },
      { format: 'long', scenario: 'CHASE', take: 1 },
      { format: 'short', scenario: 'NEAR_DEATH', take: 3 },
      { format: 'long', scenario: 'BOSS_ESCAPE', take: 1 },
      { format: 'short', scenario: 'CHAOS', take: 5 },
      { format: 'long', scenario: 'PERFECT_RUN', take: 4 },
      { format: 'short', scenario: 'FAIL', take: 2 },
      { format: 'short', scenario: 'IMPOSSIBLE', take: 4 },
    ]
  : [
      { format: 'short', scenario: 'CHASE', take: 6 },
      { format: 'long', scenario: 'CHASE', take: 1 },
    ];
const quiet = args.includes('--quiet');
const tot: Record<string, number> = {};
let maxJump = 0;
for (const n of levels) {
  for (const v of variants) {
    const cfg = validateVideoConfig({ level: n, format: v.format, scenario: v.scenario, take: v.take, cameraStyle: 'dynamic' }).config;
    const r = resolver(cfg);
    const s = auditTakeCamera(r, { maxTime: 150, poseOf: raw ? (vs) => vs.session.director.pose : undefined });
    for (const k of ['frames', 'inside', 'belowFloor', 'aboveCeiling', 'occluded', 'tooClose', 'playerOut', 'enemyFramed', 'enemyOut', 'jumps'] as const) tot[k] = (tot[k] ?? 0) + s[k];
    maxJump = Math.max(maxJump, s.maxJump);
    const pct = (a: number, b = s.frames) => (b ? ((100 * a) / b).toFixed(1) : '-') + '%';
    if (!quiet) console.log(
      `L${String(n).padStart(3)} ${v.format.padEnd(5)} ${r.theme.id.padEnd(10)} frames ${String(s.frames).padStart(5)} inside ${pct(s.inside)} below ${pct(s.belowFloor)} ceil ${pct(s.aboveCeiling)} occl ${pct(s.occluded)} close ${pct(s.tooClose)} pOut ${pct(s.playerOut)} eOut ${pct(s.enemyOut, s.enemyFramed)} jump ${s.maxJump.toFixed(2)}`,
    );
    const ex = s.examples.filter((e) => !e.issue.startsWith('jump')).slice(0, 4).map((e) => `${e.issue}@${e.t.toFixed(1)}s/${e.mode}`);
    if (ex.length && !quiet) console.log('      ' + ex.join('  '));
  }
}
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(2) : '-') + '%';
console.log(
  `\nTOTAL frames ${tot.frames} · inside ${tot.inside} (${pct(tot.inside, tot.frames)}) · belowFloor ${tot.belowFloor} · aboveCeiling ${tot.aboveCeiling} · occluded ${pct(tot.occluded, tot.frames)} · tooClose ${tot.tooClose} · playerOut ${pct(tot.playerOut, tot.frames)} · enemyOut ${pct(tot.enemyOut, tot.enemyFramed)} of ${tot.enemyFramed} · jumps>1.2m ${tot.jumps} · maxJump ${maxJump.toFixed(2)} m`,
);
process.exit(tot.inside + tot.belowFloor + tot.aboveCeiling + tot.tooClose > 0 ? 1 : 0);
