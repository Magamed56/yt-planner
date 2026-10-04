/** Bundled video configs from /videos/*.json + URL-param configs. */
import { validateVideoConfig, type VideoConfig } from '@engine/video/VideoConfig';

const files = import.meta.glob('/videos/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export function bundledConfigs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, json] of Object.entries(files)) out[path.split('/').pop()!.replace(/\.json$/, '')] = json;
  return out;
}

/** Builds a raw config object from URL parameters (overriding a named config). */
export function configFromParams(p: URLSearchParams): { config: VideoConfig; errors: string[]; warnings: string[] } {
  const named = p.get('config');
  const base = (named && bundledConfigs()[named]) || {};
  const raw: Record<string, unknown> = { ...(base as object) };
  const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v))) raw[k] = v;
  };
  set('level', num('level'));
  set('seed', num('seed'));
  const d = p.get('difficulty');
  set('difficulty', d === null ? undefined : isNaN(Number(d)) ? d : Number(d));
  set('length', num('length'));
  set('theme', p.get('theme') ?? undefined);
  set('character', p.get('character') ?? undefined);
  set('enemy', p.get('enemy') ?? undefined);
  set('scenario', (p.get('scenario') ?? p.get('VIDEO_SCENARIO'))?.toUpperCase());
  set('take', num('take'));
  set('takeSeed', num('takeSeed'));
  set('cameraStyle', p.get('camera') ?? undefined);
  set('format', p.get('format') ?? undefined);
  set('duration', num('duration'));
  set('fps', num('fps'));
  set('highlight', p.get('highlight') ?? undefined);
  if (p.has('events')) raw.specialEvents = p.get('events')!.split(',');
  if (p.has('hook')) raw.captions = [{ at: 0, duration: 1.8, text: p.get('hook'), style: 'hook' }];
  return validateVideoConfig(raw);
}
