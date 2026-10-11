// Каналы на других языках (английский и т. д.): ролики из релизов GitHub «en-08a-<имя>.mp4»
// (workflow «video-studio: ролик», lang = en, upload = release). Загружает их владелец руками со
// своего телефона — панель только показывает файлы и тексты; YouTube второго канала не трогает
// (ключа для него нет). Русская очередь эти релизы не видит: mp4Code берёт только «08a-….mp4».
// Чистые функции без сети и файлов — их проверяет scripts/lang-videos-test.ts.
import { CODE_SRC, compareCodes, normCode } from "../../src/pipeline/codes";
import { DEFAULT_LANG, LANGS } from "../../src/pipeline/lang";
import type { BrandKit } from "./brand-kit";
import type { GhAsset, GhRelease } from "./github";
import type { LangChannel, NavLang } from "./lang-channels";
import type { LangPlan } from "./lang-plan";
import type { RunInfo } from "./state";

// Файл ролика другого языка: «en-08a-<имя>.mp4» (src/pipeline/lang.ts → langVideoName).
const LANG_MP4 = new RegExp(`^([a-z]{2,3})-(${CODE_SRC})-.+\\.mp4$`, "i");

// «en-08a-pochemu.mp4» → { lang: "en", code: "08a" }; русский «08a-….mp4» и чужие файлы — null.
export function langMp4(name: string): { lang: string; code: string } | null {
  const m = LANG_MP4.exec(name);
  if (!m) return null;
  const lang = m[1]!.toLowerCase();
  const code = normCode(m[2]);
  // Только известные языки и не русский: префикс — ровно код языка, как его пишет workflow.
  if (!code || lang === DEFAULT_LANG || !LANGS[lang]) return null;
  return { lang, code };
}

// ---- description.txt (src/pipeline/meta.ts → descriptionTxt) ----

export interface StudioTexts {
  title: string;
  description: string;
  tags: string[];
}

// «НАЗВАНИЕ / <название> / / ОПИСАНИЕ / <описание…> / / ТЕГИ (…) / <теги через запятую> / …».
// В описании бывают пустые строки, поэтому оно — всё между «ОПИСАНИЕ» и последним «ТЕГИ».
// Нет заголовка «НАЗВАНИЕ» или пустое название — null (такой файл не наш).
export function parseStudioTexts(raw: string | null | undefined): StudioTexts | null {
  const lines = (raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  const head = (re: RegExp, from: number) => lines.findIndex((l, i) => i >= from && re.test(l.trim()));
  const t = head(/^НАЗВАНИЕ$/, 0);
  if (t < 0) return null;
  const title = (lines[t + 1] ?? "").trim();
  if (!title) return null;
  const d = head(/^ОПИСАНИЕ$/, t + 2);
  let g = -1;
  for (let i = lines.length - 1; i > Math.max(t + 1, d); i--) {
    // «ТЕГИ (поле «Теги» в YouTube Studio)»; \b здесь не годится — кириллица для него не буквы.
    if (/^ТЕГИ(?:\s|\(|:|$)/.test(lines[i]!.trim())) {
      g = i;
      break;
    }
  }
  const description = d < 0 ? "" : lines.slice(d + 1, g < 0 ? lines.length : g).join("\n").trim();
  const tags = g < 0 ? [] : (lines[g + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { title, description, tags };
}

// ---- ролики языка ----

export interface LangVideo {
  code: string; // «08a» — код темы, он же русский оригинал (/?v=08a)
  file: string; // «en-08a» — с него начинаются имена скачанных файлов: en-08a-cover.jpg
  title: string; // из description.txt (НАЗВАНИЕ), иначе название релиза
  texts: StudioTexts | null; // название, описание и теги для Studio (тело релиза = description.txt)
  tag: string;
  url: string;
  builtAt: string; // ISO: когда релиз опубликован (created_at у релиза — дата коммита)
  mp4: GhAsset;
  cover: GhAsset | null; // cover.jpg — вертикальная обложка (Reels)
  thumb: GhAsset | null; // thumbnail.png — обложка 16:9
  caption: GhAsset | null; // instagram.txt — подпись Reels
  description: GhAsset | null; // description.txt — те же тексты, если тело релиза пустое
}

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};

// Новее ли релиз a, чем b. Правило как у русской очереди (state.ts → releasesByCode): по
// created_at. Но это дата коммита — у релизов нескольких запусков с одного коммита она одна,
// поэтому при равенстве решают время публикации и номер релиза (растёт с каждым новым).
function newer(a: GhRelease, b: GhRelease): boolean {
  return (ms(a.created_at) - ms(b.created_at) || ms(a.published_at) - ms(b.published_at) || a.id - b.id) > 0;
}

const asset = (r: GhRelease, name: string) => r.assets.find((a) => a.name === name) ?? null;

// Ролики языка: один на код — из самого свежего релиза; свежие коды первыми. Черновики и
// релизы без «<язык>-<код>-….mp4» (русские, коды без темы) не берём.
export function langVideosOf(releases: GhRelease[], lang: string): LangVideo[] {
  const best = new Map<string, { release: GhRelease; mp4: GhAsset }>();
  for (const r of releases) {
    if (r.draft) continue;
    const mp4 = r.assets.find((a) => langMp4(a.name)?.lang === lang);
    if (!mp4) continue;
    const code = langMp4(mp4.name)!.code;
    const prev = best.get(code);
    if (prev && !newer(r, prev.release)) continue;
    best.set(code, { release: r, mp4 });
  }
  return [...best.entries()]
    .map(([code, { release: r, mp4 }]) => {
      const texts = parseStudioTexts(r.body);
      return {
        code,
        file: `${lang}-${code}`,
        title: texts?.title || r.name?.trim() || code,
        texts,
        tag: r.tag_name,
        url: r.html_url,
        builtAt: r.published_at || r.created_at,
        mp4,
        cover: asset(r, "cover.jpg"),
        thumb: asset(r, "thumbnail.png"),
        caption: asset(r, "instagram.txt"),
        description: asset(r, "description.txt"),
      };
    })
    .sort((a, b) => compareCodes(b.code, a.code));
}

// Языки, у которых в релизах есть ролики, — в порядке списка языков (lang.ts → LANGS).
export function releaseLangs(releases: GhRelease[]): string[] {
  const found = new Set<string>();
  for (const r of releases) {
    if (r.draft) continue;
    for (const a of r.assets) {
      const m = langMp4(a.name);
      if (m) found.add(m.lang);
    }
  }
  return Object.keys(LANGS).filter((l) => found.has(l));
}

// Тело релиза пустое (его правили на GitHub), а description.txt есть — тексты из файла
// (texts: id файла → текст; читает страница, таких релизов единицы).
export function withFileTexts(videos: LangVideo[], texts: Map<number, string>): LangVideo[] {
  return videos.map((v) => {
    if (v.texts || !v.description || !texts.has(v.description.id)) return v;
    const parsed = parseStudioTexts(texts.get(v.description.id));
    return parsed ? { ...v, texts: parsed, title: parsed.title } : v;
  });
}

// Запуски этого языка: workflow пишет язык в название — «batch: 01a,01b [en]». Идущие — и
// последний, если он упал за двое суток (квота голоса, сценарий): иначе со страницы не видно,
// почему роликов нет.
type RunLike = Pick<RunInfo, "title" | "active" | "conclusion" | "createdAt">;
export function langRunsOf<T extends RunLike>(runs: T[], lang: string, nowMs: number): { active: T[]; failed: T | null } {
  const mine = runs.filter((r) => r.title.includes(`[${lang}]`)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const last = mine.find((r) => !r.active) ?? null;
  const active = mine.filter((r) => r.active);
  // Идёт новый запуск — прежняя неудача уже не новость.
  const broke = !active.length && last && (last.conclusion === "failure" || last.conclusion === "timed_out") && nowMs - ms(last.createdAt) < 2 * 86_400_000;
  return { active, failed: broke ? last : null };
}

// Русские названия языков для текстов панели: «Английских роликов пока нет».
const RU_ADJ: Record<string, string> = {
  en: "Английских",
  kk: "Казахских",
  uz: "Узбекских",
  uk: "Украинских",
  es: "Испанских",
  de: "Немецких",
  fr: "Французских",
  pt: "Португальских",
  tr: "Турецких",
};

export function emptyText(lang: string): string {
  const what = RU_ADJ[lang] ? `${RU_ADJ[lang]} роликов` : `Роликов на языке «${LANGS[lang]?.native ?? lang}»`;
  return `${what} пока нет. Соберите: Actions → «video-studio: ролик» → mode = batch, plan = коды, lang = ${lang}, upload = release`;
}

// Данные страницы /lang/<язык> (app/lang/[code]/page.tsx → components/LangView.tsx).
export interface LangRunNote {
  codes: string[]; // «01a», «01b» — что собирается
  createdLabel: string;
  url: string;
  stage?: string | null; // упавший: на каком этапе
}

export interface LangPageData {
  lang: string;
  channel: LangChannel;
  videos: (LangVideo & { builtLabel: string })[];
  running: LangRunNote[];
  failed: LangRunNote | null;
  empty: string; // что делать, если роликов нет
  geminiVoice: boolean; // голос языка — Gemini TTS: квота озвучки общая с русским каналом
  langs: NavLang[]; // переключатель языков (показываем, если их больше одного)
  brand: BrandKit | null; // бренд-кит brand/<язык>/ — блок «Оформление канала»; нет кита — null
  plan: LangPlan; // время выхода каждого ролика (schedule.start); не посчитан — plan.problem
  mainChannel: string; // русский канал (channel.json): «не перепутайте с ним» в инструкции
  actionsUrl: string; // workflow «video-studio: ролик» на GitHub
  shell: { updated: string; generatedAt: string; activeRuns: number; activeIds: number[] };
}
