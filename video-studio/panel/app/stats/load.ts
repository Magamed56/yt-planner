// Данные экрана «Статистика»: очередь (тот же loadState — для меню и сопоставления роликов с
// темами плана) + цифры канала из того же прохода по YouTube + удержание из YouTube Analytics
// (один запрос) + запуски Actions с начала месяца + content/usage.jsonl. Считает всё lib/stats.ts;
// здесь — только запросы.
import { parsePlan } from "../../../src/pipeline/plan";
import { parseTitleIdeas, TITLE_IDEAS_FILE } from "../../../src/pipeline/title-ideas";
import type { ChannelListing } from "../../../src/pipeline/youtube-fill";
import { analyticsRange } from "@/lib/analytics";
import { getVariable, GithubError, readFile, readJson, repoName } from "@/lib/github";
import { releaseTiming, typicalRatio, weakStarts, type ReleaseTiming, type WeakStartReport } from "@/lib/insights";
import { readHistory } from "@/lib/history-store";
import { loadState, STUDIO_DIR } from "@/lib/load";
import { PLAYLISTS_VAR, parsePlaylistsSetting } from "@/lib/playlists";
import type { PanelState } from "@/lib/state";
import { buildStats, formatCount, type RunTiming, type StatsData } from "@/lib/stats";
import { titleIdeaViews, type TitleIdeaView } from "@/lib/titles";
import { dropTomorrow, etaLabel, kpiTrends, type Trends } from "@/lib/trends";
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
  trends: Trends; // подписчики и просмотры за 7 дней, «вчера», темп — по истории цифр
  drop: number; // просмотры Shorts, которые завтра выпадут из окна 90 дней
  pace: Record<string, string>; // «tier:цель» → «≈ +9 в день → 500 к 12.11 (34 дня)»
}

// Темп к порогам монетизации по 7 дням истории: подписчики — когда дойдём; просмотры за 90
// дней — окно скользящее, поэтому «при нынешнем темпе за 90 дней будет ≈ …».
function paceLabels(money: StatsData["monetization"], trends: Trends, now: Date, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of money.tiers) {
    for (const g of t.goals) {
      const key = `${t.id}:${g.label}`;
      if (/подписчик/i.test(g.label) && g.have !== null) {
        const eta = etaLabel(g.have, g.need, trends.subsPerDay, now, tz);
        if (eta) out[key] = eta;
      } else if (/просмотр/i.test(g.label) && trends.viewsPerDay !== null && !g.done) {
        out[key] = `сейчас ≈ ${formatCount(Math.round(trends.viewsPerDay))} в день → за 90 дней при таком темпе ≈ ${formatCount(Math.round(trends.viewsPerDay * 90))}`;
      }
    }
  }
  return out;
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

export async function loadStats(now = new Date()): Promise<{ state: PanelState; stats: StatsData; extras: StatsExtras; listing: Promise<ChannelListing>; now: Date }> {
  // Один проход по каналу (≈ 3–5 единиц квоты, без поиска): ролики уходят и в очередь.
  const overview = channelOverview();
  overview.catch(() => {}); // ошибку покажет страница; снимку истории она не нужна
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
  const [state, planJson, runs, usage, yt, ideasRaw, playlistsRaw, analytics, history] = await Promise.all([
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
    readHistory(),
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
  // «▲ ×2,3 / ≈ обычно / ▼ ×0,4» — то же правило и те же просмотры в сутки, что в ленте.
  const typical = typicalRatio(stats.videos, now);
  for (const v of stats.videos) {
    const x = typical.get(v.videoId);
    if (x) Object.assign(v, { ratio: x.ratio, ratioLabel: x.label, verdict: x.verdict, basis: x.basis });
  }
  const published = state.rows.filter((r) => r.stage === "published" && r.when).map((r) => r.when!);
  const trends = kpiTrends(history, published, state.slotTimes.length, yt.channel?.subscriberCount ?? null, now, state.timezone);
  const setting = parsePlaylistsSetting(playlistsRaw.raw);
  const extras: StatsExtras = {
    weak: weakStarts(stats.videos, now),
    ideas: titleIdeaViews(parseTitleIdeas(ideasRaw.json), stats.videos, now, state.timezone),
    ideasError: ideasRaw.error,
    titlesRunning: [...new Set(state.runs.filter((r) => r.active && r.kind === "titles").flatMap((r) => r.codes))],
    timing: releaseTiming(stats.videos, state.slotTimes, state.timezone, now),
    slotTimes: state.slotTimes,
    playlists: { auto: setting.auto, count: Object.keys(setting.byPillar).length, error: playlistsRaw.error, channelName: state.channelName },
    trends,
    drop: dropTomorrow(stats.videos, now),
    pace: paceLabels(stats.monetization, trends, now, state.timezone),
  };
  return { state, stats, extras, listing: overview, now };
}
