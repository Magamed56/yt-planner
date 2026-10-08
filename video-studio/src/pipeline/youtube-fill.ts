// Тексты и расписание для роликов, которые загрузили в YouTube Studio руками
// (npm run youtube-fill). Ищем их среди загрузок канала: код ролика «01a» в имени
// файла или в заголовке-черновике (Studio берёт его из имени файла), затем
// уникальная длительность. Найденным ставим название, описание, теги, категорию,
// язык, «не для детей», отметку о синтетическом контенте и publishAt через
// videos.update. Ролики, у которых уже есть время выхода, не сдвигаем.

import { isoNoMs, upcomingSlots, type ChannelSchedule } from "./channel";
import { accessToken, explainApiError, type Auth } from "./youtube";

const API = "https://www.googleapis.com/youtube/v3";

// Ролик из списка (content/week1-videos.json): что поставить на YouTube.
export interface FillItem {
  id: string; // «01a» — код в начале имени файла
  file: string; // имя файла без .mp4: «01a-pochemu-svoy-golos…»
  durationSec: number;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage: string;
  containsSyntheticMedia: boolean;
}

// Видео канала — то, что вернул videos.list.
export interface ChannelVideo {
  videoId: string;
  title: string;
  description: string;
  fileName: string | null; // fileDetails.fileName — видно только владельцу
  durationSec: number | null;
  uploadStatus: string | null; // uploaded | processed | failed | rejected | deleted
  privacyStatus: string; // private | unlisted | public
  publishAt: string | null;
  embeddable: boolean | null;
  license: string | null;
  publicStatsViewable: boolean | null;
}

export type MatchedBy = "файл" | "название" | "длительность";

export interface FillMatch {
  item: FillItem;
  video: ChannelVideo;
  by: MatchedBy;
}

export interface MatchReport {
  matches: FillMatch[]; // в порядке списка роликов
  missing: FillItem[]; // ролика нет на канале (ещё не загружен или YouTube его пока не показывает)
  duplicates: { item: FillItem; videos: ChannelVideo[] }[]; // загружен дважды — не трогаем, решает человек
  broken: { item: FillItem; video: ChannelVideo }[]; // загрузка не удалась (failed/rejected)
  pending: { item: FillItem; video: ChannelVideo }[]; // файл ещё загружается: длительности нет (P0D), трогать рано
}

// «PT1M4S» → 64; «P0D» и мусор → null.
export function parseIsoDuration(s: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s ?? "");
  if (!m) return null;
  const sec = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return sec > 0 ? sec : null;
}

// Код ролика («01a») как отдельное слово: «01a-pochemu.mp4», «01a pochemu», «Ролик 01a».
function codeIn(text: string | null, codes: Set<string>): string | null {
  if (!text) return null;
  for (const m of text.toLowerCase().matchAll(/(?:^|[^0-9a-zа-яё])(\d{2}[a-z])(?=$|[^0-9a-zа-яё])/g)) {
    if (codes.has(m[1]!)) return m[1]!;
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/\.mp4$/i, "").replace(/[\s_]+/g, "-");

// Какому ролику из списка соответствует видео канала и по какому признаку.
function identify(video: ChannelVideo, items: FillItem[], codes: Set<string>): { item: FillItem; by: MatchedBy } | null {
  const byId = new Map(items.map((i) => [i.id.toLowerCase(), i]));
  const fromFile = codeIn(video.fileName, codes);
  if (fromFile) return { item: byId.get(fromFile)!, by: "файл" };
  const fromTitle = codeIn(video.title, codes);
  if (fromTitle) return { item: byId.get(fromTitle)!, by: "название" };
  // Имя файла без кода (переименовали) или уже проставленное нами название — повторный запуск.
  for (const item of items) {
    const slug = norm(item.file).replace(/^\d{2}[a-z]-/, "");
    if ((video.fileName && norm(video.fileName).includes(slug)) || norm(video.title).includes(slug)) return { item, by: "файл" };
    if (video.title.trim() === item.title.trim()) return { item, by: "название" };
  }
  return null;
}

const DURATION_TOLERANCE_SEC = 1.5;

export function matchVideos(items: FillItem[], videos: ChannelVideo[]): MatchReport {
  const codes = new Set(items.map((i) => i.id.toLowerCase()));
  const found = new Map<string, { video: ChannelVideo; by: MatchedBy }[]>();
  const unknown: ChannelVideo[] = [];
  for (const v of videos) {
    const hit = identify(v, items, codes);
    if (!hit) {
      unknown.push(v);
      continue;
    }
    const list = found.get(hit.item.id) ?? [];
    list.push({ video: v, by: hit.by });
    found.set(hit.item.id, list);
  }
  // Последний шанс — длительность, но только однозначная: один ролик ↔ одно видео.
  const unmatchedItems = items.filter((i) => !found.has(i.id));
  const candidates = (v: ChannelVideo) =>
    v.durationSec === null || v.privacyStatus === "public"
      ? []
      : unmatchedItems.filter((i) => Math.abs(i.durationSec - v.durationSec!) <= DURATION_TOLERANCE_SEC);
  for (const v of unknown) {
    const c = candidates(v);
    if (c.length !== 1) continue;
    const item = c[0]!;
    const rivals = unknown.filter((u) => u !== v && candidates(u).includes(item));
    if (rivals.length) continue;
    found.set(item.id, [{ video: v, by: "длительность" }]);
  }

  const report: MatchReport = { matches: [], missing: [], duplicates: [], broken: [], pending: [] };
  for (const item of items) {
    const list = found.get(item.id) ?? [];
    const alive = list.filter((x) => !["failed", "rejected", "deleted"].includes(x.video.uploadStatus ?? ""));
    if (!list.length) report.missing.push(item);
    else if (!alive.length) report.broken.push({ item, video: list[0]!.video });
    else if (alive.length > 1) report.duplicates.push({ item, videos: alive.map((x) => x.video) });
    // Как в bakery-escape (publish_plan.received): пока у видео нет длительности, YouTube не получил файл целиком.
    else if (alive[0]!.video.durationSec === null) report.pending.push({ item, video: alive[0]!.video });
    else report.matches.push({ item, video: alive[0]!.video, by: alive[0]!.by });
  }
  return report;
}

export type ScheduleMode = "slots" | "none";

export interface PlannedUpdate {
  match: FillMatch;
  privacyStatus: string; // что будет после обновления
  publishAt: string | null; // новое время выхода или прежнее (keptPublishAt)
  keptPublishAt: boolean; // время уже стояло — не трогаем
  textsChanged: boolean;
  skip: boolean; // всё уже как надо — запрос не нужен
}

const textsMatch = (v: ChannelVideo, i: FillItem) => v.title.trim() === i.title.trim() && v.description.trim() === i.description.trim();

// Кому какой слот: по порядку списка, следующие свободные слоты после «сейчас»
// (или после start), уже назначенные времена не сдвигаем и не занимаем.
export function planUpdates(
  report: MatchReport,
  opts: { schedule: ChannelSchedule; mode: ScheduleMode; start?: Date | null; now?: Date },
): PlannedUpdate[] {
  const now = opts.now ?? new Date();
  const future = (iso: string | null) => (iso ? Date.parse(iso) > now.getTime() : false);
  const kept = report.matches.filter((m) => m.video.privacyStatus !== "public" && future(m.video.publishAt));
  const needSlot = report.matches.filter((m) => m.video.privacyStatus !== "public" && !future(m.video.publishAt));
  const from = opts.start && opts.start.getTime() > now.getTime() ? opts.start : now;
  const slots =
    opts.mode === "slots"
      ? upcomingSlots(opts.schedule, needSlot.length, { from, taken: kept.map((m) => m.video.publishAt!) })
      : [];
  let next = 0;
  return report.matches.map((match) => {
    const v = match.video;
    const textsChanged = !textsMatch(v, match.item);
    if (v.privacyStatus === "public") {
      return { match, privacyStatus: "public", publishAt: null, keptPublishAt: false, textsChanged, skip: !textsChanged };
    }
    if (future(v.publishAt)) {
      return { match, privacyStatus: "private", publishAt: v.publishAt, keptPublishAt: true, textsChanged, skip: !textsChanged };
    }
    const slot = opts.mode === "slots" ? slots[next++] : undefined;
    const publishAt = slot ? isoNoMs(slot) : null;
    // Без слота видео остаётся как было (обычно «Ограниченный доступ») — опубликуете сами.
    return { match, privacyStatus: publishAt ? "private" : v.privacyStatus, publishAt, keptPublishAt: false, textsChanged, skip: !textsChanged && !publishAt };
  });
}

// Тело videos.update. Изменяемые поля частей snippet и status, которых нет в
// запросе, YouTube сбрасывает к значениям по умолчанию — поэтому переносим
// текущие embeddable, license и publicStatsViewable.
export function updateBody(p: PlannedUpdate): Record<string, unknown> {
  const { item, video } = p.match;
  const status: Record<string, unknown> = {
    privacyStatus: p.privacyStatus,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: item.containsSyntheticMedia,
    embeddable: video.embeddable ?? true,
    license: video.license ?? "youtube",
    publicStatsViewable: video.publicStatsViewable ?? true,
  };
  if (p.publishAt) status.publishAt = p.publishAt;
  return {
    id: video.videoId,
    snippet: {
      title: item.title,
      description: item.description,
      tags: item.tags,
      categoryId: item.categoryId,
      defaultLanguage: item.defaultLanguage,
      defaultAudioLanguage: item.defaultLanguage,
    },
    status,
  };
}

// ---- Data API ----

export interface ApiDeps {
  auth: Auth;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

async function api<T>(deps: ApiDeps, method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await f(`${API}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken(deps.auth)}`, ...(body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/недействителен|неверные YT_CLIENT/.test(msg) || attempt >= 3) throw new Error(`YouTube: ${msg}`, { cause: e });
      deps.log?.(`нет связи (${msg}) — повтор через ${attempt * 5} с…`);
      await sleep(attempt * 5000);
      continue;
    }
    const text = await res.text();
    if (res.ok) return (text ? JSON.parse(text) : {}) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      deps.log?.(`${explainApiError(res.status, text)} — повтор через ${attempt * 5} с…`);
      await sleep(attempt * 5000);
      continue;
    }
    throw new Error(`YouTube: ${explainApiError(res.status, text)}`);
  }
}

interface ApiVideo {
  id: string;
  snippet?: { title?: string; description?: string };
  status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string; embeddable?: boolean; license?: string; publicStatsViewable?: boolean };
  contentDetails?: { duration?: string };
  fileDetails?: { fileName?: string };
}

const toChannelVideo = (v: ApiVideo): ChannelVideo => ({
  videoId: v.id,
  title: v.snippet?.title ?? "",
  description: v.snippet?.description ?? "",
  fileName: v.fileDetails?.fileName ?? null,
  durationSec: parseIsoDuration(v.contentDetails?.duration),
  uploadStatus: v.status?.uploadStatus ?? null,
  privacyStatus: v.status?.privacyStatus ?? "private",
  publishAt: v.status?.publishAt ?? null,
  embeddable: v.status?.embeddable ?? null,
  license: v.status?.license ?? null,
  publicStatsViewable: v.status?.publicStatsViewable ?? null,
});

// Последние загрузки канала (до maxVideos): плейлист «Загрузки» + поиск по своим
// роликам — только что загруженное видео появляется в плейлисте с задержкой.
export async function listChannelVideos(deps: ApiDeps, maxVideos = 200): Promise<ChannelVideo[]> {
  const ch = await api<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(deps, "GET", "channels?part=contentDetails&mine=true");
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("YouTube: у этого аккаунта Google нет канала — войдите в аккаунт канала «Суть за минуту» при получении токена.");
  const ids: string[] = [];
  let page = "";
  do {
    const q = new URLSearchParams({ part: "contentDetails", playlistId: uploads, maxResults: "50" });
    if (page) q.set("pageToken", page);
    const r = await api<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>(deps, "GET", `playlistItems?${q}`);
    for (const it of r.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    page = r.nextPageToken ?? "";
  } while (page && ids.length < maxVideos);
  try {
    const s = await api<{ items?: { id?: { videoId?: string } }[] }>(deps, "GET", "search?part=id&forMine=true&type=video&order=date&maxResults=50");
    for (const it of s.items ?? []) if (it.id?.videoId) ids.push(it.id.videoId);
  } catch (e) {
    deps.log?.(`поиск по своим роликам не сработал (${e instanceof Error ? e.message : e}) — беру только плейлист «Загрузки»`);
  }
  const unique = [...new Set(ids)].slice(0, maxVideos);
  const out: ChannelVideo[] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const q = new URLSearchParams({ part: "snippet,status,contentDetails,fileDetails", id: unique.slice(i, i + 50).join(","), maxResults: "50" });
    const r = await api<{ items?: ApiVideo[] }>(deps, "GET", `videos?${q}`);
    out.push(...(r.items ?? []).map(toChannelVideo));
  }
  return out;
}

export interface AppliedUpdate {
  plan: PlannedUpdate;
  publishAt: string | null; // что YouTube вернул после обновления
  privacyStatus: string;
  warning: string | null;
}

export async function applyUpdate(deps: ApiDeps, p: PlannedUpdate): Promise<AppliedUpdate> {
  const r = await api<ApiVideo>(deps, "PUT", "videos?part=snippet,status", updateBody(p));
  const publishAt = r.status?.publishAt ?? null;
  const privacyStatus = r.status?.privacyStatus ?? p.privacyStatus;
  const warning =
    p.publishAt && !publishAt
      ? "YouTube не принял время выхода (так бывает, пока проект Google не прошёл аудит API) — поставьте «Запланировать» в Studio вручную"
      : null;
  return { plan: p, publishAt, privacyStatus, warning };
}
