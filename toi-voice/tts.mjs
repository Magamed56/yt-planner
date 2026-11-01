// Озвучка текста приглашения (toi-voice/text.txt) через Gemini TTS тем же ключом,
// что у video-studio. Запускается workflow toi-voice.yml; результат — toi-voice/out/*.wav.
// Без зависимостей: встроенный fetch Node 22. Ключ — только в заголовке, в лог не пишется.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const text = readFileSync(path.join(dir, "text.txt"), "utf8").trim();
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].map((k) => (k ?? "").trim()).filter(Boolean);
if (!keys.length) {
  console.error("Нет секрета GEMINI_API_KEY — озвучивать нечем.");
  process.exit(1);
}
// Голоса: мужской (как у канала) и женский — на выбор.
const voices = (process.env.TOI_VOICES || "Charon,Kore").split(",").map((v) => v.trim()).filter(Boolean);
const style =
  "Говори на кыргызском языке, с правильным кыргызским произношением. Тепло, торжественно и неспешно, " +
  "как ведущий праздника, который от имени семьи приглашает гостей на той. Чёткая дикция. Между абзацами — пауза около секунды.";
const models = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"];
const isLegacy = (m) => /preview|^gemini-2\.|^gemini-3\.[01]-/.test(m);

// PCM 16 бит моно → WAV.
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const toWav = (b64, mime, rate) => {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.subarray(0, 4).toString() === "RIFF") return bytes;
  return wav(bytes, Number(/rate=(\d+)/i.exec(mime ?? "")?.[1] ?? rate ?? 24000));
};

async function post(url, key, body) {
  const ctrl = AbortSignal.timeout(180_000);
  const r = await fetch(url, { method: "POST", signal: ctrl, headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`), { status: r.status });
  return JSON.parse(t);
}

async function synth(model, key, voice, language) {
  if (!isLegacy(model)) {
    const speech = { voice };
    if (language) speech.language = language;
    const j = await post(`${BASE}/interactions`, key, {
      model,
      input: [{ type: "text", text, annotations: [{ type: "speech_metadata", style }] }],
      response_format: { type: "audio", mime_type: "audio/wav" },
      generation_config: { speech_config: [speech] },
    });
    const a = (j.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).reverse().find((c) => c.type === "audio" && c.data);
    if (!a) throw new Error("в ответе нет аудио");
    return toWav(a.data, a.mime_type, a.sample_rate);
  }
  const j = await post(`${BASE}/models/${model}:generateContent`, key, {
    contents: [{ parts: [{ text: `${style}\n\n${text}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  });
  const p = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data)?.inlineData;
  if (!p) throw new Error("в ответе нет аудио");
  return toWav(p.data, p.mimeType, 24000);
}

mkdirSync(path.join(dir, "out"), { recursive: true });
const report = [];
for (const voice of voices) {
  let done = false;
  // Сначала с явным кыргызским (ky); если модель такой язык не принимает — без поля языка.
  attempts: for (const model of models) {
    for (const [ki, key] of keys.entries()) {
      for (const language of isLegacy(model) ? [null] : ["ky", null]) {
        const label = `${voice} · ${model} · ключ ${ki + 1} · язык ${language ?? "авто"}`;
        try {
          const audio = await synth(model, key, voice, language);
          const file = path.join(dir, "out", `voice-${voice}.wav`);
          writeFileSync(file, audio);
          console.log(`OK ${label} → ${path.basename(file)} (${audio.length} байт)`);
          report.push({ voice, model, key: ki + 1, language: language ?? "auto", bytes: audio.length });
          done = true;
          break attempts;
        } catch (e) {
          const msg = String(e.message).split(key).join("***");
          console.warn(`× ${label}: ${msg}`);
          if (e.status === 400 && language) continue; // язык не принят — пробуем без него
          if (e.status === 401 || e.status === 403) break; // ключ не подходит — следующий
          break; // 429/404/5xx — следующий ключ или модель
        }
      }
    }
  }
  if (!done) report.push({ voice, error: "ни одна модель не ответила" });
}
writeFileSync(path.join(dir, "out", "report.json"), JSON.stringify(report, null, 2));
if (!report.some((r) => r.bytes)) process.exit(1);
