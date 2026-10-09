// Плейлисты рубрик — запросы: свежая очередь (какие ролики вышли и запланированы), плейлисты
// канала и их ролики, затем создание и добавление. Что делать — решает planPlaylistSync.
import { parsePlan } from "../../src/pipeline/plan";
import { getVariable, readJson, setVariable } from "./github";
import { loadState, STUDIO_DIR } from "./load";
import { PLAYLISTS_VAR, parsePlaylistsSetting, planPlaylistSync, playlistsSettingText, type PlaylistsSetting, type SyncPlan } from "./playlists";
import { codesLabel } from "./stages";
import { addToPlaylist, createPlaylist, myPlaylists, playlistVideoIds } from "./youtube-tools";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Без прав, ключа или квоты остальные запросы тоже не пройдут — не тратим квоту.
const fatal = (msg: string) => /не хватает прав|недействителен|неверные YT_CLIENT|квота/.test(msg);

async function pillarsOfPlan(): Promise<{ id: string; title: string }[]> {
  const plan = parsePlan(await readJson(`${STUDIO_DIR}/content/plan.json`));
  if (plan.pillars?.length) return plan.pillars.map((p) => ({ id: p.id, title: p.title }));
  return [...new Set(plan.items.map((i) => i.pillar))].map((id) => ({ id, title: id }));
}

export async function readPlaylistsSetting(): Promise<PlaylistsSetting> {
  return parsePlaylistsSetting(await getVariable(PLAYLISTS_VAR));
}

export interface SyncState {
  plan: SyncPlan;
  setting: PlaylistsSetting;
}

// Квота сверки: очередь ≈ 3–5 единиц, список плейлистов — 1, ролики плейлистов — по 1 на рубрику.
export async function computePlaylistSync(): Promise<SyncState> {
  const [state, pillars, setting, existing] = await Promise.all([loadState(), pillarsOfPlan(), readPlaylistsSetting(), myPlaylists()]);
  if (state.youtubeError) throw new Error(`YouTube недоступен: ${state.youtubeError}`);
  const videos = state.rows
    .filter((r) => r.youtube && (r.stage === "published" || r.stage === "scheduled"))
    .map((r) => ({ videoId: r.youtube!.videoId, code: r.code, pillar: r.pillar }));
  // Ролики читаем только у плейлистов, которые сверка может взять: из настройки и с нужным названием.
  const first = planPlaylistSync({ pillars, channelName: state.channelName, setting, existing, members: {}, videos });
  const ids = Object.values(first.byPillar);
  const lists = await Promise.all(ids.map((id) => playlistVideoIds(id)));
  const members = Object.fromEntries(ids.map((id, i) => [id, lists[i]!]));
  const plan = planPlaylistSync({ pillars, channelName: state.channelName, setting, existing, members, videos });
  return { plan, setting };
}

export interface SyncResult {
  created: string[];
  added: string[]; // коды
  problems: string[];
  deferred: number;
}

// Создаём недостающие плейлисты (id сразу в настройку: при сбое дальше дубля не будет),
// затем добавляем ролики. Повторный запуск продолжает с того же места.
export async function applyPlaylistSync(): Promise<SyncResult> {
  const { plan, setting } = await computePlaylistSync();
  const next: PlaylistsSetting = { auto: setting.auto, byPillar: { ...plan.byPillar } };
  if (plan.settingChanged) await setVariable(PLAYLISTS_VAR, playlistsSettingText(next));
  const res: SyncResult = { created: [], added: [], problems: [], deferred: plan.deferred };
  for (const c of plan.create) {
    try {
      next.byPillar[c.pillar] = await createPlaylist(c.title, c.description);
      res.created.push(c.title);
      await setVariable(PLAYLISTS_VAR, playlistsSettingText(next));
    } catch (e) {
      res.problems.push(`плейлист «${c.title}»: ${errorText(e)}`);
      if (fatal(errorText(e))) return res;
    }
  }
  for (const a of plan.add) {
    const id = next.byPillar[a.pillar];
    if (!id) continue; // плейлист не создался — его ролики в следующий раз
    try {
      await addToPlaylist(id, a.videoId);
      res.added.push(a.code);
    } catch (e) {
      res.problems.push(`${a.code}: ${errorText(e)}`);
      if (fatal(errorText(e))) break;
    }
  }
  return res;
}

// После «Найти новые загрузки»: если включено «добавлять сами», свежие ролики — в плейлист своей
// рубрики (только в уже созданные). Ошибки не роняют заполнение — возвращаем их текстом.
export async function autoAddToPlaylists(items: { code: string; videoId: string }[]): Promise<string | null> {
  if (!items.length) return null;
  try {
    const setting = await readPlaylistsSetting();
    if (!setting.auto) return null;
    const plan = parsePlan(await readJson(`${STUDIO_DIR}/content/plan.json`));
    const pillarOf = new Map(plan.items.map((i) => [i.id, i.pillar]));
    const todo = items.map((x) => ({ ...x, playlistId: setting.byPillar[pillarOf.get(x.code) ?? ""] })).filter((x) => x.playlistId);
    const lists = new Map<string, Set<string>>();
    for (const id of new Set(todo.map((x) => x.playlistId!))) lists.set(id, new Set(await playlistVideoIds(id)));
    const added: string[] = [];
    for (const x of todo) {
      if (lists.get(x.playlistId!)!.has(x.videoId)) continue;
      await addToPlaylist(x.playlistId!, x.videoId);
      added.push(x.code);
    }
    const skipped = items.length - todo.length;
    const parts = [added.length ? `в плейлисты рубрик: ${codesLabel(added)}` : "", skipped ? `без плейлиста рубрики: ${skipped} — создайте на «Статистике»` : ""].filter(Boolean);
    return parts.length ? `Плейлисты — ${parts.join("; ")}.` : null;
  } catch (e) {
    return `Плейлисты: не вышло — ${errorText(e)}`;
  }
}
