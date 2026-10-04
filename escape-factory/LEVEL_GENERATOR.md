# Level Generator

```ts
generateLevel({
  seed: 1001,            // same seed + same params → the same level, byte for byte
  difficulty: 2,         // 1..5 or 'EASY' | 'NORMAL' | 'HARD' | 'INSANE' | 'IMPOSSIBLE'
  length?: 14,           // number of modules (default from difficulty)
  theme?: 'FACTORY',     // decor, module weights, special surfaces, physics budget
  enemy?: 'grumbo',      // 'none' → no chases / peeks
  specialEvents?: ['boss', 'more:CRUSHER', 'floorCollapse'],
  modules?: registry,    // custom ModuleRegistry (other games)
}) → LevelData
```

Examples: `seed 1001, difficulty 1` (EASY), `seed 1002, difficulty 2` (NORMAL),
`seed 2001, difficulty 5` (IMPOSSIBLE). The campaign uses `seed = 1000 + level`.

`LevelData` is plain JSON-serialisable data: modules, pieces (solids, hazards, triggers,
checkpoints, coins, decor, finish), the **spine** (centre line with cumulative distance `s`),
**nav hints** for the bot, spawn and stats (estimated duration, counts, generation time).
The simulation, the renderer and the bot all read the same data.

## Pipeline

1. **Grammar plan.** `START`, then a body following the gameplay loop — roles cycle
   `explore → obstacle → danger → explore → obstacle → danger → explore → danger → obstacle` —
   then the tail: (`BOSS`) → final-escape flow module → `FINISH`. Chase set-pieces are placed
   at 30–80 % of the body as `CHASE → flow(inChase) → CHECKPOINT(endsChase)`; extra
   checkpoints every N modules (difficulty).
2. **Module assignment.** For each role slot a module type is drawn from the registry with
   weights × theme `moduleWeights` × `more:<TYPE>` (×3); never the same type twice in a row,
   never more than two danger modules in a row, TURNs preferred in explore slots.
3. **Beat planner.** Walks the estimated timeline and plants a *surprise* every 10–20 s
   (scaled by `surpriseRate`): `enemyPeek, lightsFlicker, alarm, floorCollapse, wallSlam,
   debris, enemyRoar, steamBurst`. Passing surprise names in `specialEvents` restricts the pool.
4. **Build.** Each module generates geometry in *local coordinates* (lx right, ly up, lz
   forward) through a `LevelBuilder` that maps them to the module frame. Headings are 90°
   steps (+Z, +X, −X; never −Z) so a level can't run into itself; turns alternate safely.
5. **Overlap rollback.** A module whose footprint intersects earlier geometry is rolled back
   and regenerated with another variant/type.
6. **Finalize + validate.** Checkpoints, spawn, stats; `validateLevel()` checks spine
   continuity, gaps ≤ 5.4 m (jumpable), walkable landings for every jump hint, checkpoint
   order, finish reachability, footprint overlap.

Generation takes ~2–10 ms per level.

## Modules

| Module | Variants / notes |
|---|---|
| START | spawn pad, Grumbo peek hook in the distance |
| STRAIGHT | catwalk, coins, breakable crates, collapsing tiles behind you |
| TURN | left/right arc |
| JUMP | 1–4 gaps, steps up/down; in chases platforms ≥ 4.6 m (× theme `rangeScale`), no drops |
| MOVING_PLATFORM | sway, shuttle, elevator |
| DISAPPEARING_PLATFORM | step-to-vanish tiles or A/B rhythm (blink cycles with fair windows) |
| SPINNER | 2–4 arm spinners, padded so two never overlap |
| CRUSHER | timed crusher gates with floor shadows and warning lamps |
| LASER | blinking gates, always-on low beams (jump them), sweeping beams |
| FALLING_OBJECT | arena with telegraphed fallers (crates, snowballs, presents, meteors…) |
| NARROW_BRIDGE | straight or zig-zag planks |
| CONVEYOR | against / sideways / boost belts |
| WALL | pusher walls with safe lanes |
| DOOR | three doorways, doors slam, Grumbo may block one — choose! |
| TRAP | collapse floors / trapdoors |
| CHASE | corridor, gaps or collapsing floor; starts the chase |
| CHECKPOINT | checkpoint ring; after a chase a blast door slams on Grumbo |
| BOSS | arena: slam lanes + rolling barrels until the exit opens |
| FINISH | exit gate, confetti cannons |

## Special events

| Flag | Effect |
|---|---|
| `boss` | add the BOSS arena before the finish |
| `doubleChase` | one more chase segment |
| `noChase` | no chases |
| `noTurns` | straight level |
| `chaos` | extra chaos-only surprises (used by CHAOS takes) |
| `more:<MODULE>` | triple that module's weight (e.g. `more:LASER`) |
| `<surprise>` | restrict the beat planner to the named surprise(s) |

## Nav hints (bot contract)

Modules describe *how* to traverse them, so the bot never needs per-module code:
`lane` (where to run), `jump` (takeoff s, landing s, target piece, height change), `gate`
(danger window: hazards, blockers, supports, planned jumps), `ride` (moving platform), `choice`
(doors), `arena` (lanes + hazards, boss/fallers), `nowait`, `sprint`. The bot's Predictor
simulates the next seconds against the deterministic hazards to choose timing.

## Difficulty

See the table in [GAME_DESIGN.md](GAME_DESIGN.md#difficulty). Difficulty is continuous, so
`difficulty: 2.37` interpolates every parameter between NORMAL and HARD.

## Themes and fairness

Themes change decor, module weights, special floor surfaces (ice/jelly with a probability) and
physics. Physics may only stretch the jump range by ~12 % (`speedMul / √gravityScale`); the
generator gets `rangeScale` and lengthens chase platforms accordingly. Unit test
`themes.test.ts` enforces the budget.

## Reproducibility and validation

- `generator.test.ts`: same seed → identical hash; different seeds differ; 200 seeds validate.
- `campaign.test.ts`: all 100 campaign levels validate, reproduce, and **the SKILLED bot
  finishes every one** (~8 s).
- `npm run validate:levels -- 1 100 <PROFILE> [character]` prints a per-level report (time,
  deaths, cause, where it got stuck).

## Adding a module

```ts
export const LOCKERS: ModuleDef = {
  type: 'LOCKERS', roles: ['obstacle'], chaseSafe: true, minDifficulty: 1, beat: false,
  weight: () => 1, estimate: () => 3,
  generate(ctx) {
    const { b, rng, diff } = ctx;
    runFloor(ctx, 0, 12);                       // floor + spine points
    // a locker door that swings out (local coords: lx0, lx1, ly0, ly1, lz0, lz1)
    b.solid(1.2, 2.6, 0, 2.2, 5, 5.3, { style: 'pusher', motion: { kind: 'pingpong', lx: -1.4, ly: 0, lz: 0, period: 2.4, phase: rng.next(), hold: 0.3 } });
    b.hint({ kind: 'lane', s0: b.sAt(2), s1: b.sAt(10), lateral: -diff.trackHalfWidth / 2 });
    decorate(ctx, 0, 12);
    return { exit: straightExit(ctx, 12), estTime: 12 / 8 };
  },
};
registry.register(LOCKERS);
```

Rules: describe traversal with hints, keep gaps ≤ the validator limit, telegraph dangers,
use `ctx.rng` only (determinism), and run `validate:levels` with the bot.
