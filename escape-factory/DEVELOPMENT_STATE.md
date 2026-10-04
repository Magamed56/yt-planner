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

## CURRENT
- PHASE 6 — First complete level: app shell, menus, HUD, save system, props/decor/backdrop,
  particles, audio.

## NEXT
- PHASE 3 enemy → 4 obstacles → 5 level generator → 6 first level → 7 chase → 8 camera director →
  9 bot → 10 video mode → 11 shorts → 12 long video → 13 scenarios → 14 themes → 15 100 levels →
  16 optimisation → 17 QA.

## BUGS
- none known

## TODO
- see NEXT

## ARCHITECTURE_DECISIONS
- ADR-001: Three.js/TS over Godot/Unity/Unreal (AI-friendly text code, headless tests in Node,
  Playwright+ffmpeg deterministic recording, Web+PC, free/MIT).
- ADR-002: Simulation is pure TypeScript with no Three.js imports; rendering is a read-only view.
- ADR-003: Fixed 60 Hz timestep + seeded RNG streams ⇒ seed + config reproduces a run exactly.
- ADR-004: The game lives in `escape-factory/` inside the yt-planner repo (self-contained, own
  package.json) and can be split out with `git subtree split -P escape-factory`.
