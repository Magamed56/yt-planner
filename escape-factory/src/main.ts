/**
 * Entry point. Routes by URL:
 *   (default)        game menu + play
 *   ?mode=sandbox    dev sandbox
 */
import { App } from '@game/App';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'game';
const root = document.getElementById('app')!;

async function boot() {
  if (mode === 'sandbox') {
    await import('./dev/sandbox');
    return;
  }
  const app = new App(root);
  app.start();
  if (params.has('level')) app.play(Number(params.get('level')));
  (window as unknown as { __app: App }).__app = app;
}

void boot().then(() => ((window as unknown as { __booted: boolean }).__booted = true));
