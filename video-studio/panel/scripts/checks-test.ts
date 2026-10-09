// Офлайн-проверка «Перед загрузкой проверьте» (lib/checks.ts): разбор qc.json и description.txt
// релиза и итоговые строки карточки. Описания и отчёт QC собирает сам конвейер (meta.ts, qc.ts) —
// так разбор проверяется на настоящем формате, а не на выдуманном. Сеть не нужна.
// Запуск из папки video-studio: npx tsx panel/scripts/checks-test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { channelFromJson } from "../../src/pipeline/channel";
import { buildYoutubeMeta, descriptionTxt, voiceCreditLine } from "../../src/pipeline/meta";
import type { Credit } from "../../src/pipeline/contracts";
import type { VideoScript } from "../../src/types";
import {
  expectedVoice,
  parseCredits,
  parseQc,
  releaseChecks,
  voiceDiffers,
  type CheckContext,
  type CreditFacts,
  type FileFacts,
  type QcFacts,
  type ReleaseFacts,
} from "../lib/checks";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const channel = channelFromJson(JSON.parse(fs.readFileSync(path.join(studio, "channel.json"), "utf8")));
const demo = JSON.parse(fs.readFileSync(path.join(studio, "examples", "demo-ru.json"), "utf8")) as VideoScript;
// qc.ts тянет @remotion/renderer (он есть только в node_modules video-studio): путь — строкой,
// чтобы проверка типов панели его не разбирала. Загружается в main (скрипты панели — CommonJS,
// await на верхнем уровне нельзя).
type EvaluateQc = (input: Record<string, unknown>, mode?: "fail" | "warn") => { id: string; severity: "error" | "warn"; message: string }[];
let evaluateQc: EvaluateQc = () => {
  throw new Error("qc.ts ещё не загружен");
};

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ---- данные как у конвейера ----

const CHARON = { provider: "gemini", name: "Charon" };
const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({ voice: CHARON, stockKeysMissing: false, ...over });

const pexelsVideo: Credit = { provider: "Pexels", author: "Ann", url: "https://www.pexels.com/video/clip-333/" };
const pexelsPhoto: Credit = { provider: "Pexels", author: "Bob", url: "https://www.pexels.com/photo/p-77/" };
const pixabay: Credit = { provider: "Pixabay", author: "cat", url: "https://pixabay.com/videos/clip-5/" };
const wiki = (n: number): Credit => ({ provider: "Wikimedia Commons", author: `Автор ${n} (CC BY-SA 4.0)`, url: `https://commons.wikimedia.org/wiki/File:Photo_${n}.jpg` });

// description.txt ровно как его пишет make.ts: buildYoutubeMeta → descriptionTxt.
function descriptionOf(credits: Credit[], over: { script?: Partial<VideoScript>; voice?: string | null } = {}): string {
  const meta = buildYoutubeMeta({ script: { ...demo, ...over.script }, format: "shorts", visualCredits: credits, musicCredit: null, voiceProvider: "gemini", channel });
  const text = descriptionTxt(meta);
  // До 08.10.2026 в описании была строка «Озвучка: …» — её подставляем там, где была.
  return over.voice ? text.replace("\nТЕГИ", `\n${over.voice}\n\nТЕГИ`) : text;
}

const PROBE = {
  durationSec: 52.4,
  sizeBytes: 31_000_000,
  bitrateKbps: 9200,
  videoBitrateKbps: 9000,
  width: 1080,
  height: 1920,
  videoCodec: "h264",
  pixFmt: "yuv420p",
  fps: 30,
  audioCodec: "aac",
  sampleRate: 48000,
  channels: 2,
  audioBitrateKbps: 192,
};
const AUDIO = { meanVolumeDb: -20, maxVolumeDb: -1.5, integratedLufs: -14.2, truePeakDbtp: -1.2, loudnessRangeLu: 5 };

// qc.json как его пишет writeQc: отчёт runQc с замечаниями evaluateQc.
function qcJson(over: { probe?: Partial<typeof PROBE>; audio?: Partial<typeof AUDIO>; silences?: { start: number; end: number; duration: number }[]; voice?: unknown; extraIssues?: unknown[] } = {}): string {
  const base = {
    expected: { durationSec: 52.4, width: 1080, height: 1920, fps: 30 },
    probe: { ...PROBE, ...over.probe },
    audio: { ...AUDIO, ...over.audio },
    silences: over.silences ?? [],
    blacks: [],
  };
  const issues = [...evaluateQc(base), ...(over.extraIssues ?? [])] as { severity: string }[];
  const report = { file: "video.mp4", checkedAt: "2026-10-09T10:00:00.000Z", ok: !issues.some((i) => i.severity === "error"), ...base, issues, ...(over.voice ? { voice: over.voice } : {}) };
  return JSON.stringify(report, null, 2) + "\n";
}

const ok = <T>(data: T): FileFacts<T> => ({ state: "ok", data });
const facts = (qc: FileFacts<QcFacts>, credits: FileFacts<CreditFacts>): ReleaseFacts => ({ qc, credits });
const qcOk = (text: string) => ok(parseQc(text)!);
const creditsOk = (text: string) => ok(parseCredits(text));
const texts = (lines: { text: string }[]) => lines.map((l) => l.text).join("\n");

// ---- qc.json ----

test("qc.json: чистый отчёт — ни одного замечания, голос не записан (старый формат)", () => {
  const q = parseQc(qcJson());
  assert.ok(q);
  assert.equal(q.ok, true);
  assert.deepEqual(q.issues, []);
  assert.equal(q.voice, null);
});

test("qc.json: замечания конвейера — ошибка нет звука, тишина, битрейт; ok=false", () => {
  const q = parseQc(qcJson({ probe: { audioCodec: null as unknown as string, videoBitrateKbps: 3000 }, silences: [{ start: 10, end: 12.5, duration: 2.5 }] }))!;
  assert.equal(q.ok, false);
  assert.deepEqual(q.issues.map((i) => [i.id, i.severity]), [
    ["no-audio", "error"],
    ["bitrate", "warn"],
    ["silence", "warn"],
  ]);
  const lines = releaseChecks(facts(ok(q), creditsOk(descriptionOf([pexelsVideo]))), ctx());
  assert.equal(lines[0]!.level, "error");
  assert.match(lines[0]!.text, /^QC: В файле нет звуковой дорожки/, "первая буква заглавная");
  assert.match(texts(lines), /QC: Тишина 2\.5 с/);
});

test("qc.json: битый, обрезанный или не отчёт QC — null (маршрут покажет «не прочитать»)", () => {
  assert.equal(parseQc("{"), null);
  assert.equal(parseQc(qcJson().slice(0, 300)), null);
  assert.equal(parseQc('{"name":"другой файл"}'), null);
  assert.equal(parseQc("[]"), null);
  // Мусор в замечаниях не роняет разбор.
  assert.deepEqual(parseQc('{"ok":true,"issues":[null,{"message":""},{"id":"x","message":"нечто","severity":"???"}]}')!.issues, [{ id: "x", severity: "warn", message: "нечто" }]);
});

test("qc.json: больше 5 замечаний — 5 строк и «ещё N»", () => {
  const silences = Array.from({ length: 7 }, (_, i) => ({ start: i * 5, end: i * 5 + 2, duration: 2 }));
  const lines = releaseChecks(facts(qcOk(qcJson({ silences })), creditsOk(descriptionOf([pexelsVideo]))), ctx());
  const qc = lines.filter((l) => l.text.startsWith("QC:"));
  assert.equal(qc.length, 6);
  assert.match(qc.at(-1)!.text, /ещё 2 — полный список в qc\.json/);
});

// ---- голос ----

test("голос: qc.json.voice — запасной Edge вместо Gemini; замечание voice-fallback не дублируется", () => {
  const voice = { provider: "edge", name: "ru-RU-DmitryNeural", model: null, requested: "gemini", fallback: true, modelFallback: false, reason: "квота Gemini закончилась" };
  const extra = { id: "voice-fallback", severity: "warn", message: "озвучено запасным голосом edge (ru-RU-DmitryNeural) вместо gemini — квота." };
  const q = parseQc(qcJson({ voice, extraIssues: [extra] }))!;
  assert.deepEqual(q.voice, { provider: "edge", name: "ru-RU-DmitryNeural", requested: "gemini", fallback: true, reason: "квота Gemini закончилась" });
  const lines = releaseChecks(facts(ok(q), creditsOk(descriptionOf([pexelsVideo]))), ctx());
  const all = texts(lines);
  assert.match(all, /Озвучено запасным голосом Edge · ru-RU-DmitryNeural вместо Gemini \(квота Gemini закончилась\)\. Пересоберите/);
  assert.doesNotMatch(all, /QC: Озвучено запасным/);
  assert.equal(lines.filter((l) => /запасн/i.test(l.text)).length, 1);
});

test("голос: основной, но не голос канала — предупреждение; тот же — «Голос: Gemini · Charon»", () => {
  const other = parseQc(qcJson({ voice: { provider: "gemini", name: "Puck", requested: "gemini", fallback: false } }))!;
  assert.match(texts(releaseChecks(facts(ok(other), creditsOk(descriptionOf([pexelsVideo]))), ctx())), /Голос Gemini · Puck, а у канала — Gemini · Charon\. Если это не нарочно/);
  const same = parseQc(qcJson({ voice: { provider: "gemini", name: "charon", requested: "gemini", fallback: false } }))!;
  const lines = releaseChecks(facts(ok(same), creditsOk(descriptionOf([pexelsVideo]))), ctx());
  assert.ok(lines.some((l) => l.level === "ok" && l.text === "Голос: Gemini · charon."));
  // fallback не указан, но провайдер не тот, что просили, — тоже запасной.
  assert.equal(parseQc(qcJson({ voice: { provider: "piper", requested: "gemini" } }))!.voice?.fallback, true);
  assert.equal(parseQc(qcJson({ voice: { provider: "edge", requested: "auto" } }))!.voice?.fallback, false);
});

test("голос: из строки «Озвучка: …» старых описаний, если в qc.json его нет", () => {
  const desc = descriptionOf([pexelsVideo], { voice: voiceCreditLine("edge", "ru-RU-SvetlanaNeural") });
  const c = parseCredits(desc);
  assert.deepEqual(c.voice, { provider: "edge", name: "ru-RU-SvetlanaNeural", requested: null, fallback: false, reason: null });
  assert.equal(parseCredits(descriptionOf([], { voice: voiceCreditLine("gemini") })).voice?.provider, "gemini");
  assert.match(texts(releaseChecks(facts(qcOk(qcJson()), ok(c)), ctx())), /Голос Edge · ru-RU-SvetlanaNeural, а у канала — Gemini · Charon/);
});

test("голос неизвестен — подсказка послушать, каким должен быть", () => {
  const lines = releaseChecks(facts(qcOk(qcJson()), creditsOk(descriptionOf([pexelsVideo]))), ctx());
  assert.ok(lines.some((l) => l.level === "info" && l.text === "Каким голосом озвучено, в релизе не записано — послушайте начало: должен быть Gemini · Charon."));
});

test("голос, который нужен: канал из channel.json, рубрика из voiceByPillar сильнее", () => {
  assert.deepEqual(expectedVoice(channel, "space"), CHARON);
  const withPillar = { ...channel, voiceByPillar: { tech: { provider: null, voice: "ru-RU-DmitryNeural", rate: "+5%", style: null }, history: { provider: "piper", voice: null, rate: null, style: null } } };
  assert.deepEqual(expectedVoice(withPillar, "tech"), { provider: "edge", name: "ru-RU-DmitryNeural" });
  assert.deepEqual(expectedVoice(withPillar, "history"), { provider: "piper", name: null });
  assert.deepEqual(expectedVoice(withPillar, "mind"), CHARON);
  assert.equal(expectedVoice({ voice: { provider: null, name: null, style: null }, voiceByPillar: {} }, "mind"), null);
  assert.equal(voiceDiffers({ provider: "gemini", name: null }, CHARON), false, "имя неизвестно — сравниваем только провайдера");
  assert.equal(voiceDiffers({ provider: "edge", name: null }, CHARON), true);
});

// ---- кадры: блок «Видео и фото» ----

test("кадры: видео Pexels и Pixabay, фото Pexels и Wikimedia — всё в порядке", () => {
  const c = parseCredits(descriptionOf([pexelsVideo, pexelsPhoto, pixabay, wiki(1), null as unknown as Credit]));
  assert.equal(c.block, true);
  assert.deepEqual([c.stockVideo, c.stockPhoto, c.stockOther, c.archive, c.hidden], [2, 1, 0, 1, 0]);
  assert.deepEqual(c.providers, [
    { name: "Pexels", count: 2 },
    { name: "Pixabay", count: 1 },
    { name: "Wikimedia Commons", count: 1 },
  ]);
  const line = releaseChecks(facts(qcOk(qcJson()), ok(c)), ctx()).find((l) => l.text.startsWith("Кадры"));
  assert.deepEqual(line, { level: "ok", text: "Кадры: видео — 2, фото — 2 (Pexels 2, Pixabay 1, Wikimedia Commons 1)." });
});

test("кадры только из Wikimedia (как 10a–12b) — предупреждение с подсказкой про ключи стоков", () => {
  const c = parseCredits(descriptionOf([wiki(1), wiki(2), wiki(3)]));
  assert.deepEqual([c.stockVideo, c.stockPhoto, c.archive], [0, 0, 3]);
  const f = facts(qcOk(qcJson()), ok(c));
  const missing = releaseChecks(f, ctx({ stockKeysMissing: true })).find((l) => l.text.startsWith("Кадры"))!;
  assert.equal(missing.level, "warn");
  assert.match(missing.text, /^Кадры только из Wikimedia Commons \(3 фото\), стокового видео нет — такие фото часто мимо темы\. В секретах GitHub нет PEXELS_API_KEY и PIXABAY_API_KEY/);
  assert.match(texts(releaseChecks(f, ctx({ stockKeysMissing: false }))), /Ключи стоков уже заданы — пересборка подберёт видео заново/);
  assert.match(texts(releaseChecks(f, ctx({ stockKeysMissing: null }))), /нужны PEXELS_API_KEY или PIXABAY_API_KEY/);
});

test("кадры: только фото Pexels — «стокового видео нет»", () => {
  const line = releaseChecks(facts(qcOk(qcJson()), creditsOk(descriptionOf([pexelsPhoto, wiki(1)]))), ctx()).find((l) => l.text.startsWith("Стокового"))!;
  assert.equal(line.level, "warn");
  assert.match(line.text, /только фото \(Pexels 1, Wikimedia Commons 1\)/);
});

test("кадры: блока нет (как 01a–09b) — «нет ни видео, ни фото»; только ИИ — просто сведение", () => {
  const none = releaseChecks(facts(qcOk(qcJson()), creditsOk(descriptionOf([]))), ctx({ stockKeysMissing: true }));
  assert.ok(none.some((l) => l.level === "warn" && /^В ролике нет ни видео, ни фото — только графика/.test(l.text)));
  const ai = parseCredits(descriptionOf([{ provider: "Cloudflare FLUX.1 schnell", author: null, url: null }]));
  assert.equal(ai.block, false);
  assert.equal(ai.ai, "Cloudflare FLUX.1 schnell");
  assert.ok(releaseChecks(facts(qcOk(qcJson()), ok(ai)), ctx()).some((l) => l.level === "info" && l.text === "Кадры — только картинки ИИ (Cloudflare FLUX.1 schnell)."));
});

test("кадры: длинное описание свернуло строки в «… и ещё N источников (…)»", () => {
  const credits = [pexelsVideo, ...Array.from({ length: 60 }, (_, i) => wiki(i)), pexelsPhoto];
  const desc = descriptionOf(credits, { script: { description: "Очень длинный текст ролика. ".repeat(60) } });
  const c = parseCredits(desc);
  assert.ok(c.hidden > 0, "часть строк свёрнута");
  assert.equal(c.stockVideo + c.stockPhoto + c.archive + c.hidden, 62);
  assert.ok(c.hiddenProviders.includes("Wikimedia Commons"));
  const line = releaseChecks(facts(qcOk(qcJson()), ok(c)), ctx()).find((l) => l.text.startsWith("Кадры"))!;
  assert.equal(line.level, "ok");
});

test("кадры: описание канала на другом языке (Video and photos:)", () => {
  const c = parseCredits(descriptionOf([pixabay, wiki(1)], { script: { language: "en" } }));
  assert.equal(c.block, true);
  assert.deepEqual([c.stockVideo, c.archive], [1, 1]);
});

// ---- файлы релиза ----

test("старый релиз без qc.json и description.txt — три спокойные подсказки, без ошибок", () => {
  const lines = releaseChecks(facts({ state: "missing" }, { state: "missing" }), ctx());
  assert.deepEqual(lines.map((l) => l.level), ["info", "info", "info"]);
  assert.match(texts(lines), /Автопроверки \(qc\.json\) в релизе нет/);
  assert.match(texts(lines), /description\.txt в релизе нет/);
});

test("GitHub не отдал файл — строка с причиной, остальное показывается", () => {
  const lines = releaseChecks(facts({ state: "error", message: "GitHub не отвечает" }, creditsOk(descriptionOf([pexelsVideo]))), ctx());
  assert.match(texts(lines), /Автопроверку не прочитать \(GitHub не отвечает\)/);
  assert.ok(lines.some((l) => l.level === "ok" && l.text.startsWith("Кадры")));
});

test("порядок: ошибки, предупреждения, «проверьте сами», в конце — что в порядке", () => {
  const q = parseQc(qcJson({ probe: { audioCodec: null as unknown as string } }))!;
  const lines = releaseChecks(facts(ok(q), creditsOk(descriptionOf([wiki(1)]))), ctx());
  const rank = { error: 0, warn: 1, info: 2, ok: 3 };
  assert.deepEqual(lines.map((l) => rank[l.level]), [...lines.map((l) => rank[l.level])].sort((a, b) => a - b));
  const clean = releaseChecks(facts(qcOk(qcJson({ voice: { provider: "gemini", name: "Charon", requested: "gemini", fallback: false } })), creditsOk(descriptionOf([pexelsVideo]))), ctx());
  assert.deepEqual(clean.map((l) => l.level), ["ok", "ok", "ok"]);
  assert.equal(clean[0]!.text, "Автопроверка пройдена: длительность, кадр и звук в порядке.");
});

async function main() {
  ({ evaluateQc } = (await import(pathToFileURL(path.join(studio, "src", "pipeline", "qc.ts")).href)) as { evaluateQc: EvaluateQc });
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}`);
      throw e;
    }
  }
  console.log(`\nВсе проверки «Перед загрузкой проверьте» пройдены: ${tests.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
