// Офлайн-проверка блока «Оформление канала» (/lang/en): тексты описания и ключевых слов из
// brand/en/README.md (единственный источник — README и кнопки панели не разойдутся), список
// файлов кита против `npm run brand` (src/remotion/brand/jobs.ts) и самих PNG в репозитории,
// какие пути пускает маршрут /api/brand. Сеть и ключи не нужны.
// Запуск из папки video-studio: npx tsx panel/scripts/brand-kit-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { channelFromJson } from "../../src/pipeline/channel";
import { BRAND_STILLS, brandJobs } from "../../src/remotion/brand/jobs";
import {
  brandDir,
  brandDownloadName,
  brandFilePath,
  brandKitOf,
  brandSrc,
  brandTextsOf,
  charCount,
  DESCRIPTION_MAX,
  HIGHLIGHT,
  INSTAGRAM_KIT,
  isKitPath,
  readmeBlock,
  YOUTUBE_KIT,
  type KitEntry,
} from "../lib/brand-kit";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const enJson = JSON.parse(fs.readFileSync(path.join(studio, "channels", "en.json"), "utf8")) as { pillars: { id: string }[] };
const en = channelFromJson(enJson);
const kitDir = path.join(studio, ...brandDir("en").split("/"));
const readme = fs.readFileSync(path.join(kitDir, "README.md"), "utf8");

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

// Ширина и высота PNG — из заголовка IHDR (байты 16–23), без пакетов.
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", `${file}: не PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("блок README: текст между ``` под заголовком, без рамки и пустых краёв", () => {
  const md = "# Кит\n\n### Описание канала\n\nТекст до блока.\n\n```\nLine 1\n\nLine 2\n```\n\n### Ключевые слова\n\n```\na, b, c\n```\n";
  assert.equal(readmeBlock(md, "Описание канала"), "Line 1\n\nLine 2");
  assert.equal(readmeBlock(md, "Ключевые слова"), "a, b, c");
  assert.equal(readmeBlock(md.replace(/\n/g, "\r\n"), "Описание канала"), "Line 1\n\nLine 2", "переводы строк Windows");
  assert.equal(readmeBlock(md, "Описание"), null, "заголовок — целиком, не начало");
  assert.equal(readmeBlock("## Описание канала ##\n~~~text\nTilde\n~~~\n", "Описание канала"), "Tilde", "~~~ и закрывающие #");
  assert.equal(readmeBlock("### Описание канала\n````\n```\ninner\n```\n````\n", "Описание канала"), "```\ninner\n```", "длинная рамка");
  assert.equal(readmeBlock("### Описание канала\nбез блока\n### Ключевые слова\n```\nx\n```\n", "Описание канала"), null, "блок чужого раздела не берём");
  assert.equal(readmeBlock("### Описание канала\n```\nне закрыт\n", "Описание канала"), null, "незакрытая рамка");
  assert.equal(readmeBlock("### Описание канала\n```\n\n```\n", "Описание канала"), null, "пустой блок");
  assert.deepEqual(brandTextsOf(null), { description: null, keywords: null, post: null });
  assert.equal(brandTextsOf("### Ключевые слова\n```\na, b,\nc\n```")?.keywords, "a, b, c", "ключевые слова — одной строкой");
});

test("brand/en/README.md: описание и ключевые слова для кнопок «Скопировать»", () => {
  const t = brandTextsOf(readme);
  assert.ok(t.description && t.keywords && t.post, "в README есть все три блока");
  assert.ok(t.description.startsWith(`${en.name}:`), `описание начинается с названия канала: ${t.description.slice(0, 40)}`);
  assert.ok(en.disclaimer && t.description.includes(en.disclaimer), "в описании — дисклеймер из channels/en.json");
  assert.ok(charCount(t.description) <= DESCRIPTION_MAX, `описание ${charCount(t.description)} знаков — больше ${DESCRIPTION_MAX}`);
  // README сам называет длину описания — число должно совпадать с текстом.
  const stated = /(\d+)\s+знаков из 1000/.exec(readme);
  assert.ok(stated, "README называет длину описания («… знаков из 1000»)");
  assert.equal(Number(stated[1]), charCount(t.description), "длина описания в README устарела");
  assert.ok(!t.description.includes("```") && !t.keywords.includes("```"), "без рамки блока");
  assert.ok(!t.keywords.includes("\n"), "ключевые слова — одна строка");
  const words = t.keywords.split(",").map((w) => w.trim());
  assert.ok(words.length >= 5 && words.every(Boolean), `ключевые слова через запятую: ${t.keywords}`);
  assert.ok(words.includes(en.name!.toLowerCase()), "название канала — среди ключевых слов");
  assert.ok(en.hashtags.brand.every((h) => t.post!.includes(h)), "подпись поста — с фирменным хэштегом");
});

test("список файлов кита: как рисует npm run brand, размеры — как у композиций", () => {
  const jobs = brandJobs(enJson.pillars.map((p) => p.id));
  const stills = Object.values(BRAND_STILLS);
  for (const spec of [...YOUTUBE_KIT, ...INSTAGRAM_KIT]) {
    const job = jobs.find((j) => j.file === spec.path);
    assert.ok(job, `${spec.path}: такого файла npm run brand не рисует`);
    const still = stills.find((s) => s.id === job.compositionId)!;
    assert.deepEqual({ width: spec.width, height: spec.height }, { width: still.width, height: still.height }, spec.path);
  }
  const highlights = jobs.filter((j) => j.file.startsWith("highlights/"));
  assert.equal(highlights.length, enJson.pillars.length, "по обложке на рубрику");
  for (const j of highlights) assert.ok(isKitPath(j.file), `${j.file} — в ките`);
  assert.deepEqual(HIGHLIGHT, { width: BRAND_STILLS.highlight.width, height: BRAND_STILLS.highlight.height });
  // Листы самопроверки не загружают — в кнопки панели они не попадают.
  for (const j of jobs.filter((j) => j.group === "preview" || j.file.includes("preview"))) assert.equal(isKitPath(j.file), false, j.file);
});

test("brand/en/: все файлы кита на месте, PNG нужного размера, README их называет", () => {
  for (const spec of [...YOUTUBE_KIT, ...INSTAGRAM_KIT]) {
    const file = path.join(kitDir, spec.path);
    assert.ok(fs.existsSync(file), `нет ${brandDir("en")}/${spec.path}`);
    assert.deepEqual(pngSize(file), { width: spec.width, height: spec.height }, spec.path);
    assert.ok(readme.includes(`\`${spec.path}\``), `README не называет ${spec.path}`);
  }
  for (const p of enJson.pillars) {
    const file = path.join(kitDir, "highlights", `${p.id}.png`);
    assert.ok(fs.existsSync(file), `нет обложки «Актуального» ${p.id}`);
    assert.deepEqual(pngSize(file), HIGHLIGHT, file);
  }
});

test("маршрут /api/brand: только кит другого языка, остальной репозиторий не читается", () => {
  assert.equal(brandFilePath("en", ["banner-youtube.png"]), "brand/en/banner-youtube.png");
  assert.equal(brandFilePath("en", ["highlights", "mind.png"]), "brand/en/highlights/mind.png");
  assert.equal(brandFilePath("kk", ["avatar-youtube.png"]), "brand/kk/avatar-youtube.png");
  assert.equal(brandFilePath("ru", ["banner-youtube.png"]), null, "русский кит — не здесь");
  assert.equal(brandFilePath("EN", ["banner-youtube.png"]), null, "только точное написание");
  assert.equal(brandFilePath("eng", ["banner-youtube.png"]), null);
  assert.equal(brandFilePath("xx", ["banner-youtube.png"]), null);
  assert.equal(brandFilePath("en", ["..", "channel.json"]), null);
  assert.equal(brandFilePath("en", ["../../channel.json"]), null);
  assert.equal(brandFilePath("en", ["README.md"]), null);
  assert.equal(brandFilePath("en", ["banner-safe-preview.png"]), null, "лист самопроверки");
  assert.equal(brandFilePath("en", ["highlights", "..", "banner-youtube.png"]), null);
  assert.equal(brandFilePath("en", ["highlights", "x", "mind.png"]), null);
  assert.equal(brandFilePath("en", ["highlights", "Mind.PNG"]), null);
  assert.equal(brandFilePath("en", []), null);
});

test("кит для страницы: порядок, имена с языком, адреса через панель", () => {
  const files = [...YOUTUBE_KIT, ...INSTAGRAM_KIT].map((k) => k.path);
  const entries: KitEntry[] = [
    ...["README.md", "banner-safe-preview.png", "avatar-preview.png", ...files.reverse()].map((p, i) => ({ path: p, size: 1000 + i, sha: `sha${i}abcdef0123456789` })),
    ...["why", "body", "mind"].map((id) => ({ path: `highlights/${id}.png`, size: 270_000, sha: `h-${id}` })),
  ];
  const kit = brandKitOf("en", entries, readme, "https://github.com/o/r/blob/master/video-studio/brand/en/README.md");
  assert.ok(kit);
  assert.deepEqual(
    kit.youtube.map((f) => f.path),
    YOUTUBE_KIT.map((k) => k.path),
    "баннер, аватар, водяной знак — в этом порядке",
  );
  assert.deepEqual(
    kit.instagram.map((f) => f.name),
    ["en-avatar-instagram.png", "en-highlight-body.png", "en-highlight-mind.png", "en-highlight-why.png", "en-instagram-post-intro.png"],
  );
  const banner = kit.youtube[0]!;
  assert.equal(banner.name, "en-banner-youtube.png");
  assert.equal(banner.src, brandSrc("en", "banner-youtube.png", banner.src.split("v=")[1]!));
  assert.match(banner.src, /^\/api\/brand\/en\/banner-youtube\.png\?v=sha\d+abcdef01$/, "sha — короткий, адрес — свой маршрут");
  assert.equal(banner.href, `${banner.src}&download=1`);
  assert.equal(banner.code, "en", "один code — файлы кита не разрываются между частями «Поделиться»");
  assert.equal(kit.instagram.find((f) => f.path === "highlights/mind.png")?.src, "/api/brand/en/highlights/mind.png?v=h-mind");
  assert.ok(kit.texts.description && kit.texts.keywords);
  assert.equal(brandKitOf("en", entries.filter((e) => !e.path.includes("youtube")), readme), null, "без файлов YouTube блока нет");
  assert.equal(brandKitOf("kk", [], null), null);
  assert.deepEqual(brandKitOf("en", entries, null)?.texts, { description: null, keywords: null, post: null }, "README нет — кнопок текста нет");
  assert.equal(brandDownloadName("en", "highlights/space.png"), "en-highlight-space.png");
  assert.equal(brandSrc("en", "avatar-youtube.png", ""), "/api/brand/en/avatar-youtube.png");
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
