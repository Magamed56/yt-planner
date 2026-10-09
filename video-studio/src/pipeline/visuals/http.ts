// Сеть для визуала: жёсткие таймауты на весь запрос (включая чтение тела),
// лимит размера при скачивании и атомарная запись файла (.part → rename),
// чтобы недокачанный клип никогда не попал в рендер.

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { VisualError, type FetchLike } from "./types";

export function linkedAbort(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ctrl = new AbortController();
  let timed = false;
  const timer = setTimeout(() => {
    timed = true;
    ctrl.abort(new Error("timeout"));
  }, timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
    timedOut: () => timed,
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusError(what: string, status: number, body: string): VisualError {
  let detail = body.slice(0, 200).replace(/\s+/g, " ").trim();
  try {
    const j = JSON.parse(body) as { error?: unknown; errors?: { message?: string }[]; message?: string };
    const m = typeof j.error === "string" ? j.error : j.errors?.[0]?.message ?? j.message;
    if (m) detail = String(m).slice(0, 200);
  } catch {
    // не JSON
  }
  const tail = detail ? ` Ответ: ${detail}` : "";
  if (status === 401 || status === 403) return new VisualError(`${what}: HTTP ${status} — ключ неверный или без доступа.${tail}`, { status, disable: true });
  if (status === 429) return new VisualError(`${what}: HTTP 429 — исчерпан лимит запросов, источник выключен до конца запуска.${tail}`, { status, disable: true });
  if (status >= 500) return new VisualError(`${what}: HTTP ${status} — сбой сервиса.${tail}`, { status });
  return new VisualError(`${what}: HTTP ${status}.${tail}`, { status });
}

// network: true — таймаут или нет связи (не ответ сервера): такие сбои
// подряд выключают источник (index.ts), чтобы не ждать таймаут на каждой сцене.
function networkError(what: string, url: string, e: unknown, timedOut: boolean, timeoutMs: number): VisualError {
  if (e instanceof VisualError) return e;
  if (timedOut) return new VisualError(`${what}: нет ответа за ${Math.round(timeoutMs / 1000)} с (${hostOf(url)}).`, { cause: e, network: true });
  // Ошибка файловой системы (нет места, нет прав) — это не сеть.
  const sys = (e as { syscall?: unknown })?.syscall;
  if (typeof sys === "string" && /^(open|write|close|rename|unlink|mkdir|fsync)$/.test(sys)) {
    return new VisualError(`${what}: не удалось записать файл (${(e as Error).message}) — проверьте свободное место на диске и права на папку.`, { cause: e });
  }
  const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error)?.message ?? String(e);
  return new VisualError(`${what}: не удалось подключиться к ${hostOf(url)} (${code}).`, { cause: e, network: true });
}

export async function getJson<T>(f: FetchLike, what: string, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const { signal, cleanup, timedOut } = linkedAbort(timeoutMs);
  try {
    const res = await f(url, { ...init, signal });
    const text = await res.text();
    if (!res.ok) throw statusError(what, res.status, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VisualError(`${what}: ответ не JSON (${text.slice(0, 80)}…).`);
    }
  } catch (e) {
    throw networkError(what, url, e, timedOut(), timeoutMs);
  } finally {
    cleanup();
  }
}

// Ответ целиком в память (для сгенерированных картинок — они небольшие).
export async function getBytes(
  f: FetchLike,
  what: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ body: Buffer; contentType: string }> {
  const { signal, cleanup, timedOut } = linkedAbort(timeoutMs);
  try {
    const res = await f(url, { ...init, signal });
    if (!res.ok) throw statusError(what, res.status, await res.text().catch(() => ""));
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new VisualError(`${what}: ответ ${(len / 1e6).toFixed(1)} МБ больше лимита ${(maxBytes / 1e6).toFixed(0)} МБ.`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw new VisualError(`${what}: ответ больше лимита ${(maxBytes / 1e6).toFixed(0)} МБ.`);
    return { body, contentType: res.headers.get("content-type") ?? "" };
  } catch (e) {
    throw networkError(what, url, e, timedOut(), timeoutMs);
  } finally {
    cleanup();
  }
}

// Потоковое скачивание в файл с лимитом размера. Пишем во временный .part и
// переименовываем только после успеха; при любой ошибке .part удаляется.
export async function downloadToFile(
  f: FetchLike,
  what: string,
  url: string,
  dest: string,
  timeoutMs: number,
  maxBytes: number,
  headers?: Record<string, string>,
): Promise<{ bytes: number; contentType: string }> {
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const { signal, cleanup, timedOut } = linkedAbort(timeoutMs);
  let out: ReturnType<typeof createWriteStream> | null = null;
  try {
    const res = await f(url, headers ? { redirect: "follow", signal, headers } : { redirect: "follow", signal });
    if (!res.ok) throw statusError(what, res.status, await res.text().catch(() => ""));
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new VisualError(`${what}: файл ${(len / 1e6).toFixed(1)} МБ больше лимита ${(maxBytes / 1e6).toFixed(0)} МБ.`);
    if (!res.body) throw new VisualError(`${what}: пустой ответ.`);
    const stream = createWriteStream(part);
    out = stream;
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) cb(new VisualError(`${what}: файл больше лимита ${(maxBytes / 1e6).toFixed(0)} МБ — скачивание прервано.`));
        else cb(null, chunk);
      },
    });
    // pipeline, а не ручной цикл write/drain: ошибки записи на диск (нет места,
    // EPERM/EBUSY на Windows) приходят событием 'error' потока — без
    // слушателя это неперехватываемое исключение, которое роняло весь make.
    // pipeline превращает их в обычный reject и сам закрывает все потоки.
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), limit, stream);
    out = null;
    if (bytes === 0) throw new VisualError(`${what}: скачан пустой файл.`);
    await rm(dest, { force: true });
    await rename(part, dest);
    return { bytes, contentType: res.headers.get("content-type") ?? "" };
  } catch (e) {
    // На Windows открытый файл не удалить — сначала дожидаемся закрытия
    // (с подстраховкой по времени, чтобы никогда не зависнуть).
    const s = out;
    if (s) {
      await new Promise<void>((resolve) => {
        if (s.closed) return resolve();
        const t = setTimeout(resolve, 2000);
        s.once("close", () => {
          clearTimeout(t);
          resolve();
        });
        s.destroy();
      });
    }
    await rm(part, { force: true }).catch(() => undefined);
    throw networkError(what, url, e, timedOut(), timeoutMs);
  } finally {
    cleanup();
  }
}
