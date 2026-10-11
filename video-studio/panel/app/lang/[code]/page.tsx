// Канал на другом языке (/lang/en): ролики из релизов «en-08a-….mp4» — скачать на телефон и
// выложить руками, тексты для Studio и Instagram — одним нажатием; оформление канала — из
// бренд-кита brand/<язык>/. Только GitHub (релизы, запуски, файлы ветки): YouTube второго канала
// панель не трогает — ключа к нему нет.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_LANG, LANGS, normalizeLang } from "../../../../src/pipeline/lang";
import ErrorScreen from "@/components/ErrorScreen";
import LangView from "@/components/LangView";
import { brandDir, brandKitOf, type BrandKit } from "@/lib/brand-kit";
import { CHANNEL_NAME } from "@/lib/channel-name";
import { assetText, branchName, listDirEntries, listReleases, listRuns, readFile, repoName } from "@/lib/github";
import { LANG_CHANNELS, langChannel, navLangs, PANEL_TZ } from "@/lib/lang-channels";
import { STUDIO_DIR } from "@/lib/load";
import { emptyText, langRunsOf, langVideosOf, releaseLangs, withFileTexts, type LangPageData, type LangRunNote } from "@/lib/lang-videos";
import { runInfos, type RunInfo } from "@/lib/state";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const lang = normalizeLang((await params).code);
  return { title: lang && lang !== DEFAULT_LANG ? `${langChannel(lang).name} — панель` : "Каналы — панель" };
}

// description.txt релизов с пустым текстом релиза: файл по номеру не меняется — помним его.
const fileTexts = new Map<number, string>();
async function readTexts(ids: number[]): Promise<Map<number, string>> {
  if (fileTexts.size > 200) fileTexts.clear();
  await Promise.all(
    ids.filter((id) => !fileTexts.has(id)).map((id) =>
      assetText(id)
        .then((t) => void fileTexts.set(id, t))
        .catch(() => {}), // не прочитался — название из релиза, копирование описания скрыто
    ),
  );
  return fileTexts;
}

// Бренд-кит языка: файлы папки (размер и sha — для кнопок и адресов картинок), обложки
// «Актуального» и README с текстами. Меняется редко — помним 10 минут; папки нет (kk, uz) —
// null, блок «Оформление канала» не показываем. Ошибку не помним: со следующим заходом — заново.
const kits = new Map<string, { at: number; kit: BrandKit | null }>();
async function readBrandKit(lang: string): Promise<BrandKit | null> {
  const hit = kits.get(lang);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.kit;
  const dir = `${STUDIO_DIR}/${brandDir(lang)}`;
  const top = await listDirEntries(dir);
  const has = (name: string, type: string) => top.some((e) => e.name === name && e.type === type);
  const [sub, readme] = top.length
    ? await Promise.all([has("highlights", "dir") ? listDirEntries(`${dir}/highlights`) : [], has("README.md", "file") ? readFile(`${dir}/README.md`) : null])
    : [[], null];
  const entries = [...top, ...sub].filter((e) => e.type === "file" && e.path.startsWith(`${dir}/`)).map((e) => ({ path: e.path.slice(dir.length + 1), size: e.size, sha: e.sha }));
  const readmeUrl = `https://github.com/${repoName()}/blob/${encodeURIComponent(branchName())}/${dir}/README.md`;
  const kit = brandKitOf(lang, entries, readme, readme === null ? null : readmeUrl);
  kits.set(lang, { at: Date.now(), kit });
  return kit;
}

export default async function LangPage({ params }: Params) {
  await connection();
  const raw = (await params).code;
  const lang = normalizeLang(raw);
  if (!lang) notFound();
  if (lang === DEFAULT_LANG) redirect("/"); // русский канал — главная панель
  if (lang !== raw) redirect(`/lang/${lang}`); // «EN», «eng» → /lang/en

  const now = new Date();
  let data: LangPageData;
  try {
    // Кит не прочитался — страница с роликами всё равно нужна: блок оформления просто не покажем.
    const [releases, ghRuns, brand] = await Promise.all([listReleases(), listRuns(), readBrandKit(lang).catch(() => null)]);
    let videos = langVideosOf(releases, lang);
    const missing = videos.filter((v) => !v.texts && v.description).slice(0, 12);
    if (missing.length) videos = withFileTexts(videos, await readTexts(missing.map((v) => v.description!.id)));

    const day = new Intl.DateTimeFormat("ru-RU", { timeZone: PANEL_TZ, day: "2-digit", month: "2-digit" });
    const time = new Intl.DateTimeFormat("ru-RU", { timeZone: PANEL_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const runs = runInfos(ghRuns, undefined, PANEL_TZ);
    const mine = langRunsOf(runs, lang, now.getTime());
    const note = (r: RunInfo): LangRunNote => ({ codes: r.codes, createdLabel: r.createdLabel, url: r.url, stage: r.failedStage ?? null });
    const active = runs.filter((r) => r.active);
    const repo = repoName();

    data = {
      lang,
      channel: langChannel(lang),
      videos: videos.map((v) => ({ ...v, builtLabel: `${day.format(new Date(v.builtAt))} ${time.format(new Date(v.builtAt))}` })),
      running: mine.active.map(note),
      failed: mine.failed ? note(mine.failed) : null,
      empty: emptyText(lang),
      geminiVoice: LANGS[lang]?.geminiTts ?? false,
      // Переключатель: пункты меню + языки, у которых уже есть ролики, + этот.
      langs: navLangs(LANG_CHANNELS, [...releaseLangs(releases), lang]),
      brand,
      mainChannel: CHANNEL_NAME,
      actionsUrl: `https://github.com/${repo}/actions/workflows/video-studio.yml?query=branch%3A${encodeURIComponent(branchName())}`,
      shell: { updated: time.format(now), generatedAt: now.toISOString(), activeRuns: active.length, activeIds: active.map((r) => r.id) },
    };
  } catch (e) {
    return <ErrorScreen title="Не получилось загрузить ролики канала" message={e instanceof Error ? e.message : String(e)} />;
  }
  return <LangView data={data} />;
}
