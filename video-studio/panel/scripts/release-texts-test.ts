// Офлайн-проверка: тексты для Studio из релиза, когда в content/videos.json записи нет (пакет
// собрали в другой ветке, коммит с текстами не дошёл). Самый свежий релиз на код, тело релиза —
// description.txt. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/release-texts-test.ts
import assert from "node:assert/strict";
import { descriptionTxt } from "../../src/pipeline/meta";
import type { GhRelease } from "../lib/github";
import { releaseFillItems } from "../lib/release-texts";

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

// description.txt — тем же кодом, что пишет конвейер (src/pipeline/meta.ts); описание с пустыми строками.
const desc = (title: string) =>
  descriptionTxt({
    title,
    description: `${title} — суть.\n#плутон #космос\n\nТаймкоды:\n0:00 Начало\n1:25 Середина\n\nРолики — научно-популярные.`,
    tags: ["плутон", "карликовая планета", "суть за минуту"],
    categoryId: "27",
    defaultLanguage: "ru",
    containsSyntheticMedia: true,
  });

let nextId = 1000;
const rel = (file: string, published: string, body: string | null, extra: Partial<GhRelease> = {}): GhRelease => {
  const id = nextId++;
  return {
    id,
    tag_name: `video-${file}-${id}`,
    name: file,
    html_url: `https://github.com/o/r/releases/tag/video-${file}`,
    created_at: "2026-10-13T20:09:57Z", // дата коммита — у релизов одного запуска одна
    published_at: published,
    draft: false,
    assets: [`${file}.mp4`, "captions.srt", "description.txt", "thumbnail.png"].map((name, i) => ({ id: id * 100 + i, name, size: 1000 })),
    body,
    ...extra,
  };
};

test("L03: название, описание с пустыми строками и теги — из тела релиза, файл — имя mp4", () => {
  const items = releaseFillItems([rel("L03-pochemu-pluton", "2026-10-14T07:47:13Z", desc("Почему Плутон больше не планета"))], ["L03"]);
  assert.equal(items.length, 1);
  const it = items[0]!;
  assert.equal(it.id, "L03");
  assert.equal(it.file, "L03-pochemu-pluton");
  assert.equal(it.title, "Почему Плутон больше не планета");
  assert.equal(it.description, "Почему Плутон больше не планета — суть.\n#плутон #космос\n\nТаймкоды:\n0:00 Начало\n1:25 Середина\n\nРолики — научно-популярные.");
  assert.deepEqual(it.tags, ["плутон", "карликовая планета", "суть за минуту"]);
  assert.equal(it.categoryId, "27");
  assert.equal(it.defaultLanguage, "ru");
  assert.equal(it.containsSyntheticMedia, true);
});

test("тело с \\r\\n (правили на GitHub) читается так же", () => {
  const items = releaseFillItems([rel("08a-x", "2026-10-14T07:47:13Z", desc("Ролик 08a").replace(/\n/g, "\r\n"))], ["08a"]);
  assert.equal(items[0]?.title, "Ролик 08a");
  assert.ok(items[0]!.description.includes("\n\nТаймкоды:"));
});

test("на код — самый свежий релиз по времени публикации (created_at у пересборки тот же)", () => {
  const items = releaseFillItems(
    [rel("L04-old", "2026-10-14T08:27:31Z", desc("Старое название")), rel("L04-new", "2026-10-16T08:00:00Z", desc("Новое название")), rel("L04-older", "2026-10-13T08:00:00Z", desc("Совсем старое"))],
    ["L04"],
  );
  assert.deepEqual(
    items.map((i) => [i.file, i.title]),
    [["L04-new", "Новое название"]],
  );
});

test("свежий релиз без наших текстов — кода нет: тексты старого релиза могли быть к другому видео", () => {
  const items = releaseFillItems([rel("L05-old", "2026-10-14T08:00:00Z", desc("Старый")), rel("L05-new", "2026-10-15T08:00:00Z", "Правка на GitHub")], ["L05"]);
  assert.deepEqual(items, []);
});

test("только просимые коды; черновики, другие языки и релизы без ролика — мимо", () => {
  const releases = [
    rel("L06-a", "2026-10-14T10:00:00Z", desc("L06")),
    rel("L07-b", "2026-10-14T10:00:00Z", desc("L07"), { draft: true }),
    rel("en-L08-c", "2026-10-14T10:00:00Z", desc("English")),
    { ...rel("L09-d", "2026-10-14T10:00:00Z", desc("Без видео")), assets: [{ id: 1, name: "description.txt", size: 10 }] },
    rel("L10-e", "2026-10-14T10:00:00Z", null),
    rel("L11-f", "2026-10-14T10:00:00Z", desc("Не просили")),
  ];
  assert.deepEqual(
    releaseFillItems(releases, ["L06", "L07", "L08", "L09", "L10"]).map((i) => i.id),
    ["L06"],
  );
  assert.deepEqual(releaseFillItems(releases, []), []);
});

console.log(`\nrelease-texts: ${passed} проверок пройдено`);
