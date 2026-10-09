// Офлайн-проверка release-upload: какие ролики с диска залить в релизы. Сеть и диск не нужны.
// Запуск: npx tsx src/dev/release-test.ts
import assert from "node:assert/strict";
import path from "node:path";
import { codesWithRelease, matchLocal, releaseTag, slugOf, type LocalVideo } from "../pipeline/release-files";
import type { FillItem } from "../pipeline/youtube-fill";

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

const item = (id: string, file: string, title = `Ролик ${id}`): FillItem => ({
  id,
  file,
  title,
  durationSec: 50,
  description: "",
  tags: [],
  categoryId: "27",
  defaultLanguage: "ru",
  containsSyntheticMedia: true,
});

test("слаг и тег релиза", () => {
  assert.equal(slugOf("06a-rogatye-shlemy"), "rogatye-shlemy");
  assert.equal(releaseTag(item("06A", "06a-rogatye-shlemy")), "video-06a-rogatye-shlemy");
  const long = releaseTag(item("07a", `07a-${"x".repeat(150)}`));
  assert.ok(long.length <= 100 && long.startsWith("video-07a-"));
});

test("коды с релизом — по файлу «код-….mp4», черновики не в счёт", () => {
  const done = codesWithRelease([
    { assets: [{ name: "08A-pochemu.mp4" }, { name: "cover.jpg" }] },
    { draft: true, assets: [{ name: "09a-x.mp4" }] },
    { assets: [{ name: "video.mp4" }] },
    {},
  ]);
  assert.deepEqual([...done], ["08a"]);
});

test("ролик ↔ файл: имя, папка рендера (и обрезанный слаг), название из youtube.json", () => {
  const items = [
    item("01a", "01a-pochemu-svoy-golos-zvuchit-stranno"),
    item("02b", "02b-eta-akula-mozhet-byt-starshe-sankt-peterburga"),
    item("03a", "03a-internet-lezhit-na-dne-okeana", "Интернет лежит на дне океана"),
    item("04a", "04a-net-faila"),
  ];
  const found: LocalVideo[] = [
    { kind: "named", path: path.join("D:", "Ролики", "01A-pochemu-svoy-golos-zvuchit-stranno.mp4"), name: "01A-pochemu-svoy-golos-zvuchit-stranno.mp4" },
    { kind: "outdir", dir: path.join("out", "eta-akula-mozhet-byt-starshe-sankt-pe"), name: "eta-akula-mozhet-byt-starshe-sankt-pe", title: null, files: ["video.mp4", "cover.jpg", "instagram.txt", "props.json"] },
    { kind: "outdir", dir: path.join("out", "internet-2026-10-01"), name: "internet-2026-10-01", title: "Интернет лежит на дне океана", files: ["video.mp4", "thumbnail.png"] },
    { kind: "outdir", dir: path.join("out", "pustaya"), name: "net-faila", title: null, files: ["props.json"] }, // без video.mp4
  ];
  const plans = matchLocal(items, found);
  assert.equal(plans.get("01a")?.video, found[0]!.kind === "named" ? found[0]!.path : "");
  assert.deepEqual(plans.get("01a")?.extras, []);
  assert.equal(plans.get("02b")?.video, path.join("out", "eta-akula-mozhet-byt-starshe-sankt-pe", "video.mp4"));
  assert.deepEqual(plans.get("02b")?.extras.map((e) => path.basename(e)), ["cover.jpg", "instagram.txt"]);
  assert.equal(plans.get("03a")?.video, path.join("out", "internet-2026-10-01", "video.mp4"));
  assert.ok(!plans.has("04a"), "папка без video.mp4 — не ролик");
});

test("две версии одного ролика (и копия браузера «(1)») — видны обе", () => {
  const a = path.join("D:", "Загрузки", "02b-shchekotka.mp4");
  const b = path.join("D:", "Загрузки", "nedelya-1", "02b-shchekotka.mp4");
  const c = path.join("D:", "Загрузки", "02b-shchekotka (1).mp4");
  const plans = matchLocal(
    [item("02b", "02b-shchekotka")],
    [a, b, c].map((p): LocalVideo => ({ kind: "named", path: p, name: path.basename(p) })),
  );
  assert.equal(plans.get("02b")?.video, a);
  assert.deepEqual(plans.get("02b")?.others, [b, c]);
});

test("короткий слаг не цепляет чужую папку по началу имени", () => {
  const plans = matchLocal([item("05a", "05a-luk")], [{ kind: "outdir", dir: "out/luk-i-slezy", name: "luk-i-slezy", title: null, files: ["video.mp4"] }]);
  assert.ok(!plans.has("05a"));
});

console.log(`release-test: ${passed} ✓`);
