// Данные для очереди — всё параллельно: GitHub (план, канал, сценарии, тексты, релизы, запуски,
// секреты, настройки автопилота) и YouTube. YouTube недоступен — очередь всё равно видна.
import { branchName, getVariable, GithubError, listDir, listReleases, listRuns, listSecretNames, readJson, repoName } from "./github";
import { AUTOPILOT_LAST_VAR, AUTOPILOT_VAR, buildState, parseAutopilot, parseAutopilotLast, type PanelState } from "./state";
import { channelVideos } from "./youtube";

export const STUDIO_DIR = "video-studio";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^YouTube:\s*/, "");

export async function loadState(now = new Date()): Promise<PanelState> {
  const youtube = channelVideos().then(
    (videos) => ({ videos, error: null as string | null }),
    (e: unknown) => ({ videos: null, error: errorText(e) }),
  );
  const [planJson, channelJson, scriptFiles, week1, later, releases, runs, secretNames, autopilotRaw, lastRaw, yt] = await Promise.all([
    readJson(`${STUDIO_DIR}/content/plan.json`),
    readJson(`${STUDIO_DIR}/channel.json`),
    listDir(`${STUDIO_DIR}/scripts`),
    readJson(`${STUDIO_DIR}/content/week1-videos.json`),
    readJson(`${STUDIO_DIR}/content/videos.json`),
    listReleases(),
    listRuns(),
    listSecretNames().catch(() => null),
    getVariable(AUTOPILOT_VAR).catch(() => null),
    getVariable(AUTOPILOT_LAST_VAR).catch(() => null),
    youtube,
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
    runs,
    videos: yt.videos,
    youtubeError: yt.error,
    secretNames,
    autopilot: parseAutopilot(autopilotRaw),
    autopilotLast: parseAutopilotLast(lastRaw),
    repo: repoName(),
    branch: branchName(),
  });
}
