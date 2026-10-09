// TikTok для панели: разбор ответов Display API (профиль, ролики), цифры для экрана «TikTok»,
// сопоставление роликов с темами плана, пороги Creator Rewards. Чистые функции без сети и без
// node:* — их проверяет scripts/tiktok-test.ts, подписи считает сервер.
import { formatCount, formatNumber, formatRate } from "./stats";

export const TIKTOK_DEFAULT_SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"];

export interface TikTokUser {
  openId: string;
  displayName: string;
  username: string | null;
  avatar: string | null;
  followers: number | null;
  following: number | null;
  likes: number | null;
  videos: number | null;
}

export interface TikTokVideo {
  id: string;
  title: string;
  cover: string | null; // ссылка TikTok живёт ~6 часов — только для показа сразу
  url: string | null;
  createdAt: string; // ISO
  durationSec: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

type Json = Record<string, unknown>;
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);

// Ошибка API v2: { error: { code: "ok" | "access_token_invalid" | …, message } } — с подсказкой.
export function tiktokApiError(json: unknown, status: number): string | null {
  const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
  const code = e?.code ?? (status >= 400 ? `HTTP ${status}` : "ok");
  if (code === "ok" && status < 400) return null;
  const hint: Record<string, string> = {
    access_token_invalid: "доступ истёк или отозван — подключите TikTok заново",
    scope_not_authorized: "у приложения TikTok нет нужного права (scope) — добавьте его в портале разработчика и подключите заново",
    scope_permission_missed: "при подключении не дали нужное право — подключите заново и отметьте все пункты",
    rate_limit_exceeded: "TikTok просит подождать — обновите страницу через минуту",
  };
  return `TikTok: ${hint[code] ?? `${code}${e?.message ? ` — ${e.message}` : ""}`}.`;
}

export function parseUser(json: unknown): TikTokUser | null {
  const u = ((json as Json | null)?.data as Json | undefined)?.user as Json | undefined;
  if (!u) return null;
  return {
    openId: str(u.open_id) ?? "",
    displayName: str(u.display_name) ?? "TikTok",
    username: str(u.username),
    avatar: str(u.avatar_url_100) ?? str(u.avatar_url),
    followers: num(u.follower_count),
    following: num(u.following_count),
    likes: num(u.likes_count),
    videos: num(u.video_count),
  };
}

export function parseVideos(json: unknown): { videos: TikTokVideo[]; cursor: number | null; hasMore: boolean } {
  const d = (json as Json | null)?.data as Json | undefined;
  const list = Array.isArray(d?.videos) ? (d!.videos as Json[]) : [];
  const videos: TikTokVideo[] = [];
  for (const v of list) {
    const id = str(v.id) ?? (typeof v.id === "number" ? String(v.id) : null);
    const t = num(v.create_time);
    if (!id || t === null) continue;
    videos.push({
      id,
      title: str(v.title) ?? str(v.video_description) ?? "",
      cover: str(v.cover_image_url),
      url: str(v.share_url),
      createdAt: new Date(t * 1000).toISOString(),
      durationSec: num(v.duration),
      views: num(v.view_count) ?? 0,
      likes: num(v.like_count) ?? 0,
      comments: num(v.comment_count) ?? 0,
      shares: num(v.share_count) ?? 0,
    });
  }
  return { videos, cursor: num(d?.cursor), hasMore: d?.has_more === true };
}

// ---- ролик TikTok ↔ тема плана: по названию в подписи ----

// «Почему цены — на 99?» → «почему цены на 99»: регистр, ё, знаки и эмодзи не важны.
export const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Код темы, если в подписи ролика есть её название (первые 40 знаков) — и только одна такая тема.
export function matchCode(caption: string, topics: { code: string; titles: string[] }[]): string | null {
  const text = normText(caption);
  if (!text) return null;
  const hits = topics.filter((t) => t.titles.some((title) => {
    const n = normText(title).slice(0, 40).trim();
    return n.length >= 12 && text.includes(n);
  }));
  return hits.length === 1 ? hits[0]!.code : null;
}

// ---- экран «TikTok» ----

const DAY_MS = 86_400_000;

export interface TikTokVideoStat extends TikTokVideo {
  code: string | null;
  dateLabel: string;
  perDay: number;
  viewsLabel: string;
  perDayLabel: string;
  likesLabel: string;
  commentsLabel: string;
  sharesLabel: string;
  long: boolean; // дольше минуты — только такие идут в Creator Rewards
}

export interface Goal {
  label: string;
  haveLabel: string;
  needLabel: string;
  percent: number;
  done: boolean;
}

export interface TikTokStats {
  user: TikTokUser;
  followersLabel: string;
  likesLabel: string;
  videosLabel: string;
  views30Label: string;
  avgViewsLabel: string;
  engagementLabel: string;
  videos: TikTokVideoStat[]; // по просмотрам
  rewards: Goal[];
}

// Creator Rewards Program: 10 000 подписчиков, 100 000 просмотров за 30 дней, ролики дольше минуты.
export const CREATOR_REWARDS = { followers: 10_000, views30: 100_000, minSec: 60 };

const goal = (label: string, have: number, need: number): Goal => ({
  label,
  haveLabel: have >= 100_000 ? formatCount(have) : formatNumber(have),
  needLabel: need >= 100_000 ? formatCount(need) : formatNumber(need),
  percent: need > 0 ? Math.min(100, Math.max(0, (have / need) * 100)) : 0,
  done: have >= need,
});

export function tiktokStats(user: TikTokUser, list: TikTokVideo[], topics: { code: string; titles: string[] }[], now: Date, tz: string): TikTokStats {
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" });
  const nowMs = now.getTime();
  const videos: TikTokVideoStat[] = list.map((v) => {
    const at = Date.parse(v.createdAt);
    const perDay = v.views / Math.max(1, (nowMs - at) / DAY_MS);
    return {
      ...v,
      code: matchCode(v.title, topics),
      dateLabel: day.format(at),
      perDay,
      viewsLabel: formatCount(v.views),
      perDayLabel: formatRate(perDay),
      likesLabel: formatCount(v.likes),
      commentsLabel: formatCount(v.comments),
      sharesLabel: formatCount(v.shares),
      long: (v.durationSec ?? 0) > CREATOR_REWARDS.minSec,
    };
  });
  videos.sort((a, b) => b.views - a.views || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const views = videos.reduce((s, v) => s + v.views, 0);
  const reactions = videos.reduce((s, v) => s + v.likes + v.comments + v.shares, 0);
  // Display API не отдаёт просмотры за период — сумма по роликам, вышедшим за 30 дней.
  const recent = videos.filter((v) => nowMs - Date.parse(v.createdAt) <= 30 * DAY_MS);
  const views30 = recent.reduce((s, v) => s + v.views, 0);
  const pct = (p: number) => `${p < 10 ? (Math.round(p * 10) / 10).toString().replace(".", ",") : Math.round(p)} %`;
  return {
    user,
    followersLabel: user.followers === null ? "—" : formatNumber(user.followers),
    likesLabel: user.likes === null ? "—" : formatCount(user.likes),
    videosLabel: user.videos === null ? String(videos.length) : formatNumber(user.videos),
    views30Label: `≈ ${formatCount(views30)}`,
    avgViewsLabel: videos.length ? formatCount(Math.round(views / videos.length)) : "—",
    engagementLabel: views > 0 ? pct((reactions / views) * 100) : "—",
    videos,
    rewards: [
      goal("Подписчики", user.followers ?? 0, CREATOR_REWARDS.followers),
      goal("Просмотры за 30 дней", views30, CREATOR_REWARDS.views30),
      goal("Ролики дольше минуты за 30 дней", recent.filter((v) => v.long).length, 1),
    ],
  };
}
