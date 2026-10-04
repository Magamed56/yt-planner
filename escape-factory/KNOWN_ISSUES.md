# Known Issues & Limitations

## Environment

- **Google Fonts are blocked in the cloud container**, so captions rendered there fall back
  to Arial Black/Impact instead of *Lilita One*. On a normal machine the font loads. (To be
  independent of the network, bundle the font file locally.)
- **Recording without a GPU is slow**: SwiftShader renders ~2.4 fps at 1080×1920 and ~5 fps
  at half-scale 1080p (a 5-minute long video ≈ 30 min). Use `--gpu` on a machine with a
  graphics card, or `--scale 0.5` for drafts.
- Draft long videos are large (≈ 300 MB for 5 min at CRF 18 after upscaling). Use `--crf 23`
  for smaller files.

## Video system

- **No text-to-speech yet**: `voice.lines` are exported to the metadata JSON (and the SRT
  has the captions) for an external TTS/voice-over step; the MP4 has music + SFX only.
- The Shorts cold open and the instant replay can show the same moment (the climax) twice
  when a level is very short.
- `format: "square"` is supported by the renderer but has no dedicated framing style.
- Long videos chain full level runs (deaths included) — there is no "best moments only"
  supercut mode yet.
- A PERFECT take relies on a clean-take search (up to 8 seeds). If none is clean, the take
  contains a death; `plan:videos` rejects such configs, hand-written configs are not checked.

## Camera

- Camera collision uses axis-aligned boxes (physics colliders + registered decor bounds).
  Decorations without registered bounds, or with odd shapes, can still block the view
  briefly (`npm run audit:camera`: ~1.7 % occluded frames, mostly thin props).
- A crusher head moving onto the camera can leave 1–2 bad frames before the director cuts
  to a free shot (3 frames in ~355k audited).
- When nothing nearby is free (narrow corridors under ceilings) the camera may cut more
  often than in open areas (the cuts are rate-limited).

## Gameplay

- The PERFECT bot profile still dies occasionally on hard levels (by design it reacts like a
  very good player, not an oracle); all profiles finish all 100 levels.
- Character stat differences are deliberately tiny (±8 %) to keep generated levels fair —
  characters are mostly cosmetic.
- Theme physics are limited by the fairness budget (≤ +12 % jump range): SPACE and
  UNDERWATER feel floaty but not dramatically so.
- Touch controls are basic (virtual stick + jump) and not tuned for small phones.
- The NIGHT theme can look very dark in some wide shots.

## Technical

- Determinism holds within one JavaScript engine build. Planning and rendering happen in the
  same browser session, so videos are always consistent, but a take simulated in Node and in a
  different browser could in theory diverge in the last float bits (never observed).
- Draw calls are ~110–300 per frame including the shadow pass (shadows are off at
  `quality: low`). Static level geometry is merged per material, not split by distance.
- Text-label textures (signs, banners) live in a bounded global cache and are never freed
  (by design; they plateau at ~12).
