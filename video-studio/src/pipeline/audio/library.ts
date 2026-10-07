// Выбор трека из локальной фонотеки (MUSIC_DIR). Бесплатной легальной
// музыки с API для монетизируемых роликов нет, поэтому треки пользователь
// кладёт сам (YouTube Audio Library, Pixabay Music), а рядом — json-описание
// с лицензией и настроением. Выбор детерминирован зерном.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { hashString } from "./dsp";
import { moodMatches, resolveMood } from "./music";

export const MUSIC_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg"];

export interface TrackMeta {
  title?: string;
  artist?: string;
  license?: string;
  attribution?: string; // готовая строка для описания ролика
  moods?: string[];
  sourceUrl?: string;
}

export interface LibraryTrack {
  file: string; // абсолютный путь
  meta: TrackMeta | null;
}

async function readMeta(file: string): Promise<TrackMeta | null> {
  const ext = path.extname(file);
  // Поддерживаем оба варианта имени: track.json и track.mp3.json.
  for (const side of [file.slice(0, -ext.length) + ".json", file + ".json"]) {
    if (!existsSync(side)) continue;
    try {
      const raw = JSON.parse(await readFile(side, "utf8")) as Record<string, unknown>;
      const str = (k: string) => (typeof raw[k] === "string" && (raw[k] as string).trim() ? (raw[k] as string).trim() : undefined);
      const moods = Array.isArray(raw.moods) ? raw.moods.filter((m): m is string => typeof m === "string") : undefined;
      return { title: str("title"), artist: str("artist"), license: str("license"), attribution: str("attribution"), moods, sourceUrl: str("sourceUrl") };
    } catch (e) {
      console.warn(`[музыка] Не удалось прочитать описание ${side}: ${(e as Error).message} — трек будет без атрибуции.`);
      return null;
    }
  }
  return null;
}

export async function listTracks(dir: string): Promise<LibraryTrack[]> {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isFile() && MUSIC_EXTENSIONS.includes(path.extname(d.name).toLowerCase()))
    .map((d) => d.name)
    .sort(); // стабильный порядок на любой ОС — иначе выбор по зерну «плавает»
  return Promise.all(names.map(async (name) => ({ file: path.join(dir, name), meta: await readMeta(path.join(dir, name)) })));
}

export function pickTrack(tracks: LibraryTrack[], mood: string | undefined, seed: string): LibraryTrack | null {
  if (!tracks.length) return null;
  let pool = tracks;
  if (mood) {
    const m = resolveMood(mood, seed);
    const matching = tracks.filter((t) => t.meta?.moods && moodMatches(m, t.meta.moods));
    if (matching.length) pool = matching;
  }
  return pool[hashString(`track:${seed}`) % pool.length]!;
}

export function creditFor(track: LibraryTrack): string | null {
  const m = track.meta;
  if (!m) return null;
  if (m.attribution) return m.attribution;
  if (!m.title && !m.artist) return null;
  const name = [m.title ? `«${m.title}»` : null, m.artist].filter(Boolean).join(" — ");
  return `Музыка: ${name}${m.license ? ` (${m.license})` : ""}${m.sourceUrl ? ` ${m.sourceUrl}` : ""}`;
}
