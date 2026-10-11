// Данные для очереди — всё параллельно: GitHub (план, канал, сценарии, тексты, релизы, запуски,
// секреты, настройки автопилота) и YouTube. YouTube недоступен — очередь всё равно видна.
import { branchName, getVariable, GithubError, listDir, listReleases, listRuns, listSecretNames, readJson, repoName, runSteps, type GhRun, type GhStep } from "./github";
import { LONG_PLAN_FILE } from "../../src/pipeline/long-plan";
import type { ChannelVideo } from "../../src/pipeline/youtube-fill";
import { AUTOPILOT_LAST_VAR, AUTOPILOT_VAR, buildState, parseAutopilot, parseAutopilotLast, parseQueueOrder, QUEUE_ORDER_VAR, type PanelState } from "./state";
import { readHistory } from "./history-store";
import { REBUILD_FILE } from "./rebuild-hold";
import { channelVideos } from "./youtube";

export const STUDIO_DIR = "video-studio";

// Запуски и шаги идущих (их обычно 0–2) — для полоски прогресса; и шаги последнего упавшего
// за двое суток запуска ролика — на каком этапе он сломался. Шаги не пришли — без этапов.
export async function runsWithSteps(): Promise<{ runs: GhRun[]; steps: Record<number, GhStep[]> }> {
  const runs = await listRuns();
  const active = runs.filter((r) => r.status !== "completed").slice(0, 3);
  const failed = runs.find((r) => r.status === "completed" && (r.conclusion === "failure" || r.conclusion === "timed_out") && r.path.endsWith("/video-studio.yml") && Date.now() - Date.parse(r.created_at) < 2 * 86_400_000);
  const pairs = await Promise.all([...active, ...(failed ? [failed] : [])].map(async (r) => [r.id, await runSteps(r.id).catch(() => [])] as const));
  return { runs, steps: Object.fromEntries(pairs) };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^YouTube:\s*/, "");

// videos — уже начатый запрос к YouTube: «Статистика» берёт ролики вместе с цифрами канала
// и отдаёт их сюда, чтобы не проходить по каналу второй раз (квота).
export async function loadState(now = new Date(), videos: Promise<ChannelVideo[]> = channelVideos()): Promise<PanelState> {
  const youtube = videos.then(
    (videos) => ({ videos, error: null as string | null }),
    (e: unknown) => ({ videos: null, error: errorText(e) }),
  );
  const [planJson, channelJson, scriptFiles, week1, later, releases, runInfo, secretNames, autopilotRaw, lastRaw, orderRaw, history, yt, longPlanJson, rebuildJson] = await Promise.all([
    readJson(`${STUDIO_DIR}/content/plan.json`),
    readJson(`${STUDIO_DIR}/channel.json`),
    listDir(`${STUDIO_DIR}/scripts`),
    readJson(`${STUDIO_DIR}/content/week1-videos.json`),
    readJson(`${STUDIO_DIR}/content/videos.json`),
    listReleases(),
    runsWithSteps(),
    listSecretNames().catch(() => null),
    getVariable(AUTOPILOT_VAR).catch(() => null),
    getVariable(AUTOPILOT_LAST_VAR).catch(() => null),
    getVariable(QUEUE_ORDER_VAR).catch(() => null),
    readHistory(),
    youtube,
    // «Разборы» (L01…): нет файла или GitHub не отдал — очередь Shorts всё равно видна.
    readJson(`${STUDIO_DIR}/${LONG_PLAN_FILE}`).catch(() => null),
    // «Ждёт пересборки» — один файл на всю очередь, параллельно с остальным; нет или битый — как раньше.
    readJson(`${STUDIO_DIR}/${REBUILD_FILE}`).catch(() => null),
  ]);
  if (planJson === null) {
    throw new GithubError(`В ветке ${branchName()} нет video-studio/content/plan.json — слейте PR с video-studio в эту ветку или поменяйте GITHUB_BRANCH.`, 404);
  }
  return buildState({
    now,
    planJson,
    channelJson,
    scriptFiles,
    fillLists: [week1, later],
    releases,
    runs: runInfo.runs,
    runSteps: runInfo.steps,
    videos: yt.videos,
    youtubeError: yt.error,
    secretNames,
    autopilot: parseAutopilot(autopilotRaw),
    autopilotLast: parseAutopilotLast(lastRaw),
    repo: repoName(),
    branch: branchName(),
    queueOrder: parseQueueOrder(orderRaw),
    history,
    longPlanJson,
    rebuildJson,
  });
}
