// Субтитры роликов на других языках: русский captions.srt → перевод LLM (те же реплики и
// тайминги) → captions.<язык>.srt → дорожки «English (AI)» у ролика на YouTube.
//   npm run captions-translate -- 08a,08b --langs en,kk,uz [--dry-run] [--no-upload]
// Ролик на канале ищем по коду «08a», как youtube-fill. Повторный запуск безопасен: готовые
// переводы берутся с диска, уже загруженные дорожки пропускаются.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CAPTION_INSERT_UNITS,
  CAPTION_LIST_UNITS,
  CaptionsScopeError,
  captionsScopeHelp,
  existingTrack,
  hasCaptionsScope,
  insertCaption,
  listCaptions,
  pickCaptionRelease,
  tokenScopes,
  type CaptionDeps,
  type ReleaseLike,
} from "../pipeline/captions";
import { captionFileName, captionTrackName, knownLangs, parseLangs } from "../pipeline/lang";
import { PLAN_CODE, scriptCode } from "../pipeline/plan";
import { ScriptGenerationError } from "../pipeline/script/generate";
import { translateCues } from "../pipeline/script/translate";
import { collectLlmUsage } from "../pipeline/script/usage-log";
import { parseSrt, sameTimings, serializeSrt, srtLineWidth, withCueTexts, type SrtCue } from "../pipeline/srt";
import { missingYoutubeEnv, youtubeAuth, youtubeEnvHelp } from "../pipeline/youtube";
import { fillItemsOf, listChannelVideos, matchVideos, type FillItem } from "../pipeline/youtube-fill";
import { ROOT, UserError, argsError, escapeMd, fail, ghSummary, loadEnv, rel, reportFailedLlmUsage } from "./common";

const HELP = `Субтитры роликов на других языках: перевод русских captions.srt и загрузка на YouTube.

  npm run captions-translate -- 08a[,08b …] --langs en,kk,uz [параметры]

  --langs en,kk,uz   языки перевода (знаю: ${knownLangs()})
  --dry-run          перевести и записать файлы, но на YouTube ничего не загружать
  --no-upload        только файлы, без YouTube (ключи YT_* не нужны)
  --retranslate      перевести заново, даже если captions.<язык>.srt уже есть
  --srt <файл>       русские субтитры явно (только для одного ролика)
  --from <папка>     искать <папка>/<код>/captions.srt (так их кладёт workflow из релиза)

Откуда русские субтитры (по порядку): --srt, --from, папка рендера out/<ролик>/ с этим кодом,
релиз GitHub с файлом «<код>-….mp4» (нужен GITHUB_TOKEN в .env или вход в gh).
Переводы — captions.<язык>.srt рядом с исходником; число реплик и тайминги — как в оригинале.
На YouTube — дорожка «English (AI)» и т. п.; уже загруженная дорожка языка пропускается.
Нужно право youtube.force-ssl у YT_REFRESH_TOKEN (ключи до октября 2026 его не имеют —
выпустите заново: npm run youtube-auth -- --save). Квота: ~400 единиц за дорожку из 10 000 в сутки.
Расход LLM пишется в content/usage.jsonl.
`;

interface Source {
  code: string;
  file: string; // русский captions.srt
  dir: string; // сюда пишем переводы
  from: string; // для лога: «out/<ролик>», «релиз video-08a-…»
  videoId: string | null; // ролик уже загружали через API (youtube-result.json) — искать не нужно
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readVideoId(dir: string): string | null {
  try {
    const id = (JSON.parse(fs.readFileSync(path.join(dir, "youtube-result.json"), "utf8")) as { videoId?: unknown }).videoId;
    return typeof id === "string" && /^[\w-]{6,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// Папка рендера русского ролика с этим кодом: source.json → «script:scripts/sut-08a-….json».
// Переводы (scripts/en/…) не берём — их субтитры не русские. Несколько папок — самая свежая.
function findInOut(code: string): Source | null {
  const out = path.join(ROOT, "out");
  let best: { dir: string; mtime: number } | null = null;
  for (const name of fs.existsSync(out) ? fs.readdirSync(out) : []) {
    const dir = path.join(out, name);
    const srt = path.join(dir, "captions.srt");
    if (!fs.existsSync(srt)) continue;
    let source = "";
    try {
      source = String((JSON.parse(fs.readFileSync(path.join(dir, "source.json"), "utf8")) as { source?: unknown }).source ?? "");
    } catch {
      continue;
    }
    const file = source.replace(/^script:/, "");
    if (!/^scripts\/sut-[^/]+\.json$/.test(file) || scriptCode(file) !== code) continue;
    const mtime = fs.statSync(srt).mtimeMs;
    if (!best || mtime > best.mtime) best = { dir, mtime };
  }
  return best ? { code, file: path.join(best.dir, "captions.srt"), dir: best.dir, from: rel(best.dir), videoId: readVideoId(best.dir) } : null;
}

// ---- Релизы GitHub (на ПК; в Actions субтитры скачивает сам workflow) ----

function githubAccess(): { token: string; repo: string } | null {
  let token = process.env.GITHUB_TOKEN?.trim() || "";
  if (!token) {
    const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
    token = gh.status === 0 ? gh.stdout.trim() : "";
  }
  let repo = process.env.GITHUB_REPO?.trim() || process.env.GITHUB_REPOSITORY?.trim() || "";
  if (!repo) {
    const url = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? "";
    repo = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? "";
  }
  return token && repo ? { token, repo } : null;
}

async function fromRelease(code: string, gh: { token: string; repo: string }): Promise<Source | null> {
  const headers = { Authorization: `Bearer ${gh.token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const res = await fetch(`https://api.github.com/repos/${gh.repo}/releases?per_page=100`, { headers: { ...headers, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GitHub: список релизов — HTTP ${res.status}${res.status === 401 ? " (токен недействителен)" : ""}`);
  const pick = pickCaptionRelease((await res.json()) as ReleaseLike[], code);
  if (!pick) return null;
  const asset = await fetch(`https://api.github.com/repos/${gh.repo}/releases/assets/${pick.assetId}`, { headers: { ...headers, Accept: "application/octet-stream" }, signal: AbortSignal.timeout(60_000) });
  if (!asset.ok) throw new Error(`GitHub: captions.srt из релиза ${pick.tag} — HTTP ${asset.status}`);
  const dir = path.join(ROOT, "out", "captions", code);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "captions.srt");
  fs.writeFileSync(file, Buffer.from(await asset.arrayBuffer()));
  return { code, file, dir, from: `релиз ${pick.tag}`, videoId: null };
}

async function findSource(code: string, opts: { srt?: string; from?: string }, gh: () => { token: string; repo: string } | null): Promise<Source | null> {
  if (opts.srt) {
    const file = path.resolve(opts.srt);
    if (!fs.existsSync(file)) throw new UserError(`--srt: нет такого файла: ${opts.srt}`);
    return { code, file, dir: path.dirname(file), from: rel(file), videoId: readVideoId(path.dirname(file)) };
  }
  if (opts.from) {
    const file = path.join(path.resolve(opts.from), code, "captions.srt");
    if (fs.existsSync(file)) return { code, file, dir: path.dirname(file), from: rel(path.dirname(file)), videoId: null };
  }
  const local = findInOut(code);
  if (local) return local;
  const access = gh();
  return access ? fromRelease(code, access) : null;
}

// Списки роликов youtube-fill — по ним видео на канале узнаётся и по названию, а не только по коду.
function readFillItems(): FillItem[] {
  const items: FillItem[] = [];
  for (const f of ["content/week1-videos.json", "content/videos.json"]) {
    try {
      for (const it of fillItemsOf(JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")))) if (!items.some((x) => x.id === it.id)) items.push(it);
    } catch {
      // списка нет — ищем только по коду
    }
  }
  return items;
}

// Ролика нет в списках: ищем только по коду в имени файла/названии (заголовок-заглушка ни с чем не совпадёт).
const codeOnlyItem = (code: string): FillItem => ({
  id: code,
  file: code,
  durationSec: Number.NaN,
  title: `\u0000${code}`,
  description: "",
  tags: [],
  categoryId: "27",
  defaultLanguage: "ru",
  containsSyntheticMedia: true,
});

interface Row {
  code: string;
  lang: string;
  translation: string;
  youtube: string;
}

async function main() {
  loadEnv();
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        langs: { type: "string" },
        codes: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "no-upload": { type: "boolean", default: false },
        retranslate: { type: "boolean", default: false },
        srt: { type: "string" },
        from: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    });
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    return;
  }
  const codes = [...new Set([...positionals, String(values.codes ?? "")].join(",").split(/[\s,]+/).map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (!codes.length) throw new UserError(`Укажите коды роликов: npm run captions-translate -- 08a,08b --langs en\n\n${HELP}`);
  const bad = codes.filter((c) => !PLAN_CODE.test(c));
  if (bad.length) throw new UserError(`Коды роликов — вида «08a», а не: ${bad.join(", ")}`);
  const { langs, unknown } = parseLangs(String(values.langs ?? ""));
  if (unknown.length) throw new UserError(`--langs: не знаю ${unknown.join(", ")}. Доступны: ${knownLangs()}.`);
  const targets = langs.filter((l) => l !== "ru");
  if (!targets.length) throw new UserError(`--langs: укажите языки перевода, например --langs en,kk,uz (русский — это оригинал).`);
  if (values.srt && codes.length > 1) throw new UserError("--srt — для одного ролика; для нескольких используйте --from <папка> (<папка>/<код>/captions.srt).");
  const dry = values["dry-run"] === true;
  const upload = values["no-upload"] !== true;

  console.log(`video-studio · субтитры ${codes.join(", ")} → ${targets.join(", ")}${dry ? " (пробный запуск: на YouTube ничего не меняю)" : upload ? "" : " (только файлы)"}`);

  // До перевода — ключи и права: без них не стоит тратить квоту LLM.
  let deps: CaptionDeps | null = null;
  let ytNote: string | null = null;
  if (upload) {
    const missing = missingYoutubeEnv();
    if (missing.length) {
      if (!dry) throw new UserError(`Не заданы ${missing.join(", ")} — загрузить субтитры на YouTube нечем.\n${youtubeEnvHelp()}\nТолько файлы, без YouTube: добавьте --no-upload.`);
      ytNote = `YouTube не проверял: не заданы ${missing.join(", ")}`;
    } else {
      deps = { auth: youtubeAuth(), log: (m) => console.log(`  ${m}`) };
      const scopes = await tokenScopes(deps);
      if (scopes && !hasCaptionsScope(scopes)) {
        if (!dry) throw new UserError(captionsScopeHelp());
        console.log(`  ⚠ ${captionsScopeHelp().split("\n").join("\n  ")}`);
        ytNote = "у ключа нет права на субтитры (youtube.force-ssl)";
        deps = null;
      }
    }
  }

  // 1. Русские субтитры.
  let ghCache: { token: string; repo: string } | null | undefined;
  const gh = () => (ghCache === undefined ? (ghCache = githubAccess()) : ghCache);
  const sources: { src: Source; cues: SrtCue[] }[] = [];
  const rows: Row[] = [];
  const failures: string[] = [];
  for (const code of codes) {
    try {
      const src = await findSource(code, { srt: typeof values.srt === "string" ? values.srt : undefined, from: typeof values.from === "string" ? values.from : undefined }, gh);
      if (!src) {
        const why = gh() ? "ни в out/, ни в релизах GitHub" : "в out/ (а к релизам GitHub нет доступа: GITHUB_TOKEN в .env или gh auth login)";
        throw new Error(`не нашёл русские субтитры ${why} — соберите ролик или укажите --srt <файл>`);
      }
      const cues = parseSrt(fs.readFileSync(src.file, "utf8"), rel(src.file));
      console.log(`  ${code}: ${cues.length} реплик — ${src.from}`);
      sources.push({ src, cues });
    } catch (e) {
      console.log(`  ${code}: ✖ ${errText(e)}`);
      failures.push(`${code}: ${errText(e)}`);
      for (const lang of targets) rows.push({ code, lang, translation: "нет исходных субтитров", youtube: "—" });
    }
  }

  // 2. Перевод: готовый файл с теми же таймингами переиспользуем (квота LLM не тратится).
  const ready = new Map<string, string>(); // `${code}:${lang}` → путь к переводу
  for (const { src, cues } of sources) {
    const usage = collectLlmUsage(ROOT, src.code);
    try {
      for (const lang of targets) {
        const file = path.join(src.dir, captionFileName(lang));
        const key = `${src.code}:${lang}`;
        if (!values.retranslate && fs.existsSync(file)) {
          try {
            if (sameTimings(cues, parseSrt(fs.readFileSync(file, "utf8"), rel(file)))) {
              ready.set(key, file);
              console.log(`  ${src.code} → ${lang}: перевод уже есть — ${rel(file)}`);
              continue;
            }
          } catch {
            // битый или устаревший — переведём заново
          }
        }
        try {
          const t = await translateCues(
            cues.map((c) => c.text),
            lang,
            { onLlmCall: usage.onLlmCall },
          );
          const translated = withCueTexts(cues, t.texts, srtLineWidth(cues));
          if (!sameTimings(cues, translated)) throw new Error("тайминги перевода разошлись с оригиналом");
          fs.writeFileSync(file, serializeSrt(translated));
          ready.set(key, file);
          console.log(`  ${src.code} → ${lang}: ✔ ${rel(file)} (${t.servedBy ?? "LLM"})`);
        } catch (e) {
          if (e instanceof ScriptGenerationError) reportFailedLlmUsage(e.usage, null);
          console.log(`  ${src.code} → ${lang}: ✖ ${errText(e)}`);
          failures.push(`${src.code} → ${lang}: ${errText(e)}`);
          rows.push({ code: src.code, lang, translation: "❌ не переведено", youtube: "—" });
        }
      }
    } finally {
      usage.flush();
    }
  }

  // 3. YouTube: ролик по коду (как youtube-fill), затем дорожки, которых ещё нет.
  const todo = sources.filter(({ src }) => targets.some((l) => ready.has(`${src.code}:${l}`)));
  const videoOf = new Map<string, string>();
  if (deps && todo.length) {
    const needSearch = todo.filter(({ src }) => !src.videoId);
    for (const { src } of todo) if (src.videoId) videoOf.set(src.code, src.videoId);
    if (needSearch.length) {
      const videos = await listChannelVideos(deps);
      const lists = readFillItems();
      const items = [...lists, ...codes.filter((c) => !lists.some((i) => i.id.toLowerCase() === c)).map(codeOnlyItem)];
      const report = matchVideos(items, videos);
      for (const { src } of needSearch) {
        const m = report.matches.find((x) => x.item.id.toLowerCase() === src.code);
        if (m) videoOf.set(src.code, m.video.videoId);
        else {
          const dup = report.duplicates.find((d) => d.item.id.toLowerCase() === src.code);
          const pending = report.pending.find((d) => d.item.id.toLowerCase() === src.code);
          const why = dup ? `загружен ${dup.videos.length} раза — удалите лишний` : pending ? "ещё обрабатывается — запустите позже" : "не найден на канале (имя файла или название должно содержать код)";
          failures.push(`${src.code}: ${why}`);
          for (const lang of targets) if (ready.has(`${src.code}:${lang}`)) rows.push({ code: src.code, lang, translation: "✔", youtube: why });
        }
      }
    }
    const inserts = [...videoOf.keys()].reduce((a, code) => a + targets.filter((l) => ready.has(`${code}:${l}`)).length, 0);
    const units = inserts * CAPTION_INSERT_UNITS + videoOf.size * CAPTION_LIST_UNITS;
    if (!dry && units > 9000) console.log(`  ⚠ понадобится ~${units} единиц квоты YouTube из 10 000 в сутки — часть дорожек может не влезть (повторите завтра: готовые пропустятся).`);
  }
  for (const [code, videoId] of videoOf) {
    let tracks: Awaited<ReturnType<typeof listCaptions>> = [];
    try {
      tracks = await listCaptions(deps!, videoId);
    } catch (e) {
      if (e instanceof CaptionsScopeError) throw new UserError(e.message);
      failures.push(`${code}: ${errText(e)}`);
      for (const lang of targets) if (ready.has(`${code}:${lang}`)) rows.push({ code, lang, translation: "✔", youtube: `ошибка: ${errText(e)}` });
      continue;
    }
    for (const lang of targets) {
      const file = ready.get(`${code}:${lang}`);
      if (!file) continue;
      const name = captionTrackName(lang);
      const have = existingTrack(tracks, lang);
      let result: string;
      if (have) result = `уже есть («${have.name || have.language}»)`;
      else if (dry) result = `будет загружено как «${name}»`;
      else {
        try {
          await insertCaption(deps!, { videoId, language: lang, name, srt: fs.readFileSync(file, "utf8") });
          result = `✔ «${name}»`;
        } catch (e) {
          if (e instanceof CaptionsScopeError) throw new UserError(e.message);
          result = `ошибка: ${errText(e)}`;
          failures.push(`${code} → ${lang}: ${errText(e)}`);
          // Квота кончилась — остальные дорожки тоже не пройдут.
          if (/квота/.test(errText(e))) {
            rows.push({ code, lang, translation: "✔", youtube: result });
            throw new UserError(`${errText(e)} Переводы сохранены; запустите завтра — загруженные дорожки пропустятся.`);
          }
        }
      }
      console.log(`  ${code} → ${lang}: YouTube ${result} — https://studio.youtube.com/video/${videoId}/translations`);
      rows.push({ code, lang, translation: "✔", youtube: result });
    }
  }
  if (!deps) {
    for (const { src } of sources) {
      for (const lang of targets) if (ready.has(`${src.code}:${lang}`)) rows.push({ code: src.code, lang, translation: "✔", youtube: upload ? (ytNote ?? "—") : "не загружали (--no-upload)" });
    }
  }

  rows.sort((a, b) => a.code.localeCompare(b.code) || a.lang.localeCompare(b.lang));
  ghSummary(
    `### 🌐 Субтитры на других языках${dry ? " (пробный запуск)" : ""}\n\n| Ролик | Язык | Перевод | YouTube |\n|---|---|---|---|\n` +
      rows.map((r) => `| ${r.code} | ${r.lang} | ${escapeMd(r.translation)} | ${escapeMd(r.youtube)} |`).join("\n") +
      "\n" +
      (failures.length ? `\n${failures.map((f) => `- ⚠ ${escapeMd(f)}`).join("\n")}\n` : ""),
  );
  console.log(`\n${failures.length ? "✖" : "✔"} Переводов готово: ${ready.size} из ${codes.length * targets.length}${dry ? "; пробный запуск — на YouTube ничего не меняли." : ""}`);
  if (failures.length) throw new UserError(`Не всё получилось:\n- ${failures.join("\n- ")}\nГотовое сохранено — повторный запуск его пропустит.`);
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
