// Кросспостинг готового ролика в канал Telegram через ОФИЦИАЛЬНЫЙ Bot API
// (api.telegram.org, метод sendVideo). Бот — администратор канала с правом
// «Публикация сообщений», токен выдаёт @BotFather. Настройка — docs/telegram-setup.md.
//
// Почему так:
//   - multipart/form-data на встроенных fetch/FormData/Blob — без npm-пакетов;
//   - бот загружает файл не больше 50 МБ, а рендер по умолчанию (VIDEO_QUALITY=high, CRF 15) даёт
//     ≈ 11 Мбит/с: шорт на 33 с — 48 МБ, на 57 с — ≈ 80 МБ. Размер проверяем до отправки и больший
//     файл пережимаем в копию до 45 МБ ffmpeg'ом из Remotion (системный не нужен);
//   - подпись — telegram.txt (если человек написал свою) или instagram.txt, лимит 1024 символа;
//   - обложка — cover.jpg параметром cover (Bot API 8.3+). Параметр thumbnail не годится:
//     ему нужен JPEG до 200 КБ и не больше 320×320, а cover.jpg — 1080×1920;
//   - отложенной публикации у ботов нет — расписание делает workflow
//     (.github/workflows/video-studio-telegram.yml, очередь в релизах GitHub);
//   - историю канала бот читать не может, поэтому от дублей защищает отметка
//     telegram-result.json: «sending» пишется ДО отправки, и оборванная отправка
//     вслепую не повторяется.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TG_API_HOST = "api.telegram.org";
export const TG_CAPTION_MAX = 1024;
// Лимит загрузки ботом — «50 MB»; точно (двоичные или десятичные, считается ли обложка) Bot API
// не пишет, поэтому на ответ «слишком большой» sendVideo пережимает копию и повторяет.
export const TG_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const TG_TARGET_BYTES = 45 * 1024 * 1024; // цель пережатия: запас на погрешность битрейта и обложку
export const TG_COVER_MAX_BYTES = 10 * 1024 * 1024; // обложка — как фото
export const TG_CAPTION_FILE = "telegram.txt";
export const TG_RESULT_FILE = "telegram-result.json";
const RETRY_AFTER_MAX_S = 120; // дольше ждать в CI нет смысла — пусть повторит следующий запуск

export interface TelegramConfig {
  token: string;
  chatId: string; // -100… или @имя публичного канала
  host: string;
}

export function missingTelegramEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"].filter((k) => !env[k]?.trim());
}

export function telegramEnvHelp(): string {
  return (
    "Для отправки в Telegram нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.\n" +
    "  1) @BotFather → /newbot → токен вида 123456789:AA… — это TELEGRAM_BOT_TOKEN.\n" +
    "  2) Канал → «Управление каналом» → «Администраторы» → добавьте бота с правом «Публикация сообщений».\n" +
    "  3) npm run telegram-check — покажет id канала (TELEGRAM_CHAT_ID: -100… или @имя публичного канала).\n" +
    "  Подробно, по шагам: docs/telegram-setup.md."
  );
}

// Ошибка уже с подсказкой, что делать: CLI печатает её без стека.
export class TelegramError extends Error {
  readonly userFacing = true;
  // true — запрос мог дойти до Telegram: повторять вслепую нельзя, будет дубль поста.
  readonly maybeSent: boolean;
  constructor(message: string, opts: { cause?: unknown; maybeSent?: boolean } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.maybeSent = opts.maybeSent ?? false;
  }
}

export class TelegramApiError extends TelegramError {
  constructor(
    message: string,
    readonly status: number,
    readonly description: string,
    readonly retryAfter: number | null,
  ) {
    super(message);
  }
}

// @имя, ссылка t.me/имя, ссылка на пост закрытого канала t.me/c/<id>/<n> или числовой id.
export function normalizeChatId(raw: string): string | null {
  const s = raw.trim();
  if (/^-?\d+$/.test(s)) return s;
  const priv = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/c\/(\d+)(?:\/\d+)?\/?$/i.exec(s);
  if (priv) return `-100${priv[1]}`;
  const m = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/i.exec(s) ?? /^@?([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(s);
  return m ? `@${m[1]}` : null;
}

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const missing = missingTelegramEnv(env);
  if (missing.length) throw new TelegramError(`Не заданы ${missing.join(", ")}.\n${telegramEnvHelp()}`);
  // Из адреса API токен иногда копируют вместе с «bot» — уберём.
  const token = env.TELEGRAM_BOT_TOKEN!.trim().replace(/^bot(?=\d)/i, "");
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new TelegramError("TELEGRAM_BOT_TOKEN не похож на токен бота (вида 123456789:AAH…). Скопируйте его целиком у @BotFather: /mybots → бот → «API Token».");
  }
  const raw = env.TELEGRAM_CHAT_ID!.trim();
  const chatId = normalizeChatId(raw);
  if (!chatId) {
    const invite = /t\.me\/(?:\+|joinchat)/i.test(raw);
    throw new TelegramError(
      `TELEGRAM_CHAT_ID="${raw}" — ${invite ? "ссылка-приглашение не подходит" : "не похоже на id канала"}. Нужен числовой id (у канала -100…) или @имя публичного канала. Узнать id: npm run telegram-check (docs/telegram-setup.md, шаг 3).`,
    );
  }
  return { token, chatId, host: TG_API_HOST };
}

// 413 приходит и от самого Bot API, и HTML-страницей от его фронтенда.
const isTooBig = (status: number, description: string) => status === 413 || /too big|too large/i.test(description);

// Понятные причины частых отказов Bot API (по тексту description — кодов у Telegram мало).
export function explainTelegramError(status: number, description: string, retryAfter: number | null = null, migrateTo: string | null = null): string {
  const d = description.toLowerCase();
  if (status === 401 || (status === 404 && d === "not found")) {
    return "токен TELEGRAM_BOT_TOKEN не принят — бот удалён или токен перевыпущен. Возьмите актуальный у @BotFather (/mybots → бот → «API Token») и обновите секрет TELEGRAM_BOT_TOKEN.";
  }
  if (migrateTo) return `группа стала супергруппой, её новый id ${migrateTo} — поставьте его в TELEGRAM_CHAT_ID.`;
  if (/chat not found/.test(d)) {
    return "канал TELEGRAM_CHAT_ID не найден. У канала id начинается с -100 (например -1001234567890), у публичного можно указать @имя; бот должен быть добавлен в канал. Узнать id: npm run telegram-check.";
  }
  if (status === 403 || /not a member|kicked|bot was blocked|deactivated/.test(d)) {
    return "бот не состоит в канале или его удалили — добавьте его администратором канала с правом «Публикация сообщений» (docs/telegram-setup.md, шаг 2).";
  }
  if (/administrator rights|not enough rights|have no rights|chat_write_forbidden|chat_admin_required/.test(d)) {
    return "у бота нет права публиковать в канале — сделайте его администратором с правом «Публикация сообщений».";
  }
  if (isTooBig(status, d)) return "файл слишком большой: бот Telegram отправляет не больше 50 МБ.";
  if (/caption is too long/.test(d)) return `подпись длиннее ${TG_CAPTION_MAX} символов — сократите telegram.txt.`;
  if (status === 429) return `слишком много запросов — Telegram просит подождать${retryAfter ? ` ${retryAfter} с` : ""}. Повторите позже.`;
  return `HTTP ${status}: ${description || "без описания"}`;
}

// ---- HTTP ----

type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  cfg: { token: string; host: string };
  fetch: Fetch;
  sleep: Sleep;
  log: (m: string) => void;
}

interface TgResponse<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

// Токен — часть пути URL (так устроен Bot API): URL нигде не печатаем, из текста ошибок токен вырезаем.
const redact = (s: string, token: string) => (token ? s.split(token).join("***") : s);
const errText = (e: unknown, token = "") => {
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  return redact(`${e instanceof Error ? e.message : String(e)}${code ? `: ${code}` : ""}`, token);
};

async function call<T>(ctx: Ctx, method: string, body: FormData | Record<string, unknown>, where: string, timeoutMs = 30_000): Promise<T> {
  const url = `https://${ctx.cfg.host}/bot${ctx.cfg.token}/${method}`;
  const signal = AbortSignal.timeout(timeoutMs);
  const res =
    body instanceof FormData
      ? await ctx.fetch(url, { method: "POST", body, signal })
      : await ctx.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const text = await res.text();
  let json: TgResponse<T> | null = null;
  try {
    json = JSON.parse(text) as TgResponse<T>;
  } catch {
    json = null; // не JSON — например, страница ошибки прокси
  }
  if (res.ok && json?.ok === true) return json.result as T;
  const status = json?.error_code ?? (res.ok ? 502 : res.status);
  const description = redact(json?.description ?? text.slice(0, 300), ctx.cfg.token).trim();
  const retryAfter = typeof json?.parameters?.retry_after === "number" ? json.parameters.retry_after : null;
  const migrateTo = typeof json?.parameters?.migrate_to_chat_id === "number" ? String(json.parameters.migrate_to_chat_id) : null;
  throw new TelegramApiError(`Telegram (${where}): ${explainTelegramError(status, description, retryAfter, migrateTo)}`, status, description, retryAfter);
}

// Ошибки сети, при которых запрос точно не ушёл (хост не найден, соединение не установлено), —
// их можно повторить. Таймаут и обрыв посреди загрузки — нельзя: пост мог выйти.
const NOT_SENT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const notSent = (e: unknown) => NOT_SENT_CODES.has(String((e as { cause?: { code?: unknown } })?.cause?.code ?? ""));

const RETRY_HINT = "Проверьте канал: если поста нет — отправьте ещё раз (локально — с --force, в GitHub — удалите telegram-published.json из релиза).";

// ---- Видео ----

export interface VideoInfo {
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

// Размер кадра и длительность — по самому MP4 (@remotion/media-parser уже в зависимостях):
// без width/height Telegram иногда показывает вертикальный ролик квадратом.
export async function probeVideo(file: string): Promise<VideoInfo | null> {
  try {
    const { parseMedia } = await import("@remotion/media-parser");
    const { nodeReader } = await import("@remotion/media-parser/node");
    const r = await parseMedia({ src: file, reader: nodeReader, fields: { dimensions: true, durationInSeconds: true }, acknowledgeRemotionLicense: true, logLevel: "error" });
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    return { width: num(r.dimensions?.width), height: num(r.dimensions?.height), durationSec: num(r.durationInSeconds) };
  } catch {
    return null; // не разобрали — отправим без размеров, Telegram определит сам
  }
}

// Битрейт видео (кбит/с) для копии, которая влезет в лимит бота: весь бюджет минус звук 128k
// и ~2 % на контейнер; не выше 8 Мбит/с (на экране телефона разницы нет) и не ниже 1 Мбит/с.
export function telegramVideoKbps(durationSec: number, targetBytes = TG_TARGET_BYTES): number {
  const totalKbps = (targetBytes * 8 * 0.98) / durationSec / 1000;
  return Math.max(1000, Math.min(8000, Math.floor(totalKbps - 128)));
}

export type Transcode = (input: string, output: string, videoKbps: number) => Promise<void>;

// Пережатие ffmpeg'ом из Remotion: H.264 со средним битрейтом (размер предсказуем, в отличие от CRF),
// звук AAC 128k, faststart — чтобы в Telegram ролик начинал играть сразу. Пути — абсолютные:
// ffmpeg запускается из своей папки.
const transcodeWithRemotion: Transcode = async (input, output, videoKbps) => {
  const { RenderInternals } = await import("@remotion/renderer");
  let cancel: (() => void) | null = null;
  const timer = setTimeout(() => cancel?.(), 15 * 60_000);
  try {
    await RenderInternals.callFf({
      bin: "ffmpeg",
      args: [
        "-hide_banner", "-nostats", "-y", "-i", path.resolve(input),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.5)}k`, "-bufsize", `${videoKbps * 2}k`,
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", path.resolve(output),
      ],
      indent: false,
      logLevel: "error",
      binariesDirectory: null,
      cancelSignal: (cb) => {
        cancel = cb;
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

// ---- Подпись ----

const HASHTAGS_ONLY = /^(?:#[\p{L}\p{N}_]+\s*)+$/u;

// Обрезка по границе символа (эмодзи — две единицы UTF-16) и, если можно, по слову.
function cutText(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  const sp = out.search(/\s\S*$/);
  if (sp > max * 0.6) out = out.slice(0, sp);
  return `${out.replace(/[\s,;:—–-]+$/u, "")}…`;
}

// Подпись Telegram — до 1024 символов; считаем в UTF-16 (как Telegram, с запасом для эмодзи).
// Длинную режем по абзацам: целые абзацы по порядку (хук, суть, призыв), а что не влезло —
// пропускаем; хэштеги — в конце, не больше четверти лимита.
export function telegramCaption(text: string, max = TG_CAPTION_MAX): string {
  const clean = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length <= max) return clean;
  const paras = clean.split(/\n{2,}/);
  let tags = "";
  if (paras.length > 1 && HASHTAGS_ONLY.test(paras[paras.length - 1]!)) {
    for (const h of paras.pop()!.split(/\s+/)) {
      const next = tags ? `${tags} ${h}` : h;
      if (next.length <= Math.floor(max / 4)) tags = next;
    }
  }
  let left = max - (tags ? tags.length + 2 : 0);
  const kept: string[] = [];
  for (const p of paras) {
    const need = (kept.length ? 2 : 0) + p.length;
    if (need <= left) {
      kept.push(p);
      left -= need;
    } else if (!kept.length) {
      kept.push(cutText(p, left));
      left = 0;
    }
  }
  if (tags) kept.push(tags);
  return kept.join("\n\n");
}

// ---- Отправка ----

export interface SendVideoInput {
  videoPath: string;
  caption?: string;
  coverPath?: string | null; // cover.jpg — обложка сообщения
  info?: VideoInfo | null; // размеры и длительность; не задано — узнаем по файлу
  config?: TelegramConfig;
  fetch?: Fetch;
  sleep?: Sleep;
  log?: (m: string) => void;
  probe?: (file: string) => Promise<VideoInfo | null>;
  transcode?: Transcode | false; // больше 50 МБ — чем пережать (false — не пережимать, сразу ошибка)
  beforeSend?: () => void; // перед первым запросом sendVideo (после всех проверок и пережатия)
  timeoutMs?: number;
}

export interface TelegramPostResult {
  messageId: number;
  chatId: string;
  chatTitle: string | null;
  url: string | null;
  postedAt: string;
  withCover: boolean;
  video: { bytes: number; originalBytes: number; transcoded: boolean; width: number | null; height: number | null; durationSec: number | null };
}

interface TgChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  date?: number;
  chat?: TgChat;
}

// Ссылка на пост: у публичного канала t.me/<имя>/<n>, у закрытого t.me/c/<id без -100>/<n>
// (открывается у подписчиков).
export function postUrl(chat: TgChat | undefined, messageId: number): string | null {
  if (chat?.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = String(chat?.id ?? "");
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

export async function sendVideo(input: SendVideoInput): Promise<TelegramPostResult> {
  const cfg = input.config ?? telegramConfig();
  const log = input.log ?? console.log;
  const ctx: Ctx = { cfg, fetch: input.fetch ?? fetch, sleep: input.sleep ?? realSleep, log };
  if (!fs.existsSync(input.videoPath)) throw new TelegramError(`Файл видео не найден: ${input.videoPath}`);
  const originalBytes = fs.statSync(input.videoPath).size;
  if (originalBytes < 1024) throw new TelegramError(`Файл ${input.videoPath} почти пустой (${originalBytes} байт) — пересоберите ролик.`);
  const caption = telegramCaption(input.caption ?? "");
  const info = input.info !== undefined ? input.info : await (input.probe ?? probeVideo)(input.videoPath);
  const transcode = input.transcode === undefined ? transcodeWithRemotion : input.transcode;
  const fitted = await fitVideo(input.videoPath, originalBytes, info, transcode, log);
  try {
    return await postVideo(ctx, cfg, input, { fitted, info, caption, originalBytes });
  } catch (e) {
    // Файл чуть меньше лимита, а Telegram ответил «слишком большой» (точный лимит у Bot API не
    // документирован, а 413 значит, что пост не вышел): пережимаем копию и пробуем ещё раз.
    if (!(e instanceof TelegramApiError && isTooBig(e.status, e.description) && !fitted.transcoded && transcode !== false && info?.durationSec)) throw e;
    const smaller = await fitVideo(input.videoPath, originalBytes, info, transcode, log, true);
    try {
      return await postVideo(ctx, cfg, input, { fitted: smaller, info, caption, originalBytes });
    } finally {
      smaller.cleanup();
    }
  } finally {
    fitted.cleanup();
  }
}

interface FittedVideo {
  file: string;
  bytes: number;
  transcoded: boolean;
  cleanup: () => void;
}

// Больше 50 МБ — пережимаем копию (до двух попыток: средний битрейт x264 может чуть «перелететь»).
// Не вышло — ошибка до отправки, с подсказкой. force — пережать и файл меньше лимита (его не принял Telegram).
async function fitVideo(videoPath: string, bytes: number, info: VideoInfo | null, transcode: Transcode | false, log: (m: string) => void, force = false): Promise<FittedVideo> {
  if (bytes <= TG_VIDEO_MAX_BYTES && !force) return { file: videoPath, bytes, transcoded: false, cleanup: () => {} };
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const tooBig = bytes <= TG_VIDEO_MAX_BYTES ? `Telegram не принял видео ${mb(bytes)} МБ как слишком большое` : `Видео ${mb(bytes)} МБ, а бот Telegram отправляет не больше 50 МБ`;
  const hint = "Соберите ролик с VIDEO_QUALITY=standard или опубликуйте его в канал вручную.";
  if (transcode === false) throw new TelegramError(`${tooBig}. ${hint}`);
  if (!info?.durationSec) throw new TelegramError(`${tooBig}, а длительность ролика узнать не удалось — пережать под лимит нельзя. ${hint}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-studio-tg-"));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  let kbps = telegramVideoKbps(info.durationSec);
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = path.join(dir, `telegram-${attempt}.mp4`);
      log(`[telegram] ${tooBig} — пережимаю копию для Telegram (видео ${(kbps / 1000).toFixed(1)} Мбит/с)…`);
      const t0 = Date.now();
      try {
        await transcode(videoPath, out, kbps);
      } catch (e) {
        throw new TelegramError(`${tooBig}, а пережать не вышло (${errText(e).split("\n")[0]}). ${hint}`, { cause: e });
      }
      const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
      if (size >= 1024 && size <= TG_VIDEO_MAX_BYTES) {
        log(`[telegram] копия для Telegram: ${mb(size)} МБ за ${Math.round((Date.now() - t0) / 1000)} с`);
        return { file: out, bytes: size, transcoded: true, cleanup };
      }
      if (size < 1024) throw new TelegramError(`${tooBig}, а пережатая копия вышла пустой. ${hint}`);
      kbps = Math.max(500, Math.floor(((kbps * TG_TARGET_BYTES) / size) * 0.9));
    }
    throw new TelegramError(`${tooBig}, и даже пережатая копия не влезает в лимит. ${hint}`);
  } catch (e) {
    cleanup();
    throw e;
  }
}

async function postVideo(
  ctx: Ctx,
  cfg: TelegramConfig,
  input: SendVideoInput,
  { fitted, info, caption, originalBytes }: { fitted: FittedVideo; info: VideoInfo | null; caption: string; originalBytes: number },
): Promise<TelegramPostResult> {
  const { log } = ctx;
  const bytes = fitted.bytes;
  let coverPath = input.coverPath && fs.existsSync(input.coverPath) ? input.coverPath : null;
  if (coverPath && fs.statSync(coverPath).size > TG_COVER_MAX_BYTES) {
    log("[telegram] cover.jpg больше 10 МБ — отправляю без обложки (Telegram возьмёт первый кадр)");
    coverPath = null;
  }
  const video = new Blob([new Uint8Array(fs.readFileSync(fitted.file))], { type: "video/mp4" });
  const cover = coverPath ? new Blob([new Uint8Array(fs.readFileSync(coverPath))], { type: "image/jpeg" }) : null;

  // FormData собираем на каждую попытку: тело запроса одноразовое.
  const form = (withCover: boolean) => {
    const f = new FormData();
    f.set("chat_id", cfg.chatId);
    f.set("video", video, "video.mp4");
    f.set("supports_streaming", "true");
    if (info?.width && info.height) {
      f.set("width", String(Math.round(info.width)));
      f.set("height", String(Math.round(info.height)));
    }
    if (info?.durationSec) f.set("duration", String(Math.max(1, Math.round(info.durationSec))));
    if (caption) f.set("caption", caption);
    if (withCover && cover) {
      f.set("cover", "attach://cover_file");
      f.set("cover_file", cover, "cover.jpg");
    }
    return f;
  };

  let withCover = cover !== null;
  input.beforeSend?.();
  log(`[telegram] отправляю видео (${(bytes / 1048576).toFixed(1)} МБ${info?.width ? `, ${info.width}×${info.height}` : ""}${withCover ? ", с обложкой" : ""}) в ${cfg.chatId}…`);
  for (let attempt = 1; ; attempt++) {
    try {
      const msg = await call<TgMessage>(ctx, "sendVideo", form(withCover), "отправка видео", input.timeoutMs ?? 10 * 60_000);
      const url = postUrl(msg.chat, msg.message_id);
      log(`[telegram] опубликовано: ${url ?? `сообщение ${msg.message_id}`}`);
      return {
        messageId: msg.message_id,
        chatId: String(msg.chat?.id ?? cfg.chatId),
        chatTitle: msg.chat?.title ?? null,
        url,
        postedAt: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
        withCover,
        video: { bytes, originalBytes, transcoded: fitted.transcoded, width: info?.width ?? null, height: info?.height ?? null, durationSec: info?.durationSec ?? null },
      };
    } catch (e) {
      if (e instanceof TelegramApiError) {
        // 429 — Telegram запрос не выполнил и сам говорит, сколько ждать.
        if (e.status === 429 && attempt < 4 && (e.retryAfter ?? 5) <= RETRY_AFTER_MAX_S) {
          const wait = (e.retryAfter ?? 5) + 1;
          log(`[telegram] Telegram просит подождать — повтор через ${wait} с…`);
          await ctx.sleep(wait * 1000);
          continue;
        }
        // Обложку понимает Bot API 8.3+; если отказ про неё — отправляем без неё, первым кадром.
        if (e.status === 400 && withCover && /cover|attach|photo/i.test(e.description)) {
          log(`[telegram] обложку не приняли (${e.description}) — отправляю без неё`);
          withCover = false;
          continue;
        }
        if (e.status >= 500) throw new TelegramError(`Telegram ответил ошибкой сервера (HTTP ${e.status}) во время отправки — неизвестно, вышел ли пост. ${RETRY_HINT}`, { cause: e, maybeSent: true });
        throw e;
      }
      if (e instanceof TelegramError) throw e;
      if (notSent(e)) {
        if (attempt < 3) {
          log(`[telegram] нет связи (${errText(e, cfg.token)}) — повтор через ${attempt * 5} с…`);
          await ctx.sleep(attempt * 5000);
          continue;
        }
        throw new TelegramError(`Telegram: нет связи с ${cfg.host} (${errText(e, cfg.token)}). Повторите позже.`, { cause: e });
      }
      throw new TelegramError(`Связь с Telegram оборвалась во время отправки (${errText(e, cfg.token)}) — неизвестно, вышел ли пост. ${RETRY_HINT}`, { cause: e, maybeSent: true });
    }
  }
}

// ---- Папка ролика ----

export interface TelegramRunRecord {
  status: "sending" | "posted" | "uncertain";
  startedAt: string;
  error?: string;
}

export type TelegramRunDirResult = TelegramPostResult & { resultFile: string };

// Подпись: telegram.txt (своя, если человек написал) → instagram.txt (её же проверяли для Reels).
export function readTelegramCaption(runDir: string): { text: string; file: string | null } {
  for (const name of [TG_CAPTION_FILE, "instagram.txt"]) {
    const file = path.join(runDir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
    if (text) return { text, file };
  }
  return { text: "", file: null };
}

function readRecord(file: string): (TelegramRunRecord & Partial<TelegramPostResult>) | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as TelegramRunRecord & Partial<TelegramPostResult>;
  } catch {
    // битый файл — отметка всё равно есть: считаем, что отправка могла пройти
    return { status: "uncertain", startedAt: "неизвестно" };
  }
}

const writeRecord = (file: string, data: unknown) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

// Почему этот ролик без --force не отправить (уже отправлен или прошлая отправка оборвалась);
// null — можно. Отдельно от отправки: upload проверяет до YouTube, make — пропускает шаг
// (повторная сборка того же сценария пишет в ту же папку, отметка остаётся).
export function telegramAlreadySent(runDir: string): string | null {
  const prev = readRecord(path.join(runDir, TG_RESULT_FILE));
  if (!prev) return null;
  const again = `npm run upload -- ${path.relative(process.cwd(), runDir) || "."} --to telegram --force`;
  if (prev.status === "posted") return `Этот ролик уже отправлен в Telegram (${prev.url ?? `сообщение ${prev.messageId ?? "?"}`}). Ещё раз: ${again}`;
  return `Прошлая отправка в Telegram (${prev.startedAt}) оборвалась — неизвестно, вышел ли пост. Проверьте канал: если поста нет — ${again}`;
}

// Отправить ролик из папки (video.mp4 + подпись [+ cover.jpg]). telegram-result.json —
// отметка «уже отправляли»: с ней второй раз без --force не отправим.
export async function publishTelegramRunDir(
  runDir: string,
  opts: { force?: boolean; log?: (m: string) => void } & Pick<SendVideoInput, "fetch" | "sleep" | "config" | "probe" | "info" | "transcode"> = {},
): Promise<TelegramRunDirResult> {
  const log = opts.log ?? console.log;
  const video = path.join(runDir, "video.mp4");
  if (!fs.existsSync(video)) throw new TelegramError(`В ${runDir} нет video.mp4 — сначала соберите ролик: npm run make -- …`);
  const resultFile = path.join(runDir, TG_RESULT_FILE);
  const sent = opts.force ? null : telegramAlreadySent(runDir);
  if (sent) throw new TelegramError(sent);
  const config = opts.config ?? telegramConfig();
  const caption = readTelegramCaption(runDir);
  if (!caption.file) log("[telegram] нет ни telegram.txt, ни instagram.txt — отправляю без подписи");
  else if (caption.text.length > TG_CAPTION_MAX) log(`[telegram] подпись ${caption.text.length} символов, лимит Telegram ${TG_CAPTION_MAX} — сокращаю по абзацам`);

  // Отметка «отправляю» — прямо перед запросом (после проверок и пережатия): если процесс прервут
  // посреди загрузки, повтор не задублирует пост.
  const prevRaw = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, "utf8") : null;
  const startedAt = new Date().toISOString();
  let marked = false;
  const beforeSend = () => {
    writeRecord(resultFile, { status: "sending", startedAt } satisfies TelegramRunRecord);
    marked = true;
  };
  const { force: _force, ...sendOpts } = opts;
  try {
    const r = await sendVideo({ ...sendOpts, config, log, beforeSend, videoPath: video, caption: caption.text, coverPath: path.join(runDir, "cover.jpg") });
    writeRecord(resultFile, { status: "posted", startedAt, ...r });
    return { ...r, resultFile };
  } catch (e) {
    if (marked) {
      // Точно не ушло — возвращаем как было (с --force там может лежать прошлый пост), можно повторить.
      // Иначе — «неизвестно, вышел ли пост»: без --force не повторяем.
      if (e instanceof TelegramError && !e.maybeSent) {
        if (prevRaw === null) fs.rmSync(resultFile, { force: true });
        else fs.writeFileSync(resultFile, prevRaw);
      } else writeRecord(resultFile, { status: "uncertain", startedAt, error: errText(e, config.token) } satisfies TelegramRunRecord);
    }
    throw e;
  }
}

// ---- Проверка настроек (npm run telegram-check) ----

export interface TelegramCheck {
  bot: { id: number; username: string | null; name: string } | null;
  chat: { id: string; type: string; title: string | null; username: string | null } | null;
  member: { status: string; canPost: boolean } | null;
  foundChats: { id: string; type: string; title: string | null }[]; // когда TELEGRAM_CHAT_ID не задан
  problems: string[];
}

interface TgUpdate {
  channel_post?: { chat?: TgChat };
  my_chat_member?: { chat?: TgChat };
  message?: { chat?: TgChat };
}

// Токен → бот (getMe); id канала → канал (getChat) и права бота в нём (getChatMember).
// Без id — чаты из последних событий бота (getUpdates хранит их 24 часа и без offset
// ничего не «съедает»): так владелец узнаёт id закрытого канала.
export async function checkTelegram(opts: { token: string; chatId?: string | null; host?: string; fetch?: Fetch }): Promise<TelegramCheck> {
  const ctx: Ctx = { cfg: { token: opts.token.trim().replace(/^bot(?=\d)/i, ""), host: opts.host ?? TG_API_HOST }, fetch: opts.fetch ?? fetch, sleep: realSleep, log: () => {} };
  const out: TelegramCheck = { bot: null, chat: null, member: null, foundChats: [], problems: [] };
  const problem = (e: unknown) => out.problems.push(e instanceof TelegramError ? e.message : `Telegram: нет связи с API (${errText(e, ctx.cfg.token)}). Повторите позже.`);
  try {
    const me = await call<{ id: number; username?: string; first_name?: string }>(ctx, "getMe", {}, "проверка токена");
    out.bot = { id: me.id, username: me.username ?? null, name: me.first_name ?? "" };
  } catch (e) {
    problem(e);
    return out;
  }
  if (!opts.chatId) {
    try {
      const ups = await call<TgUpdate[]>(ctx, "getUpdates", { limit: 100, timeout: 0, allowed_updates: ["channel_post", "my_chat_member", "message"] }, "последние события");
      for (const u of ups) {
        const c = u.channel_post?.chat ?? u.my_chat_member?.chat ?? u.message?.chat;
        if (!c || c.type === "private" || out.foundChats.some((f) => f.id === String(c.id))) continue;
        out.foundChats.push({ id: String(c.id), type: c.type ?? "?", title: c.title ?? null });
      }
    } catch (e) {
      if (e instanceof TelegramApiError && e.status === 409) {
        out.problems.push("У бота включён webhook — список событий недоступен. Узнайте id канала через web.telegram.org (docs/telegram-setup.md, шаг 3).");
      } else problem(e);
    }
    return out;
  }
  try {
    const c = await call<TgChat>(ctx, "getChat", { chat_id: opts.chatId }, "канал");
    out.chat = { id: String(c.id), type: c.type ?? "?", title: c.title ?? null, username: c.username ?? null };
  } catch (e) {
    problem(e);
    return out;
  }
  try {
    const m = await call<{ status?: string; can_post_messages?: boolean; can_send_videos?: boolean }>(ctx, "getChatMember", { chat_id: opts.chatId, user_id: out.bot.id }, "права бота");
    const status = m.status ?? "?";
    // В канале публикуют только администраторы с правом «Публикация сообщений».
    const canPost =
      out.chat.type === "channel" ? status === "administrator" && m.can_post_messages !== false : status === "administrator" || status === "member" || (status === "restricted" && m.can_send_videos === true);
    out.member = { status, canPost };
    if (!canPost) {
      out.problems.push(
        out.chat.type === "channel"
          ? "Бот не может публиковать в канале: сделайте его администратором с правом «Публикация сообщений» (docs/telegram-setup.md, шаг 2)."
          : `Бот не может отправлять видео в этот чат (статус ${status}) — проверьте его права.`,
      );
    }
  } catch (e) {
    problem(e);
  }
  return out;
}
