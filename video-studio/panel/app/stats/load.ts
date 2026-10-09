// Данные экрана «Статистика»: очередь (тот же loadState — для меню и сопоставления роликов с
// темами плана) + цифры канала из того же прохода по YouTube + удержание из YouTube Analytics
// (один запрос) + запуски Actions с начала месяца + content/usage.jsonl. Считает всё lib/stats.ts;
// здесь — только запросы.
import { parsePlan } from "../../../src/pipeline/plan";
import { parseTitleIdeas, TITLE_IDEAS_FILE } from "../../../src/pipeline/title-ideas";
import type { ChannelListing } from "../../../src/pipeline/youtube-fill";
import { analyticsRange } from "@/lib/analytics";
import { getVariable, GithubError, readFile, readJson, repoName } from "@/lib/github";
import { releaseTiming, weakStarts, type ReleaseTiming, type WeakStartReport } from "@/lib/insights";
import { loadState, STUDIO_DIR } from "@/lib/load";
import { PLAYLISTS_VAR, parsePlaylistsSetting } from "@/lib/playlists";
import type { PanelState } from "@/lib/state";
import { buildStats, type RunTiming, type StatsData } from "@/lib/stats";
import { titleIdeaViews, type TitleIdeaView } from "@/lib/titles";
import { channelOverview, channelRetention, type RetentionResult } from "@/lib/youtube";

// Подсказки: слабый старт и новые названия, лучшее время выхода, плейлисты рубрик.
export interface StatsExtras {
  weak: WeakStartReport;
  ideas: TitleIdeaView[];
  ideasError: string | null;
  titlesRunning: string[]; // коды, для которых сейчас идёт подбор названий
  timing: ReleaseTiming;
  slotTimes: string[];
  playlists: { auto: boolean; count: number; error: string | null; channelName: string };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^YouTube:\s*/, "");

interface ApiRun {
  id: number;
  status: string;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
}

// Все запуски репозитория с 1-го числа (минуты тратят любые workflow, не только канала).
// Отдельный запрос, а не listRuns: тому хватает последних 40 и не нужны длительности.
async function monthRuns(now: Date): Promise<RunTiming[]> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new GithubError("Не задан GITHUB_TOKEN (Vercel → Settings → Environment Variables).", 0);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const page = async (n: number) => {
    const q = new URLSearchParams({ per_page: "100", page: String(n), exclude_pull_requests: "true", created: `>=${since}` });
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${repoName()}/actions/runs?${q}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new GithubError(`GitHub не отвечает (${errorText(e)}).`, 0);
    }
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " — у токена нужно право Actions: Read" : "";
      throw new GithubError(`GitHub, запуски Actions: HTTP ${res.status}${hint}.`, res.status);
    }
    return (await res.json()) as { total_count?: number; workflow_runs?: ApiRun[] };
  };
  const first = await page(1);
  // Больше 1000 запусков за месяц у канала не бывает — дальше не листаем.
  const pages = Math.min(10, Math.ceil((first.total_count ?? 0) / 100));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2)));
  return [first, ...rest]
    .flatMap((p) => p.workflow_runs ?? [])
    .map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, startedAt: r.run_started_at ?? null, updatedAt: r.updated_at }));
}

export async function loadStats(now = new Date()): Promise<{ state: PanelState; stats: StatsData; extras: StatsExtras }> {
  // Один проход по каналу (≈ 3–5 единиц квоты, без поиска): ролики уходят и в очередь.
  const overview = channelOverview();
  const youtube = overview.then(
    (o): ChannelListing & { error: string | null } => ({ ...o, error: null }),
    (e: unknown) => ({ videos: [], channel: null, error: errorText(e) }),
  );
  // Удержание — один запрос к Analytics сразу после списка роликов (нужна дата первой загрузки).
  // Не бросает и ждёт не дольше 10 с: без него страница всё равно полезна. Нет вышедших — не спрашиваем.
  const retention = youtube.then((o): Promise<RetentionResult> | null => {
    const range = o.error ? null : analyticsRange(o.videos, now);
    return range && o.videos.some((v) => v.privacyStatus === "public") ? channelRetention(range) : null;
  });
  const [state, planJson, runs, usage, yt, ideasRaw, playlistsRaw, analytics] = await Promise.all([
    loadState(now, overview.then((o) => o.videos)),
    readJson(`${STUDIO_DIR}/content/plan.json`),
    monthRuns(now).then(
      (list) => ({ list, error: null as string | null }),
      (e: unknown) => ({ list: null, error: errorText(e) }),
    ),
    readFile(`${STUDIO_DIR}/content/usage.jsonl`).then(
      (text) => ({ text, error: null as string | null }),
      (e: unknown) => ({ text: null, error: errorText(e) }),
    ),
    youtube,
    readJson(`${STUDIO_DIR}/${TITLE_IDEAS_FILE}`).then(
      (json) => ({ json, error: null as string | null }),
      (e: unknown) => ({ json: null, error: errorText(e) }),
    ),
    getVariable(PLAYLISTS_VAR).then(
      (raw) => ({ raw, error: null as string | null }),
      (e: unknown) => ({ raw: null, error: errorText(e) }),
    ),
    retention,
  ]);
  const plan = parsePlan(planJson);
  const pillarOf = new Map(plan.items.map((it) => [it.id, it.pillar]));
  const pillarIds = [...new Set(plan.items.map((it) => it.pillar))];
  const pillars = plan.pillars?.length ? plan.pillars.map((p) => ({ id: p.id, title: p.title })) : pillarIds.map((id) => ({ id, title: id }));
  const stats = buildStats({
    now,
    timezone: state.timezone,
    videos: yt.error ? null : yt.videos,
    channel: yt.channel,
    youtubeError: yt.error,
    topics: state.rows.flatMap((r) => (r.youtube ? [{ videoId: r.youtube.videoId, code: r.code, pillar: pillarOf.get(r.code) ?? "" }] : [])),
    pillars,
    runs: runs.list,
    runsError: runs.error,
    usageText: usage.text,
    usageError: usage.error,
    retention: analytics?.rows ?? null,
    retentionProblem: analytics?.problem ?? null,
  });
  const setting = parsePlaylistsSetting(playlistsRaw.raw);
  const extras: StatsExtras = {
    weak: weakStarts(stats.videos, now),
    ideas: titleIdeaViews(parseTitleIdeas(ideasRaw.json), stats.videos, now, state.timezone),
    ideasError: ideasRaw.error,
    titlesRunning: [...new Set(state.runs.filter((r) => r.active && /^titles\b/.test(r.title)).flatMap((r) => r.codes))],
    timing: releaseTiming(stats.videos, state.slotTimes, state.timezone, now),
    slotTimes: state.slotTimes,
    playlists: { auto: setting.auto, count: Object.keys(setting.byPillar).length, error: playlistsRaw.error, channelName: state.channelName },
  };
  return { state, stats, extras };
}
