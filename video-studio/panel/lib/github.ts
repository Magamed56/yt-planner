// GitHub REST для панели: файлы ветки (план, сценарии, списки текстов), релизы с роликами,
// запуски workflow и переменные автопилота. Токен — fine-grained, только на этот репозиторий.
const API = "https://api.github.com";

export const repoName = () => process.env.GITHUB_REPO?.trim() || "Magamed56/yt-planner";
export const branchName = () => process.env.GITHUB_BRANCH?.trim() || "master";

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function gh(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new GithubError("Не задан GITHUB_TOKEN (Vercel → Settings → Environment Variables).", 0);
  const { accept, ...rest } = init;
  try {
    return await fetch(`${API}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GithubError(`GitHub не отвечает (${e instanceof Error ? e.message : String(e)}). Обновите страницу через минуту.`, 0);
  }
}

// Понятная причина отказа: чаще всего — права токена или ещё не слитый в master PR.
async function failure(res: Response, what: string): Promise<GithubError> {
  let message = "";
  try {
    message = ((await res.json()) as { message?: string }).message ?? "";
  } catch {
    // тело не JSON
  }
  const hint =
    res.status === 401
      ? "токен GitHub недействителен или истёк — выпустите новый и обновите GITHUB_TOKEN"
      : res.status === 403
        ? `у токена GitHub не хватает прав (${message}) — нужны Actions, Contents, Variables: Read and write; Secrets: Read`
        : res.status === 404
          ? `не найдено (${message || "404"}) — проверьте GITHUB_REPO, GITHUB_BRANCH и что video-studio слит в эту ветку`
          : `HTTP ${res.status}: ${message}`;
  return new GithubError(`GitHub, ${what}: ${hint}.`, res.status);
}

// Текст файла ветки или null, если файла нет.
export async function readFile(path: string): Promise<string | null> {
  const res = await gh(`/repos/${repoName()}/contents/${encPath(path)}?ref=${encodeURIComponent(branchName())}`, { accept: "application/vnd.github.raw+json" });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, `файл ${path}`);
  return res.text();
}

export async function readJson(path: string): Promise<unknown | null> {
  const text = await readFile(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new GithubError(`${path}: битый JSON (${e instanceof Error ? e.message : String(e)}).`, 0);
  }
}

// Имена файлов папки ветки ([] — папки нет).
export async function listDir(path: string): Promise<string[]> {
  const res = await gh(`/repos/${repoName()}/contents/${encPath(path)}?ref=${encodeURIComponent(branchName())}`);
  if (res.status === 404) return [];
  if (!res.ok) throw await failure(res, `папка ${path}`);
  const list = (await res.json()) as { name: string; type: string }[];
  return Array.isArray(list) ? list.filter((f) => f.type === "file").map((f) => f.name) : [];
}

export interface GhAsset {
  id: number;
  name: string;
  size: number;
}

export interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  created_at: string;
  draft: boolean;
  assets: GhAsset[];
}

export async function listReleases(): Promise<GhRelease[]> {
  const res = await gh(`/repos/${repoName()}/releases?per_page=100`);
  if (!res.ok) throw await failure(res, "релизы");
  return (await res.json()) as GhRelease[];
}

export interface GhRun {
  id: number;
  name: string;
  display_title: string;
  path: string;
  event: string;
  status: string; // queued | in_progress | completed | waiting | requested | pending
  conclusion: string | null; // success | failure | cancelled | …
  created_at: string;
  updated_at: string;
  html_url: string;
}

export async function listRuns(): Promise<GhRun[]> {
  const res = await gh(`/repos/${repoName()}/actions/runs?per_page=40`);
  if (!res.ok) throw await failure(res, "запуски Actions");
  const runs = ((await res.json()) as { workflow_runs?: GhRun[] }).workflow_runs ?? [];
  return runs.filter((r) => r.path?.startsWith(".github/workflows/video-studio"));
}

// Запуск workflow кнопкой: файл из .github/workflows, ветка — GITHUB_BRANCH.
export async function dispatchWorkflow(file: string, inputs: Record<string, string>): Promise<void> {
  const res = await gh(`/repos/${repoName()}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: branchName(), inputs }),
  });
  if (!res.ok) throw await failure(res, `запуск ${file}`);
}

export async function getVariable(name: string): Promise<string | null> {
  const res = await gh(`/repos/${repoName()}/actions/variables/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, `переменная ${name}`);
  return ((await res.json()) as { value?: string }).value ?? null;
}

export async function setVariable(name: string, value: string): Promise<void> {
  const res = await gh(`/repos/${repoName()}/actions/variables/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ name, value }) });
  if (res.ok) return;
  if (res.status !== 404) throw await failure(res, `переменная ${name}`);
  const created = await gh(`/repos/${repoName()}/actions/variables`, { method: "POST", body: JSON.stringify({ name, value }) });
  if (!created.ok) throw await failure(created, `переменная ${name}`);
}

// Имена секретов Actions (значения GitHub не отдаёт). null — токену не дали права Secrets: Read.
export async function listSecretNames(): Promise<string[] | null> {
  const res = await gh(`/repos/${repoName()}/actions/secrets?per_page=100`);
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw await failure(res, "секреты");
  return (((await res.json()) as { secrets?: { name: string }[] }).secrets ?? []).map((s) => s.name);
}

// Файл релиза приватного репозитория: GitHub отвечает редиректом на временную ссылку
// хранилища (несколько минут) — по ней браузер и скачивает видео, мимо панели.
export async function assetDownloadUrl(assetId: number): Promise<string> {
  const res = await gh(`/repos/${repoName()}/releases/assets/${assetId}`, { accept: "application/octet-stream", redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) return location;
  if (!res.ok) throw await failure(res, "файл релиза");
  throw new GithubError("GitHub не дал ссылку на файл релиза — попробуйте ещё раз.", res.status);
}

// Небольшой текстовый файл релиза (подпись Reels).
export async function assetText(assetId: number): Promise<string> {
  const res = await gh(`/repos/${repoName()}/releases/assets/${assetId}`, { accept: "application/octet-stream" });
  if (!res.ok) throw await failure(res, "файл релиза");
  return (await res.text()).slice(0, 20_000);
}
