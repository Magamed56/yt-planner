// Автоматическая проверка готового ролика (QC) — сразу после рендера, до
// загрузки: длительность против props, размер кадра, кодеки и битрейт, звук
// не тихий, нет долгой тишины и чёрных провалов, громкость (LUFS, true peak).
// Результат — qc.json в папке ролика и короткая сводка по-русски. Серьёзное
// (нет звука, не та длительность или размер, нет дорожки) валит запуск, прочее —
// предупреждения. QC=warn — только предупреждать, QC=off — не проверять.
//
// Только ffmpeg/ffprobe, которые везёт Remotion (системный не нужен). В его
// урезанной сборке нет volumedetect, blackdetect и ebur128, поэтому: уровень и
// тишину считаем сами по PCM (WAV в stdout), чёрные кадры — по уменьшенным
// серым кадрам (rawvideo через image2pipe, 10 кадров/с), громкость — loudnorm
// (тот же замер EBU R128: integrated, LRA, true peak).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RenderInternals } from "@remotion/renderer";
import { FORMAT_SIZE, FPS, type VideoProps } from "../types";
import { decodeWav, toMono } from "./audio/wav";
import type { VoiceUsed } from "./contracts";
import type { EncoderSettings } from "./render";

export type QcSeverity = "error" | "warn";

export interface QcIssue {
  id: string;
  severity: QcSeverity;
  message: string; // по-русски, с подсказкой
}

export interface QcProbe {
  durationSec: number | null;
  sizeBytes: number | null;
  bitrateKbps: number | null; // общий
  videoBitrateKbps: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  pixFmt: string | null;
  fps: number | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  audioBitrateKbps: number | null;
}

export interface QcAudio {
  meanVolumeDb: number | null; // RMS всего ролика, как volumedetect
  maxVolumeDb: number | null; // пик
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  loudnessRangeLu: number | null;
}

export interface QcSpan {
  start: number;
  end: number;
  duration: number;
}

// Чем кодировали (RenderResult.encoder): по одному битрейту не понять, мало ли это.
export type QcEncoder = Pick<EncoderSettings, "quality" | "crf" | "videoBitrate" | "x264Preset">;

export interface QcReport {
  file: string;
  checkedAt: string;
  ok: boolean; // нет ошибок (предупреждения допустимы)
  expected: { durationSec: number; width: number; height: number; fps: number };
  probe: QcProbe;
  audio: QcAudio;
  silences: QcSpan[]; // тишина > 1,5 с (без конца ролика)
  blacks: QcSpan[]; // чёрное > 0,5 с
  issues: QcIssue[];
  voice?: VoiceUsed; // кто озвучил (make дописывает): панель предупреждает о запасном голосе
  encoder?: QcEncoder; // нет — ролик проверен без данных рендера (старые qc.json)
}

// Пороги (секунды, дБ, Мбит/с).
export const QC_LIMITS = {
  durationToleranceSec: 0.5,
  silenceDb: -45,
  silenceMinSec: 1.5,
  silentMaxDb: -50, // пик ниже — звука нет вовсе
  blackMinSec: 0.5,
  blackLuma: 20, // яркость 0–255 (тёмные фоны тем — от ~24)
  blackShare: 0.98, // доля тёмных пикселей в кадре
  lufsLow: -20,
  lufsHigh: -9,
  truePeakMax: -0.5,
  minBitrateMbps1080: 8, // рекомендация YouTube для 1080p30 SDR
  // x264 CRF ≤ 18 — визуально без потерь: битрейт сам падает на простой графике,
  // и низкий средний поток уже не значит низкое качество.
  transparentCrfMax: 18,
} as const;

// ---- ffmpeg/ffprobe из Remotion ----

// Бинарник из пакета Remotion (тот же, что рендерит и выравнивает громкость);
// spawn, а не callFf: нужен stdout байтами (PCM и кадры), а не строкой.
async function runFf(bin: "ffmpeg" | "ffprobe", args: string[], timeoutMs = 10 * 60_000): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  const exe = RenderInternals.getExecutablePath({ type: bin, indent: false, logLevel: "error", binariesDirectory: null });
  const proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
  const out: Buffer[] = [];
  let err = "";
  proc.stdout.on("data", (c: Buffer) => out.push(c));
  proc.stderr.on("data", (c: Buffer) => {
    // stderr бывает большим (прогресс) — держим только хвост.
    err = (err + c.toString()).slice(-200_000);
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", resolve);
    });
    return { stdout: Buffer.concat(out), stderr: err, code };
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

interface ProbeJson {
  format?: { duration?: string; size?: string; bit_rate?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string; avg_frame_rate?: string; bit_rate?: string; sample_rate?: string; channels?: number; duration?: string }[];
}

export function parseProbe(json: ProbeJson): QcProbe {
  const v = json.streams?.find((s) => s.codec_type === "video");
  const a = json.streams?.find((s) => s.codec_type === "audio");
  const rate = (r?: string) => {
    const m = /^(\d+)\/(\d+)$/.exec(r ?? "");
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
  };
  const kbps = (b?: string) => {
    const n = num(b);
    return n === null ? null : Math.round(n / 1000);
  };
  return {
    durationSec: num(json.format?.duration) ?? num(v?.duration),
    sizeBytes: num(json.format?.size),
    bitrateKbps: kbps(json.format?.bit_rate),
    videoBitrateKbps: kbps(v?.bit_rate),
    width: v?.width ?? null,
    height: v?.height ?? null,
    videoCodec: v?.codec_name ?? null,
    pixFmt: v?.pix_fmt ?? null,
    fps: rate(v?.avg_frame_rate) ?? rate(v?.r_frame_rate),
    audioCodec: a?.codec_name ?? null,
    sampleRate: num(a?.sample_rate),
    channels: a?.channels ?? null,
    audioBitrateKbps: kbps(a?.bit_rate),
  };
}

// loudnorm печатает JSON с input_i / input_tp / input_lra в конце stderr.
export function parseLoudnorm(stderr: string): Pick<QcAudio, "integratedLufs" | "truePeakDbtp" | "loudnessRangeLu"> {
  const from = stderr.lastIndexOf("{");
  const to = stderr.lastIndexOf("}");
  try {
    const j = JSON.parse(stderr.slice(from, to + 1)) as { input_i?: string; input_tp?: string; input_lra?: string };
    const i = num(j.input_i);
    return { integratedLufs: i !== null && i > -70 ? i : null, truePeakDbtp: num(j.input_tp), loudnessRangeLu: num(j.input_lra) };
  } catch {
    return { integratedLufs: null, truePeakDbtp: null, loudnessRangeLu: null };
  }
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round1 = (x: number) => Math.round(x * 10) / 10;

// Уровень и тишина по моно-PCM: RMS окнами по 50 мс; тишина — окна тише порога подряд.
export function analyzePcm(samples: Float32Array, sampleRate: number, opts = { silenceDb: QC_LIMITS.silenceDb as number, minSec: QC_LIMITS.silenceMinSec as number }): { meanDb: number; maxDb: number; silences: QcSpan[] } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sum += s * s;
  }
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  const silences: QcSpan[] = [];
  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const start = runStart / sampleRate;
    const end = endIdx / sampleRate;
    if (end - start >= opts.minSec) silences.push({ start: round1(start), end: round1(end), duration: round1(end - start) });
    runStart = -1;
  };
  for (let i = 0; i < samples.length; i += win) {
    let e = 0;
    const n = Math.min(win, samples.length - i);
    for (let j = 0; j < n; j++) e += samples[i + j]! * samples[i + j]!;
    const quiet = db(Math.sqrt(e / n)) < opts.silenceDb;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet) flush(i);
  }
  flush(samples.length);
  return { meanDb: round1(db(Math.sqrt(sum / Math.max(1, samples.length)))), maxDb: round1(db(peak)), silences };
}

// Чёрные провалы по серым кадрам w×h (по кадру на 1/fps с).
export function findBlacks(frames: Buffer, w: number, h: number, fps: number, opts = { luma: QC_LIMITS.blackLuma as number, share: QC_LIMITS.blackShare as number, minSec: QC_LIMITS.blackMinSec as number }): QcSpan[] {
  const size = w * h;
  const count = Math.floor(frames.length / size);
  const out: QcSpan[] = [];
  let runStart = -1;
  const flush = (i: number) => {
    if (runStart < 0) return;
    const start = runStart / fps;
    const end = i / fps;
    if (end - start >= opts.minSec) out.push({ start: round1(start), end: round1(end), duration: round1(end - start) });
    runStart = -1;
  };
  for (let f = 0; f < count; f++) {
    let dark = 0;
    for (let p = f * size; p < (f + 1) * size; p++) if (frames[p]! <= opts.luma) dark++;
    const black = dark / size >= opts.share;
    if (black && runStart < 0) runStart = f;
    if (!black) flush(f);
  }
  flush(count);
  return out;
}

// ---- Оценка ----

export function evaluateQc(input: Omit<QcReport, "issues" | "ok" | "checkedAt" | "file">, mode: "fail" | "warn" = "fail"): QcIssue[] {
  const { expected: e, probe: p, audio: a } = input;
  const issues: QcIssue[] = [];
  const err = (id: string, message: string) => issues.push({ id, severity: mode === "warn" ? "warn" : "error", message });
  const warn = (id: string, message: string) => issues.push({ id, severity: "warn", message });
  if (!p.videoCodec) err("no-video", "в файле нет видеодорожки — перерендерьте ролик.");
  if (!p.audioCodec) err("no-audio", "в файле нет звуковой дорожки — проверьте озвучку и музыку (props.json) и перерендерьте.");
  if (p.durationSec === null) err("duration", "не удалось узнать длительность файла — файл повреждён?");
  else if (Math.abs(p.durationSec - e.durationSec) > QC_LIMITS.durationToleranceSec) {
    err("duration", `длительность ${p.durationSec.toFixed(2)} с вместо ${e.durationSec.toFixed(2)} с (по props.json) — рендер оборвался или props собраны не через layoutScenes().`);
  }
  if (p.width !== null && p.height !== null && (p.width !== e.width || p.height !== e.height)) {
    err("size", `кадр ${p.width}×${p.height} вместо ${e.width}×${e.height}.`);
  }
  if (p.videoCodec && p.videoCodec !== "h264") warn("video-codec", `видео в ${p.videoCodec}, а не h264 — YouTube и Instagram надёжнее всего принимают h264.`);
  if (p.pixFmt && p.pixFmt !== "yuv420p") warn("pix-fmt", `пиксельный формат ${p.pixFmt}, ожидался yuv420p (иначе часть плееров покажет не те цвета).`);
  if (p.audioCodec && p.audioCodec !== "aac") warn("audio-codec", `звук в ${p.audioCodec}, а не AAC.`);
  if (p.fps !== null && Math.abs(p.fps - e.fps) > 0.05) warn("fps", `частота ${p.fps.toFixed(2)} кадр/с вместо ${e.fps}.`);
  if (p.sampleRate !== null && p.sampleRate < 44100) warn("sample-rate", `частота звука ${p.sampleRate} Гц — YouTube рекомендует 48 кГц.`);
  // Битрейт: для 1080p YouTube советует ≈ 8 Мбит/с; для других размеров — пропорционально площади.
  // Порог — про кодирование средним потоком. При постоянном качестве (CRF ≤ 18) поток
  // следует за сложностью кадра: релизы 10a–13b с CRF 15 дали 7,1–9,9 Мбит/с, и
  // совет «VIDEO_QUALITY=max» лишь удвоил бы файл. Кодировщик неизвестен — как раньше.
  const crf = input.encoder?.crf ?? null;
  const constantQuality = crf !== null && crf <= QC_LIMITS.transparentCrfMax;
  const vk = p.videoBitrateKbps ?? (p.bitrateKbps !== null && p.audioBitrateKbps !== null ? p.bitrateKbps - p.audioBitrateKbps : p.bitrateKbps);
  if (!constantQuality && vk !== null && p.width && p.height) {
    const minMbps = QC_LIMITS.minBitrateMbps1080 * Math.min(1, (p.width * p.height) / (1920 * 1080));
    if (vk / 1000 < minMbps) {
      // VIDEO_BITRATE сильнее VIDEO_CRF (render.ts → encoderSettings): совет — под тот режим, что был.
      const fix = input.encoder?.videoBitrate
        ? `поднимите VIDEO_BITRATE (например 16M) или уберите его — тогда VIDEO_QUALITY=high (CRF 15)`
        : crf !== null
          ? `VIDEO_QUALITY=high (CRF 15) или VIDEO_CRF=14`
          : `VIDEO_QUALITY=max или VIDEO_CRF=14`;
      warn("bitrate", `средний битрейт видео ${(vk / 1000).toFixed(1)} Мбит/с — ниже ~${minMbps.toFixed(0)} Мбит/с, которые YouTube советует для ${Math.min(p.width, p.height)}p; после перекодирования YouTube возможны артефакты. Поднимите качество: ${fix}.`);
    }
  }
  if (p.audioCodec) {
    if (a.maxVolumeDb === null || a.maxVolumeDb < QC_LIMITS.silentMaxDb) {
      err("silent", `звук почти беззвучный (пик ${a.maxVolumeDb === null ? "—" : `${a.maxVolumeDb} дБ`}) — проверьте файлы voice/ и громкость (MUSIC_VOLUME, SFX_VOLUME).`);
    }
    if (a.integratedLufs !== null && (a.integratedLufs < QC_LIMITS.lufsLow || a.integratedLufs > QC_LIMITS.lufsHigh)) {
      warn("loudness", `громкость ${a.integratedLufs.toFixed(1)} LUFS — заметно ${a.integratedLufs < QC_LIMITS.lufsLow ? "тише" : "громче"} обычных Shorts (≈ −14 LUFS); проверьте LOUDNESS_TARGET.`);
    }
    if (a.truePeakDbtp !== null && a.truePeakDbtp > QC_LIMITS.truePeakMax) warn("true-peak", `пик ${a.truePeakDbtp.toFixed(1)} dBTP — возможны искажения после перекодирования.`);
  }
  for (const s of input.silences) warn("silence", `тишина ${s.duration.toFixed(1)} с (${s.start.toFixed(1)}–${s.end.toFixed(1)} с) — зритель решит, что ролик завис.`);
  for (const b of input.blacks) warn("black", `чёрный экран ${b.duration.toFixed(1)} с (${b.start.toFixed(1)}–${b.end.toFixed(1)} с) — не загрузился визуал или ошибка сцены.`);
  return issues;
}

// ---- Запуск ----

export function qcMode(env: Record<string, string | undefined> = process.env): "fail" | "warn" | "off" {
  const v = (env.QC ?? "").trim().toLowerCase();
  if (v === "off" || v === "none" || v === "0") return "off";
  if (v === "warn") return "warn";
  return "fail";
}

// opts.encoder — RenderResult.encoder: при постоянном качестве битрейт не проверяется.
export async function runQc(videoFile: string, props: Pick<VideoProps, "format" | "durationInFrames">, opts: { mode?: "fail" | "warn"; encoder?: EncoderSettings | null } = {}): Promise<QcReport> {
  const file = path.resolve(videoFile);
  const size = FORMAT_SIZE[props.format] ?? FORMAT_SIZE.shorts;
  const expected = { durationSec: Math.round((props.durationInFrames / FPS) * 1000) / 1000, width: size.width, height: size.height, fps: FPS };

  const pr = await runFf("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  let probe: QcProbe;
  try {
    probe = parseProbe(JSON.parse(pr.stdout.toString("utf8")) as ProbeJson);
  } catch {
    throw new Error(`QC: ffprobe не смог прочитать ${path.basename(file)}${pr.stderr ? ` (${pr.stderr.trim().split("\n")[0]})` : ""}.`);
  }

  const audio: QcAudio = { meanVolumeDb: null, maxVolumeDb: null, integratedLufs: null, truePeakDbtp: null, loudnessRangeLu: null };
  let silences: QcSpan[] = [];
  if (probe.audioCodec) {
    // Уровень и тишина — по моно 16 кГц (хватает для порогов в дБ).
    const wav = await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "-"]);
    if (wav.stdout.length > 44) {
      const pcm = decodeWav(wav.stdout);
      const r = analyzePcm(toMono(pcm), pcm.sampleRate);
      audio.meanVolumeDb = Number.isFinite(r.meanDb) ? r.meanDb : null;
      audio.maxVolumeDb = Number.isFinite(r.maxDb) ? r.maxDb : null;
      // Хвост после призыва — нормальная пауза перед концом ролика, не сбой.
      const total = pcm.channels[0]!.length / pcm.sampleRate;
      silences = r.silences.filter((s) => s.end < total - 2.5);
    }
    const ln = await runFf("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
    Object.assign(audio, parseLoudnorm(ln.stderr));
  }

  let blacks: QcSpan[] = [];
  if (probe.videoCodec) {
    const W = 36;
    const H = 64;
    const vf = await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:v:0", "-vf", `scale=${W}:${H},format=gray`, "-r", "10", "-c:v", "rawvideo", "-f", "image2pipe", "-"]);
    blacks = findBlacks(vf.stdout, W, H, 10);
  }

  const enc = opts.encoder;
  const encoder: QcEncoder | undefined = enc ? { quality: enc.quality, crf: enc.crf, videoBitrate: enc.videoBitrate, x264Preset: enc.x264Preset } : undefined;
  const base = { expected, probe, audio, silences, blacks, ...(encoder ? { encoder } : {}) };
  const issues = evaluateQc(base, opts.mode ?? "fail");
  return { file, checkedAt: new Date().toISOString(), ok: !issues.some((i) => i.severity === "error"), ...base, issues };
}

export function writeQc(runDir: string, report: QcReport): string {
  const out = path.join(runDir, "qc.json");
  fs.writeFileSync(out, JSON.stringify({ ...report, file: path.basename(report.file) }, null, 2) + "\n");
  return out;
}

// Короткая сводка для консоли и лога CI.
export function qcSummary(r: QcReport): string[] {
  const p = r.probe;
  const a = r.audio;
  const mb = p.sizeBytes !== null ? `${(p.sizeBytes / 1048576).toFixed(1)} МБ` : "—";
  const br = p.videoBitrateKbps !== null ? `${(p.videoBitrateKbps / 1000).toFixed(1)} Мбит/с` : p.bitrateKbps !== null ? `${(p.bitrateKbps / 1000).toFixed(1)} Мбит/с (всего)` : "—";
  const lines = [
    `QC: ${p.width ?? "?"}×${p.height ?? "?"}, ${p.videoCodec ?? "нет видео"}/${p.audioCodec ?? "нет звука"}, ${p.durationSec?.toFixed(2) ?? "?"} с (ожидалось ${r.expected.durationSec.toFixed(2)}), ${mb}, видео ${br}`,
    `    звук: пик ${a.maxVolumeDb ?? "—"} дБ, средний ${a.meanVolumeDb ?? "—"} дБ, ${a.integratedLufs !== null ? `${a.integratedLufs.toFixed(1)} LUFS` : "LUFS —"}, true peak ${a.truePeakDbtp ?? "—"} dBTP`,
  ];
  if (r.issues.length === 0) lines.push("    ✔ всё в порядке");
  for (const i of r.issues) lines.push(`    ${i.severity === "error" ? "✖" : "⚠"} ${i.message}`);
  return lines;
}
