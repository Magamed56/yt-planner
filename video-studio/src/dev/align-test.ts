// Тайминги слов по распознанной речи (voice/align.ts) — без сети, ключей и модели:
// сопоставление слов сценария с «распознанными» на синтетических данных (пропуски,
// лишние слова, имена, склейки), нарезка общего звука на сцены, поправки по паузам
// и деградация без модели (сборка не падает, тайминги — прежняя оценка, кэш цел).
//
//   npx tsx src/dev/align-test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeWav16, type PcmAudio } from "../pipeline/audio/wav";
import {
  alignByAsr,
  alignEnabled,
  alignTextToAsr,
  chunkByPauses,
  matchWords,
  resampleTo16k,
  splitByAsr,
  tokensToWords,
  wordSimilarity,
  type AsrWord,
} from "../pipeline/voice/align";
import { wrapProvider, type RawProvider } from "../pipeline/voice/provider";
import { readShared, writeShared } from "../pipeline/voice/shared-cache";
import { tokenize } from "../pipeline/voice/text";
import type { SpeechProfile } from "../pipeline/voice/timing";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "align-test-"));

// «Распознанная речь»: слова подряд, по 300 мс, между ними 100 мс.
function asrOf(words: string[], startMs = 200, wordMs = 300, gapMs = 100): AsrWord[] {
  return words.map((text, i) => ({ text, startMs: startMs + i * (wordMs + gapMs), endMs: startMs + i * (wordMs + gapMs) + wordMs }));
}

// Профиль звука без пауз (или с заданными) — для поправок по краям слов.
function profileOf(durationMs: number, pauses: { startMs: number; endMs: number }[] = [], speechStartMs = 200, speechEndMs = durationMs - 100): SpeechProfile {
  const frames = Math.ceil(durationMs / 10);
  return { hopMs: 10, db: new Float32Array(frames), vdb: new Float32Array(frames), thresholdDb: -40, speechStartMs, speechEndMs, pauses, durationMs, hasSpeech: true };
}

const TEXT = "Сатурн менее плотный, чем вода. Он бы плавал в огромной ванне.";
const SCRIPT = tokenize(TEXT).map((t) => t.norm);

async function main() {
  console.log("Сопоставление слов:");

  await test("похожесть слов: одинаковые 1, имя «как слышится» > 0.5, разные < 0.5", () => {
    assert.equal(wordSimilarity("сатурн", "сатурн"), 1);
    assert.ok(wordSimilarity("гелия", "гелея") >= 0.5);
    assert.ok(wordSimilarity("галилей", "галилея") >= 0.5);
    assert.ok(wordSimilarity("вода", "плотный") < 0.5);
    assert.equal(wordSimilarity("", "а"), 0);
  });

  await test("текст совпал целиком — слова получают время речи (с поправкой на задержку CTC)", () => {
    const asr = asrOf(SCRIPT);
    const r = alignTextToAsr(TEXT, asr, 6000);
    assert.ok(r);
    assert.equal(r.matched, SCRIPT.length);
    assert.equal(r.words.length, SCRIPT.length);
    r.words.forEach((w, i) => {
      assert.ok(Math.abs(w.startMs - (asr[i]!.startMs - 40)) <= 1, `слово ${i}: ${w.startMs}`);
      assert.ok(w.endMs <= asr[i]!.endMs + 1);
    });
    assert.equal(r.words[3]!.text, "чем");
    assert.equal(r.words[4]!.text, "вода.", "пунктуация сценария остаётся в субтитрах");
  });

  await test("ё → е, регистр и знаки не мешают", () => {
    const r = alignTextToAsr("Всё ещё ждём.", asrOf(["все", "еще", "ждем"]), 2000);
    assert.equal(r?.matched, 3);
  });

  await test("пропуск в распознавании — время слова интерполируется между соседями", () => {
    const words = SCRIPT.filter((_, i) => i !== 2 && i !== 3); // «плотный, чем» не распознаны
    const asr = asrOf(words);
    const r = alignTextToAsr(TEXT, asr, 6000);
    assert.ok(r);
    assert.equal(r.matched, SCRIPT.length - 2);
    assert.deepEqual(r.found.slice(0, 5), [true, true, false, false, true]);
    const [prev, a, b, next] = [r.words[1]!, r.words[2]!, r.words[3]!, r.words[4]!];
    assert.ok(a.startMs >= prev.endMs && b.startMs >= a.endMs && next.startMs >= b.endMs, "монотонно");
    assert.ok(a.startMs < next.startMs && b.endMs <= next.startMs, "между соседями");
  });

  await test("лишние слова в речи (оговорка, шум) пропускаются", () => {
    const asr = asrOf(["э", ...SCRIPT.slice(0, 5), "ну", "вот", ...SCRIPT.slice(5)]);
    const r = alignTextToAsr(TEXT, asr, 8000);
    assert.ok(r);
    assert.equal(r.matched, SCRIPT.length);
    assert.ok(Math.abs(r.words[5]!.startMs - (asr[8]!.startMs - 40)) <= 1, "«Он» — после «ну вот»");
  });

  await test("имена и числа распознаются по-своему — слово всё равно находится", () => {
    const text = "Галилей увидел кольца Сатурна в тысяча шестьсот десятом году.";
    const asr = asrOf(["галилеи", "увидел", "кольца", "сатурна", "в", "тысяча", "шестьсот", "десятом", "году"]);
    const r = alignTextToAsr(text, asr, 5000);
    assert.equal(r?.matched, 9);
  });

  await test("склейка и расклейка слов: «во что» ↔ «вочто», «сверхновая» ↔ «сверх новая»", () => {
    const m1 = matchWords(["во", "что", "верят"], ["вочто", "верят"]);
    assert.deepEqual(m1, [{ from: 0, to: 0 }, { from: 0, to: 0 }, { from: 1, to: 1 }]);
    const r1 = alignTextToAsr("Во что верят.", asrOf(["вочто", "верят"]), 2000)!;
    assert.ok(r1.words[0]!.endMs <= r1.words[1]!.startMs && r1.words[1]!.startMs > r1.words[0]!.startMs, "склеенное слово делится по весам");
    const m2 = matchWords(["сверхновая", "звезда"], ["сверх", "новая", "звезда"]);
    assert.deepEqual(m2, [{ from: 0, to: 1 }, { from: 2, to: 2 }]);
    const m3 = matchWords(["сам", "оксфорд", "основан"], ["самоксфорд", "основан"]);
    assert.deepEqual(m3, [{ from: 0, to: 0 }, { from: 0, to: 0 }, { from: 1, to: 1 }], "настоящая склейка «сам оксфорд»");
  });

  await test("совпало меньше 60 % — null (остаётся прежняя оценка)", () => {
    assert.equal(alignTextToAsr(TEXT, asrOf(["совсем", "другой", "текст", "про", "погоду"]), 3000), null);
    assert.equal(alignTextToAsr(TEXT, [], 3000), null);
    assert.equal(alignTextToAsr("", asrOf(["а"]), 3000), null);
  });

  await test("поправки по звуку: начало после паузы — конец паузы, конец слова — не заходит в паузу", () => {
    const asr = asrOf(["раз", "два"], 200, 300, 400); // «раз» 200–500, «два» 900–1200
    const prof = profileOf(1500, [{ startMs: 520, endMs: 860 }]);
    const r = alignTextToAsr("Раз. Два.", asr, 1500, prof)!;
    assert.equal(r.words[1]!.startMs, 860, "«два» — с конца паузы");
    assert.ok(r.words[0]!.endMs <= 520, "«раз» кончается до паузы");
    assert.equal(r.words[0]!.startMs, 200, "первое слово — с начала речи");
  });

  await test("тишина внутри слова (смычка «к» в «капкан») не обрывает конец слова", () => {
    // «капкан» 200–700 (последняя буква ~660), смычка 420–470, настоящая пауза 720–900.
    const asr: AsrWord[] = [
      { text: "капкан", startMs: 200, endMs: 700 },
      { text: "закрылся", startMs: 900, endMs: 1400 },
    ];
    const prof = profileOf(1700, [{ startMs: 420, endMs: 470 }, { startMs: 720, endMs: 900 }]);
    const r = alignTextToAsr("Капкан закрылся.", asr, 1700, prof)!;
    assert.ok(r.words[0]!.endMs > 660, `«капкан» подсвечен до последней буквы, а не до смычки: конец ${r.words[0]!.endMs}`);
    assert.equal(r.words[0]!.endMs, 720, "конец — по настоящей паузе после слова");
    assert.equal(r.words[1]!.startMs, 900, "«закрылся» — с конца паузы");
  });

  await test("буквы CTC → слова: пробел — граница, время первой и последней буквы", () => {
    const w = tokensToWords(["о", "н", " ", "б", "ы"], [0.1, 0.2, 0.3, 0.5, 0.6], 1000);
    assert.deepEqual(w, [
      { text: "он", startMs: 1100, endMs: 1240 },
      { text: "бы", startMs: 1500, endMs: 1640 },
    ]);
    assert.deepEqual(tokensToWords(["▁он", "▁бы"], [0.1, 0.5]).map((x) => x.text), ["он", "бы"]);
  });

  await test("длинный звук режется по паузам, не по словам", () => {
    const pauses = [5000, 11_000, 14_000, 26_000, 33_000].map((t) => ({ startMs: t, endMs: t + 300 }));
    const cuts = chunkByPauses(profileOf(40_000, pauses));
    assert.ok(cuts.length >= 2);
    for (const c of cuts) assert.ok(pauses.some((p) => c > p.startMs && c < p.endMs), `разрез ${c} — в паузе`);
    assert.deepEqual(chunkByPauses(profileOf(15_000)), [], "короткий — целиком");
  });

  await test("пересэмплирование в 16 кГц: длина и уровень сохраняются", () => {
    const x = new Float32Array(24000).fill(0.5);
    const y = resampleTo16k(x, 24000);
    assert.equal(y.length, 16000);
    assert.ok(Math.abs(y[8000]! - 0.5) < 1e-6);
    assert.equal(resampleTo16k(x, 16000), x);
  });

  console.log("Нарезка общей озвучки на сцены:");

  await test("граница — в паузе между последним словом сцены и первым словом следующей", () => {
    // Сцена 1 — «Сатурн менее плотный, чем вода. Он бы плавал.», сцена 2 — «Вот цифры.»
    // По паузам граница легла бы после «вода.» (так ошиблась нарезка в ролике 13a).
    const texts = ["Сатурн менее плотный, чем вода. Он бы плавал.", "Вот цифры."];
    const words = ["сатурн", "менее", "плотный", "чем", "вода", "он", "бы", "плавал", "вот", "цифры"];
    const asr = asrOf(words); // «плавал» 3000–3300, «вот» 3400–3700
    asr.slice(8).forEach((w) => ((w.startMs += 800), (w.endMs += 800))); // пауза между сценами
    const prof = profileOf(5000, [{ startMs: 2050, endMs: 2200 }, { startMs: 3320, endMs: 4180 }]);
    const s = splitByAsr(texts, asr, prof)!;
    assert.ok(s);
    assert.equal(s.cuts.length, 1);
    assert.ok(s.cuts[0]! > 3300 && s.cuts[0]! < 4200, `разрез ${s.cuts[0]}`);
    assert.equal(s.words[0]!.length, 8);
    assert.equal(s.words[1]![0]!.text, "Вот");
    assert.ok(Math.abs(s.words[1]![0]!.startMs - (4180 - s.cuts[0]!)) <= 1, "слова сцены — от начала её куска");
  });

  await test("пауза между сценами (0,3 с) короче паузы между предложениями (0,55 с) — граница всё равно по словам", () => {
    const texts = ["Это почти на треть меньше. Значит, Сатурн бы всплыл.", "Но есть подвох."];
    const words = ["это", "почти", "на", "треть", "меньше", "значит", "сатурн", "бы", "всплыл", "но", "есть", "подвох"];
    const asr = asrOf(words, 200, 300, 100);
    asr.slice(5).forEach((w) => ((w.startMs += 550), (w.endMs += 550))); // после «меньше.» — 0,55 с
    asr.slice(9).forEach((w) => ((w.startMs += 300), (w.endMs += 300))); // между сценами — 0,3 с
    const pauses = [
      { startMs: asr[4]!.endMs, endMs: asr[5]!.startMs },
      { startMs: asr[8]!.endMs, endMs: asr[9]!.startMs },
    ];
    const s = splitByAsr(texts, asr, profileOf(asr.at(-1)!.endMs + 300, pauses))!;
    assert.ok(s.cuts[0]! > asr[8]!.endMs && s.cuts[0]! < asr[9]!.startMs, `разрез ${s.cuts[0]} — после «всплыл»`);
  });

  await test("последнее слово сцены не распознано — не склеивается с первым словом следующей", () => {
    // «нет» сказано (1400–1700), но распознаватель его пропустил; «нетбританские» ~
    // «британские» = 0,77 — без порога склейки разрез уезжал за «британские».
    const texts = ["И щекотки почти нет.", "Британские нейробиологи проверили это."];
    const said = ["и", "щекотки", "почти", "нет", "британские", "нейробиологи", "проверили", "это"];
    const all = asrOf(said);
    all.slice(4).forEach((w) => ((w.startMs += 700), (w.endMs += 700))); // между сценами — 0,8 с
    const asr = all.filter((w) => w.text !== "нет");
    const m = matchWords(said, asr.map((w) => w.text));
    assert.equal(m[3], null, "«нет» — не нашлось");
    assert.deepEqual(m[4], { from: 3, to: 3 }, "«британские» — само по себе");
    const s = splitByAsr(texts, asr, profileOf(4400, [{ startMs: 1700, endMs: 2500 }]))!;
    assert.ok(s);
    assert.ok(s.cuts[0]! >= 1700 && s.cuts[0]! <= 2500, `разрез ${s.cuts[0]} — между «нет» (до 1700) и «британские» (с 2500)`);
    assert.equal(s.words[1]![0]!.text, "Британские");
    assert.ok(s.words[1]![0]!.startMs >= 0, "«британские» — целиком в своей сцене");
  });

  await test("сцена не нашлась в речи — null (нарезка по паузам)", () => {
    const texts = ["Сатурн менее плотный, чем вода.", "Совершенно другой текст про погоду завтра."];
    const asr = asrOf(["сатурн", "менее", "плотный", "чем", "вода", "солнце", "светит"]);
    assert.equal(splitByAsr(texts, asr, profileOf(4000)), null);
  });

  console.log("Включение и деградация:");

  await test("CAPTION_ALIGN=0 и нерусский ролик — выравнивание выключено", () => {
    assert.equal(alignEnabled({}), true);
    assert.equal(alignEnabled({ TTS_LANGUAGE: "ru" }), true);
    assert.equal(alignEnabled({ CAPTION_ALIGN: "0" }), false);
    assert.equal(alignEnabled({ TTS_LANGUAGE: "en" }), false);
  });

  // Модели нет, сеть «упала»: загрузка не удаётся быстро, сборка идёт дальше.
  process.env.MODELS_DIR = path.join(tmp, "models");
  process.env.TTS_CACHE_DIR = "none";
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    throw new TypeError("fetch failed (тест: сети нет)");
  }) as typeof fetch;
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));

  const sr = 16000;
  const tone = (ms: number) => Float32Array.from({ length: (sr * ms) / 1000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr));
  const fake: RawProvider = {
    name: "fake",
    output: "wav",
    resolveVoice: () => "v",
    configKey: () => "k",
    synthesizeRaw: async (): Promise<{ kind: "pcm"; audio: PcmAudio }> => ({ kind: "pcm", audio: { sampleRate: sr, channels: [tone(1500)] } }),
  };

  try {
    await test("без модели и сети: alignByAsr → null, одно понятное предупреждение", async () => {
      assert.equal(await alignByAsr(TEXT, tone(1000), sr, 1000, "s1"), null);
      assert.equal(await alignByAsr(TEXT, tone(1000), sr, 1000, "s2"), null);
      assert.equal(fetches, 1, "вторая сцена не пытается качать снова");
      const w = warnings.filter((x) => x.includes("Тайминги слов по речи недоступны"));
      assert.equal(w.length, 1);
      assert.match(w[0]!, /CAPTION_ALIGN=0/);
    });

    await test("озвучка без модели: сборка не падает, тайминги — оценка по звуку", async () => {
      const p = wrapProvider(fake);
      const base = path.join(tmp, "voice", "s1");
      const r = await p.synthesize("Раз два три.", base);
      assert.equal(r.wordsSource, "estimated");
      assert.equal(r.words.length, 3);
      // В кэше нет пометки «пробовали» — когда модель появится, запись доуточнится.
      const entry = JSON.parse(await readFile(base + ".voice.json", "utf8")) as { wordsSource: string; alignTried?: boolean };
      assert.equal(entry.wordsSource, "estimated");
      assert.equal(entry.alignTried, undefined);
    });

    await test("старая запись кэша (*.voice.json) без модели читается как есть", async () => {
      const dir = path.join(tmp, "old");
      await mkdir(dir, { recursive: true });
      const p = wrapProvider(fake);
      const base = path.join(dir, "s2");
      const first = await p.synthesize("Четыре пять.", base);
      const cached = await p.synthesize("Четыре пять.", base);
      assert.equal(cached.cached, true);
      assert.deepEqual(cached.words, first.words);
      await writeFile(base + ".wav", encodeWav16({ sampleRate: sr, channels: [tone(800)] })); // файл на месте
      assert.equal((await p.synthesize("Четыре пять.", base)).wordsSource, "estimated");
    });

    await test("общий кэш: слова по речи хранятся в записи и читаются без распознавания", async () => {
      const dir = path.join(tmp, "shared");
      process.env.TTS_CACHE_DIR = dir;
      const clean = "Пять шесть.";
      const aligned = [
        { text: "Пять", startMs: 300, endMs: 700 },
        { text: "шесть.", startMs: 800, endMs: 1300 },
      ];
      await writeShared(dir, `fake|v|k|${clean}`, { kind: "pcm", audio: { sampleRate: sr, channels: [tone(1500)] }, aligned }, { provider: "fake", voice: "v", chars: clean.length });
      const back = await readShared(dir, `fake|v|k|${clean}`);
      assert.deepEqual(back?.kind === "pcm" ? back.aligned : null, aligned);
      const before = fetches;
      const r = await wrapProvider(fake).synthesize(clean, path.join(tmp, "shared-out", "s1"));
      assert.equal(r.cached, true);
      assert.equal(r.wordsSource, "aligned");
      assert.equal(fetches, before, "модель не понадобилась");
      // Слова сдвигаются вместе с обрезкой тишины (здесь её нет), промежутки те же.
      assert.ok(r.words[0]!.startMs <= 300);
      assert.equal(r.words[1]!.startMs - r.words[0]!.startMs, 500);
      process.env.TTS_CACHE_DIR = "none";
    });
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nВсе проверки выравнивания пройдены: ${passed}.`);
}

main().catch((e: unknown) => {
  console.error(e);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
