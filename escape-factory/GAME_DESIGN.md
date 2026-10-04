# Game Design — ESCAPE FACTORY

**Genre**: escape + chase + obstacle course + light horror + comedy.
**Mix**: 70 % fun · 20 % tension · 10 % horror — always YouTube-safe (no blood, no gore; a
"catch" is a comic grab-and-dangle, then you respawn at the checkpoint).
**Pitch**: Pip, a small factory worker, wakes up inside a giant, ever-changing factory. The
factory's furnace robot **Grumbo** has decided Pip belongs in the furnace. Run.

## Core loop

```
START → EXPLORE → OBSTACLE → DANGER → CHASE → ESCAPE → CHECKPOINT → NEW DANGER → … → FINAL ESCAPE → REWARD
```

The generator follows this loop literally (roles `explore / obstacle / danger` cycle, chase
set-pieces end at a checkpoint with a blast-door slam, the last stretch is a FINAL ESCAPE
that survives respawns, the finish line has confetti and an EXIT gate).

**Something notable every 10–20 seconds**: a beat planner inserts surprises between the
modules — Grumbo peeking from a balcony, lights flickering, alarms, the floor collapsing behind
you, a wall slamming down, debris falling, Grumbo's roar from the distance, steam bursts.

## The player

| Stat (reference) | Value | Feel |
|---|---|---|
| Run speed | 8 m/s | snappy, readable on video |
| Jump | ~2.25 m high, ~6 m long | coyote time + jump buffer + variable height |
| Air control | 26 m/s² | can correct mid-air, not fly |
| Body | 0.7 × 1.4 m | small, cute, clearly visible |

Characters change looks, animation personality, voice pitch and **at most ±8 %** stats, so
the generator's fairness holds for everyone:

| Id | Name | Look |
|---|---|---|
| pip | **Pip** (main) | teal bean in a yellow hard hat with a headlamp |
| robot | Bolt | retired assembly-line robot — a bit slower, jumps on hydraulics |
| cat | Mittens | the factory cat — fast paws (+4 % speed) |
| toy | Tick-Tock | wind-up tin soldier that escaped the toy line |
| cookie | Crumbs | a fresh-baked cookie that refused to be packaged |
| pumpkin | Jack | a pumpkin with a candle inside and a permanent grin |
| alien | Zip | crash-landed alien — floaty (+4 % jump, +8 % air control) |

New characters are pure data (`CharacterDef` + `ModelSpec`) — no gameplay code changes.

## The enemy — Grumbo

A huge, clumsy furnace robot: round boiler body, **pressure-gauge eye** whose needle shows
his mood (calm → angry → furious), tiny hard hat, smoking chimney, one claw hand and one
plunger hand. Original design; readable silhouette at Shorts size.

Behaviour states: `dormant → peek → chase → block → boss → grab → retreat`.

- **Appears / watches / disappears**: peeks from balconies and ledges (enemyPeek triggers).
- **Chases**: rubber-band speed `max(hunt, playerSpeed + 2.2·(gap − desiredGap))` with
  periodic **lunges** down to the "near" gap → constant *almost-caught* moments. He **never
  catches a full-speed runner**, but catches anyone who stops or messes up.
- **Accelerates** with chase intensity, **slows over gaps** (he's heavy), **smashes crates**
  in his way, **stumbles**, stomps (footstep shake + dust).
- **Blocks** a doorway (door-choice modules) — pick another door!
- **Boss**: from a pedestal he slams lanes and rolls barrels; survive until the exit opens.
- **Grabs** (comic dangle) and **retreats** when a blast door slams on his gauge.
- Themed costumes: witch hat (HALLOWEEN), Santa hat (CHRISTMAS), red scarf (WINTER),
  candy bonnet with a cherry (CANDY), brass porthole + snorkel chimney (UNDERWATER), glowing
  antenna (SPACE), glowing lava cracks (VOLCANO), hat headlamp (NIGHT).

## Modules (level building blocks)

START · STRAIGHT · TURN · JUMP · MOVING_PLATFORM · DISAPPEARING_PLATFORM · SPINNER · CRUSHER ·
LASER · FALLING_OBJECT · NARROW_BRIDGE · CONVEYOR · WALL · DOOR · TRAP · CHASE · CHECKPOINT ·
BOSS · FINISH — details and variants in [LEVEL_GENERATOR.md](LEVEL_GENERATOR.md).

Every danger is **telegraphed** (warning lights, shaking, shadows on the floor, blinking
platforms, beeping lasers) so failures feel fair and look great on camera.

## Difficulty

Continuous 1..5 with named anchors. What scales:

| | EASY | NORMAL | HARD | INSANE | IMPOSSIBLE |
|---|---|---|---|---|---|
| obstacle speed | 0.75 | 0.9 | 1.05 | 1.2 | 1.38 |
| trap density | 0.25 | 0.4 | 0.55 | 0.7 | 0.85 |
| length (modules) | 10–12 | 13–16 | 16–20 | 20–25 | 24–30 |
| gaps (m) | 1.6–2.6 | 2.0–3.2 | 2.4–3.7 | 2.8–4.2 | 3.1–4.6 |
| platforms (m) | 3.2–4.5 | 2.8–4.0 | 2.5–3.6 | 2.2–3.2 | 2.0–2.8 |
| Grumbo hunt speed | 5.0 | 5.6 | 6.2 | 6.7 | 7.2 |
| Grumbo near gap (m) | 3.2 | 3.0 | 2.7 | 2.5 | 2.3 |
| surprises / 20 s | 0.9 | 1.1 | 1.3 | 1.5 | 1.8 |
| chase segments | 1 | 1 | 2 | 2 | 3 |
| timing windows | ×1.3 | ×1.15 | ×1.0 | ×0.9 | ×0.8 |

## Themes (seasons)

| Theme | Look | Twist |
|---|---|---|
| FACTORY | warm industrial haze, steel-blue catwalks, hazard yellow | signature look |
| NORMAL | sunny daytime, potted plants, trees | friendliest |
| NIGHT | navy dark, neon signs, street lamps | more lasers, electric pits |
| WINTER | snow, pines, snowmen, ice crystals | **ice floors** (slide!), snowball fallers |
| CANDY | pastel sugar, lollipops, gumdrops, cupcakes | **jelly floors** (one comic boing), syrup pits |
| UNDERWATER | teal depths, coral, seaweed, bubbles | **floaty jumps**, shell fallers, electric eels |
| VOLCANO | lava sky, basalt, embers, lava rocks | lava pits, meteor showers |
| SPACE | starfield, antennas, crystals | **low gravity** (floaty, slower run), meteors, void |
| HALLOWEEN | dusk purple/orange, pumpkins, tombstones, candles | more trapdoors & doors |
| CHRISTMAS | toy workshop, trees, presents, candy canes | assembly-line conveyors, falling presents |

Each theme also changes lighting, fog, particles, music (scale, tempo, timbres and drum
kit: soft / electro / jingle / tribal / spooky) and Grumbo's costume. Physics changes obey a
**fairness rule**: jump range may grow by at most ~12 % and the generator lengthens chase
platforms for floaty themes, so every theme stays beatable.

## Campaign — 100 levels

- Level N uses seed `1000 + N`; difficulty ramps from 1.0 to 5.0 with a saw-tooth inside each
  10-level block (a breather after every peak).
- Theme blocks: FACTORY 1–20, NIGHT 21–30, WINTER 31–40, CANDY 41–50, UNDERWATER 51–60,
  VOLCANO 61–70, SPACE 71–80, HALLOWEEN 81–90, CHRISTMAS 91–100.
- **Boss every 10th level**, double chase every 5th, chaos levels from 40 on (every 7th).
- Levels 1–3 are short tutorials (8–10 modules). Every level has a title ("Level 7: The
  Clanky Furnace").
- Verified: the bot completes 100/100 with every profile and every character.

## Progression & save

Saved locally (`SaveSystem`, versioned with migrations): completed levels, best time and best
coins per level, deaths (total and per level), coins, unlocked characters, unlocked themes,
selected character, settings (master/music/SFX volume, quality, camera shake, cinematic
camera, FPS display), stats (runs, finishes,
play time, times caught). Coins unlock characters in the CHARACTERS screen.

## UI

Minimal: PLAY · LEVELS · CHARACTERS · SETTINGS; in-game HUD (timer, coins, deaths, a Grumbo
danger meter), PAUSE (resume/restart/menu), level complete screen. The menu runs a live bot
"attract mode" in the background. **VIDEO MODE hides all UI.**

## Sound

Procedural (no audio files): jump, land, footsteps (surface-aware pitch), fall, hit, near-death
whoosh, Grumbo roar/stomp/grab/bonk, door slam, trap click, crusher, laser hum, collapse,
checkpoint chime, finish fanfare, alarm, stings. Adaptive music: layers fade in with intensity
(calm → peek → chase → final escape), heartbeat when Grumbo is within 5 m.
