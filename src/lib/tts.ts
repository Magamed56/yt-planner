// Озвучка через Google Cloud Text-to-Speech REST API (тот же GCP-проект, что
// и для YouTube — не нужно заводить ещё один аккаунт). Простой API-ключ,
// без OAuth: TTS не требует доступа к личным данным пользователя.

const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

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
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY не задан в .env");

  const res = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      // Wavenet — стабильное, давно существующее семейство голосов Google
      // (в отличие от совсем новых, которые могут быть недоступны без
      // отдельного allowlist-доступа).
      voice: { languageCode: "ru-RU", name: "ru-RU-Wavenet-D" },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google TTS вернул ошибку (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.audioContent) throw new Error("Google TTS не вернул аудио");
  return Buffer.from(data.audioContent, "base64");
}
