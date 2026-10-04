# DEVELOPMENT STATE

> Living document. Every session must read this first and update it before committing.

## COMPLETED
- PHASE 0 — Technology selection: **Three.js + TypeScript + Vite** with a custom deterministic
  simulation core (see ARCHITECTURE.md → "Phase 0 decision").
- PHASE 1 — Project foundation: Vite/TS scaffold, engine core (seeded RNG, math, pool, fixed loop,
  typed EventBus + event catalogue), headless WebGL verified (SwiftShader), Vitest + Playwright setup.

## CURRENT
- PHASE 2 — Player controller (kinematic physics + character system).

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
