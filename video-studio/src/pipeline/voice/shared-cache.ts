// Общий кэш озвучки — между запусками и папками роликов. Кэш рядом со сценой
// (out/<ролик>/public/voice/*.voice.json) теряется на чистом раннере GitHub Actions
// и при смене названия ролика (новая папка), и пересборка того же текста снова
// тратила суточную квоту Gemini (10a и 10b озвучены дважды). Здесь лежит «сырой»
// ответ провайдера (до обрезки тишины и громкости): поменяется постобработка —
// кэш всё равно годится. Ключ — хэш провайдера, голоса, настроек (модель, стиль,
// темп) и текста. Звук запасной модели сюда не кладём: пересборка должна
// переозвучить сцену основной. В Actions папку сохраняет actions/cache.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordTiming } from "../../types";
import { projectRoot } from "../audio/paths";
import { decodeWav, encodeWav16 } from "../audio/wav";
import type { RawAudio } from "./provider";

export const SHARED_CACHE_DAYS = 14; // пересборки (повтор, правка сцены, другая палитра) — в первые дни
const DAY_MS = 86_400_000;
const ORPHAN_MS = 3_600_000;

interface SharedEntry {
  v: 1;
  key: string; // sha256 полного ключа — сверяем, а не верим имени файла
  kind: "pcm" | "mp3";
  file: string; // звук рядом с json
  words: WordTiming[] | null;
  createdAt: string;
  provider: string; // для человека, который заглянет в папку
  voice: string;
  chars: number;
}

export const sharedKey = (key: string) => createHash("sha256").update(key).digest("hex");

// null — общий кэш выключен (TTS_CACHE_DIR=none). TTS_CACHE=0 его не выключает, а
// только запрещает чтение (provider.ts): новый дубль заменяет старую запись, иначе
// следующая пересборка без флага вернула бы прежний — с той же оговоркой.
export function sharedCacheDir(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.TTS_CACHE_DIR?.trim();
  if (v && /^(none|off|0|false|no)$/i.test(v)) return null;
  return v ? path.resolve(v) : path.join(projectRoot(), ".cache", "voice");
}

export function sharedCacheDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TTS_CACHE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : SHARED_CACHE_DAYS;
}

export async function readShared(dir: string, key: string): Promise<RawAudio | null> {
  const hash = sharedKey(key);
  try {
    const e = JSON.parse(await readFile(path.join(dir, `${hash}.json`), "utf8")) as SharedEntry;
    if (e.v !== 1 || e.key !== hash || path.basename(e.file) !== e.file) return null;
    const bytes = await readFile(path.join(dir, e.file));
    const words = Array.isArray(e.words) ? e.words : null;
    if (e.kind === "mp3") return bytes.length ? { kind: "mp3", bytes: new Uint8Array(bytes), words } : null;
    const audio = decodeWav(bytes);
    return audio.channels[0]?.length ? { kind: "pcm", audio, words } : null;
  } catch {
    return null; // нет записи, битый json или звук — озвучим заново
  }
}

// Сначала звук, потом json через временное имя: оборванная запись (отмена
// запуска, два процесса сразу) не выглядит готовой.
export async function writeShared(dir: string, key: string, raw: RawAudio, meta: { provider: string; voice: string; chars: number }, now = new Date()): Promise<void> {
  if (raw.fallback) return;
  const hash = sharedKey(key);
  const file = `${hash}.${raw.kind === "mp3" ? "mp3" : "wav"}`;
  const entry: SharedEntry = { v: 1, key: hash, kind: raw.kind, file, words: raw.words ?? null, createdAt: now.toISOString(), ...meta };
  const tmp = `.${process.pid}-${Date.now()}`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file + tmp), raw.kind === "mp3" ? raw.bytes : encodeWav16(raw.audio));
    await rename(path.join(dir, file + tmp), path.join(dir, file));
    await writeFile(path.join(dir, `${hash}.json${tmp}`), JSON.stringify(entry));
    await rename(path.join(dir, `${hash}.json${tmp}`), path.join(dir, `${hash}.json`));
  } catch (e) {
    // Кэш не критичен (папка только для чтения, нет места) — ролик собирается дальше.
    console.warn(`[озвучка] общий кэш не записан (${(e as Error).message}) — на сборку это не влияет.`);
    await rm(path.join(dir, file + tmp), { force: true }).catch(() => {});
    await rm(path.join(dir, `${hash}.json${tmp}`), { force: true }).catch(() => {});
  }
}

// Записи старше maxAgeDays (по createdAt, иначе по времени файла) и осиротевшие файлы —
// прочь: иначе кэш Actions рос бы с каждым роликом. Возвращает, сколько записей удалено.
export async function pruneShared(dir: string, maxAgeDays: number, now = Date.now()): Promise<number> {
  if (!existsSync(dir)) return 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const keep = new Set<string>();
  let removed = 0;
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const p = path.join(dir, name);
    let created = NaN;
    let audio: string | null = null;
    try {
      const e = JSON.parse(await readFile(p, "utf8")) as Partial<SharedEntry>;
      created = Date.parse(String(e.createdAt));
      audio = typeof e.file === "string" && path.basename(e.file) === e.file ? e.file : null;
    } catch {
      // битая запись — удаляем
    }
    if (!Number.isFinite(created)) created = await stat(p).then((s) => s.mtimeMs).catch(() => 0);
    if (audio && now - created <= maxAgeDays * DAY_MS) {
      keep.add(name);
      keep.add(audio);
      continue;
    }
    await rm(p, { force: true }).catch(() => {});
    if (audio) await rm(path.join(dir, audio), { force: true }).catch(() => {});
    removed++;
  }
  // Файлы без записи: оборванная запись или временные. Свежие (моложе часа) не трогаем —
  // их может дописывать соседний процесс.
  for (const name of names) {
    if (keep.has(name) || name.endsWith(".json")) continue;
    const p = path.join(dir, name);
    const mtime = await stat(p).then((s) => s.mtimeMs).catch(() => now);
    if (now - mtime > ORPHAN_MS) await rm(p, { force: true }).catch(() => {});
  }
  return removed;
}

// Уборка — один раз за процесс на папку, при первом обращении к кэшу.
const pruned = new Set<string>();
export async function pruneSharedOnce(dir: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (pruned.has(dir)) return;
  pruned.add(dir);
  const n = await pruneShared(dir, sharedCacheDays(env));
  if (n) console.log(`  кэш озвучки: удалено старых записей — ${n} (старше ${sharedCacheDays(env)} дн.)`);
}
