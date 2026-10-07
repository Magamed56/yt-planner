// Проверка озвучки: синтезирует сцены s1–s3 из examples/demo-ru.json
// провайдером из TTS_PROVIDER и печатает длительности и первые тайминги слов.
//
//   npx tsx src/dev/voice-test.ts                       # edge (нужен интернет)
//   TTS_PROVIDER=piper npx tsx src/dev/voice-test.ts     # офлайн
//   npx tsx src/dev/voice-test.ts examples/demo-ru.json out/voice-test s1 s2 s3 s4
//
// Windows (PowerShell): $env:TTS_PROVIDER="piper"; npx tsx src/dev/voice-test.ts

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VideoScript } from "../types";
import { projectRoot } from "../pipeline/audio/paths";
import { getVoiceProvider } from "../pipeline/voice";

async function main() {
  const [scriptArg, outArg, ...ids] = process.argv.slice(2);
  const scriptPath = path.resolve(scriptArg ?? path.join(projectRoot(), "examples", "demo-ru.json"));
  const outDir = path.resolve(outArg ?? path.join(projectRoot(), "out", "voice-test"));
  const wanted = ids.length ? ids : ["s1", "s2", "s3"];
  const script = JSON.parse(await readFile(scriptPath, "utf8")) as VideoScript;
  const provider = getVoiceProvider();
  console.log(`Провайдер: ${provider.name}; сценарий: ${scriptPath}; файлы: ${outDir}`);

  for (const scene of script.scenes.filter((s) => wanted.includes(s.id))) {
    const t0 = Date.now();
    const r = await provider.synthesize(scene.narration, path.join(outDir, scene.id));
    const ms = Date.now() - t0;
    const speech = r.words.length ? `${r.words[0]!.startMs}–${r.words.at(-1)!.endMs} мс` : "—";
    console.log(`\n${scene.id}: ${(r.durationMs / 1000).toFixed(2)} с, слов ${r.words.length} (${r.wordsSource === "provider" ? "тайминги провайдера" : "оценка по звуку"}), речь ${speech}, синтез ${ms} мс`);
    console.log(`  ${path.relative(process.cwd(), r.file)}`);
    for (const w of r.words.slice(0, 8)) console.log(`  ${String(w.startMs).padStart(6)} → ${String(w.endMs).padStart(6)}  ${w.text}`);
    if (r.words.length > 8) console.log(`  … ещё ${r.words.length - 8}`);
  }
}

main().catch((e: unknown) => {
  console.error(`\nОшибка: ${(e as Error).message}`);
  process.exit(1);
});
