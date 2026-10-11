// Проверка без сети и без рендера: QC (разбор ffprobe/loudnorm, тишина, чёрные
// кадры, оценка), числа в экранном тексте, кадры звуков сцены, звуки монтажа,
// голос по рубрике и бренд-заставка из channel.json, настройки кодирования,
// темп склеек (тишина между сценами, хвост финала) и страницы субтитров по сценам.
// Запуск: npx tsx src/dev/media-test.ts

import assert from "node:assert/strict";
import { synthImpact, synthPop, synthRise, synthSting } from "../pipeline/audio/sfx";
import { levelStats } from "../pipeline/audio/dsp";
import { applyPillarVoice, brandIntroEnabled, channelFromJson } from "../pipeline/channel";
import { analyzePcm, evaluateQc, findBlacks, parseLoudnorm, parseProbe, type QcEncoder, type QcProbe } from "../pipeline/qc";
import { encoderOptions, encoderSettings } from "../pipeline/render";
import { KEEP_LEAD_MS, KEEP_TAIL_MS, postprocessVoice } from "../pipeline/voice/provider";
import { captionPages } from "../remotion/lib/caption-pages";
import { WHOOSH_VARIANTS, synthWhoosh } from "../pipeline/audio/whoosh";
import { WHOOSH_LEAD_FRAMES, WHOOSH_UNDER_VOICE, isNumeralWord, spokenNumberRun, statCountWindow, STAT_FALLBACK, whooshDuck } from "../remotion/lib/cues";
import { formatLike, formatNumber, isThousandsTail, isYearNumber, numberInfo } from "../remotion/lib/numbers";
import {
  CHAPTER_CARD_FRAMES,
  DEFAULT_TRANSITION_FRAMES,
  FINAL_TAIL_FRAMES,
  FPS,
  SCENE_LEAD_FRAMES,
  VOICE_GAP_FRAMES,
  buildTimelineCaptions,
  layoutScenes,
  type WordTiming,
} from "../types";

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

await test("Крупная цифра: разряды по-русски с 5 цифр, годы не делим и не докручиваем", () => {
  const nb = "\u202f"; // узкий неразрывный пробел — разделитель русского
  // По-русски (и без языка — старые props) четырёхзначные не делят.
  assert.equal(formatNumber(2560, 0, "ru"), "2560");
  assert.equal(formatNumber(3800, 0, undefined), "3800", "плашка 01b: «>3800 лет»");
  assert.equal(formatNumber(9999, 0, "ru"), "9999");
  assert.equal(formatNumber(12500, 0, "ru"), `12${nb}500`);
  assert.equal(formatNumber(1250000, 0, "ru"), `1${nb}250${nb}000`);
  assert.equal(formatNumber(1234.5, 1, "ru"), "1234,5");
  assert.equal(formatNumber(149.6, 1, "ru"), "149,6");
  assert.equal(formatNumber(-2560, 0, "ru"), "−2560");
  // Английский — как раньше (с 4 цифр), кроме годов.
  assert.equal(formatNumber(3800, 0, "en"), "3,800");
  assert.equal(formatNumber(1096, 0, "en", true), "1096", "год по-английски без запятой");
  assert.equal(formatNumber(12500, 0, "en", true), "12,500", "пятизначный «год» делим как число");
  assert.equal(formatNumber(1250.5, 1, "en"), "1,250.5");
  // Годы из сценариев: 12b (сравнение « г.» и голое 1096 по речи), 09a (« до н. э.»).
  assert.ok(isYearNumber(1096, "", " г."));
  assert.ok(isYearNumber(2560, "≈", " до н. э."));
  assert.ok(isYearNumber(2560, "≈", " до н.э."));
  assert.ok(isYearNumber(1428, "", " гг."));
  assert.ok(isYearNumber(1096, "", " году"));
  assert.ok(isYearNumber(1066, "", " AD") && isYearNumber(30, "", " BC") && isYearNumber(500, "", " BCE") && isYearNumber(1066, "", " CE"));
  assert.ok(isYearNumber(1096, "", "", "Преподавание здесь шло уже с тысяча девяносто шестого года."), "12b s3");
  assert.ok(isYearNumber(2020, "", "", "В двадцатом году Жиньяк и Заенковский…"), "L01 s29");
  // Не годы: сроки, граммы, градусы, обычные числа.
  assert.ok(!isYearNumber(332, "", " года"), "12b s6 — срок, а не дата");
  assert.ok(!isYearNumber(392, "≈", " года"));
  assert.ok(!isYearNumber(3800, ">", " лет"));
  assert.ok(!isYearNumber(1998, "", " лет", "Меньше двух тысяч лет."));
  assert.ok(!isYearNumber(1500, "", " г"), "«г» без точки — граммы");
  assert.ok(!isYearNumber(460, ">", " °C"));
  assert.ok(!isYearNumber(1, "до ", "%"));
  assert.ok(!isYearNumber(2048, "", "", "Точнее, две тысячи сорок восемь слов оперативной памяти."), "11a s2 — счётчик остаётся");
  assert.ok(!isYearNumber(2000, "", "", "Две тысячи человек в год."), "«в год» — не дата");
  assert.ok(!isYearNumber(4000, "", "", "В двадцать первом году повторили на четырёх тысячах человек."), "4000 — не календарный год");
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

await test("QC: при постоянном качестве (CRF ≤ 18) низкий средний битрейт — не замечание", () => {
  // qc.json релиза 13b: CRF 15, preset slow (SEI x264 в mp4), 7,1 Мбит/с — QC ругался ложно.
  const probe: QcProbe = { durationSec: 63.616, sizeBytes: 58474712, bitrateKbps: 7353, videoBitrateKbps: 7064, width: 1080, height: 1920, videoCodec: "h264", pixFmt: "yuv420p", fps: 30, audioCodec: "aac", sampleRate: 48000, channels: 2, audioBitrateKbps: 283 };
  const base = {
    expected: { durationSec: 63.6, width: 1080, height: 1920, fps: 30 },
    probe,
    audio: { meanVolumeDb: -19.6, maxVolumeDb: -1.5, integratedLufs: -16.25, truePeakDbtp: -1.47, loudnessRangeLu: 4.2 },
    silences: [],
    blacks: [],
  };
  const ids = (encoder?: QcEncoder) => evaluateQc(encoder ? { ...base, encoder } : base).map((i) => i.id);
  const pick = (s: ReturnType<typeof encoderSettings>): QcEncoder => ({ quality: s.quality, crf: s.crf, videoBitrate: s.videoBitrate, x264Preset: s.x264Preset });
  assert.deepEqual(ids(), ["bitrate"], "кодировщик неизвестен (старый вызов) — как раньше");
  assert.deepEqual(ids(pick(encoderSettings({}))), [], "high = CRF 15");
  assert.deepEqual(ids(pick(encoderSettings({ VIDEO_CRF: "18" }))), [], "граница CRF 18");
  assert.deepEqual(ids(pick(encoderSettings({ VIDEO_QUALITY: "standard" }))), ["bitrate"], "CRF 21 — уже с потерями");
  assert.deepEqual(ids(pick(encoderSettings({ VIDEO_BITRATE: "6M" }))), ["bitrate"], "средний поток ниже порога — замечание по делу");
  // При CRF битрейт не проверяется вовсе; битый ролик ловят другие проверки — их CRF не глушит.
  const broken = evaluateQc({ ...base, encoder: pick(encoderSettings({})), probe: { ...probe, videoBitrateKbps: 300, durationSec: 30 } });
  assert.deepEqual(broken.map((i) => `${i.id}:${i.severity}`), ["duration:error"]);
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

// ---- Темп склеек: тишина между сценами, хвост финала, субтитры ----

// Кадры от конца голоса сцены i до начала голоса сцены i+1.
const voiceGaps = (laid: ReturnType<typeof layoutScenes<{ audioDurationMs: number }>>) =>
  laid.scenes.slice(1).map((s, i) => {
    const prev = laid.scenes[i]!;
    const prevEnd = prev.startFrame + prev.audioStartFrame + Math.ceil((prev.audioDurationMs / 1000) * FPS);
    return s.startFrame + s.audioStartFrame - prevEnd;
  });

await test("Темп: между репликами сцен ≈ 0,2 с, у финала нет лишней секунды", () => {
  const scenes = [{ audioDurationMs: 2990 }, { audioDurationMs: 7175 }, { audioDurationMs: 4632 }, { audioDurationMs: 2780 }];
  const laid = layoutScenes(scenes);
  assert.deepEqual(voiceGaps(laid), [VOICE_GAP_FRAMES, VOICE_GAP_FRAMES, VOICE_GAP_FRAMES]);
  assert.equal(laid.scenes[0]!.audioStartFrame, SCENE_LEAD_FRAMES, "хук звучит почти с первого кадра");
  const last = laid.scenes.at(-1)!;
  assert.equal(last.durationInFrames - last.audioStartFrame - Math.ceil((2780 / 1000) * FPS), FINAL_TAIL_FRAMES);
  assert.ok(FINAL_TAIL_FRAMES >= 10 && FINAL_TAIL_FRAMES <= 15, "финал: 10–15 кадров после голоса");
  // Тишина на склейке целиком: хвост файла + промежуток + начало следующего файла.
  const deadAirMs = KEEP_TAIL_MS + (VOICE_GAP_FRAMES / FPS) * 1000 + KEEP_LEAD_MS;
  assert.ok(deadAirMs >= 150 && deadAirMs <= 250, `тишина на склейке ${deadAirMs} мс`);
  // Было: пауза до голоса 8 + хвост 14 − переход 12 кадров, хвост 180 мс, финал +30 кадров.
  const oldFrames = scenes.reduce((s, sc) => s + 8 + Math.ceil((sc.audioDurationMs / 1000) * FPS) + 14, 0) + FPS - (scenes.length - 1) * DEFAULT_TRANSITION_FRAMES;
  assert.ok(oldFrames - laid.durationInFrames >= 50, `короче на ${oldFrames - laid.durationInFrames} кадров`);
});

await test("Темп: голоса не наложатся при любом переходе; карточка главы — пауза", () => {
  for (const t of [0, 4, 12, 20, 30]) {
    const laid = layoutScenes([{ audioDurationMs: 1000 }, { audioDurationMs: 1500 }, { audioDurationMs: 800 }], t);
    for (const g of voiceGaps(laid)) assert.ok(g >= VOICE_GAP_FRAMES && g <= VOICE_GAP_FRAMES + SCENE_LEAD_FRAMES, `переход ${t}: промежуток ${g}`);
    const sum = laid.scenes.reduce((s, sc) => s + sc.durationInFrames, 0) - (laid.scenes.length - 1) * t;
    assert.equal(sum, laid.durationInFrames, `переход ${t}: сумма сцен сходится (Video.tsx)`);
  }
  const ch = layoutScenes([{ audioDurationMs: 1000 }, { audioDurationMs: 1000, chapter: "Глава" }]);
  assert.deepEqual(voiceGaps(ch), [VOICE_GAP_FRAMES + CHAPTER_CARD_FRAMES]);
});

await test("Свист перехода: пик в паузе, под первым словом новой сцены — тише на ≥ 10 дБ", () => {
  assert.equal(whooshDuck(0, 7), 1);
  assert.equal(whooshDuck(7, 7), 1, "до голоса — в полную силу");
  assert.equal(whooshDuck(9, 7), WHOOSH_UNDER_VOICE);
  assert.equal(whooshDuck(100, 7), WHOOSH_UNDER_VOICE);
  // Раскладка как в композиции (AudioLayer): свист — за WHOOSH_LEAD_FRAMES до склейки.
  const laid = layoutScenes([{ audioDurationMs: 2000 }, { audioDurationMs: 2000 }]);
  const next = laid.scenes[1]!;
  const voiceAt = next.startFrame + next.audioStartFrame - (next.startFrame - WHOOSH_LEAD_FRAMES);
  const speechMs = (voiceAt / FPS) * 1000 + KEEP_LEAD_MS; // речь — после тишины в начале файла
  for (const [k, v] of WHOOSH_VARIANTS.entries()) {
    const { sampleRate: sr, channels } = synthWhoosh(24000, v);
    const win = Math.round(sr * 0.01);
    const rmsDb = (fromMs: number, toMs: number, duck: boolean) => {
      let s = 0;
      let n = 0;
      for (let i = Math.max(0, Math.round((fromMs / 1000) * sr)); i < Math.min(channels[0]!.length, Math.round((toMs / 1000) * sr)); i++) {
        const g = duck ? whooshDuck((i / sr) * FPS, voiceAt) : 1;
        s += (channels[0]![i]! * g) ** 2;
        n++;
      }
      return n ? 10 * Math.log10(s / n + 1e-12) : -120;
    };
    let peak = -120;
    for (let ms = 0; ms + 10 <= (channels[0]!.length / sr) * 1000; ms += 10) peak = Math.max(peak, rmsDb(ms, ms + (win / sr) * 1000, false));
    const under = rmsDb(speechMs, speechMs + 200, true);
    assert.ok(under <= peak - 10, `вариант ${k + 1}: под первым словом ${(under - peak).toFixed(1)} дБ от пика`);
  }
});

await test("Голос: по краям речи остаётся 60 мс до и 120 мс после", () => {
  const sr = 24000;
  const at = (ms: number) => Math.round((ms / 1000) * sr);
  const pcm = new Float32Array(at(2300));
  // «Речь» — 1 с тона 1 кГц с огибающей слогов между 0,5 и 1,5 с.
  for (let i = at(500); i < at(1500); i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / sr) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / sr));
  const { audio, shiftMs } = postprocessVoice({ sampleRate: sr, channels: [pcm] });
  const outMs = (audio.channels[0]!.length / sr) * 1000;
  assert.ok(Math.abs(shiftMs - (500 - KEEP_LEAD_MS)) <= 15, `срез в начале ${shiftMs} мс`);
  assert.ok(Math.abs(outMs - (1000 + KEEP_LEAD_MS + KEEP_TAIL_MS)) <= 25, `длина ${outMs} мс`);
});

await test("Субтитры: страница не переходит через склейку", () => {
  const w = (text: string, startMs: number, endMs: number): WordTiming => ({ text, startMs, endMs });
  // Конец первой сцены и начало второй ближе BREAK_ON_SILENCE_MS — раньше были бы одной страницей.
  const laid = layoutScenes([
    { audioDurationMs: 1300, words: [w("Мозг", 0, 300), w("экономит.", 700, 1180)] },
    { audioDurationMs: 900, words: [w("Это", 60, 250), w("нормально.", 270, 800)] },
  ]);
  const captions = buildTimelineCaptions(laid.scenes);
  const merged = captionPages(captions);
  assert.ok(merged.some((p) => p.tokens.some((t) => t.text.includes("экономит")) && p.tokens.some((t) => t.text.includes("Это"))), "без сцен страница склеилась бы");
  const pages = captionPages(captions, laid.scenes);
  const boundaryMs = ((laid.scenes[1]!.startFrame + laid.scenes[1]!.audioStartFrame) / FPS) * 1000;
  for (const p of pages) {
    const first = p.tokens[0]!.fromMs;
    const lastTo = p.tokens.at(-1)!.toMs;
    assert.ok(lastTo <= boundaryMs || first >= boundaryMs, `страница «${p.text}» на склейке`);
  }
  assert.deepEqual(pages.map((p) => p.text.trim()), ["Мозг", "экономит.", "Это нормально."]);
  assert.equal(captionPages([], laid.scenes).length, 0);

  // Тайминг провайдера «в минусе» (после обрезки тишины): слово не раньше своего
  // файла голоса и не уезжает на страницу прошлой сцены.
  const early = layoutScenes([
    { audioDurationMs: 1300, words: [w("Мозг", 0, 300), w("экономит.", 700, 1180)] },
    { audioDurationMs: 900, words: [w("Это", -90, 200), w("нормально.", 220, 800)] },
  ]);
  const earlyCaps = buildTimelineCaptions(early.scenes);
  const voice2 = ((early.scenes[1]!.startFrame + early.scenes[1]!.audioStartFrame) / FPS) * 1000;
  assert.equal(earlyCaps[2]!.startMs, Math.round(voice2), "слово сцены — не раньше её голоса");
  assert.deepEqual(captionPages(earlyCaps, early.scenes).map((p) => p.text.trim()), ["Мозг", "экономит.", "Это нормально."]);
});

console.log(`\nВсе проверки пройдены: ${passed}.`);
