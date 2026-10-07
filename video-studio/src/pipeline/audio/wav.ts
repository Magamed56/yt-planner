// Чтение и запись WAV без внешних зависимостей. Системного ffmpeg у
// пользователя может не быть, поэтому всё, что конвейер делает с PCM
// (громкость, паузы, тайминги слов, синтез музыки), идёт через эти функции.

export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[]; // по массиву на канал, значения в [-1, 1]
}

export function isWav(buf: Uint8Array): boolean {
  return buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE";
}

// MP3: тег ID3 или синхрослово кадра (11 единичных бит).
export function isMp3(buf: Uint8Array): boolean {
  if (buf.length < 3) return false;
  if (ascii(buf, 0, 3) === "ID3") return true;
  return buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0;
}

function ascii(buf: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to && i < buf.length; i++) s += String.fromCharCode(buf[i]!);
  return s;
}

interface WavFormat {
  formatTag: number; // 1 = PCM int, 3 = IEEE float
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
}

function parseWavHeader(buf: Uint8Array): WavFormat {
  if (!isWav(buf)) throw new Error("Это не WAV-файл (нет заголовка RIFF/WAVE)");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12;
  let fmt: Omit<WavFormat, "dataOffset" | "dataBytes"> | null = null;
  while (off + 8 <= buf.length) {
    const id = ascii(buf, off, off + 4);
    let size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      let formatTag = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: настоящий формат — в первых байтах SubFormat GUID.
      if (formatTag === 0xfffe && size >= 40) formatTag = view.getUint16(body + 24, true);
      fmt = {
        formatTag,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV: блок data идёт раньше fmt");
      // Потоковые серверы TTS пишут размер 0 или 0xFFFFFFFF — тогда данные до конца файла.
      const rest = buf.length - body;
      if (size === 0 || size === 0xffffffff || size > rest) size = rest;
      return { ...fmt, dataOffset: body, dataBytes: size };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV: не найден блок data");
}

export function decodeWav(buf: Uint8Array): PcmAudio {
  const f = parseWavHeader(buf);
  if (f.channels < 1 || f.sampleRate < 1000) throw new Error(`WAV: странный формат (${f.channels} кан., ${f.sampleRate} Гц)`);
  const bytesPer = f.bitsPerSample / 8;
  const frameBytes = bytesPer * f.channels;
  const frames = Math.floor(f.dataBytes / frameBytes);
  const view = new DataView(buf.buffer, buf.byteOffset + f.dataOffset, frames * frameBytes);
  const channels = Array.from({ length: f.channels }, () => new Float32Array(frames));
  const read = sampleReader(f.formatTag, f.bitsPerSample, view);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < f.channels; c++) channels[c]![i] = read((i * f.channels + c) * bytesPer);
  }
  return { sampleRate: f.sampleRate, channels };
}

function sampleReader(tag: number, bits: number, v: DataView): (byteOff: number) => number {
  if (tag === 3 && bits === 32) return (o) => v.getFloat32(o, true);
  if (tag === 3 && bits === 64) return (o) => v.getFloat64(o, true);
  if (tag === 1 && bits === 16) return (o) => v.getInt16(o, true) / 32768;
  if (tag === 1 && bits === 8) return (o) => (v.getUint8(o) - 128) / 128;
  if (tag === 1 && bits === 24)
    return (o) => {
      const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
      return x / 8388608;
    };
  if (tag === 1 && bits === 32) return (o) => v.getInt32(o, true) / 2147483648;
  throw new Error(`WAV: неподдерживаемый формат сэмплов (tag=${tag}, ${bits} бит)`);
}

// Сырой PCM s16le (Gemini generateContent, ElevenLabs pcm_*) → PcmAudio.
export function decodePcm16(pcm: Uint8Array, sampleRate: number, channelCount = 1): PcmAudio {
  const frames = Math.floor(pcm.length / (2 * channelCount));
  const view = new DataView(pcm.buffer, pcm.byteOffset, frames * 2 * channelCount);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) channels[c]![i] = view.getInt16((i * channelCount + c) * 2, true) / 32768;
  }
  return { sampleRate, channels };
}

// Float → 16-бит PCM WAV. Треугольный дизеринг (детерминированный) убирает
// «зернистость» на тихих хвостах реверба и фейдах, которую даёт простое округление.
export function encodeWav16(audio: PcmAudio): Buffer {
  const ch = audio.channels.length;
  const frames = audio.channels[0]?.length ?? 0;
  const dataBytes = frames * ch * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(ch, 22);
  out.writeUInt32LE(audio.sampleRate, 24);
  out.writeUInt32LE(audio.sampleRate * ch * 2, 28);
  out.writeUInt16LE(ch * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  let seed = 0x9e3779b9;
  const rnd = () => {
    // xorshift32 — быстрый и воспроизводимый
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const x = audio.channels[c]![i]!;
      const dither = x === 0 ? 0 : rnd() - rnd(); // цифровую тишину оставляем нулями
      let s = Math.round(x * 32767 + dither);
      if (s > 32767) s = 32767;
      else if (s < -32768) s = -32768;
      out.writeInt16LE(s, o);
      o += 2;
    }
  }
  return out;
}

export function wavDurationMs(buf: Uint8Array): number {
  const f = parseWavHeader(buf);
  const frames = Math.floor(f.dataBytes / ((f.bitsPerSample / 8) * f.channels));
  return (frames / f.sampleRate) * 1000;
}

export function durationMsOf(audio: PcmAudio): number {
  return ((audio.channels[0]?.length ?? 0) / audio.sampleRate) * 1000;
}

// Сведение в моно — для анализа речи и озвучки (голос всегда моно).
export function toMono(audio: PcmAudio): Float32Array {
  const [first, ...rest] = audio.channels;
  if (!first) return new Float32Array(0);
  if (rest.length === 0) return first;
  const out = new Float32Array(first.length);
  const n = audio.channels.length;
  for (let i = 0; i < first.length; i++) {
    let s = 0;
    for (const c of audio.channels) s += c[i]!;
    out[i] = s / n;
  }
  return out;
}
