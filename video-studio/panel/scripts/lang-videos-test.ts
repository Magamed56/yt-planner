// Офлайн-проверка страницы канала на другом языке (/lang/en): разбор релизов «en-08a-….mp4»,
// самый свежий релиз на код, тексты из description.txt, запуски языка, заготовка канала и меню.
// Русская очередь эти релизы не видит. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/lang-videos-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mp4Code } from "../../src/pipeline/codes";
import { descriptionTxt } from "../../src/pipeline/meta";
import type { GhRelease } from "../lib/github";
import { LANG_CHANNELS, langChannel, langChannelOf, NAV_LANGS, navLangs } from "../lib/lang-channels";
import { emptyText, langMp4, langRunsOf, langVideosOf, parseStudioTexts, releaseLangs, withFileTexts } from "../lib/lang-videos";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(studio, p), "utf8")) as unknown;

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

// description.txt — тем же кодом, что пишет конвейер (src/pipeline/meta.ts).
const desc = (title: string, description = `${title}: the gist.\n\n#shorts #facts\n\nSubscribe for a new gist every day`, tags = ["facts", "science"]) =>
  descriptionTxt({ title, description, tags, categoryId: "27", defaultLanguage: "en", containsSyntheticMedia: true });

let nextId = 1000;
const rel = (tag: string, created: string, files: string[], extra: Partial<GhRelease> = {}): GhRelease => {
  const id = nextId++;
  return {
    id,
    tag_name: tag,
    name: extra.name ?? tag,
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    created_at: created,
    published_at: created,
    draft: false,
    assets: files.map((name, i) => ({ id: id * 100 + i, name, size: name.endsWith(".mp4") ? 12_000_000 : 300_000 })),
    ...extra,
  };
};
const EN_FILES = (code: string, slug: string) => [`en-${code}-${slug}.mp4`, "captions.srt", "description.txt", "cover.jpg", "thumbnail.png", "instagram.txt", "qc.json"];

test("имя файла: «en-08a-….mp4» — английский 08a; русские, чужие и без кода — нет", () => {
  assert.deepEqual(langMp4("en-08a-why-the-sky-is-blue.mp4"), { lang: "en", code: "08a" });
  assert.deepEqual(langMp4("EN-08A-Why.mp4"), { lang: "en", code: "08a" }, "регистр не важен");
  assert.deepEqual(langMp4("en-L01-dunning-kruger.mp4"), { lang: "en", code: "L01" }, "«Разбор»");
  assert.deepEqual(langMp4("kk-01b-x.mp4"), { lang: "kk", code: "01b" });
  assert.equal(langMp4("08a-pochemu-nebo-goluboe.mp4"), null, "русский ролик");
  assert.equal(langMp4("ru-08a-x.mp4"), null, "русский с префиксом — не другой язык");
  assert.equal(langMp4("xx-08a-x.mp4"), null, "неизвестный язык");
  assert.equal(langMp4("en-08a-x.srt"), null);
  assert.equal(langMp4("en-video.mp4"), null, "без кода темы");
  assert.equal(langMp4("en-08a.mp4"), null, "без имени после кода");
});

test("русская очередь английский файл не берёт (mp4Code), а свой — берёт", () => {
  assert.equal(mp4Code("en-08a-why-the-sky-is-blue.mp4"), null);
  assert.equal(mp4Code("08a-pochemu.mp4"), "08a");
});

test("description.txt: название, описание с пустыми строками, теги", () => {
  const t = parseStudioTexts(desc("Why is the sky blue?"));
  assert.ok(t);
  assert.equal(t.title, "Why is the sky blue?");
  assert.equal(t.description, "Why is the sky blue?: the gist.\n\n#shorts #facts\n\nSubscribe for a new gist every day");
  assert.deepEqual(t.tags, ["facts", "science"]);
  assert.ok(!t.description.includes("ТЕГИ") && !t.description.includes("Категория"), "заголовки и строка категории — не описание");
  assert.deepEqual(parseStudioTexts(desc("No tags", "Text", []))?.tags, []);
  assert.equal(parseStudioTexts("НАЗВАНИЕ\r\nTitle\r\n\r\nОПИСАНИЕ\r\nLine\r\n")?.description, "Line", "переводы строк Windows");
  assert.equal(parseStudioTexts(""), null);
  assert.equal(parseStudioTexts(null), null);
  assert.equal(parseStudioTexts("просто текст релиза"), null, "чужой текст");
  assert.equal(parseStudioTexts("НАЗВАНИЕ\n\nОПИСАНИЕ\nx"), null, "пустое название");
});

const releases: GhRelease[] = [
  // 08a собирали дважды с одного коммита: created_at одинаковый, новее — опубликованный позже.
  rel("video-en-08a-why-sky-12-1-1", "2026-10-10T10:00:00Z", EN_FILES("08a", "why-sky"), { body: desc("Why is the sky blue? (old)"), published_at: "2026-10-10T11:00:00Z" }),
  rel("video-en-08a-why-sky-13-1-1", "2026-10-10T10:00:00Z", EN_FILES("08a", "why-sky"), { body: desc("Why is the sky blue?"), published_at: "2026-10-10T12:00:00Z" }),
  rel("video-en-07b-cats-11-1-2", "2026-10-09T10:00:00Z", EN_FILES("07b", "cats"), { body: desc("Why cats purr"), name: "Why cats purr" }),
  // Текст релиза правили на GitHub — название из релиза, тексты потом из description.txt.
  rel("video-en-09a-moon-14-1-1", "2026-10-10T12:00:00Z", [`en-09a-moon.mp4`, "description.txt"], { body: "", name: "The Moon is drifting away" }),
  // Русские и другие языки — не английские ролики.
  rel("video-08a-pochemu-nebo-5-1-1", "2026-10-11T10:00:00Z", ["08a-pochemu-nebo.mp4", "cover.jpg", "description.txt"], { body: "НАЗВАНИЕ\nПочему небо голубое\n" }),
  rel("video-kk-08a-x-15-1-1", "2026-10-11T10:00:00Z", ["kk-08a-x.mp4"]),
  rel("video-en-10a-draft-16-1-1", "2026-10-12T10:00:00Z", EN_FILES("10a", "draft"), { draft: true }),
  rel("video-en-no-code-17-1-1", "2026-10-12T10:00:00Z", ["video.mp4", "description.txt"]),
];

test("ролики языка: один на код из самого свежего релиза, свежие коды первыми", () => {
  const en = langVideosOf(releases, "en");
  assert.deepEqual(
    en.map((v) => v.code),
    ["09a", "08a", "07b"],
    "черновик 10a, русский 08a, казахский 08a и ролик без кода — не здесь",
  );
  const v08 = en.find((v) => v.code === "08a")!;
  assert.equal(v08.tag, "video-en-08a-why-sky-13-1-1", "тот же created_at — побеждает опубликованный позже");
  assert.equal(v08.title, "Why is the sky blue?");
  assert.equal(v08.file, "en-08a");
  assert.equal(v08.mp4.name, "en-08a-why-sky.mp4");
  assert.equal(v08.cover?.name, "cover.jpg");
  assert.equal(v08.thumb?.name, "thumbnail.png");
  assert.equal(v08.caption?.name, "instagram.txt");
  assert.equal(v08.builtAt, "2026-10-10T12:00:00Z", "время сборки — публикация релиза, не дата коммита");
  assert.deepEqual(v08.texts?.tags, ["facts", "science"]);

  const v09 = en.find((v) => v.code === "09a")!;
  assert.equal(v09.texts, null);
  assert.equal(v09.title, "The Moon is drifting away", "пустой текст релиза — название релиза");
  assert.equal(v09.cover, null);

  // Тот же created_at и время публикации — новее релиз с бо́льшим номером (порядок в списке не важен).
  const a = rel("video-en-11a-a-1-1-1", "2026-10-10T10:00:00Z", EN_FILES("11a", "a"), { body: desc("Old") });
  const b = rel("video-en-11a-a-2-1-1", "2026-10-10T10:00:00Z", EN_FILES("11a", "a"), { body: desc("New") });
  assert.equal(langVideosOf([a, b], "en")[0]!.title, "New");
  assert.equal(langVideosOf([b, a], "en")[0]!.title, "New");
  // Новее коммит — новее релиз, даже если номер меньше.
  const c = rel("video-en-11a-a-3-1-1", "2026-10-09T10:00:00Z", EN_FILES("11a", "a"), { body: desc("Older commit") });
  assert.equal(langVideosOf([c, a], "en")[0]!.title, "Old");

  assert.deepEqual(
    langVideosOf(releases, "kk").map((v) => v.file),
    ["kk-08a"],
  );
  assert.deepEqual(langVideosOf(releases, "uz"), []);
});

test("порядок: свежие коды первыми, «Разборы» (L01) — впереди Shorts", () => {
  const list = langVideosOf([rel("t1", "2026-10-01T00:00:00Z", ["en-01a-x.mp4"]), rel("t2", "2026-10-01T00:00:00Z", ["en-L01-y.mp4"]), rel("t3", "2026-10-01T00:00:00Z", ["en-02b-z.mp4"])], "en");
  assert.deepEqual(
    list.map((v) => v.code),
    ["L01", "02b", "01a"],
  );
});

test("тексты из description.txt, если текст релиза пустой", () => {
  const en = langVideosOf(releases, "en");
  const v09 = en.find((v) => v.code === "09a")!;
  const filled = withFileTexts(en, new Map([[v09.description!.id, desc("The Moon is moving away 3.8 cm a year")]]));
  const f09 = filled.find((v) => v.code === "09a")!;
  assert.equal(f09.title, "The Moon is moving away 3.8 cm a year");
  assert.ok(f09.texts?.description);
  assert.equal(filled.find((v) => v.code === "08a"), en.find((v) => v.code === "08a"), "у остальных ничего не меняется");
  assert.equal(withFileTexts(en, new Map([[v09.description!.id, "мусор"]])).find((v) => v.code === "09a")!.texts, null, "файл не разобрался — как было");
});

test("языки с роликами в релизах — по списку языков", () => {
  assert.deepEqual(releaseLangs(releases), ["en", "kk"]);
  assert.deepEqual(releaseLangs([]), []);
});

test("запуски языка: идущие и упавший последний (за двое суток), русские не в счёт", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const run = (title: string, active: boolean, conclusion: string | null, createdAt: string) => ({ title, active, conclusion, createdAt });
  const runs = [
    run("batch: 01a,01b [en]", true, null, "2026-10-11T11:00:00Z"),
    run("batch: 08a,08b", true, null, "2026-10-11T11:30:00Z"),
    run("batch: 07a [en]", false, "failure", "2026-10-11T08:00:00Z"),
    run("batch: 05a [kk]", false, "failure", "2026-10-11T09:00:00Z"),
  ];
  const en = langRunsOf(runs, "en", now);
  assert.deepEqual(
    en.active.map((r) => r.title),
    ["batch: 01a,01b [en]"],
  );
  assert.equal(en.failed, null, "идёт новый запуск — прежняя неудача не показывается");
  const after = langRunsOf(runs.filter((r) => r.active === false), "en", now);
  assert.equal(after.failed?.title, "batch: 07a [en]");
  assert.equal(langRunsOf([run("batch: 07a [en]", false, "failure", "2026-10-08T08:00:00Z")], "en", now).failed, null, "старше двух суток");
  assert.equal(langRunsOf([run("batch: 07a [en]", false, "failure", "2026-10-11T08:00:00Z"), run("batch: 07b [en]", false, "success", "2026-10-11T10:00:00Z")], "en", now).failed, null, "после неудачи был удачный");
  assert.deepEqual(langRunsOf(runs, "uz", now), { active: [], failed: null });
});

test("канал языка: настоящий channels/en.json, заготовка kk, нет файла, битый файл", () => {
  // Канал создан — плашки «Канал ещё не создан…» на /lang/en нет (LangView смотрит на placeholder).
  const en = langChannelOf("en", readJson("channels/en.json"));
  assert.equal(en.placeholder, false, "в en.json нет «placeholder» — канал создан");
  assert.equal(en.name, "Gist in a Minute");
  assert.equal(en.handle, "GistinaMinute");
  assert.equal(en.youtube, "https://www.youtube.com/@GistinaMinute");
  assert.equal(en.label, "English");
  assert.equal(en.file, "channels/en.json");
  assert.equal(langChannel("en").placeholder, false, "вшитый в панель en.json — тоже не заготовка");
  assert.equal(langChannelOf("kk", readJson("channels/kk.json")).placeholder, true, "kk — пока заготовка");

  const ready = langChannelOf("en", { name: "Gist in a Minute", handle: "@gistinaminute", links: { youtube: "https://youtube.com/@gistinaminute" } });
  assert.equal(ready.placeholder, false, "нет «placeholder» — канал настроен");
  assert.equal(ready.handle, "gistinaminute");
  assert.equal(ready.youtube, "https://youtube.com/@gistinaminute");

  const none = langChannelOf("es", null);
  assert.equal(none.placeholder, true, "файла нет — как заготовка");
  assert.equal(none.name, "Español");
  assert.equal(none.file, "channels/es.json");

  const broken = langChannelOf("en", { name: "X", schedule: { timezone: "Mars/Olympus" } });
  assert.equal(broken.placeholder, true, "файл не разобрался — страница не падает");
});

test("вшитые каналы и меню: английский всегда, заготовки kk и uz — только с роликами", () => {
  assert.deepEqual(
    LANG_CHANNELS.map((c) => [c.lang, c.placeholder]),
    ["en", "kk", "uz"].map((l) => [l, langChannelOf(l, readJson(`channels/${l}.json`)).placeholder]),
    "вшитые файлы — те же, что на диске",
  );
  const placeholders = ["en", "kk", "uz"].map((l) => langChannelOf(l, { placeholder: true, name: l }));
  assert.deepEqual(
    navLangs(placeholders).map((l) => l.code),
    ["en"],
  );
  assert.deepEqual(navLangs(placeholders)[0], { code: "en", label: "English" });
  assert.deepEqual(
    navLangs(placeholders, ["uz"]).map((l) => l.code),
    ["en", "uz"],
    "у uz уже есть ролики",
  );
  const kkReady = [placeholders[0]!, langChannelOf("kk", { name: "Мәні бір минутта" }), placeholders[2]!];
  assert.deepEqual(
    navLangs(kkReady).map((l) => [l.code, l.label]),
    [
      ["en", "English"],
      ["kk", "Қазақша"],
    ],
  );
  assert.ok(NAV_LANGS.some((l) => l.code === "en"), "в меню панели есть English");
  assert.ok(!NAV_LANGS.some((l) => l.code === "ru"), "русский — это вся остальная панель");
});

test("пустая страница: что и где запустить", () => {
  assert.equal(emptyText("en"), "Английских роликов пока нет. Соберите: Actions → «video-studio: ролик» → mode = batch, plan = коды, lang = en, upload = release");
  assert.match(emptyText("kk"), /^Казахских роликов пока нет\..*lang = kk/);
  assert.match(emptyText("xx"), /^Роликов на языке «xx» пока нет/);
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
