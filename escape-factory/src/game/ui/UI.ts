/**
 * Minimal, chunky DOM UI: PLAY / LEVEL / RESTART / PAUSE / SETTINGS, HUD,
 * toasts and touch controls. Completely hidden in VIDEO / RECORD modes.
 */
import './ui.css';
import type { CharacterDef } from '@engine/character/CharacterDef';
import type { GameSettings, SaveData } from '@engine/save/SaveSystem';
import type { CampaignLevel } from '../campaign';

export interface UIHandlers {
  onPlay(): void;
  onLevel(n: number): void;
  onRestart(): void;
  onResume(): void;
  onPause(): void;
  onMenu(): void;
  onNext(): void;
  onSelectCharacter(id: string): void;
  onSettings(s: Partial<GameSettings>): void;
  onResetSave(): void;
  onStudio(): void;
  onTouch(x: number, y: number, jump: boolean): void;
}

type ScreenId = 'menu' | 'levels' | 'chars' | 'settings' | 'pause' | 'complete';

const THEME_COLORS: Record<string, string> = {
  FACTORY: '#ffb36b',
  NIGHT: '#7f8cff',
  WINTER: '#bfe9ff',
  CANDY: '#ff9ccf',
  UNDERWATER: '#5fd3ff',
  VOLCANO: '#ff7043',
  SPACE: '#b388ff',
  HALLOWEEN: '#ff9f1c',
  CHRISTMAS: '#7ae582',
  NORMAL: '#e0e0e0',
};

export class UI {
  readonly root: HTMLDivElement;
  private readonly screens = new Map<ScreenId, HTMLDivElement>();
  private readonly hud: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly touch: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private toastTimer = 0;
  private hudRefs: Record<string, HTMLElement> = {};
  private backTo: ScreenId = 'menu';

  constructor(
    parent: HTMLElement,
    private readonly h: UIHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    parent.appendChild(this.root);
    for (const id of ['menu', 'levels', 'chars', 'settings', 'pause', 'complete'] as ScreenId[]) {
      const el = document.createElement('div');
      el.className = 'screen';
      el.dataset.screen = id;
      this.root.appendChild(el);
      this.screens.set(id, el);
    }
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.hud.innerHTML = `<div class="tl"><div data-r="title"></div><div data-r="sub" style="font-size:0.7em;opacity:0.85"></div></div>
      <div class="tr"><span data-r="time">0:00.0</span><span data-r="deaths">💀 0</span><span class="coins" data-r="coins">● 0</span></div>
      <button class="pausebtn" data-a="pause">II</button>`;
    this.hud.querySelectorAll<HTMLElement>('[data-r]').forEach((e) => (this.hudRefs[e.dataset.r!] = e));
    this.hud.querySelector('[data-a=pause]')!.addEventListener('click', () => h.onPause());
    this.root.appendChild(this.hud);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.root.appendChild(this.toastEl);
    this.touch = document.createElement('div');
    this.touch.className = 'touch';
    this.touch.innerHTML = `<div class="stick"><div class="knob"></div></div><div class="jumpbtn">JUMP</div>`;
    this.root.appendChild(this.touch);
    this.setupTouch();
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    this.root.appendChild(this.fpsEl);
  }

  hideAll(): void {
    for (const s of this.screens.values()) s.classList.remove('show');
    this.hud.classList.remove('show');
    this.touch.classList.remove('show');
  }

  /** Completely removes UI from view (video mode). */
  setHidden(hidden: boolean): void {
    this.root.style.display = hidden ? 'none' : '';
  }

  private show(id: ScreenId, html: string): HTMLDivElement {
    for (const s of this.screens.values()) s.classList.remove('show');
    const el = this.screens.get(id)!;
    el.innerHTML = html;
    el.classList.add('show');
    el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', (ev) => this.action(b.dataset.a!, b, ev)));
    return el;
  }

  private action(a: string, el: HTMLElement, ev: Event): void {
    ev.stopPropagation();
    switch (a) {
      case 'play':
        this.h.onPlay();
        break;
      case 'levels':
        this.backTo = this.screens.get('pause')!.classList.contains('show') ? 'pause' : 'menu';
        this.levelsCb?.();
        break;
      case 'chars':
        this.charsCb?.();
        break;
      case 'settings':
        this.backTo = this.screens.get('pause')!.classList.contains('show') ? 'pause' : 'menu';
        this.settingsCb?.();
        break;
      case 'studio':
        this.h.onStudio();
        break;
      case 'level':
        if (!el.classList.contains('locked')) this.h.onLevel(Number(el.dataset.n));
        break;
      case 'char':
        this.h.onSelectCharacter(el.dataset.id!);
        break;
      case 'resume':
        this.h.onResume();
        break;
      case 'restart':
        this.h.onRestart();
        break;
      case 'menu':
        this.h.onMenu();
        break;
      case 'next':
        this.h.onNext();
        break;
      case 'back':
        if (this.backTo === 'pause') this.pauseCb?.();
        else this.h.onMenu();
        break;
      case 'reset':
        if (confirm('Reset all progress?')) this.h.onResetSave();
        break;
    }
  }

  // callbacks set by the app to (re)render data-driven screens
  levelsCb?: () => void;
  charsCb?: () => void;
  settingsCb?: () => void;
  pauseCb?: () => void;

  showMenu(save: SaveData): void {
    this.hud.classList.remove('show');
    this.touch.classList.remove('show');
    this.show(
      'menu',
      `<div class="menu-col">
        <h1 class="logo">ESCAPE<span>FACTORY</span></h1>
        <div class="tag">Grumbo is coming… RUN!</div>
        <button class="btn" data-a="play">▶ PLAY</button>
        <button class="btn alt" data-a="levels">LEVELS</button>
        <button class="btn alt" data-a="chars">CHARACTERS</button>
        <button class="btn alt" data-a="settings">SETTINGS</button>
        <button class="btn small" data-a="studio">🎬 VIDEO STUDIO</button>
        <div class="tag" style="margin-top:14px">★ ${save.completedLevels.length}/100 &nbsp; ● ${save.coins} coins</div>
      </div>
      <div class="footer">WASD / Arrows to run · Space to jump · Esc to pause</div>`,
    );
  }

  showLevels(levels: CampaignLevel[], save: SaveData, isUnlocked: (n: number) => boolean): void {
    const cells = levels
      .map((l) => {
        const done = save.completedLevels.includes(l.number);
        const locked = !isUnlocked(l.number);
        const best = save.bestTimes[String(l.number)];
        return `<button class="lvl ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${l.boss ? 'boss' : ''}" data-a="level" data-n="${l.number}"
          style="background:${THEME_COLORS[l.theme] ?? '#ddd'}" title="${l.title} · ${l.theme}">${l.number}<small>${best ? fmt(best) : l.boss ? 'BOSS' : ''}</small></button>`;
      })
      .join('');
    this.show('levels', `<div class="panel"><h2>SELECT LEVEL</h2><div class="levels">${cells}</div><div style="text-align:center;margin-top:14px"><button class="btn small" data-a="back">◀ BACK</button></div></div>`);
  }

  showCharacters(list: CharacterDef[], save: SaveData): void {
    const cards = list
      .map((c) => {
        const owned = save.unlockedCharacters.includes(c.id);
        const sel = save.selectedCharacter === c.id;
        return `<div class="char ${sel ? 'sel' : ''}" data-a="char" data-id="${c.id}">
          <div class="swatch" style="background:${c.color}"></div><div>${c.name}</div><p>${c.description}</p>
          <div>${owned ? (sel ? 'SELECTED' : 'SELECT') : `● ${c.unlockCost}`}</div></div>`;
      })
      .join('');
    this.show('chars', `<div class="panel"><h2>CHARACTERS <span class="coins" style="font-size:0.7em">● ${save.coins}</span></h2><div class="chars">${cards}</div><div style="text-align:center;margin-top:14px"><button class="btn small" data-a="back">◀ BACK</button></div></div>`);
  }

  showSettings(s: GameSettings): void {
    const el = this.show(
      'settings',
      `<div class="panel" style="min-width:340px"><h2>SETTINGS</h2>
        <div class="row">Master <input type="range" min="0" max="1" step="0.05" value="${s.master}" data-s="master"></div>
        <div class="row">Music <input type="range" min="0" max="1" step="0.05" value="${s.music}" data-s="music"></div>
        <div class="row">Sound FX <input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-s="sfx"></div>
        <div class="row">Quality <select data-s="quality">${['low', 'medium', 'high'].map((q) => `<option ${q === s.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></div>
        <div class="row">Camera shake <input type="checkbox" ${s.shake ? 'checked' : ''} data-s="shake"></div>
        <div class="row">Cinematic moments <input type="checkbox" ${s.cinematicCamera ? 'checked' : ''} data-s="cinematicCamera"></div>
        <div class="row">Show FPS / debug <input type="checkbox" ${s.showFps ? 'checked' : ''} data-s="showFps"></div>
        <div style="text-align:center;margin-top:10px"><button class="btn small" data-a="back">◀ BACK</button> <button class="btn small red" data-a="reset">RESET SAVE</button></div></div>`,
    );
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const k = inp.dataset.s as keyof GameSettings;
        const v = inp instanceof HTMLInputElement ? (inp.type === 'checkbox' ? inp.checked : Number(inp.value)) : inp.value;
        this.h.onSettings({ [k]: v } as Partial<GameSettings>);
      }),
    );
  }

  showPause(title: string): void {
    this.show(
      'pause',
      `<div class="panel menu-col"><h2>PAUSED</h2><div class="tag">${title}</div>
        <button class="btn" data-a="resume">RESUME</button><button class="btn alt" data-a="restart">RESTART</button>
        <button class="btn alt" data-a="levels">LEVELS</button><button class="btn alt" data-a="settings">SETTINGS</button>
        <button class="btn red" data-a="menu">MENU</button></div>`,
    );
  }

  showComplete(o: { title: string; time: number; deaths: number; coins: number; best: boolean; earned: number; hasNext: boolean }): void {
    this.touch.classList.remove('show');
    this.show(
      'complete',
      `<div class="panel menu-col"><h2>ESCAPED!</h2><div class="tag">${o.title}</div>
        <div class="stats">Time <b>${fmt(o.time)}</b>${o.best ? ' 🏆 NEW BEST' : ''}<br>Deaths <b>${o.deaths}</b> · Coins <b>${o.coins}</b>${o.earned ? ` (+${o.earned})` : ''}</div>
        ${o.hasNext ? '<button class="btn" data-a="next">NEXT LEVEL ▶</button>' : ''}
        <button class="btn alt" data-a="restart">RETRY</button><button class="btn red" data-a="menu">MENU</button></div>`,
    );
  }

  hideScreens(): void {
    for (const s of this.screens.values()) s.classList.remove('show');
  }

  showHUD(title: string, sub: string, touch: boolean): void {
    this.hideScreens();
    this.hud.classList.add('show');
    this.hudRefs.title.textContent = title;
    this.hudRefs.sub.textContent = sub;
    this.touch.classList.toggle('show', touch);
  }

  updateHUD(time: number, deaths: number, coins: number): void {
    this.hudRefs.time.textContent = fmt(time);
    this.hudRefs.deaths.textContent = `💀 ${deaths}`;
    this.hudRefs.coins.textContent = `● ${coins}`;
  }

  setFps(text: string | null): void {
    this.fpsEl.textContent = text ?? '';
    this.fpsEl.style.display = text ? 'block' : 'none';
  }

  toast(text: string, color: '' | 'red' | 'green' = '', ms = 1300): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast show ${color}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.className = `toast ${color}`), ms);
  }

  private setupTouch(): void {
    const stick = this.touch.querySelector<HTMLDivElement>('.stick')!;
    const knob = this.touch.querySelector<HTMLDivElement>('.knob')!;
    const jump = this.touch.querySelector<HTMLDivElement>('.jumpbtn')!;
    let sx = 0;
    let sy = 0;
    let jx = 0;
    let jy = 0;
    let jumping = false;
    const send = () => this.h.onTouch(jx, jy, jumping);
    stick.addEventListener('pointerdown', (e) => {
      stick.setPointerCapture(e.pointerId);
      const r = stick.getBoundingClientRect();
      sx = r.left + r.width / 2;
      sy = r.top + r.height / 2;
    });
    stick.addEventListener('pointermove', (e) => {
      if (!stick.hasPointerCapture(e.pointerId)) return;
      const dx = Math.max(-60, Math.min(60, e.clientX - sx));
      const dy = Math.max(-60, Math.min(60, e.clientY - sy));
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      jx = dx / 60;
      jy = dy / 60;
      send();
    });
    const end = () => {
      knob.style.transform = '';
      jx = jy = 0;
      send();
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    jump.addEventListener('pointerdown', () => {
      jumping = true;
      send();
    });
    const jend = () => {
      jumping = false;
      send();
    };
    jump.addEventListener('pointerup', jend);
    jump.addEventListener('pointercancel', jend);
  }
}

export function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
