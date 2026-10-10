// Ролики, собранные на этом компьютере (неделя 1: 01a–07b), — в релизы GitHub. Тогда панель
// отдаёт их на телефон («⬇ Видео», «📱 Сохранить в Фото») в исходном качестве, без пережатия:
// в релиз уходит тот же файл, что грузили в Studio. Ищет «01a-….mp4» и папки out/<ролик>/
// (video.mp4 + обложки и подписи); коды, у которых релиз уже есть, пропускает.
//   npx tsx src/cli/release-upload.ts --dry-run                что найдено, ничего не заливает
//   npx tsx src/cli/release-upload.ts                          залить найденное
//   npx tsx src/cli/release-upload.ts --dir "D:\Ролики" --only 01a,01b
// Токен — GITHUB_TOKEN в .env (fine-grained на этот репозиторий, Contents: Read and write) или
// вход в GitHub CLI (gh auth login).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { normCode } from "../pipeline/codes";
import { MP4_WITH_CODE, codesWithRelease, matchLocal, releaseTag, type LocalVideo, type UploadPlan } from "../pipeline/release-files";
import { fillItemsOf, type FillItem } from "../pipeline/youtube-fill";
import { ROOT, UserError, argsError, fail, loadEnv, rel } from "./common";

const HELP = `Залить ролики с этого компьютера в релизы GitHub (для скачивания из панели).

  npx tsx src/cli/release-upload.ts [параметры]

  --dry-run          только показать, что найдено и что будет залито
  --dir <папки>      где искать файлы «01a-….mp4», через запятую (тогда только там и в out/;
                     по умолчанию: out/, папка video-studio и «Загрузки»)
  --only 01a,01b     только эти ролики

Нужен GITHUB_TOKEN в .env (Contents: Read and write) или вход в gh (gh auth login).
`;

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".srt": "application/x-subrip",
};

function scan(dirs: string[]): LocalVideo[] {
  const found: LocalVideo[] = [];
  const seen = new Set<string>();
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // папки нет или нет доступа — просто не ищем там
    }
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.includes("video.mp4") && !seen.has(dir)) {
      seen.add(dir);
      let title: string | null = null;
      try {
        title = (JSON.parse(fs.readFileSync(path.join(dir, "youtube.json"), "utf8")) as { title?: string }).title ?? null;
      } catch {
        // youtube.json нет — узнаем по имени папки
      }
      found.push({ kind: "outdir", dir, name: path.basename(dir), title, files });
    }
    for (const f of files) if (MP4_WITH_CODE.test(f)) found.push({ kind: "named", path: path.join(dir, f), name: f });
    if (depth > 0) for (const e of entries) if (e.isDirectory() && !["node_modules", ".git", "public", ".next"].includes(e.name)) walk(path.join(dir, e.name), depth - 1);
  };
  for (const d of dirs) walk(d, 3);
  return found;
}

function readItems(): FillItem[] {
  const items: FillItem[] = [];
  for (const f of ["content/week1-videos.json", "content/videos.json"]) {
    const file = path.join(ROOT, f);
    if (!fs.existsSync(file)) continue;
    for (const it of fillItemsOf(JSON.parse(fs.readFileSync(file, "utf8")))) if (!items.some((x) => x.id === it.id)) items.push(it);
  }
  return items;
}

function github(): { token: string; repo: string } {
  let token = process.env.GITHUB_TOKEN?.trim() || "";
  if (!token) {
    const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
    token = gh.status === 0 ? gh.stdout.trim() : "";
  }
  if (!token) throw new UserError("Нет доступа к GitHub: добавьте GITHUB_TOKEN в video-studio/.env (тот же fine-grained токен, что у панели) или войдите: gh auth login.");
  let repo = process.env.GITHUB_REPO?.trim() || "";
  if (!repo) {
    const url = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? "";
    repo = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? "";
  }
  if (!repo) throw new UserError("Не понял, какой репозиторий: задайте GITHUB_REPO=владелец/репозиторий в .env.");
  return { token, repo };
}

async function gh<T>(token: string, url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `https://api.github.com${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string; errors?: { code?: string }[] };
      message = [j.message, ...(j.errors ?? []).map((x) => x.code)].filter(Boolean).join(": ") || message;
    } catch {
      // не JSON
    }
    const hint = res.status === 401 ? " — токен недействителен" : res.status === 403 || res.status === 404 ? " — у токена нет прав Contents: Read and write на этот репозиторий" : "";
    throw new UserError(`GitHub: HTTP ${res.status} ${message}${hint}.`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} МБ`;

async function createRelease(token: string, repo: string, p: UploadPlan): Promise<{ id: number; html_url: string }> {
  const body = (tag: string) =>
    JSON.stringify({
      tag_name: tag,
      name: `${p.item.id}: ${p.item.title}`,
      body: "Ролик собран на компьютере и залит командой release-upload — чтобы скачивать его из панели в исходном качестве.",
      prerelease: true,
    });
  const post = (tag: string) => gh<{ id: number; html_url: string }>(token, `/repos/${repo}/releases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body(tag) });
  try {
    return await post(releaseTag(p.item));
  } catch (e) {
    // Тег уже есть (например, от прошлой попытки) — новый тег с меткой времени.
    if (!(e instanceof UserError) || !/already_exists/i.test(e.message)) throw e;
    return post(`${releaseTag(p.item)}-${Date.now()}`);
  }
}

async function main(): Promise<void> {
  let values: { "dry-run"?: boolean; dir?: string; only?: string; help?: boolean };
  try {
    ({ values } = parseArgs({ options: { "dry-run": { type: "boolean" }, dir: { type: "string" }, only: { type: "string" }, help: { type: "boolean" } } }));
  } catch (e) {
    throw new UserError(argsError(e));
  }
  if (values.help) {
    console.log(HELP);
    return;
  }
  loadEnv();
  const only = new Set((values.only ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const items = readItems().filter((it) => !only.size || only.has(it.id.toLowerCase()));
  if (!items.length) throw new UserError("Нет роликов: content/week1-videos.json и content/videos.json пусты (или --only не совпал).");

  const given = (values.dir ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((d) => path.resolve(d));
  // Свои папки — только они: в «Загрузках» бывают другие версии того же ролика.
  const dirs = [path.join(ROOT, "out"), ...(given.length ? given : [ROOT, path.join(os.homedir(), "Downloads")])];
  const plans = matchLocal(items, scan(dirs));
  const { token, repo } = github();
  const releases: { draft?: boolean; assets?: { name: string }[] }[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh<typeof releases>(token, `/repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const done = codesWithRelease(releases);

  console.log(`Репозиторий ${repo}. Искал в: ${dirs.map(rel).join(", ")}\n`);
  const todo: UploadPlan[] = [];
  for (const item of items) {
    const p = plans.get(item.id);
    const label = `${item.id}  ${item.title.slice(0, 50)}`;
    if (done.has(normCode(item.id) ?? item.id.toLowerCase())) console.log(`  ✓ ${label} — уже в релизе`);
    else if (!p) console.log(`  · ${label} — файла на этом компьютере нет`);
    else {
      todo.push(p);
      console.log(`  ↑ ${label} — ${rel(p.video)} (${mb(fs.statSync(p.video).size)})${p.extras.length ? ` + ${p.extras.map((e) => path.basename(e)).join(", ")}` : ""}`);
      for (const o of p.others) console.log(`      ⚠ есть и другой файл: ${rel(o)} (${mb(fs.statSync(o).size)})`);
    }
  }
  if (!todo.length) {
    console.log("\nЗаливать нечего.");
    return;
  }
  // Две разные версии ролика — не угадываем, какая ушла на YouTube: пусть скажут папку.
  const unsure = todo.filter((p) => p.others.length);
  if (unsure.length && !values["dry-run"]) {
    throw new UserError(`У ${unsure.map((p) => p.item.id).join(", ")} нашлось несколько разных файлов. Укажите папку с теми, что грузили на YouTube: --dir "<папка>".`);
  }
  if (values["dry-run"]) {
    console.log(`\n--dry-run: будет залито ${todo.length}.${unsure.length ? " Сначала выберите папку (--dir) — см. ⚠." : " Запустите без --dry-run."}`);
    return;
  }

  for (const p of todo) {
    const release = await createRelease(token, repo, p);
    // Имя mp4 — с кодом («01a-….mp4»): по нему панель находит ролик.
    const files: [string, string][] = [[p.video, `${p.item.file}.mp4`], ...p.extras.map((e): [string, string] => [e, path.basename(e)])];
    for (const [file, asset] of files) {
      await gh(
        token,
        `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset)}`,
        { method: "POST", headers: { "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" }, body: fs.readFileSync(file) },
        15 * 60_000, // большой файл по медленной сети
      );
    }
    console.log(`  ✔ ${p.item.id} — ${release.html_url}`);
  }
  console.log(`\nГотово: ${todo.length}. Обновите панель — у этих роликов появятся «⬇ Видео» и «📱 Сохранить в Фото».`);
}

main().catch(fail);
