// Edge TTS (Microsoft, бесплатно, без ключа) через edge-tts-universal.
// Используем потоковый Communicate, а не EdgeTTS.synthesize: он отдаёт
// события WordBoundary (готовые тайминги слов). Библиотека может зависнуть
// навсегда, если WebSocket так и не откроется (ждёт событие open без
// таймаута), поэтому чтение потока обёрнуто в жёсткие таймауты.

import { Communicate } from "edge-tts-universal";
import type { WordTiming } from "../../../types";
import { envInt, TtsError, warnOnce } from "../http";
import type { RawProvider } from "../provider";

export const EDGE_DEFAULT_VOICE = "ru-RU-DmitryNeural";

export interface EdgeChunk {
  type: string;
  data?: Uint8Array;
  offset?: number; // в тиках по 100 нс
  duration?: number;
  text?: string;
}

// 1 тик = 100 нс → 10 000 тиков в миллисекунде.
export const ticksToMs = (ticks: number) => ticks / 10_000;

export function boundaryToWord(ch: EdgeChunk): WordTiming | null {
  if (ch.type !== "WordBoundary" || !ch.text || typeof ch.offset !== "number") return null;
  const startMs = ticksToMs(ch.offset);
  return { text: ch.text, startMs, endMs: startMs + ticksToMs(ch.duration ?? 0) };
}

export interface CollectLimits {
  connectMs: number; // до первого фрагмента (сюда попадает «вечное» ожидание open)
  idleMs: number; // между фрагментами
  totalMs: number; // на весь синтез
  signal?: AbortSignal;
}

// Читает поток Communicate с таймаутами. Зависший генератор не ждём:
// его return() может не завершиться, поэтому вызываем без await.
export async function collectEdgeStream(stream: AsyncIterable<EdgeChunk>, limits: CollectLimits): Promise<{ audio: Buffer; words: WordTiming[] }> {
  const it = stream[Symbol.asyncIterator]();
  const audio: Buffer[] = [];
  const words: WordTiming[] = [];
  const t0 = Date.now();
  let first = true;
  try {
    for (;;) {
      if (limits.signal?.aborted) throw new TtsError("Edge TTS: отменено.");
      const left = limits.totalMs - (Date.now() - t0);
      const wait = Math.max(1, Math.min(left, first ? limits.connectMs : limits.idleMs));
      const step = await nextWithTimeout(it, wait, limits.signal);
      if (step === "timeout") {
        const why = first
          ? `нет соединения с speech.platform.bing.com за ${Math.round(wait / 1000)} с (сервис заблокирован, нет интернета или нужен прокси EDGE_PROXY)`
          : left <= wait
            ? `синтез не уложился в ${Math.round(limits.totalMs / 1000)} с`
            : `поток данных прервался на ${Math.round(wait / 1000)} с`;
        throw new TtsError(`Edge TTS: ${why}.`, { retryable: true });
      }
      if (step.done) break;
      first = false;
      const ch = step.value;
      if (ch.type === "audio" && ch.data && ch.data.length) audio.push(Buffer.from(ch.data));
      else {
        const w = boundaryToWord(ch);
        if (w) words.push(w);
      }
    }
  } catch (e) {
    void Promise.resolve(it.return?.()).catch(() => {});
    if (e instanceof TtsError) throw e;
    const name = (e as Error).name;
    const msg = (e as Error).message;
    throw new TtsError(`Edge TTS: ошибка сервиса (${name}: ${msg}).`, { retryable: true, cause: e });
  }
  if (!audio.length) throw new TtsError("Edge TTS: сервис не вернул аудио.", { retryable: true });
  return { audio: Buffer.concat(audio), words };
}

function nextWithTimeout<T>(it: AsyncIterator<T>, ms: number, signal?: AbortSignal): Promise<IteratorResult<T> | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TtsError("Edge TTS: отменено."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    it.next().then(
      (r) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(r);
      },
      (e: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

// "+5%" / "5" / "-10%" → формат Edge "+5%"; мусор — игнорируем с предупреждением.
export function edgeRate(rate: string | undefined): string {
  if (!rate?.trim()) return "+0%";
  const m = /^\s*([+-]?)(\d+)\s*%?\s*$/.exec(rate);
  if (!m) {
    warnOnce("edge-rate", `[озвучка] TTS_RATE="${rate}" не понят (нужно, например, "+5%" или "-10%") — темп по умолчанию.`);
    return "+0%";
  }
  return `${m[1] === "-" ? "-" : "+"}${m[2]}%`;
}

export type CommunicateFactory = (text: string, opts: { voice: string; rate: string; proxy?: string; connectionTimeout: number }) => { stream(): AsyncIterable<EdgeChunk> };

const defaultFactory: CommunicateFactory = (text, opts) => new Communicate(text, opts);

export function edgeProvider(factory: CommunicateFactory = defaultFactory): RawProvider {
  return {
    name: "edge",
    output: "mp3",
    resolveVoice(voice) {
      const v = voice?.trim();
      if (!v) return EDGE_DEFAULT_VOICE;
      // Общий TTS_VOICE мог остаться от другого провайдера (например, Piper).
      if (!/^[a-z]{2,3}-[A-Z]{2,}-/i.test(v) && !v.startsWith("Microsoft Server Speech")) {
        warnOnce(`edge-voice-${v}`, `[озвучка] Голос "${v}" не похож на голос Edge — использую ${EDGE_DEFAULT_VOICE}. Русские голоса Edge: ru-RU-DmitryNeural, ru-RU-SvetlanaNeural.`);
        return EDGE_DEFAULT_VOICE;
      }
      return v;
    },
    configKey: () => `edge:${edgeRate(process.env.TTS_RATE)}`,
    async synthesizeRaw(text, ctx) {
      // Edge режет текст на куски по 4096 байт и «угадывает» паузу между ними (875 мс),
      // поэтому длинные сцены лучше дробить ещё в сценарии.
      let comm: { stream(): AsyncIterable<EdgeChunk> };
      try {
        comm = factory(text, {
          voice: ctx.voice,
          rate: edgeRate(process.env.TTS_RATE),
          proxy: process.env.EDGE_PROXY?.trim() || undefined,
          connectionTimeout: 15_000,
        });
      } catch (e) {
        throw new TtsError(`Edge TTS: неверные параметры (${(e as Error).message}). Проверьте TTS_VOICE и TTS_RATE.`);
      }
      const totalMs = Math.max(envInt("TTS_TIMEOUT_MS", 30_000), text.length * 40);
      const { audio, words } = await collectEdgeStream(comm.stream(), {
        connectMs: Math.min(totalMs, 20_000),
        idleMs: 15_000,
        totalMs,
        signal: ctx.signal,
      });
      return { kind: "mp3", bytes: audio, words: words.length ? words : null };
    },
  };
}
