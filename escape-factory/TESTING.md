# Testing

```bash
npm run typecheck          # TypeScript strict (noUnused*, exactness)
npm test                   # 133 unit tests, ~25 s (headless simulation in Node)
npm run test:e2e           # 6 browser tests, ~1 min (real WebGL via Chromium/SwiftShader)
npm run validate:levels -- 1 100 SKILLED [character]   # bot campaign report
npm run audit:camera -- [1-100] [--all]                # camera quality over video takes
```

Every phase was committed only with typecheck + unit + e2e green.

## Unit tests (`tests/unit`, Vitest)

| File | Tests | Covers |
|---|---|---|
| core.test.ts | 15 | RNG streams/determinism, math, pool, fixed loop, event bus |
| physics.test.ts | 13 | move & slide, step-up, platform carry, conveyors, crush, falling, broadphase |
| obstacles.test.ts | 14 | every hazard's time function, triggers/end triggers, near-miss, dynamic solids, vanish cycles |
| enemy.test.ts | 9 | states, rubber band never catches a full-speed runner, catches stoppers, block, boss, retreat |
| chase.test.ts | 5 | chase start/end, blast-door retreat, final escape survives respawn |
| generator.test.ts | 10 | seed reproducibility, params, 200 seeds validate, all modules used, beat every ~20 s, < 40 ms |
| campaign.test.ts | 3 | 100 distinct valid reproducible levels; **SKILLED bot finishes all 100**; difficulty ramp |
| themes.test.ts | 6 | 10 themes registered, decor builders exist, physics fairness budget, costumes, themed generation |
| bot.test.ts | 9 | profiles, jumps, rides, gates, both blinking variants, reaction time, forced mistakes |
| camera.test.ts | 10 | 13 modes, event → shot rules, priority/hold/cooldown, slow-mo, smoothing, far blends become cuts, portrait |
| camera-collision.test.ts | 10 | validator; walls/floor/roof per mode (never inside, below floor, beyond ceiling, occluded); smooth pull-in/release; CHASE/WIDE keep runner + chaser framed (16:9, 9:16); real take audits (6 levels/scenarios); generated decor stays off the track |
| video.test.ts | 12 | config validation (all bundled configs), scenarios, takes, determinism, clean/fail takes |
| recording.test.ts | 11 | interest curve, best window, cold-open camera, Shorts plan, frame-exact edits, audio timeline, long plan, **series delivers every title** |
| audio.test.ts | 2 | music never scheduled before t=0 (offline chunks), every theme kit |
| save.test.ts | 4 | defaults + persistence, best times & no coin farming, sequential unlocks & character purchases, migrations & corrupt data |

## Browser tests (`tests/e2e`, Playwright)

| Test | Checks |
|---|---|
| smoke: menu boots | non-blank 3D render, UI present |
| smoke: level 1 playable | keyboard input moves the player, pause/resume |
| video mode | no UI, portrait aspect, bot advances |
| studio | builds a config, preview |
| record mode | init plan (25–40 s, exact frame count), JPEG frames, frames differ, soundtrack chunks (incl. mid-video), captions metadata |
| perf | reloading 4 levels three times: GPU geometries flat (round 3 vs 2), textures bounded, draw calls < 300 |

The Playwright config starts its own Vite server (port 5179) and uses the preinstalled
Chromium with SwiftShader flags (`tools/browser.ts`); set `PW_CHROMIUM_PATH` to override.

## Bot validation

`validate:levels` plays campaign levels headlessly (seconds for 100 levels) and prints, per
level: OK/FAIL, theme, difficulty, modules, time, deaths (+ last cause), progress, where it
stopped, jumps/waits/stuck counters. Exit code 1 on any failure.

Current results (all 100 levels): PERFECT, SKILLED, AVERAGE, CLUMSY, DAREDEVIL, CAUTIOUS →
100/100; every character (pip, robot, cat, toy, cookie, pumpkin, alien) with SKILLED → 100/100.

`tools/trace-bot.ts <level> [profile] [seconds]` (env `CHAR=`) prints a frame trace around
deaths — the main tool behind the bot/generator fixes listed in DEVELOPMENT_STATE.md.

Timing in the e2e tests waits for simulated time (`waitForFunction`), not wall time, so slow
software WebGL doesn't fail them.

## Camera quality

`camera/CameraQuality.ts` checks every frame of a take (headless): camera inside geometry,
below the floor, beyond a ceiling, occluded, too close, player outside the frame, Grumbo
outside the frame in CHASE/WIDE, and uncut camera jumps. `npm run audit:camera` prints it per
take (default 11 levels × CHASE short/long; `1-100`, `--all` = 8 scenario/format variants,
`--raw` = director pose without collision, for comparison). Exit 1 on hard errors.

`tools/camera-shots.ts out.png "level:format:scenario:take:simTime" …` (dev server on :5173)
renders the same moments with collision off and on through the real `EditRunner`
(docs/img/camera_collision.jpg).

## Visual checks

- `tools/screenshot.ts <url> <out.png> [w h waitMs]` — screenshot any mode.
- `tools/camera-gallery.ts` — renders all 13 camera modes into `out/camera_gallery.png`.
- `tools/playtest.ts` — holds keys and screenshots every second.
- Rendered videos are checked with `ffprobe` (streams, frame count, duration), `volumedetect`
  (loudness) and frame grids (`docs/img/short_video_001.jpg`, `docs/img/long_05min.jpg`).

## Debug & performance

- **F3** (or `?debug`) in the game: FPS, frame time, draw calls, triangles, objects,
  geometries/textures, physics bodies (static/kinematic), hazards, particles, JS memory,
  level generation time, current module, camera mode, enemy state/gap, sim time.
- `tools/perf-probe.ts <level>` — renders a level in video mode on the dev server and prints
  draw calls, triangles, GPU resources and meshes per view (level / character / enemy).
