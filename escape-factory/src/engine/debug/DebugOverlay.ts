/**
 * Debug / performance overlay (F3 or ?debug=1): FPS, draw calls, triangles,
 * objects, physics bodies, memory, particles and level generation time.
 */
import type { GameSession } from '../core/GameSession';

export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:8px;top:64px;z-index:20;font:12px/1.35 monospace;color:#b6ffb6;background:rgba(0,0,0,0.6);padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre;display:none';
    parent.appendChild(this.el);
    if (new URLSearchParams(location.search).has('debug')) this.setVisible(true);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(s: GameSession, fps: number): void {
    if (!this.visible) return;
    const w = s.world;
    const v = s.view?.stats();
    let objects = 0;
    s.view?.rc.scene.traverse(() => objects++);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `FPS          ${fps.toFixed(0)}`,
      `draw calls   ${v?.drawCalls ?? '-'}`,
      `triangles    ${v ? (v.triangles / 1000).toFixed(1) + 'k' : '-'}`,
      `objects      ${objects}`,
      `geometries   ${v?.geometries ?? '-'}  textures ${v?.textures ?? '-'}`,
      `physics      ${w.physics.colliders.length} bodies (${w.physics.kinematicList.length} kinematic)`,
      `hazards      ${w.hazards.list.length}   particles ${v?.particles ?? 0}`,
      `memory       ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'n/a'}`,
      `level gen    ${w.level.stats.generationMs.toFixed(1)} ms   seed ${w.level.seed}  d${w.level.difficulty.toFixed(2)}`,
      `modules      ${w.moduleIndex + 1}/${w.level.modules.length} ${w.level.modules[w.moduleIndex]?.type ?? ''}`,
      `camera       ${s.director.mode}  x${s.director.timeScale.toFixed(2)}`,
      `enemy        ${w.enemy ? `${w.enemy.state} gap ${Number.isFinite(w.enemy.gapTo(w.playerS)) ? w.enemy.gapTo(w.playerS).toFixed(1) : '-'}` : 'none'}`,
      `sim          t=${w.time.toFixed(1)}s tick ${w.tick}  s=${w.playerS.toFixed(1)}/${w.track.length.toFixed(0)}`,
    ];
    this.el.textContent = lines.join('\n');
  }
}
