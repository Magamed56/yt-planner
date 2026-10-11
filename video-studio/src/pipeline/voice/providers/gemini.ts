// Gemini TTS (Google AI Studio). Бесплатный тариф — около 10 запросов в сутки
// на модель (проверено 07.10.2026: «limit: 10 requests per day»), поэтому сцены
// ролика озвучиваются одним запросом и режутся по паузам (batchMaxChars, split.ts).
// Новые модели gemini-3.8-flash-tts / -lite-tts работают через POST
// /v1beta/interactions (стиль — в speech_metadata.style, ответ — готовый WAV);
// старые (*-preview-tts) — через generateContent и отдают сырой PCM 24 кГц.
// Квоты у моделей раздельные, поэтому при 429/404 пробуем следующую по цепочке.
// Но 429 «в минуту» (RetryInfo «retry in 37s») — повод подождать и повторить
// ту же модель, а не менять голос посреди ролика; на следующую модель идём
// только при суточной квоте, 404/400 или повторном 5xx, и дальше весь ролик
// озвучивает уже она (один голос, а не три).
// Лимиты считаются на проект, а не на ключ, поэтому второй ключ (GEMINI_API_KEY_2)
// берут из другого проекта/аккаунта. Порядок: модель за моделью, внутри модели —
// ключ 1, затем ключ 2 (качество основной модели важнее, чей это проект). На
// второй ключ переходим только при 429; 401/403 выключает свой ключ, если есть другой.
// Таймингов слов нет — общая обвязка выравнивает текст по распознанной речи
// (align.ts; она же уточняет границы сцен в общем звуке), иначе оценивает по звуку.

import { decodePcm16, decodeWav, isWav } from "../../audio/wav";
import { envInt, httpRequest, sleep, TtsError } from "../http";
import type { RawAudio, RawContext, RawProvider } from "../provider";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_DEFAULT_VOICE = "Charon"; // глубокий спокойный мужской (выбор автора); Puck, Fenrir, Kore, Aoede, Zephyr… — см. README
export const GEMINI_DEFAULT_STYLE = "Энергично и тепло, как ведущий научпоп-канала. Чёткая дикция, живые интонации, без пауз в начале.";

const isLegacy = (model: string) => /preview|^gemini-2\.|^gemini-3\.[01]-/.test(model);

// Цепочка моделей: заданная → «лёгкая» 3.8 → старая preview.
export function geminiModelChain(model: string): string[] {
  const chain = [model];
  if (model === "gemini-3.8-flash-tts") chain.push("gemini-3.8-flash-lite-tts");
  if (!isLegacy(model)) chain.push("gemini-3.1-flash-tts-preview");
  return [...new Set(chain)];
}

type Env = Record<string, string | undefined>;

// Ключи по порядку: основной и, если задан и не совпадает с ним, второй. Без
// основного второй не используется (auto выбирает Gemini только по GEMINI_API_KEY).
function geminiKeys(env: Env): string[] {
  const first = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim();
  const second = (env.GEMINI_API_KEY_2 ?? "").trim();
  if (!first) return [];
  return second && second !== first ? [first, second] : [first];
}

// Сколько разных ключей задано — для строки в логе make (сами ключи наружу не отдаём).
export const geminiKeyCount = (env: Env = process.env): number => geminiKeys(env).length;

const KEY_VARS = ["GEMINI_API_KEY", "GEMINI_API_KEY_2"] as const;

interface InteractionsResponse {
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string; sample_rate?: number }[] }[];
}
interface GenerateContentResponse {
  candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
}

// Ответ Gemini → PCM: WAV с заголовком или сырой L16 (rate=… в mime-типе).
export function geminiAudioToPcm(b64: string, mime: string, sampleRateHint?: number): RawAudio {
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) throw new TtsError("Gemini TTS: пустое аудио в ответе.", { retryable: true });
  if (isWav(bytes)) return { kind: "pcm", audio: decodeWav(bytes) };
  if (/mpeg|mp3/i.test(mime)) return { kind: "mp3", bytes };
  const rate = Number(/rate=(\d+)/i.exec(mime)?.[1] ?? sampleRateHint ?? 24000);
  return { kind: "pcm", audio: decodePcm16(bytes, rate) };
}

const INVALID_KEY = /API key not valid|API_KEY_INVALID|valid API key/i;

export function geminiProvider(): RawProvider {
  const keys = geminiKeys(process.env);
  const model = process.env.GEMINI_TTS_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const baseStyle = process.env.GEMINI_TTS_STYLE?.trim() || GEMINI_DEFAULT_STYLE;
  const timeoutMs = envInt("TTS_TIMEOUT_MS", 120_000);
  const chain = geminiModelChain(model);
  // Шорт ≈ 700–900 символов — один запрос; длинный ролик — по ~2500 символов.
  const batchMaxChars = envInt("GEMINI_TTS_BATCH_CHARS", 2500);
  // Пары (модель, ключ) по порядку попыток; с одним ключом — ровно цепочка моделей.
  const pairs = chain.flatMap((m, mi) => keys.map((_, ki) => ({ m, mi, ki })));
  // С какой пары начинать: после перехода — с той, что ответила («липко»: остальные
  // сцены и запросы — тем же голосом и тем же проектом).
  let start = 0;
  const rejected = new Set<number>(); // ключи с 401/403 — дальше не пробуем (только если есть другой)
  // Номер ключа — в подписях ошибок и логе, только когда ключей два (с одним — как раньше).
  const labelOf = (m: string, ki: number) => (keys.length > 1 ? `${m}, ключ ${ki + 1}` : m);
  const nextAlive = (p: number) => {
    for (let q = p + 1; q < pairs.length; q++) if (!rejected.has(pairs[q]!.ki)) return q;
    return -1;
  };
  return {
    name: "gemini",
    output: "wav",
    batchMaxChars,
    resolveVoice: (v) => {
      const own = process.env.GEMINI_TTS_VOICE?.trim();
      // Голоса Gemini — одно слово с заглавной (Kore, Puck); edge/piper-имена из TTS_VOICE игнорируем.
      const cand = own || v;
      return cand && /^[A-Z][a-z]+$/.test(cand) ? cand : GEMINI_DEFAULT_VOICE;
    },
    // Ключ сюда не входит: голос у обоих проектов тот же — общий кэш годится для любого.
    configKey: () => `gemini:${model}:${baseStyle}`,
    async synthesizeRaw(text, ctx) {
      if (!keys.length) throw new TtsError("Gemini TTS: не задан GEMINI_API_KEY (ключ бесплатно: https://aistudio.google.com/apikey).");
      let lastErr: TtsError | null = null;
      let quotaErr: TtsError | null = null; // 429 хоть у одной модели — главная причина для сводки запуска
      for (let p = start; p < pairs.length; p++) {
        const { m, mi, ki } = pairs[p]!;
        if (rejected.has(ki)) continue;
        const label = labelOf(m, ki);
        for (let attempt = 1; ; attempt++) {
          try {
            const audio = await callModel(m, keys[ki]!, label, text, ctx);
            start = p; // «липкий» запасной вариант: остальные сцены — той же парой
            const out = mi > 0 ? { ...audio, fallback: m } : audio;
            return keys.length > 1 ? { ...out, keyIndex: ki + 1 } : out;
          } catch (err) {
            const e = safeError(err, label, keys);
            // Gemini на неверный ключ обычно отвечает 400 API_KEY_INVALID, а не 401/403.
            const badKey = e.status === 401 || e.status === 403 || (e.status === 400 && INVALID_KEY.test(e.message));
            const other = badKey ? keys.findIndex((_, i) => i !== ki && !rejected.has(i)) : -1;
            if (badKey && (other >= 0 || e.status !== 400)) {
              // Ключ неверный — другие модели с ним не помогут. Есть второй рабочий — дальше им;
              // единственный неверный ключ на 400 идёт по цепочке моделей, как раньше.
              if (other < 0) throw e;
              rejected.add(ki);
              lastErr = e;
              console.warn(`[озвучка] ${e.message} Ключ ${ki + 1} пропускаю (проверьте секрет ${KEY_VARS[ki]}) — продолжаю ключом ${other + 1}.`);
              break;
            }
            const wait = sameModelWait(e, attempt);
            if (wait !== null && !ctx.signal?.aborted) {
              console.warn(`[озвучка] Gemini TTS (${label}): ${e.status === 429 ? "лимит запросов в минуту" : `сбой сервиса (HTTP ${e.status})`} — жду ${Math.ceil(wait / 1000)} с и повторяю…`);
              await sleep(wait, ctx.signal);
              continue;
            }
            const fallThrough = e.status === 429 || e.status === 404 || e.status === 400 || (e.status ?? 0) >= 500;
            if (!fallThrough) throw e;
            lastErr = e;
            if (e.status === 429) quotaErr ??= e;
            // 404/400/5xx — дело в модели, а не в проекте: второй ключ той же модели пропускаем.
            if (e.status !== 429) while (p + 1 < pairs.length && pairs[p + 1]!.mi === mi) p++;
            const q = nextAlive(p);
            const next = q >= 0 ? pairs[q]! : null;
            if (next && next.mi === mi) console.warn(`[озвучка] Gemini: квота ключа ${ki + 1} исчерпана (${m}) — продолжаю ключом ${next.ki + 1} (та же модель)…`);
            else if (next) console.warn(`[озвучка] ${e.message} Пробую следующую модель (${labelOf(next.m, next.ki)}) — ею будет озвучен и остаток ролика…`);
            break;
          }
        }
      }
      // Квота кончилась у основной, а запасная модель ответила 404/5xx — наверх отдаём
      // именно 429: по нему make пишет «квота Gemini закончилась — ролик соберётся при повторе».
      if (quotaErr && lastErr !== quotaErr) console.warn(`[озвучка] ${lastErr?.message ?? ""}`);
      throw quotaErr ?? lastErr ?? new TtsError("Gemini TTS: ни одна модель не ответила.", { retryable: true });
    },
  };

  async function callModel(m: string, key: string, label: string, text: string, ctx: RawContext): Promise<RawAudio> {
    // Несколько сцен в одном запросе (абзацы) — просим явную паузу между ними:
    // по ней звук потом режется на сцены.
    const style = text.includes("\n\n") ? `${baseStyle.replace(/[.!?…\s]+$/u, "")}. Между абзацами — пауза около секунды.` : baseStyle;
    const headers = { "x-goog-api-key": key, "Content-Type": "application/json" }; // ключ — только в заголовке, не в адресе
    if (!isLegacy(m)) {
      const r = await httpRequest(`Gemini TTS (${label})`, `${BASE}/interactions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: m,
          input: [{ type: "text", text, annotations: style ? [{ type: "speech_metadata", style }] : [] }],
          response_format: { type: "audio", mime_type: "audio/wav" },
          // Язык ролика (TTS_LANGUAGE ставит make по сценарию); по умолчанию — русский канал.
          generation_config: { speech_config: [{ voice: ctx.voice, language: process.env.TTS_LANGUAGE?.trim() || "ru" }] },
        }),
      }, { timeoutMs, signal: ctx.signal });
      const j = JSON.parse(r.body.toString("utf8")) as InteractionsResponse;
      const audio = (j.steps ?? [])
        .filter((s) => s.type === "model_output")
        .flatMap((s) => s.content ?? [])
        .reverse()
        .find((c) => c.type === "audio" && c.data);
      if (!audio?.data) throw new TtsError(`Gemini TTS (${label}): в ответе нет аудио.`, { retryable: true });
      return geminiAudioToPcm(audio.data, audio.mime_type ?? "audio/wav", audio.sample_rate);
    }
    // Старый путь: режиссура — фразой перед текстом в форме «Как читать: текст»,
    // как в примерах Google (модель выполняет указание, а не озвучивает его).
    const r = await httpRequest(`Gemini TTS (${label})`, `${BASE}/models/${m}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: style ? `${style.replace(/[.!?…\s]+$/u, "")}:\n${text}` : text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ctx.voice } } } },
      }),
    }, { timeoutMs, signal: ctx.signal });
    const j = JSON.parse(r.body.toString("utf8")) as GenerateContentResponse;
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new TtsError(`Gemini TTS (${label}): в ответе нет аудио.`, { retryable: true });
    return geminiAudioToPcm(part.data, part.mimeType ?? "audio/L16;codec=pcm;rate=24000");
  }
}

// Ключ не должен попасть ни в лог, ни в qc.json, ни в сводку запуска. Google его в
// ответе не повторяет, но текст ошибки всё равно проверяем: нашёлся — заменяем на «***»
// и отбрасываем cause (там мог остаться исходный текст).
function safeError(err: unknown, label: string, keys: string[]): TtsError {
  const e = err instanceof TtsError ? err : new TtsError(`Gemini TTS (${label}): ${(err as Error).message}`, { retryable: true, cause: err });
  if (!keys.some((k) => errorText(e).includes(k))) return e;
  const message = keys.reduce((s, k) => s.split(k).join("***"), e.message);
  return new TtsError(message, { retryable: e.retryable, status: e.status, retryAfterMs: e.retryAfterMs, quotaId: e.quotaId });
}

function errorText(e: unknown, depth = 0): string {
  if (!(e instanceof Error)) return String(e);
  return depth < 5 && e.cause !== undefined ? `${e.message}\n${errorText(e.cause, depth + 1)}` : e.message;
}

// Когда повторить ту же модель вместо перехода на следующую: 429 с квотой «в
// минуту» (или с RetryInfo без id квоты) — ждём сколько сказано (до ~1 мин),
// не больше двух раз; 5xx — один повтор через 3 с. Суточная квота, 404, 400
// и 429 без подробностей — сразу дальше по цепочке.
function sameModelWait(e: TtsError, attempt: number): number | null {
  if (e.status === 429) {
    const perDay = /PerDay/i.test(e.quotaId ?? "");
    const perMinute = /PerMinute/i.test(e.quotaId ?? "") || (!e.quotaId && e.retryAfterMs !== undefined);
    if (perDay || !perMinute || attempt > 2) return null;
    const ms = (e.retryAfterMs ?? 20_000) + 1000;
    return ms <= 66_000 ? ms : null;
  }
  if ((e.status ?? 0) >= 500 && attempt === 1) return 3000;
  return null;
}
