// Загрузка на YouTube через Data API v3. Авторизация — OAuth refresh token
// (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN, получить один раз:
// npm run youtube-auth). Видео грузим протоколом resumable частями по 8 МБ:
// обрыв связи в CI не начинает загрузку заново (у googleapis только
// multipart одним куском). Обложку ставим через googleapis thumbnails.set.

import fs from "node:fs";
import { google } from "googleapis";
import type { YoutubeMeta } from "./meta";

export type Privacy = "private" | "unlisted" | "public";
export const PRIVACY_VALUES: Privacy[] = ["private", "unlisted", "public"];

export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

export interface UploadInput {
  videoFile: string;
  thumbnailFile?: string | null;
  meta: YoutubeMeta;
  privacy: Privacy;
  publishAt?: string | null; // ISO-время отложенной публикации (только с privacy=private)
  notifySubscribers?: boolean;
  log?: (msg: string) => void;
  fetch?: typeof fetch; // подмена в тестах
  auth?: Auth; // подмена в тестах (по умолчанию — из YT_* переменных)
  chunkBytes?: number;
}

export interface UploadResult {
  videoId: string;
  url: string;
  studioUrl: string;
  privacy: string;
  thumbnailSet: boolean;
  uploadStatus: string | null;
}

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const CHUNK = 8 * 1024 * 1024; // кратно 256 КиБ — требование протокола

export function missingYoutubeEnv(): string[] {
  return ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"].filter((k) => !process.env[k]?.trim());
}

export function youtubeEnvHelp(): string {
  return (
    "Для загрузки на YouTube нужны YT_CLIENT_ID, YT_CLIENT_SECRET и YT_REFRESH_TOKEN.\n" +
    "  1) Google Cloud Console → новый проект → включить «YouTube Data API v3».\n" +
    "  2) OAuth consent screen: External, добавить себя в тестовые пользователи, затем «Publish app» (иначе токен живёт 7 дней).\n" +
    "  3) Credentials → OAuth client ID → тип «Desktop app» → скопировать Client ID и Client secret в .env.\n" +
    "  4) npm run youtube-auth — откроется браузер, после входа будет напечатан YT_REFRESH_TOKEN.\n" +
    "  Подробно: README.md, раздел «Загрузка на YouTube»."
  );
}

export function youtubeAuth() {
  const missing = missingYoutubeEnv();
  if (missing.length) throw new Error(`Не заданы ${missing.join(", ")}.\n${youtubeEnvHelp()}`);
  const auth = new google.auth.OAuth2(process.env.YT_CLIENT_ID!.trim(), process.env.YT_CLIENT_SECRET!.trim());
  auth.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN!.trim() });
  return auth;
}

type Auth = Pick<ReturnType<typeof youtubeAuth>, "getAccessToken">;

async function accessToken(auth: Auth): Promise<string> {
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error("пустой access token");
    return token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_grant/i.test(msg)) {
      throw new Error(
        "YouTube: YT_REFRESH_TOKEN недействителен (отозван или истёк — у приложения в статусе «Testing» токен живёт 7 дней). " +
          "Переведите OAuth-приложение в «In production» и получите новый токен: npm run youtube-auth.",
      );
    }
    if (/invalid_client|unauthorized_client/i.test(msg)) {
      throw new Error("YouTube: неверные YT_CLIENT_ID / YT_CLIENT_SECRET (или токен выпущен для другого клиента). Проверьте .env / секреты GitHub.");
    }
    throw new Error(`YouTube: не удалось получить доступ (${msg}).`);
  }
}

// Понятные причины частых отказов API.
function explainApiError(status: number, body: string): string {
  let reason = "";
  let message = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? "";
    message = j.error?.message ?? message;
  } catch {
    // не JSON — оставляем как есть
  }
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return "исчерпана суточная квота YouTube Data API (сбрасывается в полночь по тихоокеанскому времени).";
  if (reason === "uploadLimitExceeded") return "достигнут лимит загрузок канала на сегодня.";
  if (reason === "youtubeSignupRequired") return "у аккаунта Google нет канала YouTube — создайте канал.";
  if (reason === "invalidTitle") return "YouTube отклонил заголовок (пустой, длиннее 100 символов или с «<», «>»).";
  if (reason === "invalidDescription") return "YouTube отклонил описание (длиннее 5000 символов или с «<», «>»).";
  if (reason === "invalidTags") return "YouTube отклонил теги (суммарно больше 500 символов).";
  if (status === 403 && /insufficient|scope/i.test(message)) return "у токена нет права youtube.upload — получите его заново: npm run youtube-auth.";
  return `HTTP ${status}${reason ? ` ${reason}` : ""}: ${message}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

function readChunk(fd: number, start: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let off = 0;
  while (off < length) {
    const n = fs.readSync(fd, buf, off, length - off, start + off);
    if (n === 0) break;
    off += n;
  }
  return off === length ? buf : buf.subarray(0, off);
}

export async function uploadToYoutube(input: UploadInput): Promise<UploadResult> {
  const log = input.log ?? console.log;
  const fetchImpl = input.fetch ?? fetch;
  const chunkBytes = input.chunkBytes ?? CHUNK;
  if (!fs.existsSync(input.videoFile)) throw new Error(`Файл видео не найден: ${input.videoFile}`);
  const size = fs.statSync(input.videoFile).size;
  const auth = input.auth ?? youtubeAuth();

  const status: Record<string, unknown> = {
    privacyStatus: input.publishAt ? "private" : input.privacy,
    selfDeclaredMadeForKids: false,
    embeddable: true,
    license: "youtube",
    containsSyntheticMedia: input.meta.containsSyntheticMedia,
  };
  if (input.publishAt) status.publishAt = input.publishAt;
  const resource = {
    snippet: {
      title: input.meta.title,
      description: input.meta.description,
      tags: input.meta.tags,
      categoryId: input.meta.categoryId,
      defaultLanguage: input.meta.defaultLanguage,
      defaultAudioLanguage: input.meta.defaultLanguage,
    },
    status,
  };

  // 1) Открываем сессию загрузки.
  const params = new URLSearchParams({ uploadType: "resumable", part: "snippet,status", notifySubscribers: String(input.notifySubscribers ?? true) });
  let sessionUrl = "";
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(`${UPLOAD_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken(auth)}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(resource),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      sessionUrl = res.headers.get("location") ?? "";
      if (!sessionUrl) throw new Error("YouTube: сервер не вернул адрес сессии загрузки.");
      break;
    }
    const body = await res.text();
    if (retryable(res.status) && attempt < 4) {
      log(`[youtube] ${explainApiError(res.status, body)} — повтор через ${attempt * 5} с…`);
      await sleep(attempt * 5000);
      continue;
    }
    throw new Error(`YouTube: загрузка отклонена — ${explainApiError(res.status, body)}`);
  }

  // 2) Отправляем файл частями; после обрыва спрашиваем, сколько дошло.
  const fd = fs.openSync(input.videoFile, "r");
  let offset = 0;
  let failures = 0;
  let lastLogged = -1;
  let video: UploadedVideo | null = null;
  try {
    while (!video) {
      const len = Math.min(chunkBytes, size - offset);
      const chunk = readChunk(fd, offset, len);
      let res: Response;
      try {
        res = await fetchImpl(sessionUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${await accessToken(auth)}`,
            "Content-Length": String(chunk.length),
            "Content-Type": "video/mp4",
            "Content-Range": chunk.length ? `bytes ${offset}-${offset + chunk.length - 1}/${size}` : `bytes */${size}`,
          },
          body: new Uint8Array(chunk),
          signal: AbortSignal.timeout(300_000),
        });
      } catch (e) {
        if (++failures > 6) throw new Error(`YouTube: связь обрывается слишком часто (${e instanceof Error ? e.message : String(e)}).`);
        log(`[youtube] обрыв связи — продолжу с того же места через ${failures * 5} с…`);
        await sleep(failures * 5000);
        const q = await queryOffset(fetchImpl, sessionUrl, size, auth, offset);
        if (typeof q === "number") offset = q;
        else video = q;
        continue;
      }
      if (res.status === 200 || res.status === 201) {
        video = (await res.json()) as UploadedVideo;
        break;
      }
      if (res.status === 308) {
        // Range: bytes=0-N — сервер принял N+1 байт.
        const range = res.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : 0;
        failures = 0;
        const pct = Math.floor((offset / size) * 100);
        if (Math.floor(pct / 20) > Math.floor(lastLogged / 20)) {
          lastLogged = pct;
          log(`[youtube] загружено ${pct}% (${(offset / 1048576).toFixed(1)} из ${(size / 1048576).toFixed(1)} МБ)`);
        }
        continue;
      }
      const body = await res.text();
      if ((retryable(res.status) || res.status === 401) && ++failures <= 6) {
        log(`[youtube] ${explainApiError(res.status, body)} — повтор через ${failures * 5} с…`);
        await sleep(failures * 5000);
        const q = await queryOffset(fetchImpl, sessionUrl, size, auth, offset);
        if (typeof q === "number") offset = q;
        else video = q;
        continue;
      }
      throw new Error(`YouTube: ошибка при загрузке — ${explainApiError(res.status, body)}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  const videoId = video?.id;
  if (!videoId) throw new Error("YouTube не вернул id загруженного видео.");
  log(`[youtube] видео загружено: https://youtu.be/${videoId}`);

  // 3) Обложка: для Shorts и неподтверждённых каналов API часто отказывает —
  // это не ошибка конвейера.
  let thumbnailSet = false;
  if (input.thumbnailFile && fs.existsSync(input.thumbnailFile)) {
    try {
      const yt = google.youtube({ version: "v3", auth: auth as ReturnType<typeof youtubeAuth> });
      const mimeType = /\.png$/i.test(input.thumbnailFile) ? "image/png" : "image/jpeg";
      await yt.thumbnails.set({ videoId, media: { mimeType, body: fs.createReadStream(input.thumbnailFile) } });
      thumbnailSet = true;
      log("[youtube] обложка установлена");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[youtube] обложку поставить не удалось (${msg.split("\n")[0]}) — для своих обложек канал должен быть подтверждён по телефону; у Shorts обложку выбирают в приложении YouTube.`);
    }
  }

  return {
    videoId,
    url: `https://youtu.be/${videoId}`,
    studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
    privacy: video?.status?.privacyStatus ?? String(status.privacyStatus),
    thumbnailSet,
    uploadStatus: video?.status?.uploadStatus ?? null,
  };
}

interface UploadedVideo {
  id?: string;
  status?: { privacyStatus?: string; uploadStatus?: string };
}

// Сколько байт сервер уже получил (после обрыва); если файл уже целиком
// дошёл — сервер сразу отдаёт созданное видео. При сбое — оставляем как было.
async function queryOffset(fetchImpl: typeof fetch, sessionUrl: string, size: number, auth: Auth, fallback: number): Promise<number | UploadedVideo> {
  try {
    const res = await fetchImpl(sessionUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${await accessToken(auth)}`, "Content-Length": "0", "Content-Range": `bytes */${size}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 308) {
      const range = res.headers.get("range");
      return range ? Number(range.split("-")[1]) + 1 : 0;
    }
    if (res.status === 200 || res.status === 201) return (await res.json()) as UploadedVideo;
    return fallback;
  } catch {
    return fallback;
  }
}
