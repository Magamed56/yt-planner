// Офлайн-проверка скачивания файлов роликов: имена с кодом, безопасное имя из адреса, какие
// файлы брать, пакеты для меню «Поделиться». Запуск из папки video-studio:
// npx tsx panel/scripts/files-test.ts
import assert from "node:assert/strict";
import { downloadName, fileHref, filesOf, kindTotals, loadFileOf, safeDownloadName, shareGroups, sizeLabel, type SaveItem } from "../lib/downloads";

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

const MB = 1_048_576;
const item = (code: string, mp4: number, extra: { cover?: boolean; thumb?: boolean } = { cover: true, thumb: true }): SaveItem => ({
  code,
  release: {
    mp4: { id: Number.parseInt(code, 36), name: `${code}-pochemu-tak.mp4`, size: mp4 * MB },
    cover: extra.cover ? { id: Number.parseInt(code, 36) + 1, name: "cover.jpg", size: 0.3 * MB } : null,
    thumb: extra.thumb ? { id: Number.parseInt(code, 36) + 2, name: "thumbnail.png", size: 1.2 * MB } : null,
  },
});

test("имя файла: обложки получают код ролика, у видео он уже есть", () => {
  assert.equal(downloadName("08a", "cover.jpg"), "08a-cover.jpg");
  assert.equal(downloadName("08a", "thumbnail.png"), "08a-thumbnail.png");
  assert.equal(downloadName("08a", "08a-pochemu.mp4"), "08a-pochemu.mp4");
  assert.equal(downloadName("08a", "08A-pochemu.mp4"), "08A-pochemu.mp4");
});

test("имя из адреса: только безопасное и с тем же расширением", () => {
  assert.equal(safeDownloadName("08a-cover.jpg", "cover.jpg"), "08a-cover.jpg");
  assert.equal(safeDownloadName(null, "cover.jpg"), "cover.jpg");
  assert.equal(safeDownloadName("", "cover.jpg"), "cover.jpg");
  assert.equal(safeDownloadName("08a-cover.html", "cover.jpg"), "cover.jpg", "другое расширение");
  assert.equal(safeDownloadName("../08a-cover.jpg", "cover.jpg"), "cover.jpg", "путь");
  assert.equal(safeDownloadName("обложка.jpg", "cover.jpg"), "cover.jpg", "не латиница");
  assert.equal(safeDownloadName('a".jpg', "cover.jpg"), "cover.jpg", "кавычка");
  assert.equal(safeDownloadName(`${"a".repeat(150)}.jpg`, "cover.jpg"), "cover.jpg", "слишком длинное");
  assert.equal(safeDownloadName("08A-COVER.JPG", "cover.jpg"), "08A-COVER.JPG", "регистр расширения не важен");
});

test("файлы: по отмеченным видам, в порядке ролик → видео, обложка 9:16, обложка YouTube", () => {
  const items = [item("08a", 25), item("08b", 30, { cover: true })];
  const all = filesOf(items, ["thumb", "video", "cover"]);
  assert.deepEqual(
    all.map((f) => [f.code, f.kind, f.name]),
    [
      ["08a", "video", "08a-pochemu-tak.mp4"],
      ["08a", "cover", "08a-cover.jpg"],
      ["08a", "thumb", "08a-thumbnail.png"],
      ["08b", "video", "08b-pochemu-tak.mp4"],
      ["08b", "cover", "08b-cover.jpg"],
    ],
  );
  assert.deepEqual(
    filesOf(items, ["cover"]).map((f) => f.name),
    ["08a-cover.jpg", "08b-cover.jpg"],
  );
  assert.deepEqual(filesOf(items, []), []);
  const totals = kindTotals(items);
  assert.equal(totals.video.count, 2);
  assert.equal(totals.thumb.count, 1, "у 08b нет обложки YouTube");
  assert.equal(totals.video.size, 55 * MB);
});

test("ссылки: видео — редиректом на GitHub, обложки — через панель с именем", () => {
  const [video, cover] = filesOf([item("08a", 25)], ["video", "cover"]);
  assert.equal(fileHref(video!), `/api/asset/${video!.assetId}`);
  assert.equal(fileHref(cover!), `/api/asset/${cover!.assetId}/file?download=1&name=08a-cover.jpg`);
  // FilesSaver берёт байты для «Поделиться» потоком через панель, скачивает — по той же ссылке.
  assert.deepEqual(loadFileOf(cover!), {
    key: "08a-cover",
    code: "08a",
    name: "08a-cover.jpg",
    size: cover!.size,
    src: `/api/asset/${cover!.assetId}/file`,
    href: fileHref(cover!),
  });
  assert.equal(loadFileOf(video!).href, `/api/asset/${video!.assetId}`);
});

test("пакеты «Поделиться»: файлы ролика вместе, лимиты по числу и размеру", () => {
  const files = filesOf([item("08a", 60), item("08b", 70), item("09a", 80), item("09b", 20)], ["video", "cover", "thumb"]);
  const groups = shareGroups(files, 10, 200 * MB);
  assert.deepEqual(
    groups.map((g) => [...new Set(g.map((f) => f.code))]),
    [
      ["08a", "08b"],
      ["09a", "09b"],
    ],
  );
  for (const g of groups) assert.ok(g.reduce((s, f) => s + f.size, 0) <= 200 * MB);
  // По числу файлов: 4 ролика × 3 файла, не больше 10 за раз — ролик не разрывается.
  const small = filesOf(
    ["10a", "10b", "11a", "11b"].map((c) => item(c, 5)),
    ["video", "cover", "thumb"],
  );
  assert.deepEqual(
    shareGroups(small, 10, 200 * MB).map((g) => g.length),
    [9, 3],
  );
  // Ролик больше лимита — отдельно, по файлу.
  const big = filesOf([item("12a", 250), item("12b", 10)], ["video", "cover"]);
  assert.deepEqual(
    shareGroups(big, 10, 200 * MB).map((g) => g.map((f) => f.name)),
    [["12a-pochemu-tak.mp4"], ["12a-cover.jpg", "12b-pochemu-tak.mp4", "12b-cover.jpg"]],
  );
  assert.deepEqual(shareGroups([], 10, 200 * MB), []);
});

test("размеры: КБ до мегабайта, прогресс — в единицах всего файла", () => {
  assert.equal(sizeLabel(17_400), "17 КБ", "водяной знак");
  assert.equal(sizeLabel(300), "1 КБ", "не «0 КБ» у непустого файла");
  assert.equal(sizeLabel(0), "0 КБ");
  assert.equal(sizeLabel(1_262_165), "1,2 МБ", "баннер");
  assert.equal(sizeLabel(25 * 1_048_576), "25,0 МБ");
  // Граница: 1023,5 КБ округлились бы в «1024 КБ» — это уже мегабайт.
  assert.equal(sizeLabel(1_048_063), "1023 КБ");
  assert.equal(sizeLabel(1_048_064), "1,0 МБ");
  assert.equal(sizeLabel(1_048_575), "1,0 МБ");
  // Начало скачивания ролика: «0,0 из 25,0 МБ», а не «0 КБ из 25,0 МБ».
  assert.equal(sizeLabel(0, 25 * 1_048_576), "0,0 МБ");
  assert.equal(sizeLabel(400_000, 25 * 1_048_576), "0,4 МБ");
  assert.equal(sizeLabel(5_000, 17_400), "5 КБ", "маленький файл — весь прогресс в КБ");
});

console.log(`\nВсе проверки скачивания пройдены: ${passed}.`);
