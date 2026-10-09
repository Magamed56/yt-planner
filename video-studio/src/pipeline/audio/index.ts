// Звук ролика: фоновая музыка и звук перехода. Все пути в результате —
// относительно publicDir запуска (см. contracts.ts).
//
// MUSIC = auto (по умолчанию) | none | generated | <путь к файлу или папке>
//   auto       — трек из MUSIC_DIR (по умолчанию ./music), если папка пуста — generated
//   generated  — локально синтезированный эмбиент-пэд нужной длины (без лицензий)
//   none       — без музыки

import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MusicChoice } from "../contracts";
import type { SfxSet } from "../../types";
import { hashString } from "./dsp";
import { creditFor, listTracks, MUSIC_EXTENSIONS, pickTrack, type LibraryTrack } from "./library";
import { synthAmbient } from "./music";
import { envPath } from "./paths";
import { synthImpact, synthPop, synthRise, synthSting } from "./sfx";
import { encodeWav16 } from "./wav";
import { WHOOSH_VARIANTS, synthWhoosh } from "./whoosh";

export { MUSIC_MOODS, resolveMood, synthAmbient, type MusicMood } from "./music";
export { synthImpact, synthPop, synthRise, synthSting } from "./sfx";
export { synthWhoosh } from "./whoosh";

export interface PrepareMusicOptions {
  durationMs: number;
  mood?: string;
  seed: string;
}

export async function prepareMusic(publicDir: string, opts: PrepareMusicOptions): Promise<MusicChoice | null> {
  const mode = process.env.MUSIC?.trim() || "auto";
  const lower = mode.toLowerCase();
  if (lower === "none" || lower === "off" || lower === "0") return null;
  if (lower === "generated") return generated(publicDir, opts);

  if (lower === "auto") {
    const dir = envPath("MUSIC_DIR", "music");
    const tracks = await listTracks(dir);
    const track = pickTrack(tracks, opts.mood, opts.seed);
    if (!track) {
      console.log(`[музыка] В папке ${dir} нет треков (${MUSIC_EXTENSIONS.join(", ")}) — генерирую фоновый эмбиент.`);
      return generated(publicDir, opts);
    }
    return copyTrack(publicDir, track);
  }

  // MUSIC = путь к файлу или к папке с треками.
  const p = path.resolve(mode);
  if (existsSync(p) && statSync(p).isDirectory()) {
    const track = pickTrack(await listTracks(p), opts.mood, opts.seed);
    if (track) return copyTrack(publicDir, track);
    console.warn(`[музыка] В папке MUSIC=${p} нет подходящих треков — генерирую фоновый эмбиент.`);
    return generated(publicDir, opts);
  }
  if (existsSync(p)) {
    const [track] = (await listTracks(path.dirname(p))).filter((t) => path.resolve(t.file) === p);
    return copyTrack(publicDir, track ?? { file: p, meta: null });
  }
  // Ролик важнее музыки: не роняем весь конвейер (особенно в CI) из-за опечатки в пути.
  console.warn(`[музыка] Файл MUSIC=${mode} не найден — генерирую фоновый эмбиент. Варианты: auto | none | generated | путь к файлу.`);
  return generated(publicDir, opts);
}

async function copyTrack(publicDir: string, track: LibraryTrack): Promise<MusicChoice> {
  const ext = path.extname(track.file).toLowerCase();
  // ASCII-имя: кириллица, пробелы и «#» в имени ломают URL в staticFile().
  const name = `track-${hashString(path.basename(track.file)).toString(16).padStart(8, "0")}${ext}`;
  const dest = path.join(publicDir, "music", name);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(track.file, dest);
  const credit = creditFor(track);
  console.log(`[музыка] Трек: ${path.basename(track.file)}${credit ? ` — ${credit}` : " (без json-описания, атрибуции нет)"}`);
  return { src: `music/${name}`, credit };
}

async function generated(publicDir: string, opts: PrepareMusicOptions): Promise<MusicChoice> {
  const t0 = Date.now();
  // +2 c запаса, чтобы музыка не оборвалась раньше финальной сцены.
  const { audio, mood } = synthAmbient({ durationMs: Math.max(1000, opts.durationMs) + 2000, mood: opts.mood, seed: opts.seed });
  const name = `ambient-${mood}-${hashString(`${opts.seed}:${opts.durationMs}`).toString(16).padStart(8, "0")}.wav`;
  const dest = path.join(publicDir, "music", name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, encodeWav16(audio));
  console.log(`[музыка] Сгенерирован эмбиент «${mood}» (${Math.round(opts.durationMs / 1000) + 2} с) за ${((Date.now() - t0) / 1000).toFixed(1)} с.`);
  return { src: `music/${name}`, credit: null };
}

// Звук перехода: один и тот же файл на весь ролик, синтезируется за миллисекунды.
export async function makeWhoosh(publicDir: string): Promise<string> {
  const rel = "sfx/whoosh.wav";
  const dest = path.join(publicDir, "sfx", "whoosh.wav");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, encodeWav16(synthWhoosh(44100)));
  return rel;
}

// Весь набор звуков монтажа (переходы, пункты, цифры, заставка) — локальный
// синтез за доли секунды. SFX=whoosh — только свист переходов (как раньше),
// SFX=off — без звуков монтажа; громкость — SFX_VOLUME.
export async function makeSfx(publicDir: string, opts: { sting?: boolean } = {}): Promise<{ whooshSrc: string | null; sfx: SfxSet | null }> {
  const mode = (process.env.SFX ?? "").trim().toLowerCase();
  if (mode === "off" || mode === "none" || mode === "0") return { whooshSrc: null, sfx: null };
  const dir = path.join(publicDir, "sfx");
  await mkdir(dir, { recursive: true });
  const put = async (name: string, audio: ReturnType<typeof synthWhoosh>) => {
    await writeFile(path.join(dir, name), encodeWav16(audio));
    return `sfx/${name}`;
  };
  // Первый вариант — прежний whoosh.wav: старые props.json ссылаются на него.
  const whooshes: string[] = [];
  for (const [i, v] of WHOOSH_VARIANTS.entries()) whooshes.push(await put(i === 0 ? "whoosh.wav" : `whoosh-${i + 1}.wav`, synthWhoosh(44100, v)));
  if (mode === "whoosh") return { whooshSrc: whooshes[0]!, sfx: null };
  const sfx: SfxSet = {
    whooshes,
    pop: await put("pop.wav", synthPop(44100)),
    impact: await put("impact.wav", synthImpact(44100)),
    rise: await put("rise.wav", synthRise(44100)),
    sting: opts.sting ? await put("sting.wav", synthSting(44100)) : null,
  };
  return { whooshSrc: whooshes[0]!, sfx };
}
