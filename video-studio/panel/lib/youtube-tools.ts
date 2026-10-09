// YouTube Data API для подсказок «Статистики»: плейлисты рубрик и смена названия ролика.
// Тот же токен, что у остальной панели (lib/youtube.ts); права youtube хватает и на плейлисты.
// Квота: чтение — 1 единица за страницу, вставка и videos.update — по 50.
import { accessToken, explainApiError } from "../../src/pipeline/google-api";
import type { PlaylistInfo } from "./playlists";
import type { ApiSnippet } from "./titles";
import { youtubeAuth } from "./youtube";

const API = "https://www.googleapis.com/youtube/v3";

async function yt<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<T> {
  const token = await accessToken(youtubeAuth);
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`YouTube не отвечает (${e instanceof Error ? e.message : String(e)}) — попробуйте через минуту.`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube: ${explainApiError(res.status, text)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// Плейлисты канала (до 500 — у канала их единицы).
export async function myPlaylists(): Promise<PlaylistInfo[]> {
  const out: PlaylistInfo[] = [];
  let page = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50" });
    if (page) q.set("pageToken", page);
    const r = await yt<{ items?: { id?: string; snippet?: { title?: string } }[]; nextPageToken?: string }>(`playlists?${q}`);
    for (const p of r.items ?? []) if (p.id) out.push({ id: p.id, title: p.snippet?.title ?? "" });
    page = r.nextPageToken ?? "";
    if (!page) break;
  }
  return out;
}

// Ролики плейлиста (до 1 000).
export async function playlistVideoIds(playlistId: string): Promise<string[]> {
  const out: string[] = [];
  let page = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ part: "contentDetails", playlistId, maxResults: "50" });
    if (page) q.set("pageToken", page);
    const r = await yt<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>(`playlistItems?${q}`);
    for (const it of r.items ?? []) if (it.contentDetails?.videoId) out.push(it.contentDetails.videoId);
    page = r.nextPageToken ?? "";
    if (!page) break;
  }
  return out;
}

export async function createPlaylist(title: string, description: string): Promise<string> {
  const r = await yt<{ id?: string }>("playlists?part=snippet,status", {
    method: "POST",
    body: { snippet: { title, description, defaultLanguage: "ru" }, status: { privacyStatus: "public" } },
  });
  if (!r.id) throw new Error("YouTube не вернул id нового плейлиста.");
  return r.id;
}

export async function addToPlaylist(playlistId: string, videoId: string): Promise<void> {
  await yt("playlistItems?part=snippet", { method: "POST", body: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } } });
}

export async function videoSnippet(videoId: string): Promise<ApiSnippet | null> {
  const r = await yt<{ items?: { snippet?: ApiSnippet }[] }>(`videos?part=snippet&id=${encodeURIComponent(videoId)}`);
  return r.items?.[0]?.snippet ?? null;
}

// videos.update part=snippet; возвращает название, которое YouTube подтвердил.
export async function updateVideoSnippet(body: { id: string; snippet: Record<string, unknown> }): Promise<string | null> {
  const r = await yt<{ snippet?: { title?: string } }>("videos?part=snippet", { method: "PUT", body });
  return r.snippet?.title ?? null;
}
