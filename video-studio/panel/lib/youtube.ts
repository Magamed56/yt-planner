// YouTube Data API для панели. Токен — обмен refresh token → access token через fetch (без
// googleapis), список роликов — общий код youtube-fill, но без поиска (он стоит 100 единиц
// квоты из 10 000 в сутки, а панель обновляют часто). Перенос — videos.update части status.
import { accessToken, explainApiError, type Auth } from "../../src/pipeline/google-api";
import { listChannelVideos, type ChannelVideo } from "../../src/pipeline/youtube-fill";

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
