// Похожие каналы (идея 72): что у них выстрелило за последний месяц — подсказка для тем.
// Только открытые данные Data API: ≈3 единицы квоты на канал (channels + playlistItems + videos).
// Ничего не сохраняем — правила YouTube API не дают хранить чужие данные дольше 30 дней.
// Список каналов — переменная репозитория PANEL_COMPETITORS (JSON-массив «@handle» или «UC…»).
import { accessToken, explainApiError } from "../../src/pipeline/google-api";
import { parseIsoDuration } from "../../src/pipeline/youtube-fill";
import { getVariable } from "./github";
import { youtubeAuth } from "./youtube";

export const COMPETITORS_VAR = "PANEL_COMPETITORS";
export const MAX_COMPETITORS = 12;
const API = "https://www.googleapis.com/youtube/v3";
const DAY_MS = 86_400_000;
const SHORT_MAX_SEC = 180; // Shorts — до 3 минут
const HIT_FACTOR = 3; // «выстрелило» — в 3 раза больше обычного для канала
const HIT_MIN_VIEWS = 1000;

export interface CompetitorVideo {
  id: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number | null;
  comments: number | null;
  durationSec: number | null;
  perDay: number; // просмотров в сутки с выхода
  short: boolean;
}

export interface CompetitorReport {
  ref: string;
  title: string;
  url: string;
  subscribers: number | null; // null — канал скрыл число подписчиков
  medianPerDay: number;
  uploadsPerWeek: number;
  shortsShare: number; // доля коротких среди последних роликов, 0…1
  hits: CompetitorVideo[]; // выстрелившие за 30 дней
  recent: CompetitorVideo[]; // лучшие свежие за 30 дней
  error?: string;
}

export function parseCompetitors(raw: string | null): string[] {
  let list: unknown;
  try {
    list = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const x of list) {
    const ref = typeof x === "string" ? channelRef(x) : null;
    if (ref && !out.some((o) => o.toLowerCase() === ref.toLowerCase())) out.push(ref);
  }
  return out.slice(0, MAX_COMPETITORS);
}

// «@handle», «handle», ссылка youtube.com/@handle или /channel/UC… → «@handle» или «UC…».
export function channelRef(input: string): string | null {
  const s = input.trim();
  const id = /(?:^|youtube\.com\/channel\/)(UC[\w-]{22})(?:$|[/?#])/.exec(s);
  if (id) return id[1]!;
  const fromUrl = /youtube\.com\/(@[\p{L}\p{N}._-]{3,30})(?:$|[/?#])/u.exec(s);
  if (fromUrl) return fromUrl[1]!;
  const handle = /^@?([\p{L}\p{N}._-]{3,30})$/u.exec(s);
  return handle ? `@${handle[1]}` : null;
}

export function perDay(views: number, publishedAt: string, now: Date): number {
  // Меньше суток считаем как сутки: иначе свежий ролик выглядит «вирусным».
  const days = Math.max(1, (now.getTime() - Date.parse(publishedAt)) / DAY_MS);
  return views / days;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function summarize(videos: CompetitorVideo[], now: Date): Pick<CompetitorReport, "medianPerDay" | "uploadsPerWeek" | "shortsShare" | "hits" | "recent"> {
  const t = now.getTime();
  const medianPerDay = median(videos.map((v) => v.perDay));
  const recent = videos.filter((v) => t - Date.parse(v.publishedAt) <= 30 * DAY_MS).sort((a, b) => b.perDay - a.perDay);
  const hits = recent.filter((v) => v.views >= HIT_MIN_VIEWS && v.perDay >= HIT_FACTOR * medianPerDay).slice(0, 5);
  const last28 = videos.filter((v) => t - Date.parse(v.publishedAt) <= 28 * DAY_MS).length;
  return {
    medianPerDay,
    uploadsPerWeek: last28 / 4,
    shortsShare: videos.length ? videos.filter((v) => v.short).length / videos.length : 0,
    hits,
    recent: recent.filter((v) => !hits.includes(v)).slice(0, 5),
  };
}

async function yt<T>(path: string): Promise<T> {
  const token = await accessToken(youtubeAuth);
  const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube: ${explainApiError(res.status, text)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface ApiChannel {
  id: string;
  snippet?: { title?: string; customUrl?: string };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
interface ApiVideo {
  id: string;
  snippet?: { title?: string; publishedAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s));

export async function loadCompetitor(ref: string, now = new Date()): Promise<CompetitorReport> {
  const q = ref.startsWith("@") ? `forHandle=${encodeURIComponent(ref)}` : `id=${encodeURIComponent(ref)}`;
  const ch = (await yt<{ items?: ApiChannel[] }>(`channels?part=snippet,statistics,contentDetails&${q}`)).items?.[0];
  if (!ch) throw new Error("канал не найден — проверьте @handle");
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  // У канала без открытых роликов YouTube не находит плейлист загрузок — это не ошибка, а «пусто».
  const playlist = uploads
    ? await yt<{ items?: { contentDetails?: { videoId?: string } }[] }>(`playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploads)}`).catch((e: unknown) => {
        if (e instanceof Error && /playlistNotFound/.test(e.message)) return { items: [] };
        throw e;
      })
    : { items: [] };
  const ids = (playlist.items ?? []).map((i) => i.contentDetails?.videoId).filter((id): id is string => !!id);
  const items = ids.length ? ((await yt<{ items?: ApiVideo[] }>(`videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`)).items ?? []) : [];
  const videos: CompetitorVideo[] = items
    .filter((v) => v.snippet?.publishedAt)
    .map((v) => {
      const views = Number(v.statistics?.viewCount ?? 0);
      const durationSec = parseIsoDuration(v.contentDetails?.duration);
      return {
        id: v.id,
        title: v.snippet?.title ?? "",
        publishedAt: v.snippet!.publishedAt!,
        views,
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
        durationSec,
        perDay: perDay(views, v.snippet!.publishedAt!, now),
        short: durationSec !== null && durationSec <= SHORT_MAX_SEC,
      };
    });
  const handle = ch.snippet?.customUrl;
  return {
    ref,
    title: ch.snippet?.title ?? ref,
    url: handle ? `https://www.youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}` : `https://www.youtube.com/channel/${ch.id}`,
    subscribers: ch.statistics?.hiddenSubscriberCount ? null : num(ch.statistics?.subscriberCount),
    ...summarize(videos, now),
  };
}

export async function loadCompetitors(now = new Date()): Promise<{ refs: string[]; reports: CompetitorReport[] }> {
  const refs = parseCompetitors(await getVariable(COMPETITORS_VAR));
  const reports = await Promise.all(
    refs.map((ref) =>
      loadCompetitor(ref, now).catch(
        (e): CompetitorReport => ({
          ref,
          title: ref,
          url: ref.startsWith("@") ? `https://www.youtube.com/${ref}` : `https://www.youtube.com/channel/${ref}`,
          subscribers: null,
          medianPerDay: 0,
          uploadsPerWeek: 0,
          shortsShare: 0,
          hits: [],
          recent: [],
          error: e instanceof Error ? e.message : String(e),
        }),
      ),
    ),
  );
  return { refs, reports };
}
