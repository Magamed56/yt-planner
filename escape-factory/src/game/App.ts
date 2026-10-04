/**
 * ESCAPE FACTORY browser application: menus, play loop, save integration.
 * VIDEO / RECORD / STUDIO modes are routed from main.ts (see video/).
 */
import { AudioSystem } from '@engine/audio/AudioSystem';
import { CINEMATIC_PLAY_STYLE, GAMEPLAY_STYLE, VIDEO_STYLE } from '@engine/camera/styles';
import { characters } from '@engine/character/CharacterRegistry';
import { GameSession } from '@engine/core/GameSession';
import { enemies } from '@engine/enemy/EnemyDef';
import type { InputSource } from '@engine/input/InputState';
import { KeyboardInput } from '@engine/input/KeyboardInput';
import { generateLevel } from '@engine/level/LevelGenerator';
import type { LevelData } from '@engine/level/types';
import { MaterialLibrary } from '@engine/render/materials';
import { RenderContext } from '@engine/render/RenderContext';
import { SaveSystem, type GameSettings } from '@engine/save/SaveSystem';
import { themes } from '@engine/theme/ThemeDef';
import type { DirectorStyle } from '@engine/camera/CameraDirector';
import { allCampaignLevels, campaignLevel, campaignParams, CAMPAIGN_SIZE } from './campaign';
import { registerContent } from './content';
import { UI } from './ui/UI';
import { DebugOverlay } from '@engine/debug/DebugOverlay';
import { ProxyInput } from '@engine/input/ProxyInput';
import { BotController } from '@engine/bot/BotController';
import { BOT_PROFILES } from '@engine/bot/BotProfile';

type AppState = 'menu' | 'play' | 'paused' | 'complete';


export class App {
  readonly rc: RenderContext;
  readonly mats = new MaterialLibrary();
  readonly save: SaveSystem;
  readonly ui: UI;
  readonly keyboard: KeyboardInput;
  readonly debug: DebugOverlay;
  session: GameSession | null = null;
  private state: AppState = 'menu';
  private levelNo = 1;
  private audioCtx: AudioContext | null = null;
  private audio: AudioSystem | null = null;
  private last = performance.now();
  private finishTimer = -1;
  private readonly offs: Array<() => void> = [];
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(parent: HTMLElement) {
    registerContent();
    this.save = new SaveSystem(undefined, undefined, { character: characters.defaultCharacter });
    this.rc = new RenderContext({ parent, quality: this.save.data.settings.quality });
    this.keyboard = new KeyboardInput();
    this.keyboard.cameraYaw = () => this.session?.heading ?? 0;
    this.debug = new DebugOverlay(parent);
    if (new URLSearchParams(location.search).has('debug')) this.debug.setVisible(true);
    this.ui = new UI(parent, {
      onPlay: () => this.play(Math.min(CAMPAIGN_SIZE, this.save.highestUnlocked)),
      onLevel: (n) => this.play(n),
      onRestart: () => this.play(this.levelNo),
      onResume: () => this.resume(),
      onPause: () => this.pause(),
      onMenu: () => this.menu(),
      onNext: () => this.play(Math.min(CAMPAIGN_SIZE, this.levelNo + 1)),
      onSelectCharacter: (id) => this.selectCharacter(id),
      onSettings: (s) => this.applySettings(s),
      onResetSave: () => {
        this.save.reset();
        this.menu();
      },
      onStudio: () => {
        location.search = '?mode=studio';
      },
      onTouch: (x, y, j) => this.keyboard.setTouch(x, y, j),
    });
    this.ui.levelsCb = () => this.ui.showLevels(allCampaignLevels(), this.save.data, (n) => this.save.isLevelUnlocked(n));
    this.ui.charsCb = () => this.ui.showCharacters(characters.list(), this.save.data);
    this.ui.settingsCb = () => this.ui.showSettings(this.save.data.settings);
    this.ui.pauseCb = () => this.ui.showPause(campaignLevel(this.levelNo).title);
    window.addEventListener('keydown', (e) => this.onKey(e));
    const unlock = () => this.ensureAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  start(): void {
    this.menu();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- sessions -------------------------------------------------------------

  private makeSession(level: LevelData, input: InputSource, style: DirectorStyle, withAudio: boolean): GameSession {
    this.session?.dispose();
    for (const o of this.offs.splice(0)) o();
    const theme = themes.get(level.theme);
    const enemy = level.enemy === 'none' ? null : enemies.get(level.enemy);
    const character = characters.get(this.save.data.selectedCharacter);
    const s = new GameSession({
      level,
      character,
      enemy,
      theme,
      input,
      style,
      rc: this.rc,
      mats: this.mats,
      audio: withAudio ? this.audio : null,
    });
    s.view?.effects && (s.view.effects.shakeEnabled = this.save.data.settings.shake);
    if (withAudio && this.audio) this.audio.startMusic(theme.music, level.seed);
    this.session = s;
    return s;
  }

  menu(): void {
    this.state = 'menu';
    this.finishTimer = -1;
    // attract mode: the bot plays a level behind the menu with cinematic cameras
    const lvl = generateLevel(campaignParams(Math.min(this.save.highestUnlocked, CAMPAIGN_SIZE)));
    const proxy = new ProxyInput();
    const s = this.makeSession(lvl, proxy, VIDEO_STYLE, false);
    proxy.target = new BotController(s.world, BOT_PROFILES.SKILLED, lvl.seed);
    this.ui.showMenu(this.save.data);
  }

  play(n: number): void {
    if (!this.save.isLevelUnlocked(n)) return;
    this.ensureAudio();
    this.levelNo = n;
    const c = campaignLevel(n);
    const level = generateLevel(campaignParams(n));
    const style = this.save.data.settings.cinematicCamera ? CINEMATIC_PLAY_STYLE : GAMEPLAY_STYLE;
    const s = this.makeSession(level, this.keyboard, style, true);
    this.state = 'play';
    this.finishTimer = -1;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.ui.showHUD(`LEVEL ${n} · ${c.title}`, `${c.theme} · ${level.difficultyName}${c.boss ? ' · BOSS' : ''}`, touch);
    const ev = s.world.events;
    this.offs.push(
      ev.on('CHASE_START', () => this.ui.toast('RUN!', 'red')),
      ev.on('CHASE_END', () => this.ui.toast('ESCAPED!', 'green')),
      ev.on('CHECKPOINT_REACHED', () => this.ui.toast('CHECKPOINT!', 'green', 900)),
      ev.on('BOSS_START', () => this.ui.toast('BOSS FIGHT!', 'red')),
      ev.on('BOSS_END', () => this.ui.toast('HE FELL!', 'green')),
      ev.on('FINAL_ESCAPE', () => this.ui.toast('FINAL ESCAPE!', 'red')),
      ev.on('ENEMY_BLOCK', () => this.ui.toast('NOT THAT WAY!', 'red', 900)),
      ev.on('FLOOR_COLLAPSE', () => this.ui.toast('THE FLOOR!', 'red', 900)),
      ev.on('PLAYER_FAIL', (e) => {
        const msg: Record<string, string> = { caught: 'CAUGHT!', fell: 'WHOOPS!', crushed: 'SQUASHED!', zapped: 'ZAPPED!', squashed: 'BONK!', hit: 'OUCH!' };
        this.ui.toast(msg[e.payload.reason] ?? 'OUCH!', 'red', 1100);
      }),
      ev.on('PLAYER_FINISH', () => {
        this.ui.toast('YOU ESCAPED!', 'green', 1800);
        this.finishTimer = 2.4;
      }),
    );
  }

  private completeLevel(): void {
    const s = this.session!;
    const w = s.world;
    const out = this.save.recordRun({ level: this.levelNo, time: w.finishTime, deaths: w.deaths, coins: w.coins, completed: true, caught: w.enemy?.catches ?? 0 });
    const c = campaignLevel(Math.min(CAMPAIGN_SIZE, this.levelNo + 1));
    if (this.levelNo < CAMPAIGN_SIZE) this.save.unlockTheme(c.theme);
    this.state = 'complete';
    this.ui.showComplete({
      title: campaignLevel(this.levelNo).title,
      time: w.finishTime,
      deaths: w.deaths,
      coins: w.coins,
      best: out.newBest,
      earned: out.coinsEarned,
      hasNext: this.levelNo < CAMPAIGN_SIZE,
    });
  }

  pause(): void {
    if (this.state !== 'play' || !this.session) return;
    this.state = 'paused';
    this.session.paused = true;
    this.ui.showPause(campaignLevel(this.levelNo).title);
  }

  resume(): void {
    if (this.state !== 'paused' || !this.session) return;
    this.state = 'play';
    this.session.paused = false;
    this.ui.hideScreens();
  }

  private selectCharacter(id: string): void {
    const def = characters.get(id);
    if (!this.save.data.unlockedCharacters.includes(id)) {
      if (!this.save.unlockCharacter(id, def.unlockCost)) {
        this.ui.toast('NOT ENOUGH COINS', 'red', 900);
        return;
      }
    }
    this.save.selectCharacter(id);
    this.session?.view?.charView.setCharacter(def);
    this.ui.showCharacters(characters.list(), this.save.data);
  }

  private applySettings(s: Partial<GameSettings>): void {
    this.save.updateSettings(s);
    const st = this.save.data.settings;
    this.audio?.setVolumes(st.master, st.music, st.sfx);
    if (this.session?.view) this.session.view.effects.shakeEnabled = st.shake;
    if (s.quality) {
      this.rc.quality = st.quality;
      this.rc.renderer.shadowMap.enabled = st.quality !== 'low';
      this.rc.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, st.quality === 'high' ? 2 : st.quality === 'medium' ? 1.25 : 1));
      this.rc.resize();
    }
    if (s.showFps !== undefined) this.debug.setVisible(st.showFps);
  }

  private ensureAudio(): void {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
      return;
    }
    try {
      this.audioCtx = new AudioContext();
      this.audio = new AudioSystem(this.audioCtx);
      const st = this.save.data.settings;
      this.audio.setVolumes(st.master, st.music, st.sfx);
    } catch {
      this.audioCtx = null;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'play') this.pause();
      else if (this.state === 'paused') this.resume();
    } else if (e.code === 'KeyR' && this.state === 'play') this.play(this.levelNo);
    else if (e.code === 'F3') {
      e.preventDefault();
      this.debug.toggle();
    }
  }

  private tick(dt: number): void {
    const s = this.session;
    if (!s) return;
    s.frame(dt);
    if (this.state === 'menu' && s.world.status === 'finished' && s.world.time - s.world.finishTime > 4) this.menu();
    if (this.state === 'play' || this.state === 'paused') {
      const w = s.world;
      this.ui.updateHUD(w.status === 'finished' ? w.finishTime : w.time, w.deaths, w.coins);
      const gap = w.enemy?.gapTo(w.playerS) ?? Infinity;
      this.ui.setDanger(Number.isFinite(gap) && w.player.isAlive ? 1 - Math.min(1, Math.max(0, (gap - 1.3) / 12)) : null);
      if (this.finishTimer > 0) {
        this.finishTimer -= dt;
        if (this.finishTimer <= 0) this.completeLevel();
      }
    }
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.debug.update(s, this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }
}
