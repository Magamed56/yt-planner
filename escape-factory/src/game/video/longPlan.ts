/** Game wrapper around the engine long-form planner (campaign-aware). */
import type { Resolver } from '@engine/video/Edit';
import { planLong } from '@engine/video/LongPlanner';
import type { VideoConfig } from '@engine/video/VideoConfig';
import { campaignLevel, CAMPAIGN_SIZE } from '../campaign';

export interface LongOptions {
  minutes: number;
  startLevel?: number;
  title?: string;
}

export function planLongVideo(o: LongOptions & { base: VideoConfig }, resolve: Resolver) {
  return planLong(
    {
      ...o,
      base: { ...o.base, format: 'long', cameraStyle: o.base.cameraStyle === 'shorts' ? 'dynamic' : o.base.cameraStyle },
      levelConfig: (n) => {
        const L = campaignLevel(n);
        return { level: n, seed: L.seed, difficulty: L.difficulty, theme: L.theme };
      },
      levelTitle: (n) => `Level ${n}: ${campaignLevel(n).title}`,
      isBossLevel: (n) => campaignLevel(n).boss,
      maxLevel: CAMPAIGN_SIZE,
    },
    resolve,
  );
}
