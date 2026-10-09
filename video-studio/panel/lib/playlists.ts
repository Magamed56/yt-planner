// Плейлисты рубрик: на каждую рубрику плана — плейлист «<рубрика> — <канал>», в нём вышедшие и
// запланированные ролики. Что создать и что добавить — чистая функция без сети (её проверяет
// scripts/insights-test.ts); запросы к YouTube — lib/playlist-sync.ts. Связь рубрика → плейлист
// хранится в переменной репозитория PANEL_PLAYLISTS вместе с настройкой «добавлять сами».
import { plural } from "./stages";
import { formatNumber } from "./stats";

export const PLAYLISTS_VAR = "PANEL_PLAYLISTS";
// Квота YouTube Data API: вставка (playlists.insert, playlistItems.insert) — 50 единиц,
// чтение списка — 1 единица за страницу; в сутки — 10 000.
export const PLAYLIST_QUOTA = { insert: 50, read: 1, daily: 10_000 };
// Вставок за одно «Применить»: 40 × 50 = 2 000 единиц — пятая часть суток, остальное панели хватит.
export const PLAYLIST_MAX_INSERTS = 40;
const TITLE_MAX = 150; // предел YouTube для названия плейлиста

export interface PlaylistsSetting {
  auto: boolean; // новые ролики после «Найти новые загрузки» — сразу в плейлист рубрики
  byPillar: Record<string, string>; // id рубрики → id плейлиста
}

export function parsePlaylistsSetting(raw: string | null): PlaylistsSetting {
  try {
    const j = JSON.parse(raw ?? "") as { auto?: unknown; byPillar?: unknown };
    const byPillar: Record<string, string> = {};
    if (j.byPillar && typeof j.byPillar === "object") {
      for (const [k, v] of Object.entries(j.byPillar as Record<string, unknown>)) if (typeof v === "string" && /^[\w-]{10,64}$/.test(v)) byPillar[k] = v;
    }
    return { auto: j.auto === true, byPillar };
  } catch {
    return { auto: false, byPillar: {} };
  }
}

export const playlistsSettingText = (s: PlaylistsSetting): string => JSON.stringify({ auto: s.auto, byPillar: s.byPillar });

const clean = (s: string) => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

export function playlistTitle(pillarTitle: string, channelName: string): string {
  const t = clean(`${pillarTitle} — ${channelName}`);
  return [...t].length > TITLE_MAX ? [...t].slice(0, TITLE_MAX).join("").trim() : t;
}

export function playlistDescription(pillarTitle: string, channelName: string): string {
  return clean(`Все ролики рубрики «${pillarTitle}» канала «${channelName}» — суть за минуту, только проверяемые факты.`);
}

const sameTitle = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();

export interface PlaylistInfo {
  id: string;
  title: string;
}

export interface SyncVideo {
  videoId: string;
  code: string;
  pillar: string;
}

export interface SyncInput {
  pillars: { id: string; title: string }[];
  channelName: string;
  setting: PlaylistsSetting;
  existing: PlaylistInfo[]; // плейлисты канала (playlists.list mine=true)
  members: Record<string, string[]>; // id плейлиста → id роликов в нём
  videos: SyncVideo[]; // вышедшие и запланированные ролики плана
  maxInserts?: number;
}

export interface SyncPillar {
  pillar: string;
  pillarTitle: string;
  title: string; // название плейлиста
  playlistId: string | null;
  status: "ok" | "found" | "create" | "empty"; // есть / нашёлся по названию / создать / роликов ещё нет
  toAdd: number;
  already: number;
}

export interface SyncPlan {
  pillars: SyncPillar[];
  create: { pillar: string; title: string; description: string }[];
  add: { pillar: string; videoId: string; code: string }[]; // в пределах лимита, старые — первыми
  deferred: number; // не влезли в лимит — в следующий раз
  already: number; // уже в своих плейлистах
  inserts: number;
  units: number;
  byPillar: Record<string, string>; // связи после сверки (без ещё не созданных)
  settingChanged: boolean; // нашлись плейлисты по названию или пропали удалённые — сохранить
}

// Сверка: плейлист рубрики — из настройки, если он ещё есть на канале; иначе — плейлист канала
// с тем же названием (настройку потеряли или создали руками); иначе — создать. Пустую рубрику не
// создаём. Ролики, которые уже в плейлисте, пропускаем — повторный запуск ничего не дублирует.
export function planPlaylistSync(input: SyncInput): SyncPlan {
  const cap = input.maxInserts ?? PLAYLIST_MAX_INSERTS;
  const alive = new Set(input.existing.map((p) => p.id));
  const byPillar: Record<string, string> = {};
  const pillars: SyncPillar[] = [];
  const pending: { pillar: string; videoId: string; code: string }[] = [];
  const create: SyncPlan["create"] = [];
  let already = 0;
  for (const p of input.pillars) {
    const title = playlistTitle(p.title, input.channelName);
    const saved = input.setting.byPillar[p.id];
    const found = saved && alive.has(saved) ? null : input.existing.find((e) => sameTitle(e.title, title));
    const playlistId = saved && alive.has(saved) ? saved : (found?.id ?? null);
    if (playlistId) byPillar[p.id] = playlistId;
    const inList = new Set(playlistId ? (input.members[playlistId] ?? []) : []);
    const videos = input.videos.filter((v) => v.pillar === p.id).sort((a, b) => a.code.localeCompare(b.code));
    const toAdd = videos.filter((v) => !inList.has(v.videoId));
    already += videos.length - toAdd.length;
    const status: SyncPillar["status"] = playlistId ? (found ? "found" : "ok") : videos.length ? "create" : "empty";
    if (status === "create") create.push({ pillar: p.id, title, description: playlistDescription(p.title, input.channelName) });
    pillars.push({ pillar: p.id, pillarTitle: p.title, title, playlistId, status, toAdd: toAdd.length, already: videos.length - toAdd.length });
    pending.push(...toAdd.map((v) => ({ pillar: p.id, videoId: v.videoId, code: v.code })));
  }
  // Сначала создаём плейлисты (их мало), потом добавляем ролики по порядку плана.
  const creates = create.slice(0, cap);
  const order = pending.filter((x) => byPillar[x.pillar] || creates.some((c) => c.pillar === x.pillar)).sort((a, b) => a.code.localeCompare(b.code));
  const add = order.slice(0, Math.max(0, cap - creates.length));
  const inserts = creates.length + add.length;
  const saved = input.setting.byPillar;
  const settingChanged = Object.keys(saved).length !== Object.keys(byPillar).length || Object.entries(byPillar).some(([k, v]) => saved[k] !== v);
  return {
    pillars,
    create: creates,
    add,
    deferred: pending.length - add.length,
    already,
    inserts,
    units: inserts * PLAYLIST_QUOTA.insert,
    byPillar,
    settingChanged,
  };
}

// «≈ 1 250 единиц из 10 000 в сутки»
export const quotaLabel = (units: number): string =>
  `≈ ${formatNumber(units)} ${plural(units, "единица", "единицы", "единиц")} из ${formatNumber(PLAYLIST_QUOTA.daily)} в сутки`;
