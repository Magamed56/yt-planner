// Озвучка через edge-tts-universal — использует бесплатный сервис озвучки
// Microsoft Edge, без API-ключа и без привязки биллинга (в отличие от
// Google Cloud TTS, которое упёрлось в требование карты).
import { EdgeTTS } from "edge-tts-universal";

const VOICE = "ru-RU-SvetlanaNeural";

// Строки шот-листа/подписи в сценарии не должны звучать в озвучке — берём
// только реплики диктора. Если сценарий записан в виде шот-листа с ЗК:,
// вытаскиваем только эти строки; иначе читаем текст как есть.
export function extractNarration(script: string): string {
  const lines = script
    .split("\n")
    .map((l) => l.match(/ЗК[:\s]*[«"']?(.*?)[»"']?\s*$/i)?.[1] ?? null)
    .filter((l): l is string => l !== null && l.trim().length > 0);
  return lines.length > 0 ? lines.join(". ") : script;
}

export async function generateVoiceover(text: string): Promise<Buffer> {
  const tts = new EdgeTTS(text, VOICE);
  const result = await tts.synthesize();
  return Buffer.from(await result.audio.arrayBuffer());
}
