// Общие помощники сети для облачных/локальных TTS: жёсткие таймауты (ни один
// запрос не должен «висеть» вечно), понятные русские ошибки и признак того,
// имеет ли смысл повторять запрос.

export class TtsError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, opts: { retryable?: boolean; status?: number | null; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "TtsError";
    this.retryable = opts.retryable ?? false;
    this.status = opts.status ?? null;
  }
}

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Связываем внешний AbortSignal и таймаут в один контроллер. AbortSignal.any
// появился не во всех версиях Node, поэтому вручную.
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

export interface HttpResult {
  status: number;
  headers: Headers;
  body: Buffer;
}

// fetch с таймаутом на ВЕСЬ запрос, включая чтение тела ответа.
export async function httpRequest(
  what: string,
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<HttpResult> {
  const { signal, cleanup, timedOut } = linkedAbort(opts.timeoutMs, opts.signal);
  try {
    const res = await fetch(url, { ...init, signal });
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw httpError(what, res.status, body, res.headers);
    return { status: res.status, headers: res.headers, body };
  } catch (e) {
    if (e instanceof TtsError) throw e;
    if (timedOut()) throw new TtsError(`${what}: нет ответа за ${Math.round(opts.timeoutMs / 1000)} с (${hostOf(url)}).`, { retryable: true });
    if (opts.signal?.aborted) throw new TtsError(`${what}: отменено.`, { retryable: false, cause: e });
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
    throw new TtsError(`${what}: не удалось подключиться к ${hostOf(url)} (${code}). Проверьте адрес/сеть.`, { retryable: true, cause: e });
  } finally {
    cleanup();
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function httpError(what: string, status: number, body: Buffer, headers?: Headers): TtsError {
  let detail = body.toString("utf8").slice(0, 400).replace(/\s+/g, " ").trim();
  try {
    const j = JSON.parse(body.toString("utf8")) as { error?: { message?: string } | string; detail?: unknown; message?: string };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? (typeof j.detail === "string" ? j.detail : null);
    if (m) detail = m.slice(0, 400);
  } catch {
    // тело не JSON — показываем как есть
  }
  const hint =
    status === 401 || status === 403
      ? " — ключ API неверный или у него нет доступа."
      : status === 404
        ? " — неверный адрес, модель или голос."
        : status === 429
          ? " — исчерпан лимит запросов (квота бесплатного тарифа), попробуйте позже."
          : status >= 500
            ? " — ошибка на стороне сервиса."
            : "";
  const retryAfter = headers?.get("retry-after");
  if (detail && !/[.!?…]$/.test(detail)) detail += ".";
  return new TtsError(`${what}: HTTP ${status}${hint}${detail ? ` Ответ: ${detail}` : ""}${retryAfter ? ` (Retry-After: ${retryAfter} с)` : ""}`, {
    status,
    retryable: status === 408 || status === 429 || status >= 500,
  });
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

// Предупреждения о лицензиях печатаем один раз за процесс, а не на каждую сцену.
const warned = new Set<string>();
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
