// TikTok для панели (сервер): вход через Login Kit (OAuth v2), ключи — в переменной репозитория
// PANEL_TIKTOK в зашифрованном виде (AES-256-GCM, ключ выводится из TIKTOK_CLIENT_SECRET), профиль
// и ролики — Display API. Только официальный API, только чтение: выкладывать ролики через API
// TikTok разрешает лишь проверенным приложениям «для многих пользователей» (docs/tiktok-setup.md).
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteVariable, getVariable, setVariable } from "./github";
import { parseUser, parseVideos, TIKTOK_DEFAULT_SCOPES, tiktokApiError, type TikTokUser, type TikTokVideo } from "./tiktok-data";

export const TIKTOK_VAR = "PANEL_TIKTOK";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
const STATE_TTL_MS = 15 * 60_000;

export interface TikTokTokens {
  openId: string;
  scope: string;
  accessToken: string;
  accessUntil: number; // мс
  refreshToken: string;
  refreshUntil: number; // мс
  connectedAt: string;
}

export class TikTokError extends Error {
  constructor(
    message: string,
    readonly reconnect = false, // ключ больше не работает — нужно «Подключить» заново
  ) {
    super(message);
  }
}

const env = (k: string) => process.env[k]?.trim() ?? "";

// Чего не хватает в Vercel для TikTok.
export function tiktokEnvMissing(): string[] {
  return ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"].filter((k) => !env(k));
}

export const tiktokScopes = () => (env("TIKTOK_SCOPES") ? env("TIKTOK_SCOPES").split(/[\s,]+/).filter(Boolean) : TIKTOK_DEFAULT_SCOPES);

// Адрес возврата: ровно тот, что прописан в портале TikTok (без параметров).
export const redirectUri = (origin: string) => env("TIKTOK_REDIRECT_URI") || `${origin}/api/tiktok/callback`;

// ---- state для OAuth: подпись вместо cookie ----
// Панель со значка на iPhone открывает TikTok в отдельном окне без своих cookie — проверяем
// подпись (SESSION_SECRET) и срок, а не cookie: подделать state без секрета нельзя.

const stateSig = (body: string) => createHmac("sha256", env("SESSION_SECRET")).update(`tiktok:${body}`).digest("base64url");

export function newState(now = Date.now()): string {
  const body = `${now + STATE_TTL_MS}.${randomBytes(12).toString("base64url")}`;
  return `${body}.${stateSig(body)}`;
}

export function stateValid(state: string | null, now = Date.now()): boolean {
  const m = /^(\d+)\.([\w-]+)\.([\w-]+)$/.exec(state ?? "");
  if (!m || !env("SESSION_SECRET") || Number(m[1]) < now) return false;
  const want = Buffer.from(stateSig(`${m[1]}.${m[2]}`));
  const got = Buffer.from(m[3]!);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function authorizeUrl(origin: string, state: string): string {
  const q = new URLSearchParams({ client_key: env("TIKTOK_CLIENT_KEY"), scope: tiktokScopes().join(","), response_type: "code", redirect_uri: redirectUri(origin), state });
  return `${AUTH_URL}?${q}`;
}

// ---- хранение: AES-256-GCM, «v1.iv.данные.тег» ----

function key(secret = env("TIKTOK_CLIENT_SECRET")): Buffer {
  if (!secret) throw new TikTokError("Не задан TIKTOK_CLIENT_SECRET (Vercel → Settings → Environment Variables).");
  return Buffer.from(hkdfSync("sha256", secret, "yt-planner-panel", "tiktok-tokens-v1", 32));
}

export function sealTokens(t: TikTokTokens, secret?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([c.update(JSON.stringify(t), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), data.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function openTokens(sealed: string, secret?: string): TikTokTokens | null {
  const [v, iv, data, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !data || !tag) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    const t = JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8")) as TikTokTokens;
    return typeof t.accessToken === "string" && typeof t.refreshToken === "string" ? t : null;
  } catch {
    return null; // другой секрет приложения или битая запись — подключать заново
  }
}

// ---- токены ----

type TokenReply = { access_token?: string; expires_in?: number; open_id?: string; refresh_token?: string; refresh_expires_in?: number; scope?: string; error?: string; error_description?: string };

async function tokenCall(params: Record<string, string>): Promise<TokenReply> {
  let res: Response;
  try {
    res = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), ...params }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new TikTokError(`TikTok не отвечает (${e instanceof Error ? e.message : String(e)}). Попробуйте через минуту.`);
  }
  const j = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || j.error || !j.access_token) {
    const reconnect = j.error === "invalid_grant" || j.error === "invalid_client";
    const why = j.error === "invalid_client" ? "неверные TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET" : j.error === "invalid_grant" ? "доступ истёк или отозван" : `${j.error ?? `HTTP ${res.status}`} ${j.error_description ?? ""}`.trim();
    throw new TikTokError(`TikTok: ${why}${reconnect ? " — подключите TikTok заново" : ""}.`, reconnect);
  }
  return j;
}

const tokensOf = (j: TokenReply, now: number, connectedAt: string): TikTokTokens => ({
  openId: j.open_id ?? "",
  scope: j.scope ?? "",
  accessToken: j.access_token!,
  accessUntil: now + (j.expires_in ?? 86_400) * 1000,
  refreshToken: j.refresh_token ?? "",
  refreshUntil: now + (j.refresh_expires_in ?? 31_536_000) * 1000,
  connectedAt,
});

// Код из адреса возврата → ключи → в переменную репозитория.
export async function connectWithCode(code: string, origin: string): Promise<TikTokTokens> {
  const now = Date.now();
  const t = tokensOf(await tokenCall({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) }), now, new Date(now).toISOString());
  await setVariable(TIKTOK_VAR, sealTokens(t));
  return t;
}

let cached: TikTokTokens | null = null;

// Действующий ключ доступа: живёт сутки, за 5 минут до конца — обновляем. TikTok может выдать
// новый refresh token — сохраняем именно его (старый может перестать работать).
export async function tokens(): Promise<TikTokTokens | null> {
  const now = Date.now();
  if (cached && cached.accessUntil - now > 5 * 60_000) return cached;
  const raw = await getVariable(TIKTOK_VAR);
  if (!raw) return (cached = null);
  let t = openTokens(raw);
  if (!t) throw new TikTokError("Сохранённый ключ TikTok не читается (сменили TIKTOK_CLIENT_SECRET?) — подключите TikTok заново.", true);
  if (t.accessUntil - now <= 5 * 60_000) {
    if (t.refreshUntil <= now) throw new TikTokError("Ключ TikTok истёк (раз в год) — подключите TikTok заново.", true);
    t = { ...tokensOf(await tokenCall({ grant_type: "refresh_token", refresh_token: t.refreshToken }), now, t.connectedAt) };
    await setVariable(TIKTOK_VAR, sealTokens(t));
  }
  return (cached = t);
}

// Отключить: отозвать доступ у TikTok (не вышло — не страшно) и стереть ключи.
export async function disconnect(): Promise<void> {
  const raw = await getVariable(TIKTOK_VAR);
  const t = raw ? openTokens(raw) : null;
  if (t) {
    await fetch(`${API}/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), token: t.accessToken }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }
  cached = null;
  await deleteVariable(TIKTOK_VAR);
}

// ---- Display API ----

async function api(t: TikTokTokens, path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${t.accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new TikTokError(`TikTok не отвечает (${e instanceof Error ? e.message : String(e)}). Обновите страницу через минуту.`);
  }
  const j: unknown = await res.json().catch(() => null);
  const err = tiktokApiError(j, res.status);
  if (err) {
    if (res.status === 401) cached = null;
    throw new TikTokError(err, res.status === 401);
  }
  return j;
}

// Поля профиля — по выданным правам: лишнее поле TikTok отвергает целиком.
export async function tiktokUser(t: TikTokTokens): Promise<TikTokUser> {
  const scopes = new Set(t.scope.split(/[\s,]+/));
  const fields = ["open_id", "avatar_url", "avatar_url_100", "display_name"];
  if (scopes.has("user.info.profile")) fields.push("username");
  if (scopes.has("user.info.stats")) fields.push("follower_count", "following_count", "likes_count", "video_count");
  const user = parseUser(await api(t, `/user/info/?fields=${fields.join(",")}`));
  if (!user) throw new TikTokError("TikTok не вернул профиль — обновите страницу.");
  return user;
}

// Публичные ролики аккаунта, новые первыми: по 20 за запрос, не больше max.
export async function tiktokVideos(t: TikTokTokens, max = 100): Promise<TikTokVideo[]> {
  if (!t.scope.split(/[\s,]+/).includes("video.list")) return [];
  const fields = "id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count";
  const out: TikTokVideo[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < Math.ceil(max / 20); page++) {
    const body: Record<string, number> = { max_count: 20 };
    if (cursor !== null) body.cursor = cursor;
    const r = parseVideos(await api(t, `/video/list/?fields=${fields}`, { method: "POST", body: JSON.stringify(body) }));
    out.push(...r.videos);
    if (!r.hasMore || r.cursor === null) break;
    cursor = r.cursor;
  }
  return out.slice(0, max);
}
