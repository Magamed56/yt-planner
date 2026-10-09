// YouTube Data API для панели. Токен — обмен refresh token → access token через fetch (без
// googleapis), список роликов — общий код youtube-fill, но без поиска (он стоит 100 единиц
// квоты из 10 000 в сутки, а панель обновляют часто). Перенос — videos.update части status.
// Удержание — YouTube Analytics API (своя квота), первый комментарий — commentThreads.
import { accessToken, explainApiError, type Auth } from "../../src/pipeline/google-api";
import { listChannel, listChannelVideos, type ChannelListing, type ChannelVideo } from "../../src/pipeline/youtube-fill";
import { ANALYTICS_REPORTS, analyticsProblem, engagedRejected, parseRetention, retentionQuery, type AnalyticsProblem, type AnalyticsRange, type Retention } from "./analytics";
import { commentThreadBody, ownTopLevelComment, type OwnComment, type VideoBrief } from "./first-comment";

const API = "https://www.googleapis.com/youtube/v3";

export function youtubeEnvMissing(): string[] {
  return ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"].filter((k) => !process.env[k]?.trim());
}

let cached: { token: string; until: number } | null = null;

export const youtubeAuth: Auth = {
  async getAccessToken() {
    if (cached && cached.until > Date.now() + 60_000) return { token: cached.token };
    const missing = youtubeEnvMissing();
    if (missing.length) throw new Error(`не заданы ${missing.join(", ")} (Vercel → Settings → Environment Variables)`);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.YT_CLIENT_ID!.trim(),
        client_secret: process.env.YT_CLIENT_SECRET!.trim(),
        refresh_token: process.env.YT_REFRESH_TOKEN!.trim(),
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    // Код ошибки (invalid_grant…) — в тексте: accessToken() превращает его в подсказку.
    if (!res.ok || !j.access_token) throw new Error(`${j.error ?? `HTTP ${res.status}`} ${j.error_description ?? ""}`.trim());
    cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return { token: j.access_token };
  },
};

export function channelVideos(opts: { search?: boolean } = {}): Promise<ChannelVideo[]> {
  return listChannelVideos({ auth: youtubeAuth }, 200, { search: opts.search ?? false });
}

// Ролики и цифры канала одним проходом (экран «Статистика»): channels.list и так вызывается
// ради плейлиста «Загрузки», part=statistics квоту не добавляет. Без поиска — как очередь.
export function channelOverview(): Promise<ChannelListing> {
  return listChannel({ auth: youtubeAuth }, 200, { search: false });
}

async function yt<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(youtubeAuth);
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube: ${explainApiError(res.status, text)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface VideoStatus {
  privacyStatus?: string;
  publishAt?: string;
  uploadStatus?: string;
  embeddable?: boolean;
  license?: string;
  publicStatsViewable?: boolean;
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
  containsSyntheticMedia?: boolean;
}

export async function videoStatuses(ids: string[]): Promise<Map<string, VideoStatus>> {
  const r = await yt<{ items?: { id: string; status?: VideoStatus }[] }>(`videos?part=status&id=${ids.map(encodeURIComponent).join(",")}`);
  return new Map((r.items ?? []).map((v) => [v.id, v.status ?? {}]));
}

// Тело videos.update?part=status: изменяемые поля, которых нет в запросе, YouTube сбрасывает
// к умолчаниям — поэтому переносим все текущие и меняем только время выхода.
export function rescheduleBody(videoId: string, s: VideoStatus, publishAt: string): Record<string, unknown> {
  return {
    id: videoId,
    status: {
      privacyStatus: "private",
      publishAt,
      selfDeclaredMadeForKids: s.selfDeclaredMadeForKids ?? s.madeForKids ?? false,
      containsSyntheticMedia: s.containsSyntheticMedia ?? true,
      embeddable: s.embeddable ?? true,
      license: s.license ?? "youtube",
      publicStatsViewable: s.publicStatsViewable ?? true,
    },
  };
}

// Новое время выхода; возвращает то, что YouTube подтвердил (null — не принял).
export async function setPublishAt(videoId: string, s: VideoStatus, publishAt: string): Promise<string | null> {
  const r = await yt<{ status?: VideoStatus }>("videos?part=status", { method: "PUT", body: JSON.stringify(rescheduleBody(videoId, s, publishAt)) });
  return r.status?.publishAt ?? null;
}

// ---- удержание: YouTube Analytics API ----

export interface RetentionResult {
  rows: Map<string, Retention>; // по videoId
  problem: AnalyticsProblem | null; // почему данных нет — карточка на «Статистике»
}

// Короче, чем у Data API: страница «Статистики» ждёт этот ответ, а без удержания она всё равно полезна.
// Срок общий на запрос и повтор без engagedViews — иначе худший случай вдвое дольше.
const ANALYTICS_TIMEOUT_MS = 10_000;
// Отчёт не принял engagedViews — в этом экземпляре функции больше не спрашиваем (один запрос на страницу).
let engagedOk = true;

// Средний % и длительность просмотра по роликам канала. Никогда не бросает: отказ — в problem.
export async function channelRetention(range: AnalyticsRange): Promise<RetentionResult> {
  const fail = (text: string): RetentionResult => ({ rows: new Map(), problem: { kind: "error", text, activationUrl: null } });
  const slow = `YouTube Analytics не ответил за ${ANALYTICS_TIMEOUT_MS / 1000} с`;
  const deadline = Date.now() + ANALYTICS_TIMEOUT_MS;
  let token: string;
  try {
    token = await accessToken(youtubeAuth);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  for (let engaged = engagedOk; ; engaged = false) {
    const left = deadline - Date.now();
    if (left <= 0) return fail(slow);
    let status: number;
    let text: string;
    try {
      const res = await fetch(`${ANALYTICS_REPORTS}?${retentionQuery(range, engaged)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(left),
      });
      status = res.status;
      text = await res.text();
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return fail(timeout ? slow : `нет связи с YouTube Analytics (${e instanceof Error ? e.message : String(e)})`);
    }
    if (status >= 200 && status < 300) {
      // Без engagedViews прошло, а с ней отчёт отказал — дальше в этом экземпляре сразу без неё.
      if (!engaged && engagedOk) engagedOk = false;
      try {
        return { rows: parseRetention(JSON.parse(text)), problem: null };
      } catch {
        return fail("YouTube Analytics вернул не JSON");
      }
    }
    if (engaged && engagedRejected(status, text)) continue;
    return { rows: new Map(), problem: analyticsProblem(status, text) };
  }
}

// ---- первый комментарий ----

export interface CommentCheck {
  channelId: string | null; // канал ключа
  video: VideoBrief | null;
  existing: OwnComment | null; // верхний комментарий канала под роликом
}

// Сколько страниц комментариев (по 100, 1 единица квоты каждая) просматривать в поиске своего.
const COMMENT_PAGES = 3;

// Наш ли ролик, вышел ли он и нет ли уже комментария канала: ≈ 3 единицы квоты из 10 000.
export async function commentCheck(videoId: string): Promise<CommentCheck> {
  type ApiVideo = { id?: string; snippet?: { channelId?: string }; status?: { privacyStatus?: string } };
  const [mine, videos] = await Promise.all([
    yt<{ items?: { id?: string }[] }>("channels?part=id&mine=true"),
    yt<{ items?: ApiVideo[] }>(`videos?part=snippet,status&id=${encodeURIComponent(videoId)}`),
  ]);
  const channelId = mine.items?.[0]?.id ?? null;
  const v = videos.items?.find((x) => x.id === videoId);
  const video: VideoBrief | null = v ? { videoId, channelId: v.snippet?.channelId ?? "", privacyStatus: v.status?.privacyStatus ?? "private" } : null;
  if (!channelId || !video || video.channelId !== channelId || video.privacyStatus !== "public") return { channelId, video, existing: null };
  let page = "";
  for (let i = 0; i < COMMENT_PAGES; i++) {
    const q = new URLSearchParams({ part: "snippet", videoId, maxResults: "100", order: "time", textFormat: "plainText" });
    if (page) q.set("pageToken", page);
    const r = await yt<{ items?: unknown[]; nextPageToken?: string }>(`commentThreads?${q}`);
    const existing = ownTopLevelComment(r, channelId, videoId);
    if (existing) return { channelId, video, existing };
    page = r.nextPageToken ?? "";
    if (!page) break;
  }
  return { channelId, video, existing: null };
}

// commentThreads.insert — 50 единиц квоты; возвращает id нового комментария.
export async function postComment(videoId: string, channelId: string, text: string): Promise<string | null> {
  const r = await yt<{ id?: string; snippet?: { topLevelComment?: { id?: string } } }>("commentThreads?part=snippet", {
    method: "POST",
    body: JSON.stringify(commentThreadBody(videoId, channelId, text)),
  });
  return r.snippet?.topLevelComment?.id ?? r.id ?? null;
}
