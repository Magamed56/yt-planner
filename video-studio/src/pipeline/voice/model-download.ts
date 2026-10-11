// Загрузка локальных моделей sherpa-onnx (голоса Piper, распознавание речи
// GigaAM) из релизов GitHub: архив .tar.bz2 → папка в MODELS_DIR. Общая для
// всех моделей логика: таймаут «простоя», докачка не нужна (архив пишется в
// .part и переименовывается только целиком), метка «распаковано до конца».

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TtsError, linkedAbort } from "./http";

export interface TarModel {
  label: string; // начало сообщений: «Piper», «Распознавание речи»
  title: string; // что качаем, для лога: «голос Piper ru_RU-dmitri-medium (~65 МБ)»
  url: string;
  dir: string; // папка модели после распаковки (имя совпадает с корнем архива)
  complete(dir: string): boolean; // все нужные файлы на месте (папку могли распаковать руками)
  httpHint?: string; // подсказка к HTTP-ошибке загрузки
  idleMs?: number; // данные не идут столько — обрыв (по умолчанию 60 с)
  totalMs?: number; // предел на всю загрузку (по умолчанию 30 мин)
}

// Метка «распаковано до конца»: пишется только после того, как tar вышел с
// кодом 0. Проверять одни .onnx нельзя — прерванная распаковка (Ctrl+C,
// антивирус, нет места) выглядела бы готовой моделью навсегда.
export const COMPLETE_MARKER = ".complete";

export function tarModelReady(m: TarModel): boolean {
  return existsSync(path.join(m.dir, COMPLETE_MARKER)) || m.complete(m.dir);
}

class TarExitError extends TtsError {}

export async function downloadTarModel(m: TarModel): Promise<string> {
  const dir = m.dir;
  if (tarModelReady(m)) return dir;
  const root = path.dirname(dir);
  await mkdir(root, { recursive: true });
  const name = path.basename(new URL(m.url).pathname);
  const archive = path.join(root, name);
  for (let attempt = 1; ; attempt++) {
    // Архив прошлой попытки уже скачан целиком (.part переименовывается только
    // после успешной загрузки), а распаковка не дошла до конца — берём его.
    const leftover = existsSync(archive);
    if (leftover) console.log(`[озвучка] Распаковываю ранее скачанный ${name}…`);
    else await fetchArchive(m, archive, root);
    await rm(dir, { recursive: true, force: true }); // остатки прерванной распаковки
    try {
      await extractTarBz2(m, archive, root);
      break;
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      // Старый архив оказался битым — один раз качаем заново.
      if (leftover && attempt === 1 && e instanceof TarExitError) {
        await rm(archive, { force: true });
        continue;
      }
      throw e;
    }
  }
  await rm(archive, { force: true });
  if (!m.complete(dir)) {
    throw new TtsError(`${m.label}: после распаковки в ${dir} нет нужных файлов модели. Удалите папку — модель скачается заново.`);
  }
  await writeFile(path.join(dir, COMPLETE_MARKER), "");
  return dir;
}

async function fetchArchive(m: TarModel, archive: string, root: string): Promise<void> {
  const part = archive + ".part";
  console.log(`[озвучка] Скачиваю ${m.title} в ${root}…`);

  // Таймаут «простоя»: если данные не идут idleMs — обрываем, а не ждём вечно.
  const idleMs = m.idleMs ?? 60_000;
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), idleMs);
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), idleMs);
  };
  try {
    const { signal, cleanup } = linkedAbort(m.totalMs ?? 30 * 60_000, ctrl.signal);
    try {
      const res = await fetch(m.url, { signal });
      if (!res.ok || !res.body) throw new TtsError(`${m.label}: не удалось скачать модель (HTTP ${res.status}) ${m.url}.${m.httpHint ? ` ${m.httpHint}` : ""}`);
      const total = Number(res.headers.get("content-length")) || 0;
      let got = 0;
      let lastPct = -10;
      const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
      body.on("data", (chunk: Buffer) => {
        bump();
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (total && pct >= lastPct + 20) {
          lastPct = pct;
          console.log(`[озвучка]   ${pct}% (${(got / 1e6).toFixed(0)} МБ)`);
        }
      });
      await pipeline(body, createWriteStream(part));
    } finally {
      cleanup();
    }
  } catch (e) {
    await rm(part, { force: true });
    if (e instanceof TtsError) throw e;
    throw new TtsError(
      `${m.label}: загрузка модели прервалась (${(e as Error).message}). Скачайте вручную ${m.url} и распакуйте в ${root}.`,
      { cause: e },
    );
  } finally {
    clearTimeout(idle);
  }
  await rename(part, archive);
}

// В Node нет bzip2, поэтому распаковываем системным tar: он есть в Windows 10+
// (bsdtar), macOS и Linux. Запускаем из папки моделей с относительным именем
// архива — так GNU tar из Git Bash не примет «C:» за адрес удалённого хоста.
function extractTarBz2(m: TarModel, archive: string, cwd: string): Promise<void> {
  const winTar = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "tar.exe") : "";
  const tar = process.platform === "win32" && winTar && existsSync(winTar) ? winTar : "tar";
  return new Promise((resolve, reject) => {
    const p = spawn(tar, ["-xjf", path.basename(archive)], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e) =>
      reject(new TtsError(`${m.label}: не найдена утилита tar (${e.message}). Распакуйте ${archive} вручную (например, 7-Zip) в ${cwd}.`, { cause: e })),
    );
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new TarExitError(`${m.label}: tar не смог распаковать ${archive} (код ${code}): ${err.slice(0, 300)}. Распакуйте вручную в ${cwd}.`)),
    );
  });
}
