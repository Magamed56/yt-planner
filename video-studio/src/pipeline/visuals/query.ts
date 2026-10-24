// Запросы для стоков и промпты для генерации из полей сцены.

import { createHash } from "node:crypto";
import type { Format, SceneShot, ScriptScene, ShotFraming, VisualStyle } from "../../types";

const CYRILLIC = /[Ѐ-ӿ]/;

// Слова, которые в стоковом поиске только мешают (стиль, ракурс, связки).
const STOP = new Set(
  "a an the of in on at with and or for to from by into over under near is are be cinematic dramatic close-up closeup close up macro shot view top-down wide angle photo photograph image picture of style lighting light soft hard rim warm cold moody background minimal abstract concept detailed highly realistic 4k 8k hd glowing beautiful".split(
    " ",
  ),
);

function cleanQuery(q: string): string {
  return q
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function keywords(text: string, max: number): string {
  return cleanQuery(text)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, max)
    .join(" ");
}

// По убыванию точности: исходный запрос → первые два слова → ключевые слова
// из imagePrompt. Кириллицу на стоки не шлём — по ней почти ничего нет.
export function buildQueries(scene: ScriptScene): string[] {
  const out: string[] = [];
  const add = (q: string | undefined) => {
    const c = q ? cleanQuery(q) : "";
    if (c && !CYRILLIC.test(c) && !out.includes(c)) out.push(c);
  };
  const primary = scene.visualQuery ? cleanQuery(scene.visualQuery) : "";
  add(primary);
  const words = primary.split(" ").filter(Boolean);
  if (words.length >= 3) add(words.slice(0, 2).join(" "));
  if (scene.imagePrompt) add(keywords(scene.imagePrompt, 3));
  return out.slice(0, 3);
}

// ---- Кинорежим: план и общий стиль ролика ----

// Общий стиль ролика (VideoScript.style) → хвост промпта каждого AI-кадра.
// «Без надписей» — всегда: генераторы любят рисовать буквы.
export function styleText(style: VisualStyle | undefined): string | undefined {
  if (!style) return undefined;
  const t = (v: string | undefined) => v?.trim().replace(/[.\s]+$/, "") || "";
  const parts = [
    t(style.direction),
    t(style.realism),
    t(style.lighting),
    t(style.palette) && `${t(style.palette)} color palette`,
    t(style.mood) && `${t(style.mood)} mood`,
    t(style.environment) && `setting: ${t(style.environment)}`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}, no text, no letters, no watermark` : undefined;
}

const FRAMING_TEXT: Record<ShotFraming, string> = {
  establishing: "establishing extreme wide shot",
  wide: "wide shot",
  medium: "medium shot",
  "close-up": "close-up shot",
  detail: "extreme close-up detail shot",
  reaction: "close-up reaction shot, expressive face",
  pov: "first-person point-of-view shot",
  "low-angle": "low-angle shot",
  "high-angle": "high-angle shot",
  overhead: "overhead top-down shot",
};

// Промпт плана без стиля: крупность + описание + герой (если его не назвали в
// описании — иначе кадры одного героя расходятся). Стиль добавит imagePromptFor.
export function shotImagePrompt(shot: SceneShot): string {
  const body = shot.prompt.trim().replace(/[.\s]+$/, "");
  const subject = shot.subject?.trim();
  const full = subject && !body.toLowerCase().includes(subject.toLowerCase()) ? `${body}, featuring ${subject}` : body;
  return shot.framing ? `${FRAMING_TEXT[shot.framing]}: ${full}` : full;
}

export const DEFAULT_STYLE =
  "cinematic photo, soft dramatic lighting, rich color grading, shallow depth of field, highly detailed, no text, no letters, no watermark";

// Промпт для AI-картинки: imagePrompt сцены + общий стиль ролика (одинаковый
// для всех сцен — так кадры выглядят как один фильм).
export function imagePromptFor(scene: ScriptScene, format: Format, style: string | undefined): string | null {
  const base = scene.imagePrompt?.trim() || (scene.visualQuery?.trim() ? `cinematic shot of ${scene.visualQuery.trim()}` : "");
  if (!base || CYRILLIC.test(base)) return null;
  const orient = format === "shorts" ? "vertical 9:16 composition" : "wide 16:9 composition";
  return `${base.replace(/[.\s]+$/, "")}. ${orient}, ${style?.trim() || DEFAULT_STYLE}`.slice(0, 1800);
}

// Детерминированный seed: повторный запуск того же сценария даёт тот же кадр.
export function seedFor(text: string): number {
  return createHash("sha1").update(text).digest().readUInt32BE(0) % 2_147_483_647;
}

export function extFromUrl(url: string, fallback: string): string {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (m) {
      const e = m[1].toLowerCase();
      return e === "jpeg" ? "jpg" : e;
    }
  } catch {
    // не URL
  }
  return fallback;
}

export function extFromBytes(buf: Buffer, contentType = ""): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  return null;
}
