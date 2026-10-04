# Architecture

## Phase 0 decision — technology

**Choice: Three.js + TypeScript + Vite, with a custom deterministic simulation core.**

| Candidate | Verdict |
|---|---|
| **Three.js / TS** ✅ | Text-only codebase (ideal for AI-driven development and review), runs in any browser and as a PC app (wrap later with Electron/Tauri), Node can run the *same* simulation headless for tests, bots and video planning, Playwright + ffmpeg give frame-exact recording in CI/cloud containers, MIT licence, tiny builds. |
| Babylon.js | Equally capable; heavier and more opinionated. Three.js has a larger ecosystem and finer control over draw calls. |
| Godot 4 | Great editor and physics, but scenes/resources are less friendly to fully code-driven generation, headless rendering + capture in containers is harder, web export is heavier. |
| Unity | Strong tooling, but licensing, binary assets, slow iteration without an editor and heavy cloud rendering. |
| Unreal | Overkill for stylised visuals; huge builds; poor fit for automated headless video rendering. |

Consequences (ADR-001…004 in DEVELOPMENT_STATE.md): the simulation is pure TypeScript with no
Three.js imports; rendering is a read-only view; a fixed 60 Hz step plus seeded RNG streams
mean **config + seed reproduces a run exactly** — the foundation of the whole video system.

## Layers

```
┌───────────────────────────── src/game  (ESCAPE FACTORY content pack) ─────────────────────────────┐
│ characters/roster · enemies/grumbo · themes/* (+ themed decor) · campaign · recipes · App/UI ·     │
│ video/ (VideoApp, Studio, RecordMode, series, longPlan, configs)                                   │
└──────────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                               │ registers data into engine registries
┌──────────────────────────────── src/engine  (EscapeKit — reusable) ───────────────────────────────┐
│ core      rng (sfc32 streams), math, Pool, FixedLoop, GameSession                                  │
│ events    GameEvents catalogue + typed EventBus (log, onAny)                                        │
│ level     types, Track (spine), LevelBuilder, ModuleRegistry, modules/*, LevelGenerator, Validator │
│ physics   AABB grid broadphase, KinematicBody (move & slide, step-up, carry, crush)                │
│ obstacle  hazard specs + pure time functions, HazardSystem, SolidSystem (moving/vanishing solids)  │
│ sim       World (step order, deaths, respawn), Player, TriggerSystem                               │
│ character CharacterDef/Registry, ModelSpec (data-driven models)                                    │
│ enemy     EnemyDef/Registry, Enemy brain (peek/chase/block/boss/grab/retreat)                      │
│ input     keyboard/gamepad/touch, ProxyInput (bot)                                                 │
│ bot       Predictor, BotProfile, BotController                                                     │
│ camera    CameraDirector (13 modes) + styles (event→shot rules)                                    │
│ render    RenderContext, GameView, LevelView, Character/EnemyView, HazardViews, PropViews, decor,  │
│           Backdrop, Particles, EffectsDirector, CaptionLayer, ModelBuilder (+ merging), merge      │
│ audio     Synth (procedural SFX), MusicEngine (adaptive), AudioSystem, AudioTimeline (offline)     │
│ video     VideoConfig, Scenarios/Takes, VideoSession, Highlights, ShortsPlanner, LongPlanner,      │
│           Edit/EditRunner, plans                                                                   │
│ theme     ThemeDef/Registry          save   SaveSystem          debug   DebugOverlay               │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Requested systems → modules

| System | Where |
|---|---|
| GameCore | `core/GameSession`, `core/FixedLoop`, `sim/World` |
| LevelSystem | `level/*` (generator, modules, track, validator) |
| PhysicsSystem | `physics/*` |
| CharacterSystem | `character/*`, `render/CharacterView`, `game/characters/roster` |
| EnemySystem | `enemy/*`, `render/EnemyView`, `game/enemies/grumbo` |
| ObstacleSystem | `obstacle/*`, `render/HazardViews` |
| CameraSystem | `camera/*` |
| EventSystem | `events/*` |
| BotSystem | `bot/*` |
| VideoDirector | `video/Highlights`, `video/ShortsPlanner`, `video/LongPlanner`, `video/plans`, `game/video/series` |
| RecordingSystem | `video/Edit` (EditRunner), `audio/AudioTimeline`, `game/video/RecordMode`, `tools/record.ts` |
| AudioSystem | `audio/*` |
| ThemeSystem | `theme/*`, `game/themes/*` |
| SaveSystem | `save/SaveSystem` |

## Determinism

- **One clock**: `World.step()` advances exactly 1/60 s. Rendering interpolates between the
  previous and current state (`alpha`) and never writes simulation state.
- **RNG streams**: `Rng(seed).fork(label)` gives independent streams (generator, enemy, chaos,
  bot), so adding randomness in one system never shifts another.
- **Hazards are pure functions of (local) time** — `crusherState(h, t)`, `laserState(h, t)` —
  so the bot's `Predictor` can look ahead exactly, and triggered hazards (`triggerId`,
  `endTriggerId`) start/stop on trigger times.
- **Camera director** uses its own LCG, so shots are reproducible too.
- Slow motion only changes how much simulation time a video frame covers; the sequence of
  simulation steps (and so the take) is identical.

## Events

`events/GameEvents.ts` is the backbone: gameplay emits typed events (`PLAYER_JUMP`,
`ENEMY_NEAR`, `DOOR_CLOSE`, `BOSS_START`, `FINAL_ESCAPE`, `PLAYER_FINISH`…). Consumers:

- **CameraDirector** — style rules map events to shots (with priority, hold, cooldown, slow-mo).
- **AudioSystem** — `EVENT_SFX` table (spatialised), music intensity from world state.
- **EffectsDirector** — particles, shake, flashes, lighting moods.
- **Highlights** — `EVENT_INTEREST` weights → interest curve → best windows/moments.
- **EditRunner / AudioTimeline** — exact video-time event log for soundtrack + metadata.
- **Bot** — reacts to respawns/learning.

## Rendering

- Static level geometry is merged per material (chunks of 64 for culling); themed decor is
  merged into it.
- Character/enemy models are data (`ModelSpec`) built by `ModelBuilder`; unnamed parts are
  baked per animated joint with **vertex colours** (one draw per surface type per joint).
- Rigid animated groups (spinner arms, crusher heads, gears) are merged with `mergeRigid`.
- Particles use `InstancedMesh` pools; coins are one `InstancedMesh`.
- Geometry cache with **level scopes**: sized primitives created while a level view is built
  are evicted when it is disposed; `disposeUnshared` sweeps ad-hoc geometry — reloading levels
  keeps GPU memory flat (verified by `tests/e2e/perf.spec.ts`).
- Captions are drawn *inside* the WebGL frame (camera-attached canvas texture) so recordings
  contain them.

## Video pipeline

```
VideoConfig ─resolveVideo→ ResolvedVideo (level, character, bot profile, enemy tuning, takeSeed)
     │                          │
     │                 simulateTake (headless) → event log
     │                          │
     └──► planner (Shorts: planShortEdit · Long: planLong) → EditPlan { segments[(source, from, to,
                                                              captions, camera, slowmo)] }
                                 │ measureEdit (headless, exact frame count)
                                 ▼
browser ?mode=record: EditRunner.step() × N  (fast-forward to each cut, render at 1/fps)
     │ JPEG frames                          │ AudioTimeline (events in video time)
     ▼                                      ▼
tools/record.ts → ffmpeg H.264       OfflineAudioContext (30 s chunks) → PCM → AAC (−14 LUFS)
     └────────────────────── mux → MP4 + metadata JSON + SRT + thumbnail
```

## Making ESCAPE SCHOOL (or any sibling game)

1. Create `src/game-school/` with a content pack like `src/game/content.ts`:
   characters (`CharacterDef` data), an enemy (`EnemyDef` + model data), themes (`ThemeDef`).
2. Optional: register new modules (`ModuleDef`) — e.g. CLASSROOM, LOCKERS — into a
   `ModuleRegistry` and pass it via `generateLevel({ modules })`.
3. Optional: new hazards/decor via `decorRegistry.register()` and a `LevelViewExtension`.
4. Campaign + recipes are plain data files. The bot, camera director, recorder, planners and
   tests work unchanged.

Nothing in `src/engine` imports from `src/game`.
