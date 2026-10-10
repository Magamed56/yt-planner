// Канал на другом языке (/lang/en): ролики из релизов «en-08a-….mp4» — скачать на телефон и
// выложить руками, тексты для Studio и Instagram — одним нажатием. Только GitHub (релизы и
// запуски): YouTube второго канала панель не трогает — ключа к нему нет.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { DEFAULT_LANG, LANGS, normalizeLang } from "../../../../src/pipeline/lang";
import ErrorScreen from "@/components/ErrorScreen";
import LangView from "@/components/LangView";
import { assetText, branchName, listReleases, listRuns, repoName } from "@/lib/github";
import { LANG_CHANNELS, langChannel, navLangs, PANEL_TZ } from "@/lib/lang-channels";
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
    const [releases, ghRuns] = await Promise.all([listReleases(), listRuns()]);
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
      actionsUrl: `https://github.com/${repo}/actions/workflows/video-studio.yml?query=branch%3A${encodeURIComponent(branchName())}`,
      shell: { updated: time.format(now), generatedAt: now.toISOString(), activeRuns: active.length, activeIds: active.map((r) => r.id) },
    };
  } catch (e) {
    return <ErrorScreen title="Не получилось загрузить ролики канала" message={e instanceof Error ? e.message : String(e)} />;
  }
  return <LangView data={data} />;
}
