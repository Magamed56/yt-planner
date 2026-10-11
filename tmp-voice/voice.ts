// Временный: озвучка приглашения на той (кыргызский) одним запросом Gemini.
import fs from "node:fs";
import path from "node:path";
import { geminiProvider } from "../main/video-studio/src/pipeline/voice/providers/gemini.ts";
import { encodeWav16 } from "../main/video-studio/src/pipeline/audio/wav.ts";

const text = fs.readFileSync(process.env.TEXT_FILE!, "utf8").trim();
const out = process.env.OUT_DIR!;
const p = geminiProvider();
const voice = p.resolveVoice(process.env.VOICE || "Charon");
const raw = await p.synthesizeRaw(text, { voice, rate: 1 });
fs.mkdirSync(out, { recursive: true });
if (raw.kind === "pcm") fs.writeFileSync(path.join(out, "voice.wav"), encodeWav16(raw.audio));
else fs.writeFileSync(path.join(out, "voice.mp3"), (raw as { bytes: Uint8Array }).bytes);
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ voice, fallback: (raw as { fallback?: string }).fallback ?? null }));
console.log("ok", voice);
