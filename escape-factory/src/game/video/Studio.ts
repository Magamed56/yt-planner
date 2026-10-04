/**
 * VIDEO STUDIO (?mode=studio): pick level / seed / difficulty / character /
 * enemy / scenario / take / camera / format, preview live, export the
 * video_XXX.json config and copy the CLI record command.
 */
import { characters } from '@engine/character/CharacterRegistry';
import { enemies } from '@engine/enemy/EnemyDef';
import { themes } from '@engine/theme/ThemeDef';
import { DIFFICULTY_NAMES } from '@engine/level/difficulty';
import { VIDEO_SCENARIOS, validateVideoConfig, type VideoConfig } from '@engine/video/VideoConfig';
import { TAKES } from '@engine/video/Scenarios';
import { VideoApp } from './VideoApp';
import { bundledConfigs } from './configs';
import { RECIPES } from '../recipes';

export function startStudio(root: HTMLElement): void {
  document.body.style.background = '#14161f';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;display:flex;font-family:system-ui,sans-serif;color:#eee';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:330px;padding:14px;overflow:auto;background:#1d2030;border-right:2px solid #000;font-size:13px';
  const stage = document.createElement('div');
  stage.style.cssText = 'flex:1;position:relative;display:flex;align-items:center;justify-content:center';
  root.appendChild(wrap);
  wrap.append(panel, stage);
  const app = new VideoApp(stage);
  const sel = (id: string, label: string, opts: Array<[string, string]>, v: string) =>
    `<label style="display:block;margin:6px 0">${label}<br><select id="${id}" style="width:100%">${opts.map(([val, txt]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${txt}</option>`).join('')}</select></label>`;
  const inp = (id: string, label: string, v: string | number) => `<label style="display:block;margin:6px 0">${label}<br><input id="${id}" value="${v}" style="width:100%"></label>`;
  const configs = bundledConfigs();
  panel.innerHTML = `
    <h2 style="margin:0 0 8px;font-family:'Arial Black';color:#ffd23f">🎬 VIDEO STUDIO</h2>
    ${sel('preset', 'Preset config', [['', '— custom —'], ...Object.keys(configs).map((k): [string, string] => [k, k])], '')}
    ${sel('recipe', 'Title recipe', [['', '— none —'], ...RECIPES.map((r): [string, string] => [r.id, r.title])], '')}
    ${inp('level', 'Campaign level (1-100, blank = custom)', '')}
    ${inp('seed', 'Seed', 1001)}
    ${sel('difficulty', 'Difficulty', DIFFICULTY_NAMES.map((d): [string, string] => [d, d]), 'NORMAL')}
    ${sel('theme', 'Theme', themes.list().map((t): [string, string] => [t.id, t.name]), 'FACTORY')}
    ${sel('character', 'Character', characters.list().map((c): [string, string] => [c.id, c.name]), 'pip')}
    ${sel('enemy', 'Enemy', [...enemies.list().map((e): [string, string] => [e.id, e.name]), ['none', 'None']], 'grumbo')}
    ${sel('scenario', 'Scenario', VIDEO_SCENARIOS.map((s): [string, string] => [s, s]), 'CHASE')}
    ${sel('take', 'Take', TAKES.map((t): [string, string] => [String(t.take), `${t.take}: ${t.label}`]), '1')}
    ${sel('camera', 'Camera style', ['dynamic', 'smooth', 'classic', 'shorts'].map((s): [string, string] => [s, s]), 'dynamic')}
    ${sel('format', 'Format', [['short', 'Shorts 1080×1920'], ['long', 'Long 1920×1080'], ['square', 'Square 1080×1080']], 'short')}
    ${inp('duration', 'Duration (s)', 35)}
    ${inp('hook', 'Hook caption', 'CAN I ESCAPE?!')}
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <button id="go">▶ Preview</button><button id="export">⬇ Export JSON</button><button id="cli">📋 CLI command</button><button id="audio">🔊 Sound</button>
    </div>
    <pre id="out" style="white-space:pre-wrap;font-size:11px;background:#0f1118;padding:8px;margin-top:10px;max-height:240px;overflow:auto"></pre>`;
  const $ = (id: string) => panel.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id)!;
  const out = panel.querySelector('#out')!;
  const read = (): VideoConfig => {
    const raw: Record<string, unknown> = {
      id: `video_${$('seed').value}_${$('scenario').value.toLowerCase()}_t${$('take').value}`,
      title: RECIPES.find((r) => r.id === $('recipe').value)?.title ?? 'Can I Escape The Factory?',
      recipe: $('recipe').value || undefined,
      seed: Number($('seed').value),
      difficulty: $('difficulty').value,
      theme: $('theme').value,
      character: $('character').value,
      enemy: $('enemy').value,
      scenario: $('scenario').value,
      take: Number($('take').value),
      cameraStyle: $('camera').value,
      format: $('format').value,
      duration: Number($('duration').value),
      captions: $('hook').value ? [{ at: 0, duration: 1.8, text: $('hook').value, style: 'hook' }] : [],
    };
    if ($('level').value) raw.level = Number($('level').value);
    const v = validateVideoConfig(raw);
    out.textContent = (v.errors.length ? 'ERRORS: ' + v.errors.join('; ') + '\n' : '') + (v.warnings.length ? 'warnings: ' + v.warnings.join('; ') + '\n' : '') + JSON.stringify({ ...v.config }, null, 2);
    return v.config;
  };
  const go = () => {
    const r = app.load(read());
    out.textContent += `\n\nlevel: ${r.level.modules.length} modules, ${r.level.stats.totalLength.toFixed(0)} m, est ${r.level.stats.estDuration.toFixed(0)} s, takeSeed ${r.takeSeed}`;
  };
  panel.querySelector('#go')!.addEventListener('click', go);
  panel.querySelector('#audio')!.addEventListener('click', () => app.enableAudio());
  panel.querySelector('#export')!.addEventListener('click', () => {
    const c = read();
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${c.id}.json`;
    a.click();
  });
  panel.querySelector('#cli')!.addEventListener('click', () => {
    const c = read();
    const cmd = `npm run record -- --json '${JSON.stringify(c)}'`;
    void navigator.clipboard?.writeText(cmd);
    out.textContent = cmd;
  });
  $('preset').addEventListener('change', () => {
    const c = configs[$('preset').value] as Record<string, unknown> | undefined;
    if (!c) return;
    for (const k of ['seed', 'difficulty', 'theme', 'character', 'enemy', 'scenario', 'take', 'format', 'duration', 'level'] as const) if (c[k] !== undefined) $(k).value = String(c[k]);
    if (c.cameraStyle) $('camera').value = String(c.cameraStyle);
    go();
  });
  $('recipe').addEventListener('change', () => {
    const r = RECIPES.find((x) => x.id === $('recipe').value);
    if (!r) return;
    $('scenario').value = r.scenario;
    $('take').value = String(r.take);
    $('hook').value = r.hook;
    if (r.difficulty) $('difficulty').value = r.difficulty;
    go();
  });
  app.start();
  go();
}
