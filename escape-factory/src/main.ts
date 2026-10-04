/**
 * Entry point. Routes by URL:
 *   (default)        game menu + play            ?level=N to jump into a level
 *   ?mode=video      VIDEO MODE (bot + director, no UI)   see VIDEO_SYSTEM.md
 *   ?mode=record     deterministic frame recorder (driven by tools/record.ts)
 *   ?mode=studio     Video Studio
 *   ?mode=sandbox    dev sandbox
 */
const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'game';
const root = document.getElementById('app')!;

async function boot() {
  switch (mode) {
    case 'sandbox':
      await import('./dev/sandbox');
      return;
    case 'studio': {
      const { startStudio } = await import('@game/video/Studio');
      startStudio(root);
      return;
    }
    case 'video': {
      const { VideoApp } = await import('@game/video/VideoApp');
      const { configFromParams } = await import('@game/video/configs');
      const app = new VideoApp(root);
      const v = configFromParams(params);
      if (v.errors.length) console.error('video config errors:', v.errors);
      app.load(v.config);
      app.start();
      window.addEventListener('pointerdown', () => app.enableAudio(), { once: true });
      (window as unknown as { __video: unknown }).__video = app;
      return;
    }
    case 'record': {
      const { installRecorder } = await import('@game/video/RecordMode');
      installRecorder(root);
      return;
    }
    default: {
      const { App } = await import('@game/App');
      const app = new App(root);
      app.start();
      if (params.has('level')) app.play(Number(params.get('level')));
      (window as unknown as { __app: unknown }).__app = app;
    }
  }
}

void boot().then(() => ((window as unknown as { __booted: boolean }).__booted = true));
