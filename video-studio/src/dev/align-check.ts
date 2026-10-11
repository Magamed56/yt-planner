// Замер: насколько подсветка слов расходится с голосом — у готового ролика
// (captions.srt из релиза) и у нового выравнивания по речи (align.ts).
// Нужна модель распознавания (скачается в MODELS_DIR при первом запуске), поэтому
// это не *-test.ts: CI его не запускает.
//
//   ffmpeg -i video.mp4 -ac 1 -ar 16000 audio.wav
//   npx tsx src/dev/align-check.ts audio.wav scripts/sut-13a-….json captions.srt
//
// Эталон «голоса» — распознавание целого ролика одним проходом (без нарезки и без
// поправок по паузам); «новое» — тот же путь, что в конвейере: нарезка по паузам,
// сопоставление со сценарием, края слов по звуку. Сравниваются начала реплик .srt
// (их начало — время подсветки первого слова) и, для нового, все слова. Эталон —
// та же модель, так что цифры для нового — согласованность с распознаванием, а не
// независимая точность (её мерили по разметке другой моделью, GigaAM v1).

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { decodeWav, toMono } from "../pipeline/audio/wav";
import { parseSrt } from "../pipeline/srt";
import { alignTextToAsr, asrModelDir, recognizeWords, splitByAsr, tokensToWords, type AsrWord } from "../pipeline/voice/align";
import { normalizeText, tokenize } from "../pipeline/voice/text";
import { analyzeSpeech } from "../pipeline/voice/timing";
import type { VideoScript } from "../types";

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]! : NaN;
};
const fmt = (xs: number[]) => `медиана ${(pct(xs, 0.5) / 1000).toFixed(2)} с, P90 ${(pct(xs, 0.9) / 1000).toFixed(2)} с (n=${xs.length})`;

async function main() {
  const [wavPath, scriptPath, srtPath] = process.argv.slice(2);
  if (!wavPath || !scriptPath) throw new Error("Использование: align-check.ts audio.wav script.json [captions.srt]");
  const audio = decodeWav(await readFile(wavPath));
  const samples = Float32Array.from(toMono(audio));
  const sr = audio.sampleRate;
  const durationMs = (samples.length / sr) * 1000;
  const script = JSON.parse(await readFile(scriptPath, "utf8")) as VideoScript;
  const sceneTexts = script.scenes.map((s) => normalizeText(s.narration));
  const text = sceneTexts.join(" ");
  const tokens = tokenize(text);
  const sceneOf: number[] = [];
  sceneTexts.forEach((t, k) => tokenize(t).forEach(() => sceneOf.push(k)));

  // Эталон: целиком одним проходом.
  const lib = createRequire(import.meta.url)("sherpa-onnx-node") as {
    OfflineRecognizer: { createAsync(c: unknown): Promise<{ createStream(): { acceptWaveform(o: unknown): void }; decodeAsync(s: unknown): Promise<{ tokens: string[]; timestamps: number[] }> }> };
  };
  await recognizeWords(new Float32Array(sr), sr); // скачает модель, если её нет
  const dir = asrModelDir();
  const rec = await lib.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 64 },
    modelConfig: { nemoCtc: { model: path.join(dir, "model.int8.onnx") }, tokens: path.join(dir, "tokens.txt"), numThreads: Math.min(4, os.cpus().length), provider: "cpu", debug: 0 },
  });
  const st = rec.createStream();
  st.acceptWaveform({ samples, sampleRate: sr });
  const whole = await rec.decodeAsync(st);
  const refAsr: AsrWord[] = tokensToWords(whole.tokens, whole.timestamps);
  const ref = alignTextToAsr(text, refAsr, durationMs);
  if (!ref) throw new Error("эталон: речь не совпала со сценарием");
  console.log(`эталон: найдено ${ref.matched} из ${ref.total} слов сценария`);

  // Новое — путь конвейера.
  const t0 = Date.now();
  const profile = analyzeSpeech(samples, sr);
  const asr = await recognizeWords(samples, sr, profile);
  const fresh = asr ? alignTextToAsr(text, asr, durationMs, profile) : null;
  console.log(`новое: распознавание + выравнивание ${Date.now() - t0} мс на ${(durationMs / 1000).toFixed(1)} с звука; найдено ${fresh?.matched ?? 0} из ${tokens.length}`);
  if (!fresh) throw new Error("новое выравнивание не удалось");

  const all = fresh.words.map((w, i) => Math.abs(w.startMs - ref.words[i]!.startMs));
  console.log(`новое, все слова:     ${fmt(all)}`);

  // Нарезка по речи (как для общей озвучки Gemini): каждый разрез должен лечь между
  // последним словом сцены и первым словом следующей (по эталону).
  const split = asr ? splitByAsr(sceneTexts, asr, profile) : null;
  if (!split) console.log("нарезка по речи: не удалась");
  else {
    let at = 0;
    const bad: string[] = [];
    split.cuts.forEach((c, k) => {
      at += tokenize(sceneTexts[k]!).length;
      const a = ref.words[at - 1]!.endMs;
      const b = ref.words[at]!.startMs;
      if (c < a - 40 || c > b + 40) bad.push(`${script.scenes[k]!.id}|${script.scenes[k + 1]!.id}: ${(c / 1000).toFixed(2)} вне ${(a / 1000).toFixed(2)}–${(b / 1000).toFixed(2)}`);
    });
    console.log(`нарезка по речи: ${split.cuts.length - bad.length} из ${split.cuts.length} границ между словами сцен${bad.length ? ` (${bad.join("; ")})` : ""}`);
  }

  if (srtPath) {
    // Начало реплики — подсветка её первого слова; слова реплик идут подряд по сценарию.
    const cues = parseSrt(await readFile(srtPath, "utf8"));
    let wi = 0;
    const oldD: number[] = [];
    const newD: number[] = [];
    const perScene = new Map<number, { old: number[]; fresh: number[] }>();
    for (const c of cues) {
      const n = c.text.split(/\s+/).filter((w) => tokenize(w).length).length;
      if (wi >= tokens.length) break;
      const r = ref.words[wi]!.startMs;
      const o = c.startMs - r;
      const f = fresh.words[wi]!.startMs - r;
      oldD.push(Math.abs(o));
      newD.push(Math.abs(f));
      const s = perScene.get(sceneOf[wi]!) ?? { old: [], fresh: [] };
      s.old.push(o);
      s.fresh.push(f);
      perScene.set(sceneOf[wi]!, s);
      if (process.env.VERBOSE) console.log(`  ${script.scenes[sceneOf[wi]!]!.id} ${(c.startMs / 1000).toFixed(2)}–${(c.endMs / 1000).toFixed(2)} голос ${(r / 1000).toFixed(2)}–${(ref.words[Math.min(wi + n, tokens.length) - 1]!.endMs / 1000).toFixed(2)}  ${c.text}`);
      wi += n;
    }
    console.log(`старое (srt), начала реплик: ${fmt(oldD)}`);
    console.log(`новое, начала тех же реплик: ${fmt(newD)}`);
    console.log("по сценам (подсветка − голос, медиана; минус — подсветка раньше):");
    for (const [k, v] of [...perScene.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  ${script.scenes[k]!.id}: старое ${(pct(v.old, 0.5) / 1000).toFixed(2)} с, новое ${(pct(v.fresh, 0.5) / 1000).toFixed(2)} с`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
