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

// Файл ветки с его sha (нужен для записи: GitHub примет новую версию, только если файл с тех
// пор не менялся). null — файла нет. Через contents API — файлы до 1 МБ (план, сценарии).
export async function readFileWithSha(path: string): Promise<{ text: string; sha: string } | null> {
  const res = await gh(`/repos/${repoName()}/contents/${encPath(path)}?ref=${encodeURIComponent(branchName())}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, `файл ${path}`);
  const j = (await res.json()) as { type?: string; sha?: string; content?: string; encoding?: string };
  if (j.type !== "file" || !j.sha || j.encoding !== "base64" || typeof j.content !== "string") {
    throw new GithubError(`GitHub, файл ${path}: не удалось прочитать (слишком большой или не файл).`, 0);
  }
  return { text: Buffer.from(j.content, "base64").toString("utf8"), sha: j.sha };
}

// Новая версия файла коммитом в ветку. sha — версия, которую правили: если файл успели
// поменять (запуск записал сценарий, правка на GitHub), GitHub ответит 409 — ничего не затрём.
export async function writeFile(path: string, text: string, sha: string, message: string): Promise<void> {
  const res = await gh(`/repos/${repoName()}/contents/${encPath(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: Buffer.from(text, "utf8").toString("base64"), sha, branch: branchName() }),
  });
  if (res.status === 409) {
    throw new GithubError(`Файл ${path} успели изменить в ветке ${branchName()} — обновите страницу и повторите.`, res.status);
  }
  if (!res.ok) throw await failure(res, `запись ${path}`);
}

export interface GhEntry {
  name: string;
  path: string; // от корня репозитория
  type: string; // file | dir | symlink | submodule
  size: number;
  sha: string;
}

// Содержимое папки ветки: файлы и подпапки с размером и sha ([] — папки нет).
export async function listDirEntries(path: string): Promise<GhEntry[]> {
  const res = await gh(`/repos/${repoName()}/contents/${encPath(path)}?ref=${encodeURIComponent(branchName())}`);
  if (res.status === 404) return [];
  if (!res.ok) throw await failure(res, `папка ${path}`);
  const list = (await res.json()) as GhEntry[];
  return Array.isArray(list) ? list.map((e) => ({ name: e.name, path: e.path, type: e.type, size: Number(e.size) || 0, sha: e.sha ?? "" })) : [];
}

// Имена файлов папки ветки ([] — папки нет).
export async function listDir(path: string): Promise<string[]> {
  return (await listDirEntries(path)).filter((f) => f.type === "file").map((f) => f.name);
}

// Двоичный файл ветки целиком (картинки бренд-кита), не больше maxBytes; null — файла нет.
// Raw-ответ отдаёт и файлы больше 1 МБ, в отличие от JSON с base64 (readFileWithSha).
export async function readFileBytes(path: string, maxBytes: number): Promise<ArrayBuffer | null> {
  const res = await gh(`/repos/${repoName()}/contents/${encPath(path)}?ref=${encodeURIComponent(branchName())}`, { accept: "application/vnd.github.raw+json" });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, `файл ${path}`);
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new GithubError(`файл ${path} больше ${Math.round(maxBytes / 1_048_576)} МБ`, 413);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new GithubError(`файл ${path} больше ${Math.round(maxBytes / 1_048_576)} МБ`, 413);
  return buf;
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
  created_at: string; // у релиза это дата коммита, а не публикации
  published_at?: string | null;
  draft: boolean;
  assets: GhAsset[];
  body?: string | null; // текст релиза — workflow кладёт туда description.txt
}

// Ссылка на следующую страницу из заголовка Link: <…?page=2>; rel="next" — путь без адреса API.
export function nextPage(link: string | null): string | null {
  const m = /<([^>]+)>;\s*rel="next"/.exec(link ?? "");
  if (!m) return null;
  const url = new URL(m[1]!);
  return url.origin === API ? url.pathname + url.search : null;
}

// Релизы — до 5 страниц по 100: иначе уборка и превью автопилота не видят релизы старше
// ≈ 50 дней (два ролика в день). Пока релизов меньше сотни — один запрос, как раньше.
const RELEASE_PAGES = 5;
export async function listReleases(): Promise<GhRelease[]> {
  const out: GhRelease[] = [];
  let path: string | null = `/repos/${repoName()}/releases?per_page=100`;
  for (let i = 0; path && i < RELEASE_PAGES; i++) {
    const res = await gh(path);
    if (!res.ok) throw await failure(res, "релизы");
    out.push(...((await res.json()) as GhRelease[]));
    path = nextPage(res.headers.get("link"));
  }
  return out;
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
  run_attempt?: number; // 1 — первая попытка; после «Re-run» GitHub отдаёт последнюю
  run_started_at?: string | null; // начало последней попытки
}

export interface GhStep {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | skipped | …
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

// Шаги идущего запуска — для полоски «сколько осталось». У workflow канала одно задание.
export async function runSteps(runId: number): Promise<GhStep[]> {
  const res = await gh(`/repos/${repoName()}/actions/runs/${runId}/jobs?per_page=5`);
  if (!res.ok) throw await failure(res, `шаги запуска ${runId}`);
  const jobs = ((await res.json()) as { jobs?: { steps?: GhStep[] }[] }).jobs ?? [];
  return jobs.flatMap((j) => j.steps ?? []);
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

// Повтор упавших заданий запуска (та же ветка и входные данные; номер попытки станет 2).
export async function rerunFailedJobs(runId: number): Promise<void> {
  const res = await gh(`/repos/${repoName()}/actions/runs/${runId}/rerun-failed-jobs`, { method: "POST" });
  if (!res.ok) throw await failure(res, `повтор запуска ${runId}`);
}

// Удалить один файл релиза (сам релиз и остальные файлы остаются). 404 — уже удалён.
export async function deleteReleaseAsset(assetId: number): Promise<void> {
  const res = await gh(`/repos/${repoName()}/releases/assets/${assetId}`, { method: "DELETE" });
  if (res.ok || res.status === 404) return;
  throw await failure(res, `удаление файла релиза ${assetId}`);
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

// Удалить переменную (404 — её и так нет).
export async function deleteVariable(name: string): Promise<void> {
  const res = await gh(`/repos/${repoName()}/actions/variables/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw await failure(res, `переменная ${name}`);
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

// Имя, размер и тип файла релиза — для заголовков ответа панели (Content-Length, Range).
export async function assetInfo(assetId: number): Promise<{ name: string; size: number; contentType: string | null }> {
  const res = await gh(`/repos/${repoName()}/releases/assets/${assetId}`);
  if (!res.ok) throw await failure(res, "файл релиза");
  const j = (await res.json()) as { name?: string; size?: number; content_type?: string };
  return { name: j.name || `file-${assetId}`, size: Number(j.size) || 0, contentType: j.content_type || null };
}

// Небольшой двоичный файл релиза целиком (обложка «Разбора» для thumbnails.set, до maxBytes).
export async function assetBytes(assetId: number, maxBytes: number): Promise<Uint8Array> {
  const res = await gh(`/repos/${repoName()}/releases/assets/${assetId}`, { accept: "application/octet-stream" });
  if (!res.ok) throw await failure(res, "файл релиза");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new GithubError(`файл релиза больше ${Math.round(maxBytes / 1024)} КБ`, 413);
  return buf;
}

// Небольшой текстовый файл релиза (подпись Reels).
export async function assetText(assetId: number): Promise<string> {
  const res = await gh(`/repos/${repoName()}/releases/assets/${assetId}`, { accept: "application/octet-stream" });
  if (!res.ok) throw await failure(res, "файл релиза");
  return (await res.text()).slice(0, 20_000);
}
