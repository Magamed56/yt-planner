# DEVELOPMENT STATE

> Living document. Every session must read this first and update it before committing.

## COMPLETED
- PHASE 0 — Technology selection: **Three.js + TypeScript + Vite** with a custom deterministic
  simulation core (see ARCHITECTURE.md → "Phase 0 decision").
- PHASE 1 — Project foundation: Vite/TS scaffold, engine core (seeded RNG, math, pool, fixed loop,
  typed EventBus + event catalogue), headless WebGL verified (SwiftShader), Vitest + Playwright setup.

- PHASE 2 — Player controller: AABB kinematic physics (grid broadphase, move&slide, step-up,
  platform carry, conveyor, crush detection), Player state machine (coyote time, jump buffer,
  variable jump), data-driven Character System (7 characters), ModelBuilder, CharacterView with
  procedural animation, RenderContext, LevelView (merged static geometry), keyboard/gamepad input.

- PHASE 3 — First enemy GRUMBO: deterministic brain (dormant/peek/chase/block/boss/grab/retreat),
  rubber-band chase with lunges (never catches a full-speed runner, catches anyone who stops),
  smashes breakable crates, theme costumes, EnemyView procedural animation + gauge-needle mood.

- PHASE 4 — Obstacle system: 7 deterministic hazard kinds (spinner, crusher, laser, faller,
  zone, boss slam, roller) with telegraphs, near-miss detection, bot prediction API; dynamic
  solids (moving, pingpong, triggered doors/pushers, cycle/step/trigger vanish, breakables);
  HazardViews for every kind; obstacle unit tests.

- PHASE 5 — Level generator: 19-module standard library (engine/level/modules), level grammar
  following the gameplay loop, beat planner (notable moment every 10–20 s), surprise system,
  turn planning without self-intersection, rollback on overlap, 5 difficulty presets (continuous
  1..5), LevelValidator (200 seeds clean), reproducibility tests.

- PHASE 6 — First complete level: App (menu with live 3D background, LEVELS grid, CHARACTERS
  shop, SETTINGS, HUD, toasts, PAUSE, level complete), SaveSystem (localStorage, migrations),
  decor registry (25 kinds, merged static), coins/checkpoint views, backdrop (sky dome,
  silhouettes, abyss), pooled particles + EffectsDirector, procedural SFX + adaptive music,
  CameraDirector (13 modes) + styles, GameSession/GameView, DebugOverlay (F3), 100-level
  campaign definition, Playwright smoke tests.

- PHASE 7 — Chase system: chase segments end with a blast-door slam at a checkpoint (Grumbo
  bonks + visible retreat), final escape before the finish (survives respawn), enemy footsteps
  (ENEMY_STEP → stomp SFX + camera shake + dust), heartbeat SFX, red danger vignette, HUD danger
  meter, grabbed player dangles from Grumbo's claw, chase music intensity; chase tests.

- PHASE 8 — Camera Director: 13 modes verified visually (docs/img/camera_gallery.png), relative
  smoothing (fast runner never outruns the camera), enemy-aware high follow, occlusion avoidance
  against level colliders, styles gameplay/cinematicPlay/video/shorts/classic, unit tests.

- PHASE 9 — Bot: hint-following controller (jumps with air control, lanes, rides on moving
  platforms, timing gates with jump-option search, door choices, boss/faller arenas), Predictor
  (1/60 s traversal + landing prediction against deterministic hazards/solids), profiles
  PERFECT/SKILLED/AVERAGE/CLUMSY/DAREDEVIL/CAUTIOUS (mistakeChance, reactionTime, riskLevel,
  aggression, speed), forced mistakes for FAIL takes, learning after deaths, respawn jitter.
  Campaign validation: PERFECT, SKILLED and AVERAGE each complete 100/100 levels
  (`npm run validate:levels -- 1 100 PERFECT`). Generator fixes found by the bot: A/B blinking
  platforms, spinner pads, chase-friendly jumps, always-on lasers as jump barriers, boss arena
  roller spawn, door-block fairness.

- PHASE 10 — Video Mode: VideoConfig schema + validation (videos/*.json), 7 scenarios
  (CHASE, NEAR_DEATH, PERFECT_RUN, FAIL, IMPOSSIBLE, BOSS_ESCAPE, CHAOS), 6 takes (PERFECT,
  ONE_FAIL, NEAR_DEATH, FAST_RUN, CHAOS, ENEMY_ALMOST_CATCHES), resolveVideo (clean-take search,
  automatic dramatic forced mistake), simulateTake (headless), VideoSession (bot + director +
  in-frame captions + scripted events), ?mode=video URL params, Video Studio (?mode=studio),
  12 title recipes, bot-driven attract mode behind the main menu.

- PHASE 11 — Shorts recording: `npm run record -- videos/video_001.json` → MP4 (H.264 1080×1920
  30 fps + AAC, loudness-normalised to −14 LUFS) + metadata JSON + SRT + thumbnail. Pipeline:
  in-process Vite → headless Chromium `?mode=record` → `EditRunner` steps the edit at exactly
  1/fps (never wall clock) → JPEG frames piped to ffmpeg; soundtrack synthesised afterwards from
  the recorded `AudioTimeline` with OfflineAudioContext in 30 s chunks (pre-roll joins chunks).
  Highlight finder (event-interest curve) + Shorts planner: best 25–40 s window, hook caption
  in the first second, climax/outro captions anchored to simulation time (slow-motion safe),
  cold open flash-forward with CHASE camera when Grumbo is involved, slow-motion instant replay
  when a level is too short, flash + whoosh on cuts, exact length fitted by headless measuring.
  Verified: video_001 renders to 28.9 s, 868 frames, hook→chase→finish→replay
  (docs/img/short_video_001.jpg). SwiftShader renders ~2.4 fps at 1080×1920; `--gpu` / `--scale`.
- PHASE 13 (core) — One game → many videos: `npm run plan:videos` writes video_002…025 (12
  recipes × levels × 7 characters) + long_05/10/15/20min configs + videos/INDEX.md; every Short
  is verified headlessly to deliver its title (CAUGHT ends on the catch, PERFECT RUN has 0
  deaths, BOSS shows the boss, FLOOR DISAPPEARED shows the collapse…) and to land in 25–40 s.
  Scripted mistakes reworked: 'caught' freezes on plain chase ground (Grumbo slows at gaps),
  late forced jumps override an earlier timing decision, lateJump only on static targets;
  edge landings emit PLAYER_NEAR_DEATH (cause 'edge').

- PHASE 14 — Themes: NORMAL (Sunny Factory), NIGHT (Night Shift), WINTER (Frozen Plant),
  CANDY (Candy Works), UNDERWATER (Sunken Factory), VOLCANO (Lava Foundry), SPACE (Orbital
  Plant), HALLOWEEN (Haunted Factory), CHRISTMAS (Toy Workshop) + FACTORY. Each changes palette,
  lighting, fog, particles (snow/embers/bubbles/stars/leaves/sparkles), music (scale, tempo,
  timbre + kit: soft/electro/jingle/tribal/spooky), 26 new themed decorations (game layer,
  merged static), Grumbo costume, falling-object look, lethal-zone look (new 'syrup'), module
  weights, special surfaces (ice in WINTER, one-boing jelly in CANDY) and physics (floaty
  UNDERWATER, low-gravity SPACE). Fairness rule: theme physics keep jump range ≤ +12 % and
  floaty themes get longer chase platforms (`ModuleContext.rangeScale`); Grumbo's speed scales
  with the environment. Backdrop silhouettes are kept clear of the whole (turning) track.
  Gallery: docs/img/themes.jpg.
- PHASE 15 — 100 levels: campaign test plays all 100 levels with the SKILLED bot in the unit
  suite (~8 s); validation: PERFECT/SKILLED/AVERAGE/CLUMSY/DAREDEVIL/CAUTIOUS 100/100 and all 7
  characters 100/100 (SKILLED). Bot fixes found by themed levels: ride exits now set an aim,
  air control projects from real velocity (no mid-air braking past the aim point), missed
  takeoff points recoverable, per-arena learning (boss clocks restart each attempt), aggressive
  bots may hold back in arenas; zigzag bridge spine follows the planks.

- PHASE 12 — Long videos: `npm run record -- videos/long_05min.json` (or `--long N --start L`)
  renders a 1920×1080 compilation: cold open (most intense moment of all chapters, CHASE/
  DRAMATIC camera, slow-mo, hook), one chapter per level with a rotating scenario program
  (Chase · Near Death · Speedrun · Fail & Retry · Almost Caught · Chaos, boss levels as
  set-pieces), level title cards, fail captions, long-run trimming, outro teaser, exact length
  fit (±3 %), YouTube chapters in the description. Verified: 5-min video = 291.1 s, 8 733
  frames, 10 chapters, −14 LUFS audio (docs/img/long_05min.jpg). Draft scale (0.5) renders
  ~5 fps on SwiftShader (5 min ≈ 30 min).
- PHASE 16 — Optimisation: model parts baked per animated joint with vertex colours (Grumbo
  42→21 meshes, Pip 22→17), rigid animated groups merged (spinner arms, crusher heads, gears
  ~16→2, exit gate), door/pusher stripes merged; level 15 view 217→172 meshes. Leak fixes:
  level-scoped geometry cache (unique platform sizes no longer accumulate), `disposeUnshared`
  sweep for ad-hoc geometry, Character/EnemyView dispose merged geometry. e2e perf test:
  reloading 4 levels twice keeps GPU geometries flat, textures bounded, draw calls < 300.
  `tools/perf-probe.ts` prints per-view mesh/draw stats.

- PHASE 17 — Final QA + docs: README, ARCHITECTURE (Phase 0 decision, layers, systems map,
  determinism, pipeline, how to build ESCAPE SCHOOL), GAME_DESIGN, LEVEL_GENERATOR,
  VIDEO_SYSTEM, TESTING, KNOWN_ISSUES. Production build verified (three.js split into its own
  chunk), `?debug` flag, 123 unit + 6 e2e tests green, bot 100/100 for all profiles and
  characters, sample Short + 5-min long video rendered and inspected.

- PHASE 18.1 — Camera collision + video framing (fix on top of the existing director):
  - Found (validator over 100 levels × CHASE short/long, ~355k frames, old code): camera inside
    geometry 4698 frames, below floor 106, beyond a ceiling 1407, player out of frame 9.2 %,
    Grumbo out of frame in CHASE/WIDE 8.6 %, 7571 uncut jumps > 1.2 m (max 52.7 m). Causes:
    the old render-only occlusion snap (teleports, ignored decor/enemy/crusher housings, no
    near-plane clearance, absent headless so planning saw other shots), falling player dragged
    the camera under the course, framing ignored a chasing-but-not-yet-visible Grumbo,
    whip blends (TOP→LOW) animated through walls, balconies/props generated inside the track
    of a later turning module (130 of 6016 decor pieces).
  - Fixed: `camera/CameraObstacles` (colliders + decor bounds + crusher housings/heads +
    enemy body, walkable/solid/moving kinds), `camera/CameraCollision` (raise over / pull in
    with 0.35 m clearance, smoothed in 0.1 s / out 0.45 s, speed-capped; big pull-ins and
    blocked shots become director cuts to a clearance-tested fallback shot; never inside,
    never behind a surface, never below the floor, min arm 0.9 m), `camera/framing`
    (runner + chaser solver: re-aim, widen, dolly; runner has priority), director fixes
    (floor clamp to the track, whip blends > 6–9 m become cuts, cut on respawn, portrait WIDE
    along the track, FOLLOW/BACK/LOW blend to high follow when Grumbo is close behind),
    `level/decorBounds` + `clearDecorFromPath` in the generator. Collision runs in
    `GameSession.renderOnly`, so headless planning, audits and the rendered video agree.
  - Verified: `camera/CameraQuality` validator + `npm run audit:camera`; same audit after:
    inside 0, below floor 0, beyond ceiling 3 frames, occluded 3.6 → 1.7 %, player out
    0.01 %, Grumbo out 0.02 %, jumps 96 (max 3.4 m). 15 levels × 8 scenario/format variants
    (~232k frames): inside 2, below 0, ceiling 3, player out 0.04 %, Grumbo out 0.05 %.
    Browser renders through EditRunner (`tools/camera-shots.ts`), off vs on:
    docs/img/camera_collision.jpg (long L55 BACK pillar + DRAMATIC inside a wall, L88 CHASE
    behind a wall; Shorts 9:16 L30 IMPOSSIBLE ×2, L12 CHASE unchanged).
    133 unit + 6 e2e green, build OK, bots SKILLED/PERFECT/CAUTIOUS 100/100, the 24 planned
    Shorts still deliver their titles.

## CURRENT
- v1 complete — phases 0–17 + 18.1 (camera collision) done. Next work comes from the backlog below.

## NEXT
- TTS voice-over step for `voice.lines` (e.g. a local TTS → mixed into the AudioTimeline).
- "Best moments" supercut planner for long videos (cross-level highlights).
- Bundle the caption font locally (container blocks Google Fonts).
- Second sibling game (ESCAPE SCHOOL) as a content pack to prove the framework split.

## BUGS
- Camera: 1–2 frames per crusher transit can still sit inside a crusher column/beyond its
  housing while the director cuts away (3 frames in 355k); occlusion by thin props ~1.7 %.
- Google Fonts blocked in the cloud container (falls back to Arial Black) — fine for users.
- Voice lines (config.voice) are exported to metadata only — no TTS in the pipeline yet.

## TODO
- Square-format (1:1) director style; distinct replay moment vs. cold open for very short levels.
- Touch controls tuning for small phones; NIGHT theme exposure in wide shots.
- Optional distance-based splitting of merged static geometry (better culling on huge levels).

## ARCHITECTURE_DECISIONS
- ADR-001: Three.js/TS over Godot/Unity/Unreal (AI-friendly text code, headless tests in Node,
  Playwright+ffmpeg deterministic recording, Web+PC, free/MIT).
- ADR-002: Simulation is pure TypeScript with no Three.js imports; rendering is a read-only view.
- ADR-003: Fixed 60 Hz timestep + seeded RNG streams ⇒ seed + config reproduces a run exactly.
- ADR-004: The game lives in `escape-factory/` inside the yt-planner repo (self-contained, own
  package.json) and can be split out with `git subtree split -P escape-factory`.
- ADR-005: Videos are *edits* of deterministic takes: a segment is (config, sim time range);
  the runner fast-forwards unrendered to the cut point, so any moment of any take can be
  filmed again exactly, and planning/measuring runs headless in Node.
- ADR-006: Recording renders frames in the browser but encodes in Node/ffmpeg; audio is
  synthesised offline from an event timeline (no realtime capture, no drift).
- ADR-007: Themes may change physics only within the jump-range fairness budget (≤ +12 %);
  generator compensates floatiness via `rangeScale`. Keeps one generator valid for all themes.
- ADR-008: Camera collision is a separate layer after the director (ideal pose → safe pose),
  part of the simulation-side session (no Three.js), so headless planning sees the real shot.
  When a shot can't be kept without a whip or a teleport, the director cuts instead.
