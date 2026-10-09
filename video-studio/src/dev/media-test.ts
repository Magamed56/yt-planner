// Проверка без сети и без рендера: QC (разбор ffprobe/loudnorm, тишина, чёрные
// кадры, оценка), числа в экранном тексте, кадры звуков сцены, звуки монтажа,
// голос по рубрике и бренд-заставка из channel.json, настройки кодирования.
// Запуск: npx tsx src/dev/media-test.ts

import assert from "node:assert/strict";
import { synthImpact, synthPop, synthRise, synthSting } from "../pipeline/audio/sfx";
import { levelStats } from "../pipeline/audio/dsp";
import { applyPillarVoice, brandIntroEnabled, channelFromJson } from "../pipeline/channel";
import { analyzePcm, evaluateQc, findBlacks, parseLoudnorm, parseProbe, type QcProbe } from "../pipeline/qc";
import { encoderOptions, encoderSettings } from "../pipeline/render";
import { isNumeralWord, spokenNumberRun, statCountWindow, STAT_FALLBACK } from "../remotion/lib/cues";
import { formatLike, isThousandsTail, numberInfo } from "../remotion/lib/numbers";
import type { WordTiming } from "../types";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("Медиа: проверка без сети\n");

await test("Числа в тексте: что докручивать, что только подсветить", () => {
  const n = numberInfo("84%")!;
  assert.equal(n.value, 84);
  assert.equal(n.count, true);
  assert.deepEqual([n.hlStart, n.hlEnd], [0, 3], "знак % подсвечивается вместе с числом");
  const big = numberInfo("≈28 000")!;
  assert.equal(big.value, 28000);
  assert.equal(big.hlStart, 0, "≈ — вместе с числом");
  assert.equal(formatLike(big, 12345.6), "12 346", "разделитель тысяч как в оригинале");
  assert.equal(formatLike(numberInfo("3,5")!, 1.25), "1,3", "запятая и знаки после неё");
  assert.equal(numberInfo("1947.")!.count, false, "год — не количество");
  assert.equal(numberInfo("2/3")!.count, false, "дробь");
  assert.equal(numberInfo("12:00")!.count, false, "время");
  assert.equal(numberInfo("×3")!.count, false, "мелкое целое — только подсветка");
  assert.equal(numberInfo("слово"), null);
  assert.ok(isThousandsTail("28", "000"));
  assert.ok(isThousandsTail("1 000", "000"));
  assert.ok(!isThousandsTail("1947", "300"), "год + число — разные слова");
  assert.ok(!isThousandsTail("3,5", "000"));
});

const words = (list: string[]): WordTiming[] => list.map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 350 }));

await test("Счётчик stat-сцены по речи: самая длинная фраза из числительных", () => {
  assert.ok(isNumeralWord("двести") && isNumeralWord("сорок") && isNumeralWord("трёх") && isNumeralWord("процентов"));
  assert.ok(!isNumeralWord("стоит") && !isNumeralWord("семья") && !isNumeralWord("высоте"), "«сто»/«семь» — только целым словом");
  const w = words(["Один", "оборот", "занимает", "двести", "сорок", "три", "дня"]);
  assert.deepEqual(spokenNumberRun(w), { from: 3, to: 5 });
  const pct = words(["Двое", "из", "трёх", "и", "восемьдесят", "три", "процента", "врачей"]);
  assert.deepEqual(spokenNumberRun(pct, "%"), { from: 4, to: 6 }, "при % — фраза со словом «процент»");
  const year = words(["в", "тысяча", "восемьсот", "восемьдесят", "пятом", "году", "почти", "две", "трети"]);
  assert.deepEqual(spokenNumberRun(year), { from: 7, to: 7 }, "год пропускаем");
  const scene = { kind: "stat" as const, onScreen: "x", narration: "x", stat: { value: 243, label: "дня" }, audioStartFrame: 8, audioDurationMs: 3000, words: w, durationInFrames: 120 };
  const win = statCountWindow(scene, 30);
  // «три» кончается на 2350 мс → 8 + 70,5 кадра; +2 — цифра встаёт сразу после слова.
  assert.equal(win.end, 81);
  assert.ok(win.start >= 6 && win.end - win.start <= 66 && win.end - win.start >= 24, JSON.stringify(win));
  assert.deepEqual(statCountWindow({ ...scene, words: [] }, 30), STAT_FALLBACK, "без таймингов — прежнее окно");
});

await test("Звуки монтажа: длина, пик −6 dBFS, без NaN", () => {
  for (const [name, a, sec] of [
    ["pop", synthPop(44100), 0.12],
    ["impact", synthImpact(44100), 0.9],
    ["rise", synthRise(44100), 1.2],
    ["sting", synthSting(44100), 0.62],
  ] as const) {
    const s = levelStats(a.channels);
    assert.equal(s.nonFinite, 0, name);
    assert.ok(Math.abs(20 * Math.log10(s.peak) + 6) < 0.1, `${name}: пик ${s.peak}`);
    assert.ok(Math.abs(a.channels[0]!.length / 44100 - sec) < 0.01, name);
  }
});

await test("QC: разбор ffprobe и loudnorm", () => {
  const p = parseProbe({
    format: { duration: "36.733", size: "45000000", bit_rate: "9800000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p", avg_frame_rate: "30/1", bit_rate: "9450000" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, bit_rate: "320000" },
    ],
  });
  assert.deepEqual([p.width, p.height, p.fps, p.videoBitrateKbps, p.sampleRate, p.durationSec], [1080, 1920, 30, 9450, 48000, 36.733]);
  const ln = parseLoudnorm('...\n[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-14.20",\n\t"input_tp" : "-1.60",\n\t"input_lra" : "5.30"\n}\n');
  assert.deepEqual(ln, { integratedLufs: -14.2, truePeakDbtp: -1.6, loudnessRangeLu: 5.3 });
  assert.equal(parseLoudnorm('{"input_i" : "-inf"}').integratedLufs, null, "тишина");
});

await test("QC: тишина и чёрные кадры", () => {
  const sr = 1000;
  const pcm = new Float32Array(sr * 6);
  for (let i = 0; i < pcm.length; i++) pcm[i] = i < sr * 2 || i >= sr * 4 ? 0.3 * Math.sin(i) : 0;
  const a = analyzePcm(pcm, sr);
  assert.equal(a.silences.length, 1);
  assert.deepEqual([a.silences[0]!.start, a.silences[0]!.end], [2, 4]);
  assert.ok(a.maxDb > -11 && a.maxDb < -10, String(a.maxDb));
  // 10 кадров/с: 1 с обычной картинки, 0,8 с чёрного, 0,3 с чёрного (короче порога), 1 с картинки.
  const W = 4;
  const H = 4;
  const frame = (v: number) => Buffer.alloc(W * H, v);
  const frames = Buffer.concat([...Array(10).fill(frame(90)), ...Array(8).fill(frame(16)), frame(90), ...Array(3).fill(frame(16)), ...Array(10).fill(frame(90))]);
  const b = findBlacks(frames, W, H, 10);
  assert.equal(b.length, 1);
  assert.deepEqual([b[0]!.start, b[0]!.duration], [1, 0.8]);
  // Тёмный фон темы (≈24) — не «чёрный».
  assert.equal(findBlacks(Buffer.concat(Array(20).fill(frame(24))), W, H, 10).length, 0);
});

await test("QC: что валит запуск, а что — предупреждение (в т.ч. битрейт < 8 Мбит/с)", () => {
  const probe: QcProbe = {
    durationSec: 36.7,
    sizeBytes: 15e6,
    bitrateKbps: 3400,
    videoBitrateKbps: 3080,
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    pixFmt: "yuv420p",
    fps: 30,
    audioCodec: "aac",
    sampleRate: 48000,
    channels: 2,
    audioBitrateKbps: 320,
  };
  const base = {
    expected: { durationSec: 36.7, width: 1080, height: 1920, fps: 30 },
    probe,
    audio: { meanVolumeDb: -20, maxVolumeDb: -1.5, integratedLufs: -14, truePeakDbtp: -1.5, loudnessRangeLu: 6 },
    silences: [],
    blacks: [],
  };
  const ok = evaluateQc(base);
  assert.deepEqual(ok.map((i) => `${i.id}:${i.severity}`), ["bitrate:warn"], "3 Мбит/с для 1080p — предупреждение");
  assert.equal(evaluateQc({ ...base, probe: { ...probe, videoBitrateKbps: 12000 } }).length, 0);
  const silent = evaluateQc({ ...base, probe: { ...probe, videoBitrateKbps: 12000 }, audio: { ...base.audio, maxVolumeDb: -70 } });
  assert.deepEqual(silent.map((i) => `${i.id}:${i.severity}`), ["silent:error"]);
  const short = evaluateQc({ ...base, probe: { ...probe, videoBitrateKbps: 12000, durationSec: 30 } });
  assert.deepEqual(short.map((i) => `${i.id}:${i.severity}`), ["duration:error"]);
  assert.deepEqual(evaluateQc({ ...base, probe: { ...probe, videoBitrateKbps: 12000, durationSec: 30 } }, "warn").map((i) => i.severity), ["warn"], "QC=warn");
  assert.deepEqual(evaluateQc({ ...base, probe: { ...probe, videoBitrateKbps: 12000, audioCodec: null } }).map((i) => i.id), ["no-audio"]);
});

await test("Голос по рубрике и бренд-заставка из channel.json", () => {
  const ch = channelFromJson({
    voice: { provider: "gemini", name: "Charon" },
    voiceByPillar: { note: "подсказка", history: { voice: "Kore", style: "неторопливо" }, tech: { provider: "edge", voice: "ru-RU-DmitryNeural", rate: "+5%" } },
  });
  assert.deepEqual(Object.keys(ch.voiceByPillar).sort(), ["history", "tech"], "«note» — не рубрика");
  const env: NodeJS.ProcessEnv = { TTS_PROVIDER: "auto" };
  assert.deepEqual(applyPillarVoice(ch, "tech", env), ["TTS_PROVIDER=edge", "TTS_VOICE=ru-RU-DmitryNeural", "TTS_RATE=+5%"]);
  const gem: NodeJS.ProcessEnv = {};
  applyPillarVoice(ch, "history", gem);
  assert.deepEqual([gem.GEMINI_TTS_VOICE, gem.GEMINI_TTS_STYLE, gem.TTS_PROVIDER], ["Kore", "неторопливо", undefined], "голос Gemini — по виду имени");
  const explicit: NodeJS.ProcessEnv = { TTS_PROVIDER: "piper", TTS_RATE: "-10%" };
  applyPillarVoice(ch, "tech", explicit);
  assert.deepEqual([explicit.TTS_PROVIDER, explicit.TTS_RATE], ["piper", "-10%"], "явные настройки сильнее рубрики");
  assert.deepEqual(applyPillarVoice(ch, "money", {}), [], "нет рубрики в списке — голос канала");
  assert.deepEqual(applyPillarVoice(ch, null, {}), []);
  assert.equal(channelFromJson({}).brandIntro, true, "по умолчанию заставка есть");
  assert.equal(channelFromJson({ brandIntro: false }).brandIntro, false);
  assert.equal(brandIntroEnabled({ brandIntro: true }, { BRAND_INTRO: "off" }), false);
  assert.equal(brandIntroEnabled({ brandIntro: false }, { BRAND_INTRO: "on" }), true);
});

await test("Кодирование: high по умолчанию, max — гарантированный поток, тонкая настройка", () => {
  const high = encoderSettings({});
  assert.deepEqual([high.quality, high.crf, high.x264Preset, high.gopSize, high.audioBitrate, high.sampleRate], ["high", 15, "slow", 15, "320k", 48000]);
  assert.equal("videoBitrate" in encoderOptions(high), false, "crf и videoBitrate вместе Remotion не принимает");
  const max = encoderOptions(encoderSettings({ VIDEO_QUALITY: "max" }));
  assert.equal("videoBitrate" in max ? max.videoBitrate : null, "16M");
  assert.equal("crf" in max, false);
  assert.equal(encoderSettings({ VIDEO_QUALITY: "standard" }).crf, 21);
  const custom = encoderSettings({ VIDEO_BITRATE: "12M", X264_PRESET: "slower" });
  assert.deepEqual([custom.crf, custom.videoBitrate, custom.encodingMaxRate, custom.x264Preset], [null, "12000K", "18000K", "slower"]);
  assert.equal(encoderSettings({ VIDEO_CRF: "14" }).crf, 14);
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
