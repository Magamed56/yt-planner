// Длительность аудио без системного ffmpeg: WAV — по заголовку, MP3 — через
// @remotion/media-parser, а если он не справился — собственным подсчётом кадров MP3.

import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";
import { readFile } from "node:fs/promises";
import { isWav, wavDurationMs } from "../audio/wav";

export async function audioFileDurationMs(file: string): Promise<number> {
  const head = await readFile(file);
  if (isWav(head)) return wavDurationMs(head);
  try {
    const r = await parseMedia({
      src: file,
      reader: nodeReader,
      fields: { slowDurationInSeconds: true },
      acknowledgeRemotionLicense: true,
      logLevel: "error",
    });
    if (Number.isFinite(r.slowDurationInSeconds) && r.slowDurationInSeconds > 0) return r.slowDurationInSeconds * 1000;
  } catch {
    // ниже — запасной разбор кадров
  }
  const ms = mp3DurationMs(head);
  if (ms > 0) return ms;
  throw new Error(`Не удалось определить длительность аудио ${file}`);
}

// Подсчёт кадров MPEG Audio (Layer III): сумма «сэмплов на кадр» / частота.
// Точно для CBR и VBR, не требует Xing-заголовка.
export function mp3DurationMs(buf: Uint8Array): number {
  let off = 0;
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    off = 10 + size + (buf[5]! & 0x10 ? 10 : 0);
  }
  const BITRATES: Record<string, number[]> = {
    v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let samples = 0;
  let sampleRate = 0;
  let frames = 0;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff || (buf[off + 1]! & 0xe0) !== 0xe0) {
      off++;
      continue;
    }
    const version = (buf[off + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[off + 1]! >> 1) & 3; // 1 = Layer III
    const brIdx = (buf[off + 2]! >> 4) & 15;
    const srIdx = (buf[off + 2]! >> 2) & 3;
    const pad = (buf[off + 2]! >> 1) & 1;
    if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
      off++;
      continue;
    }
    const br = (version === 3 ? BITRATES.v1! : BITRATES.v2!)[brIdx]! * 1000;
    const sr = RATES[version]![srIdx]!;
    const perFrame = version === 3 ? 1152 : 576;
    const len = Math.floor(((perFrame / 8) * br) / sr) + pad;
    if (len < 4) {
      off++;
      continue;
    }
    samples += perFrame;
    sampleRate = sr;
    frames++;
    off += len;
  }
  return frames && sampleRate ? (samples / sampleRate) * 1000 : 0;
}
