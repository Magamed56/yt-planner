// Публикация Reels через ОФИЦИАЛЬНЫЙ Instagram API — вариант «Instagram API
// with Facebook Login for Business» (graph.facebook.com). Только он умеет
// resumable-загрузку ЛОКАЛЬНОГО файла на rupload.facebook.com — без публичной
// ссылки на видео (вариант «with Instagram Login», graph.instagram.com,
// принимает Reels только по video_url, а у нас видео лежит в папке/раннере).
// Нужен профессиональный аккаунт Instagram (Business), привязанный к странице
// Facebook, и токен с instagram_basic + instagram_content_publish +
// pages_read_engagement (+ pages_show_list). Настройка — docs/instagram-setup.md.
//
// Шаги (документация Meta «Content Publishing», Reels, resumable upload):
//   1) POST /{ig-user-id}/media  media_type=REELS, upload_type=resumable, caption,
//      share_to_feed, thumb_offset → { id: <контейнер>, uri }
//   2) POST https://rupload.facebook.com/ig-api-upload/<версия>/<контейнер>
//      заголовки Authorization: OAuth <токен>, offset: 0, file_size: <байт>; тело — байты MP4
//   3) GET /{контейнер}?fields=status_code,status — до FINISHED (ERROR/EXPIRED — стоп)
//   4) POST /{ig-user-id}/media_publish  creation_id=<контейнер> → { id: <медиа> }
// Отложенной публикации у API Instagram нет — расписание делает workflow
// (.github/workflows/video-studio-instagram.yml).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VideoScript } from "../types";
import { topicHashtags, uniqueHashtags, type ChannelConfig } from "./channel";

export const IG_DEFAULT_HOST = "graph.facebook.com";
export const IG_UPLOAD_HOST = "rupload.facebook.com";
export const IG_DEFAULT_VERSION = "v26.0"; // Graph API v26.0 — 29.07.2026
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS_MAX = 30;
export const IG_REEL_MAX_BYTES = 300 * 1024 * 1024; // лимит Reels — 300 МБ, 3 с – 15 мин

export interface InstagramConfig {
  userId: string;
  token: string;
  host: string;
  version: string;
  uploadHost: string;
}

export function missingInstagramEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return ["IG_USER_ID", "IG_ACCESS_TOKEN"].filter((k) => !env[k]?.trim());
}

export function instagramEnvHelp(): string {
  return (
    "Для публикации в Instagram нужны IG_USER_ID и IG_ACCESS_TOKEN.\n" +
    "  1) Instagram: профессиональный аккаунт (Бизнес), привязанный к странице Facebook.\n" +
    "  2) developers.facebook.com → приложение → «Instagram API» → вариант «with Facebook Login for Business».\n" +
    "  3) Graph API Explorer: токен с instagram_basic, instagram_content_publish, pages_read_engagement, pages_show_list.\n" +
    "  4) npm run instagram-token — продлит токен до ~60 дней и покажет IG_USER_ID.\n" +
    "  Подробно, по шагам: docs/instagram-setup.md."
  );
}

export function instagramConfig(env: NodeJS.ProcessEnv = process.env): InstagramConfig {
  const missing = missingInstagramEnv(env);
  if (missing.length) throw new InstagramError(`Не заданы ${missing.join(", ")}.\n${instagramEnvHelp()}`);
  const userId = env.IG_USER_ID!.trim();
  const token = env.IG_ACCESS_TOKEN!.trim();
  const host = (env.IG_API_HOST?.trim() || IG_DEFAULT_HOST).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const rawVersion = env.IG_API_VERSION?.trim() || IG_DEFAULT_VERSION;
  const version = /^v?\d+\.\d+$/.test(rawVersion) ? (rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`) : IG_DEFAULT_VERSION;
  if (!/^\d+$/.test(userId)) {
    throw new InstagramError(
      `IG_USER_ID="${userId}" — это должен быть числовой id Instagram-аккаунта (например 17841400000000000), а не @ник и не id страницы Facebook. Узнать: npm run instagram-token.`,
    );
  }
  // IG… — токен «Instagram Login»: с ним rupload не работает (только Facebook Login for Business).
  if (/^IG/i.test(token) && host === IG_DEFAULT_HOST) {
    throw new InstagramError(
      "IG_ACCESS_TOKEN начинается с «IG» — это токен варианта «Instagram API with Instagram Login». Загрузка файла без публичной ссылки " +
        "(resumable) у Meta работает только с «Facebook Login for Business»: нужен токен, который начинается с «EAA…». " +
        "Как получить — docs/instagram-setup.md, шаг «Токен».",
    );
  }
  return { userId, token, host, version, uploadHost: IG_UPLOAD_HOST };
}

// ---- Ошибки ----

// Ошибка уже с подсказкой, что делать: CLI печатает её без стека и без «запустите с DEBUG=1».
export class InstagramError extends Error {
  readonly userFacing = true;
}

export class InstagramApiError extends InstagramError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly transient: boolean,
    readonly raw: string,
  ) {
    super(message);
  }
}

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; is_transient?: boolean; error_user_msg?: string; fbtrace_id?: string };
}

const RATE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80004]);

// Понятные причины частых отказов (коды из таблицы ошибок Meta).
export function explainInstagramError(status: number, code: number | null, subcode: number | null, message: string): string {
  if (code === 190) {
    const why = subcode === 463 ? "истёк (живёт ~60 дней)" : subcode === 460 ? "отозван — сменили пароль Facebook" : subcode === 458 ? "отозван — приложение удалено из аккаунта" : "недействителен или истёк";
    return `токен IG_ACCESS_TOKEN ${why}. Получите новый: npm run instagram-token -- --exchange (docs/instagram-setup.md, «Продление токена») и обновите секрет IG_ACCESS_TOKEN в GitHub.`;
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    return "у токена нет нужного разрешения. Выпустите токен заново с галочками instagram_basic, instagram_content_publish, pages_read_engagement, pages_show_list (docs/instagram-setup.md, «Токен»).";
  }
  if (subcode === 2207042) return "достигнут лимит публикаций через API (скользящие 24 часа, у Meta 50–100 постов) — следующий ролик выйдет позже.";
  if (subcode === 2207051) return "Instagram временно ограничил действия аккаунта (похоже на спам). Подождите сутки и публикуйте реже; проверьте уведомления в приложении.";
  if (subcode === 2207026) return "видео не подходит для Reels: нужен MP4 (H.264 + AAC до 48 кГц), 3 с – 15 мин, до 300 МБ, лучше 9:16 и 1080×1920.";
  if (subcode === 2207006 || subcode === 2207020) return "контейнер не найден или истёк (живёт 24 часа) — запустите публикацию заново.";
  if (code === 100 && subcode === 33) return "объект не найден: проверьте IG_USER_ID (числовой id Instagram-аккаунта; узнать — npm run instagram-token) и что токен выдан для этого аккаунта.";
  if (code === 100 && /thumb_offset/i.test(message)) return "неверный thumb_offset (кадр обложки) — он должен быть внутри ролика.";
  if (code !== null && RATE_CODES.has(code)) return "превышен лимит запросов к API Meta — подождите около часа и повторите.";
  if (status === 429) return "слишком много запросов к API Meta — подождите около часа и повторите.";
  if (code === 9007 || subcode === 2207027) return "Instagram ещё обрабатывает видео — повторите публикацию через минуту.";
  return `HTTP ${status}${code !== null ? `, код ${code}${subcode ? `/${subcode}` : ""}` : ""}: ${message}`;
}

function apiError(status: number, text: string, where: string): InstagramApiError {
  let body: GraphErrorBody = {};
  try {
    body = JSON.parse(text) as GraphErrorBody;
  } catch {
    // не JSON (например, HTML от прокси)
  }
  const e = body.error ?? {};
  const code = typeof e.code === "number" ? e.code : null;
  const subcode = typeof e.error_subcode === "number" ? e.error_subcode : null;
  const message = (e.error_user_msg || e.message || text.slice(0, 300) || `HTTP ${status}`).trim();
  const transient = Boolean(e.is_transient) || status >= 500 || code === 1 || code === 2 || code === -1 || code === -2;
  return new InstagramApiError(`Instagram (${where}): ${explainInstagramError(status, code, subcode, message)}`, status, code, subcode, transient, text.slice(0, 2000));
}

// ---- HTTP ----

type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  cfg: InstagramConfig;
  fetch: Fetch;
  sleep: Sleep;
  log: (m: string) => void;
}

const isNetworkError = (e: unknown) => !(e instanceof InstagramError);
const errText = (e: unknown) => {
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  return `${e instanceof Error ? e.message : String(e)}${code ? `: ${code}` : ""}`;
};

// Один запрос к Graph API. Токен — параметром access_token (так в документации),
// URL с токеном никогда не печатается.
async function graph<T>(ctx: Ctx, method: "GET" | "POST", pathname: string, params: Record<string, string>, where: string, timeoutMs = 60_000): Promise<T> {
  const url = new URL(`https://${ctx.cfg.host}/${ctx.cfg.version}/${pathname.replace(/^\/+/, "")}`);
  const all = { ...params, access_token: ctx.cfg.token };
  let res: Response;
  if (method === "GET") {
    for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
    res = await ctx.fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) });
  } else {
    res = await ctx.fetch(url, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(all).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  const text = await res.text();
  // Meta иногда отвечает 200 с объектом error в теле — это тоже ошибка.
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  if (!res.ok || json === null || (json as GraphErrorBody).error) throw apiError(res.status, text, where);
  return json as T;
}

// Повтор при сбое сети и временных ошибках (5xx, is_transient) — только для
// запросов без побочных эффектов или с безвредными (лишний контейнер сам истечёт).
async function withRetry<T>(ctx: Ctx, what: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retry = isNetworkError(e) || (e instanceof InstagramApiError && (e.transient || e.status === 429));
      if (!retry || i >= attempts) {
        if (isNetworkError(e)) throw new InstagramError(`Instagram: нет связи с API (${what}: ${errText(e)}). Повторите позже.`, { cause: e });
        throw e;
      }
      ctx.log(`[instagram] ${what}: ${errText(e).split("\n")[0]} — повтор через ${i * 5} с…`);
      await ctx.sleep(i * 5000);
    }
  }
}

// ---- Подготовка файла ----

// Reels: звук AAC не больше 128 кбит/с и 48 кГц (требования Meta), а наш
// рендер после выравнивания громкости пишет 320 кбит/с. Перекодируем только
// звук (видео копируется) ffmpeg'ом из Remotion — системный не нужен.
export async function prepareReelVideo(videoPath: string, log: (m: string) => void = console.log): Promise<{ file: string; cleanup: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-studio-reel-"));
  const out = path.join(dir, "reel.mp4");
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    const { RenderInternals } = await import("@remotion/renderer");
    await RenderInternals.callFf({
      bin: "ffmpeg",
      args: ["-hide_banner", "-nostats", "-y", "-i", videoPath, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out],
      indent: false,
      logLevel: "error",
      binariesDirectory: null,
      cancelSignal: undefined,
    });
    if (!fs.existsSync(out) || fs.statSync(out).size < 1024) throw new Error("пустой файл");
    return { file: out, cleanup };
  } catch (e) {
    cleanup();
    log(`[instagram] не удалось перекодировать звук под Reels (${errText(e).split("\n")[0]}) — отправляю исходный файл`);
    return { file: videoPath, cleanup: () => {} };
  }
}

// ---- Публикация ----

export interface PublishReelInput {
  videoPath: string;
  caption: string;
  thumbOffsetMs?: number | null; // кадр обложки, мс от начала ролика
  shareToFeed?: boolean; // показать Reels и в сетке профиля (по умолчанию да)
  aiGenerated?: boolean; // пометка «создано с помощью ИИ» (по умолчанию IG_AI_GENERATED, иначе да — голос синтезирован)
  dedupe?: boolean; // не публиковать, если такой же текст уже есть среди последних постов (по умолчанию да)
  prepare?: boolean; // перекодировать звук под требования Reels (по умолчанию да)
  config?: InstagramConfig;
  fetch?: Fetch;
  sleep?: Sleep;
  log?: (m: string) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface PublishReelResult {
  mediaId: string;
  containerId: string | null;
  permalink: string | null;
  publishedAt: string;
  duplicate: boolean; // true — такой пост уже был, повторно не публиковали
  quota: { usage: number; total: number } | null;
}

interface MediaItem {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
}

const normCaption = (s: string) => s.replace(/\s+/g, " ").trim();

async function findRecentByCaption(ctx: Ctx, caption: string, maxAgeMs: number): Promise<MediaItem | null> {
  const r = await graph<{ data?: MediaItem[] }>(ctx, "GET", `${ctx.cfg.userId}/media`, { fields: "id,caption,permalink,timestamp", limit: "12" }, "последние посты");
  const want = normCaption(caption);
  const now = Date.now();
  return (
    (r.data ?? []).find((m) => {
      if (!m.caption || normCaption(m.caption) !== want) return false;
      const t = m.timestamp ? Date.parse(m.timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : now;
      return !Number.isFinite(t) || now - t <= maxAgeMs;
    }) ?? null
  );
}

async function publishingQuota(ctx: Ctx): Promise<{ usage: number; total: number } | null> {
  try {
    const r = await graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      ctx,
      "GET",
      `${ctx.cfg.userId}/content_publishing_limit`,
      { fields: "config,quota_usage" },
      "лимит публикаций",
    );
    const d = r.data?.[0];
    if (typeof d?.quota_usage !== "number") return null;
    return { usage: d.quota_usage, total: d.config?.quota_total ?? 100 };
  } catch (e) {
    // Токен и права проверит следующий же запрос — а лимит лишь подсказка.
    if (e instanceof InstagramApiError && (e.code === 190 || e.code === 10 || (e.code !== null && e.code >= 200 && e.code <= 299))) throw e;
    return null;
  }
}

function checkCaption(caption: string): void {
  const len = Array.from(caption).length;
  if (len > IG_CAPTION_MAX) throw new InstagramError(`Подпись для Instagram — ${len} символов, а можно не больше ${IG_CAPTION_MAX}. Сократите instagram.txt.`);
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  if (tags > IG_HASHTAGS_MAX) throw new InstagramError(`В подписи ${tags} хэштегов, Instagram разрешает не больше ${IG_HASHTAGS_MAX}.`);
}

export async function publishReel(input: PublishReelInput): Promise<PublishReelResult> {
  const cfg = input.config ?? instagramConfig();
  const log = input.log ?? console.log;
  const ctx: Ctx = { cfg, fetch: input.fetch ?? fetch, sleep: input.sleep ?? realSleep, log };
  const caption = input.caption.trim();
  checkCaption(caption);
  if (!fs.existsSync(input.videoPath)) throw new InstagramError(`Файл видео не найден: ${input.videoPath}`);
  const dedupe = input.dedupe ?? true;

  // 0) Тот же текст уже опубликован (прошлый запуск упал после публикации) — второй раз не постим.
  if (dedupe) {
    try {
      const dup = await findRecentByCaption(ctx, caption, 14 * 86_400_000);
      if (dup) {
        log(`[instagram] такой пост уже есть (${dup.permalink ?? dup.id}) — повторно не публикую`);
        return { mediaId: dup.id, containerId: null, permalink: dup.permalink ?? null, publishedAt: dup.timestamp ?? new Date().toISOString(), duplicate: true, quota: null };
      }
    } catch (e) {
      if (e instanceof InstagramApiError && (e.code === 190 || e.code === 100)) throw e; // токен / IG_USER_ID — дальше смысла нет
      log(`[instagram] не удалось проверить последние посты (${errText(e).split("\n")[0]}) — продолжаю`);
    }
  }

  const quota = await publishingQuota(ctx);
  if (quota) {
    log(`[instagram] лимит публикаций через API: ${quota.usage} из ${quota.total} за 24 ч`);
    if (quota.usage >= quota.total) throw new InstagramError(`Instagram: лимит публикаций через API исчерпан (${quota.usage}/${quota.total} за скользящие 24 ч) — повторите позже.`);
  }

  const prepared = input.prepare === false ? { file: input.videoPath, cleanup: () => {} } : await prepareReelVideo(input.videoPath, log);
  try {
    const size = fs.statSync(prepared.file).size;
    if (size > IG_REEL_MAX_BYTES) throw new InstagramError(`Видео ${(size / 1048576).toFixed(0)} МБ — для Reels нужно не больше 300 МБ.`);
    if (size < 1024) throw new InstagramError(`Файл ${input.videoPath} почти пустой (${size} байт) — пересоберите ролик.`);

    // 1) Контейнер
    const params: Record<string, string> = {
      media_type: "REELS",
      upload_type: "resumable",
      caption,
      share_to_feed: String(input.shareToFeed ?? true),
    };
    if (input.thumbOffsetMs != null && Number.isFinite(input.thumbOffsetMs) && input.thumbOffsetMs >= 0) params.thumb_offset = String(Math.round(input.thumbOffsetMs));
    const ai = input.aiGenerated ?? !["0", "false", "no", "нет"].includes((process.env.IG_AI_GENERATED ?? "1").trim().toLowerCase());
    if (ai) params.is_ai_generated = "true";
    let container: { id?: string; uri?: string };
    try {
      container = await withRetry(ctx, "создание контейнера", () => graph(ctx, "POST", `${cfg.userId}/media`, params, "создание контейнера"));
    } catch (e) {
      // Пометка ИИ появилась в API в 2026 г.; если версия/аккаунт её не знает — публикуем без неё.
      if (!(ai && e instanceof InstagramApiError && e.code === 100 && /is_ai_generated/i.test(e.raw))) throw e;
      log("[instagram] API не принял пометку is_ai_generated — создаю контейнер без неё (отметьте «Создано с ИИ» в приложении)");
      delete params.is_ai_generated;
      container = await withRetry(ctx, "создание контейнера", () => graph(ctx, "POST", `${cfg.userId}/media`, params, "создание контейнера"));
    }
    const containerId = container.id;
    if (!containerId) throw new InstagramError("Instagram не вернул id контейнера.");
    log(`[instagram] контейнер ${containerId} создан, загружаю видео (${(size / 1048576).toFixed(1)} МБ)…`);

    // 2) Байты видео — на rupload. Токен отдаём только своему хосту загрузки.
    let uploadUrl = `https://${cfg.uploadHost}/ig-api-upload/${cfg.version}/${containerId}`;
    if (container.uri) {
      try {
        const u = new URL(container.uri);
        if (u.protocol === "https:" && u.hostname === cfg.uploadHost) uploadUrl = u.toString();
      } catch {
        // неверный uri — используем адрес из документации
      }
    }
    const bytes = new Uint8Array(fs.readFileSync(prepared.file));
    await withRetry(ctx, "загрузка видео", async () => {
      const res = await ctx.fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `OAuth ${cfg.token}`, offset: "0", file_size: String(size), "Content-Type": "application/octet-stream" },
        body: bytes,
        signal: AbortSignal.timeout(15 * 60_000),
      });
      const text = await res.text();
      let ok = false;
      try {
        ok = (JSON.parse(text) as { success?: boolean }).success === true;
      } catch {
        ok = false;
      }
      // Успех rupload — только {"success": true}; остальное значит, что байты не приняты.
      if (!res.ok || !ok) throw apiError(res.ok ? 500 : res.status, text, "загрузка видео");
    });

    // 3) Ждём обработку.
    const interval = input.pollIntervalMs ?? 10_000;
    const deadline = Date.now() + (input.pollTimeoutMs ?? 10 * 60_000);
    for (let i = 0; ; i++) {
      const st = await withRetry(ctx, "статус обработки", () => graph<{ status_code?: string; status?: string }>(ctx, "GET", containerId, { fields: "status_code,status" }, "статус обработки"));
      const code = st.status_code ?? "IN_PROGRESS";
      if (code === "FINISHED") break;
      if (code === "PUBLISHED") return await finish(ctx, containerId, null, quota, caption);
      if (code === "ERROR") {
        const sub = /\b(22\d{5})\b/.exec(st.status ?? "")?.[1];
        throw new InstagramError(
          `Instagram не смог обработать видео${st.status ? ` (${st.status})` : ""}: ${sub ? explainInstagramError(400, null, Number(sub), st.status ?? "") : "проверьте формат — MP4 H.264 + AAC, 3 с – 15 мин, до 300 МБ, 9:16."}`,
        );
      }
      if (code === "EXPIRED") throw new InstagramError("Контейнер Instagram истёк (не опубликован за 24 часа) — запустите публикацию заново.");
      if (Date.now() >= deadline) throw new InstagramError(`Instagram обрабатывает видео дольше обычного (контейнер ${containerId}). Повторите позже — дубля не будет: перед публикацией проверяются последние посты.`);
      if (i % 3 === 0) log("[instagram] Instagram обрабатывает видео…");
      await ctx.sleep(interval);
    }

    // 4) Публикация. Ошибку сети здесь вслепую не повторяем: сначала смотрим
    // статус контейнера — пост мог выйти, а ответ потеряться.
    let mediaId: string | null = null;
    for (let attempt = 1; !mediaId; attempt++) {
      try {
        const r = await graph<{ id?: string }>(ctx, "POST", `${cfg.userId}/media_publish`, { creation_id: containerId }, "публикация", 120_000);
        if (!r.id) throw new InstagramError("Instagram не вернул id опубликованного поста.");
        mediaId = r.id;
      } catch (e) {
        const notReady = e instanceof InstagramApiError && (e.code === 9007 || e.subcode === 2207027);
        const unknown = isNetworkError(e) || (e instanceof InstagramApiError && (e.transient || e.subcode === 2207008));
        if ((!notReady && !unknown) || attempt >= 4) throw isNetworkError(e) ? new InstagramError(`Instagram: нет связи при публикации (${errText(e)}).`, { cause: e }) : e;
        if (unknown) {
          const st = await graph<{ status_code?: string }>(ctx, "GET", containerId, { fields: "status_code" }, "статус контейнера").catch(() => null);
          if (st?.status_code === "PUBLISHED") return await finish(ctx, containerId, null, quota, caption);
        }
        log(`[instagram] ${errText(e).split("\n")[0]} — повтор через ${attempt * 15} с…`);
        await ctx.sleep(attempt * 15_000);
      }
    }
    return await finish(ctx, containerId, mediaId, quota, caption);
  } finally {
    prepared.cleanup();
  }
}

// Ссылка на пост (permalink) — для сводки; если медиа неизвестно (ответ
// потерялся, а контейнер PUBLISHED) — ищем пост по тексту.
async function finish(ctx: Ctx, containerId: string, mediaId: string | null, quota: PublishReelResult["quota"], caption: string): Promise<PublishReelResult> {
  let id = mediaId;
  let permalink: string | null = null;
  let timestamp: string | null = null;
  if (!id) {
    const found = await findRecentByCaption(ctx, caption, 86_400_000).catch(() => null);
    if (!found) throw new InstagramError(`Instagram: контейнер ${containerId} опубликован, но пост не найден среди последних — проверьте профиль в приложении.`);
    id = found.id;
    permalink = found.permalink ?? null;
    timestamp = found.timestamp ?? null;
  }
  if (!permalink) {
    try {
      const m = await graph<{ permalink?: string; timestamp?: string }>(ctx, "GET", id, { fields: "permalink,timestamp" }, "ссылка на пост");
      permalink = m.permalink ?? null;
      timestamp = m.timestamp ?? null;
    } catch {
      // ссылка — приятное дополнение, пост уже вышел
    }
  }
  ctx.log(`[instagram] опубликовано: ${permalink ?? id}`);
  return { mediaId: id, containerId, permalink, publishedAt: timestamp ?? new Date().toISOString(), duplicate: false, quota };
}

// ---- Подпись к Reels ----

const stripMarks = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
const stripLinks = (s: string) => s.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "").replace(/\s{2,}/g, " ").trim();

function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

// Хэштеги Reels: бренд, 2 по теме, затем вперемешку общие и «инстаграмные» —
// 5–8 штук (больше Instagram сам не советует).
export function instagramHashtags(script: Pick<VideoScript, "tags">, channel: ChannelConfig | null, max = 8): string[] {
  const topic = topicHashtags(script.tags ?? [], 2);
  if (!channel) return uniqueHashtags(topic).slice(0, max);
  const core = channel.hashtags.core;
  const ig = channel.hashtags.instagram;
  const mixed: string[] = [];
  for (let i = 0; i < Math.max(core.length, ig.length); i++) {
    if (core[i]) mixed.push(core[i]!);
    if (ig[i]) mixed.push(ig[i]!);
  }
  return uniqueHashtags([...channel.hashtags.brand, ...topic, ...mixed])
    .filter((h) => !/^#shorts$/i.test(h))
    .slice(0, max);
}

// instagram.txt: цепляющая первая строка (её видно до «ещё»), 1–2 строки сути,
// призыв, хэштеги. Ссылки в подписи Instagram не кликабельны — их нет.
export function buildInstagramCaption(script: VideoScript, channel: ChannelConfig | null): string {
  const hookScene = script.scenes.find((s) => s.kind === "hook") ?? script.scenes[0];
  const hook = stripLinks(stripMarks(hookScene?.narration || script.title)).slice(0, 200);
  const hookNorm = hook.toLowerCase();
  const value: string[] = [];
  let budget = 320;
  // Хэштеги из описания YouTube (там бывает #shorts) — не в текст: свои ставим ниже.
  const descr = stripLinks(stripMarks((script.description ?? "").replace(/#[\p{L}\p{N}_]+/gu, " ")));
  for (const s of sentences(descr)) {
    if (value.length >= 2 || s.length > budget) break;
    if (s.toLowerCase() === hookNorm) continue;
    value.push(s);
    budget -= s.length;
  }
  if (!value.length && script.title && script.title.toLowerCase() !== hookNorm) value.push(stripMarks(script.title));
  const cta: string[] = [];
  if (channel?.cta.comment) cta.push(`💬 ${channel.cta.comment.replace(/[.!]+$/, "")} 👇`);
  cta.push(`🔔 ${channel?.cta.subscribe ?? "Подпишись, чтобы не пропустить новые ролики"}`);
  const tags = instagramHashtags(script, channel).join(" ");
  const compose = (v: string[]) => [hook, v.join("\n"), cta.join("\n"), tags].filter(Boolean).join("\n\n");
  let text = compose(value);
  while (Array.from(text).length > IG_CAPTION_MAX && value.length) {
    value.pop();
    text = compose(value);
  }
  return Array.from(text).slice(0, IG_CAPTION_MAX).join("");
}

// ---- Папка ролика ----

export interface InstagramMeta {
  caption: string; // то же, что instagram.txt на момент сборки (правьте instagram.txt — он главнее)
  thumbOffsetMs: number | null;
  shareToFeed: boolean;
  cover: string | null; // имя файла обложки в папке ролика (для ручной публикации)
}

export const IG_CAPTION_FILE = "instagram.txt";
export const IG_META_FILE = "instagram.json";
export const IG_RESULT_FILE = "instagram-result.json";

export function writeInstagramAssets(runDir: string, meta: InstagramMeta): { captionFile: string; metaFile: string } {
  const captionFile = path.join(runDir, IG_CAPTION_FILE);
  const metaFile = path.join(runDir, IG_META_FILE);
  fs.writeFileSync(captionFile, meta.caption.endsWith("\n") ? meta.caption : `${meta.caption}\n`);
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
  return { captionFile, metaFile };
}

export function readInstagramAssets(runDir: string): InstagramMeta {
  const captionFile = path.join(runDir, IG_CAPTION_FILE);
  const metaFile = path.join(runDir, IG_META_FILE);
  let meta: Partial<InstagramMeta> = {};
  if (fs.existsSync(metaFile)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as Partial<InstagramMeta>;
    } catch {
      meta = {};
    }
  }
  // instagram.txt — то, что проверил и, возможно, поправил человек.
  const caption = fs.existsSync(captionFile) ? fs.readFileSync(captionFile, "utf8").replace(/^﻿/, "").trim() : (meta.caption ?? "").trim();
  if (!caption) throw new InstagramError(`В папке ${runDir} нет ${IG_CAPTION_FILE} — пересоберите ролик свежей версией npm run make.`);
  return {
    caption,
    thumbOffsetMs: typeof meta.thumbOffsetMs === "number" ? meta.thumbOffsetMs : null,
    shareToFeed: meta.shareToFeed !== false,
    cover: typeof meta.cover === "string" ? meta.cover : null,
  };
}

export interface RunDirPublishResult extends PublishReelResult {
  resultFile: string;
}

// Опубликовать ролик из папки (video.mp4 + instagram.txt [+ instagram.json]).
// instagram-result.json защищает от второй публикации того же ролика.
export async function publishRunDir(runDir: string, opts: { force?: boolean; log?: (m: string) => void } & Pick<PublishReelInput, "fetch" | "sleep" | "config" | "prepare"> = {}): Promise<RunDirPublishResult> {
  const video = path.join(runDir, "video.mp4");
  if (!fs.existsSync(video)) throw new InstagramError(`В ${runDir} нет video.mp4 — сначала соберите ролик: npm run make -- …`);
  const resultFile = path.join(runDir, IG_RESULT_FILE);
  if (fs.existsSync(resultFile) && !opts.force) {
    const prev = JSON.parse(fs.readFileSync(resultFile, "utf8")) as { permalink?: string; mediaId?: string };
    throw new InstagramError(`Этот ролик уже опубликован в Instagram (${prev.permalink ?? prev.mediaId ?? "см. instagram-result.json"}). Ещё раз — с --force.`);
  }
  const meta = readInstagramAssets(runDir);
  const r = await publishReel({ videoPath: video, caption: meta.caption, thumbOffsetMs: meta.thumbOffsetMs, shareToFeed: meta.shareToFeed, dedupe: !opts.force, ...opts });
  fs.writeFileSync(resultFile, JSON.stringify(r, null, 2) + "\n");
  return { ...r, resultFile };
}
