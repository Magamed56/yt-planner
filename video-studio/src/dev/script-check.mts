// Офлайн-проверка готового сценария теми же правилами, что и CI:
//   npx tsx src/dev/script-check.mts scripts/razbor-L02-….json [ещё файлы…]
// Печатает ошибки схемы/структуры (блокируют сборку), замечания lint, число слов и оценку длительности.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// file:// — иначе на Windows путь «C:\…» в import() падает с ERR_UNSUPPORTED_ESM_URL_SCHEME.
const { validateScript, lintScript, countWords, WORDS_PER_SECOND } = await import(pathToFileURL(path.join(VS, "src/pipeline/script/validate.ts")).href);

let bad = 0;
for (const f of process.argv.slice(2)) {
  const file = path.resolve(VS, f);
  console.log(`\n== ${path.relative(VS, file)}`);
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`  ✖ не JSON: ${(e as Error).message}`);
    bad++;
    continue;
  }
  try {
    const s = validateScript(json);
    const words = s.scenes.reduce((n: number, sc: { narration: string }) => n + countWords(sc.narration), 0);
    const kinds: Record<string, number> = {};
    for (const sc of s.scenes) kinds[sc.kind] = (kinds[sc.kind] ?? 0) + 1;
    const chapters = s.scenes.filter((sc: { chapter?: string }) => sc.chapter).map((sc: { chapter?: string }) => sc.chapter);
    console.log(`  ✔ схема и структура · ${s.format} · сцен ${s.scenes.length} · слов ${words} · ≈ ${Math.round(words / WORDS_PER_SECOND)} с · title ${s.title.length} симв.`);
    console.log(`  kinds: ${JSON.stringify(kinds)}`);
    if (chapters.length) console.log(`  главы: ${chapters.join(" | ")}`);
    const lint = lintScript(s);
    for (const l of lint) console.log(`  · ${l}`);
  } catch (e) {
    bad++;
    console.log(`  ✖ ${(e as Error).message}`);
  }
}
process.exit(bad ? 1 : 0);
