// Субтитры на YouTube через Data API v3 без googleapis: captions.list (что уже есть у ролика)
// и captions.insert (multipart: метаданные JSON + файл .srt одним запросом).
// Оба метода принимают только токен с правом youtube.force-ssl — у ключей, выпущенных до него,
// права нет: проверяем заранее (tokeninfo) и объясняем, как выпустить ключ заново.
// Квота: captions.list — 50 единиц, captions.insert — 400 (в сутки 10 000).

import { randomBytes } from "node:crypto";
import { accessToken, explainApiError, type Auth } from "./google-api";

export const CAPTIONS_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const PARTNER_SCOPE = "https://www.googleapis.com/auth/youtubepartner";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/captions";
export const CAPTION_INSERT_UNITS = 400;
export const CAPTION_LIST_UNITS = 50;

export function captionsScopeHelp(): string {
  return (
    "У ключа YouTube нет права на субтитры (youtube.force-ssl) — ключ выпущен раньше, чем оно понадобилось.\n" +
    "  1) На своём ПК: npm run youtube-auth -- --save (в окне Google оставьте отмеченными все галочки доступа).\n" +
    "  2) Новый YT_REFRESH_TOKEN из .env — в GitHub (Settings → Secrets and variables → Actions → YT_REFRESH_TOKEN),\n" +
    "     в Vercel (проект панели → Settings → Environment Variables → YT_REFRESH_TOKEN, затем Redeploy)\n" +
    "     и в video-studio/.env на втором компьютере. Старый ключ после этого можно не отзывать."
  );
}

export class CaptionsScopeError extends Error {
  constructor() {
    super(captionsScopeHelp());
    this.name = "CaptionsScopeError";
  }
}

export interface CaptionDeps {
  auth: Auth;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export const hasCaptionsScope = (scopes: string[]): boolean => scopes.includes(CAPTIONS_SCOPE) || scopes.includes(PARTNER_SCOPE);

// Права текущего токена (tokeninfo). Нет связи — null: решит сам запрос (403 → понятная ошибка).
export async function tokenScopes(deps: CaptionDeps): Promise<string[] | null> {
  const f = deps.fetch ?? fetch;
  try {
    const token = await accessToken(deps.auth);
    const res = await f(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { scope?: string };
    return typeof j.scope === "string" ? j.scope.split(/\s+/).filter(Boolean) : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Отозванный ключ или чужой клиент — это не «нет связи», а ошибка, которую надо показать.
    if (/недействителен|неверные YT_CLIENT/.test(msg)) throw e;
    return null;
  }
}

const insufficient = (status: number, body: string) => status === 403 && /insufficientPermissions|insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body);

async function request(deps: CaptionDeps, url: string, init: RequestInit, what: string): Promise<unknown> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await f(url, { ...init, headers: { Authorization: `Bearer ${await accessToken(deps.auth)}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/недействителен|неверные YT_CLIENT/.test(msg) || attempt >= 3) throw new Error(`YouTube (${what}): ${msg}`, { cause: e });
      deps.log?.(`нет связи (${msg}) — повтор через ${attempt * 5} с…`);
      await sleep(attempt * 5000);
      continue;
    }
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if (insufficient(res.status, text)) throw new CaptionsScopeError();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      deps.log?.(`${explainApiError(res.status, text)} — повтор через ${attempt * 5} с…`);
      await sleep(attempt * 5000);
      continue;
    }
    throw new Error(`YouTube (${what}): ${explainApiError(res.status, text)}`);
  }
}

export interface CaptionTrack {
  id: string;
  language: string;
  name: string;
  trackKind: string; // standard | asr (автосубтитры YouTube) | forced
}

export async function listCaptions(deps: CaptionDeps, videoId: string): Promise<CaptionTrack[]> {
  const q = new URLSearchParams({ part: "snippet", videoId });
  const r = (await request(deps, `${API}/captions?${q}`, { method: "GET" }, "список субтитров")) as {
    items?: { id?: string; snippet?: { language?: string; name?: string; trackKind?: string } }[];
  };
  return (r.items ?? []).map((i) => ({ id: i.id ?? "", language: i.snippet?.language ?? "", name: i.snippet?.name ?? "", trackKind: i.snippet?.trackKind ?? "standard" }));
}

// Своя дорожка этого языка уже есть (автосубтитры YouTube — не в счёт): второй раз не заливаем.
export function existingTrack(tracks: CaptionTrack[], lang: string): CaptionTrack | null {
  const base = (l: string) => l.toLowerCase().split("-")[0];
  return tracks.find((t) => t.trackKind !== "asr" && base(t.language) === base(lang)) ?? null;
}

// Тело multipart/related: часть 1 — snippet (JSON), часть 2 — сам .srt.
export function captionsMultipart(snippet: { videoId: string; language: string; name: string }, srt: string, boundary = `vs${randomBytes(12).toString("hex")}`): { body: string; contentType: string } {
  const meta = JSON.stringify({ snippet: { ...snippet, isDraft: false } });
  const body = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", meta, `--${boundary}`, "Content-Type: application/x-subrip; charset=UTF-8", "", srt, `--${boundary}--`, ""].join("\r\n");
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export async function insertCaption(deps: CaptionDeps, input: { videoId: string; language: string; name: string; srt: string }): Promise<{ id: string }> {
  const { body, contentType } = captionsMultipart({ videoId: input.videoId, language: input.language, name: input.name }, input.srt);
  const q = new URLSearchParams({ uploadType: "multipart", part: "snippet" });
  const r = (await request(deps, `${UPLOAD}?${q}`, { method: "POST", headers: { "Content-Type": contentType }, body }, "загрузка субтитров")) as { id?: string };
  if (!r.id) throw new Error("YouTube не вернул id дорожки субтитров.");
  return { id: r.id };
}

// ---- Исходные субтитры из релизов GitHub ----

export interface ReleaseLike {
  tag_name: string;
  draft?: boolean;
  created_at?: string;
  published_at?: string | null;
  assets?: { id: number; name: string; url?: string; browser_download_url?: string }[];
}

// Самый свежий релиз русского ролика с кодом: файл «08a-….mp4» и captions.srt рядом.
// Переводы «en-08a-….mp4» не подходят — их субтитры уже не русские.
export function pickCaptionRelease(releases: ReleaseLike[], code: string): { tag: string; assetId: number } | null {
  const mp4 = new RegExp(`^${code.toLowerCase()}-.+\\.mp4$`, "i");
  const when = (r: ReleaseLike) => Date.parse(r.published_at ?? r.created_at ?? "") || 0;
  const list = releases.filter((r) => !r.draft && (r.assets ?? []).some((a) => mp4.test(a.name))).sort((a, b) => when(b) - when(a));
  for (const r of list) {
    const srt = r.assets!.find((a) => a.name === "captions.srt");
    if (srt) return { tag: r.tag_name, assetId: srt.id };
  }
  return null;
}
