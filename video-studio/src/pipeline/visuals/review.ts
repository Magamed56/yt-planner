// Проверка кадров кинорежима зрением Claude — ПЛАТНО, при ANTHROPIC_API_KEY
// (VISUALS_REVIEW=off — выключить). Одна просьба на всю раскадровку: модель
// видит все кадры сразу и замечает не только брак кадра (коллаж из панелей,
// жуть, надписи, не то, о чём фраза), но и разрыв между кадрами — другой герой,
// другая эпоха или время года. Заодно отмечает, где на картинке главный предмет
// и предметы для подписей (callouts) — по этим рамкам монтаж рисует стрелки.
//
// Зачем: в 30a (прогоны 34–35) 4 кадра из 16 вышли коллажами, а «мурашки» —
// волдырями; ни судья (он видит только текст), ни QC (только техника) этого не
// заметили — заметил человек, посмотрев ролик.
//
// Цена (claude-opus-5-5, $4 / $20 за 1 млн токенов): кадр уменьшается до 512 px
// по ширине ≈ 600 токенов; 12 кадров с текстом ≈ 12 тыс. входных и 2–4 тыс.
// выходных токенов ≈ $0.10 за ролик, перегенерированные кадры — ещё один
// запрос поменьше. Вердикт кешируется по содержимому кадра (.cache/visuals-ai/
// review): пересборка тех же кадров не платит второй раз. VISUALS_REVIEW_MODEL —
// другая модель (например, claude-sonnet-5-5).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { Box, StyleCharacter } from "../../types";
import { runFf } from "../qc";
import { FALLBACK_BETA, supportsDefaultFallbacks, supportsEffort } from "../script/llm/claude";
import { claudeCostUsd } from "../script/pricing";
import { toClaudeJsonSchema } from "../script/schema";
import { aiCacheDir } from "./ai-cache";
import { envNumber } from "./util";

type Env = Record<string, string | undefined>;

export const DEFAULT_REVIEW_MODEL = "claude-opus-5-5";
const REVIEW_WIDTH = 512; // px по ширине кадра в запросе: хватает и для деталей, и для рамок

export interface ReviewConfig {
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export function reviewConfig(env: Env): { config: ReviewConfig | null; problem: string | null } {
  // Пусто — по умолчанию: в Actions незаданная переменная репозитория приходит пустой строкой.
  const mode = (env.VISUALS_REVIEW?.trim() || "claude").toLowerCase();
  if (mode === "off" || mode === "none" || mode === "0") return { config: null, problem: null };
  if (mode !== "claude") return { config: null, problem: `VISUALS_REVIEW=${mode}: поддерживается только claude — кадры не проверяю.` };
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) return { config: null, problem: "кадры не проверены зрением Claude: нет ANTHROPIC_API_KEY (подписи-стрелки без проверки не рисуются)." };
  return { config: { model: env.VISUALS_REVIEW_MODEL?.trim() || DEFAULT_REVIEW_MODEL, apiKey, timeoutMs: envNumber(env, "VISUALS_REVIEW_TIMEOUT_MS", 300_000) }, problem: null };
}

export interface ReviewItem {
  id: string; // s3-k2
  file: string; // путь к картинке
  phrase: string; // что звучит на этом плане
  prompt: string; // по какому промпту рисовали
  targets: string[]; // что подписать (callouts.target)
}

export interface ReviewContext {
  topic: string;
  world?: string;
  look?: string;
  characters?: StyleCharacter[];
}

export interface ReviewVerdict {
  id: string;
  ok: boolean;
  score: number; // 1–10
  problems: string[];
  fixPrompt: string | null; // исправленный полный промпт для повтора
  subject: Box | null;
  boxes: Record<string, Box>;
}

export interface ReviewOutcome {
  verdicts: Map<string, ReviewVerdict>;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cached: number; // вердиктов из кэша
  model: string;
}

export const REVIEW_SYSTEM = `You are the director and art director of a vertical 9:16 YouTube Short (a short science-and-history story for a Russian-speaking audience). You receive the AI-generated frames of one video in story order. For each frame you get its id, the narration line it plays under (Russian), the prompt it was generated from, and the objects the editor wants to label with arrows.

Judge every frame the way a viewer on a phone would. Verdict "redo" if ANY of these is true:
- it is a collage, split screen, grid or several panels instead of one single photograph;
- it does not show what the narration line and the prompt are about: wrong subject, wrong action, wrong era, place or season;
- a recurring character clearly differs from the same character in other frames or from the character description (face, age, hair, clothes, animal species or color), or the world breaks continuity;
- it is creepy, gory or unpleasant: wounds, blood, dead people or animals, distorted faces, extra or missing limbs, melted hands, skin or insect macro textures;
- it shows visible text, letters, signs or watermarks;
- the main subject is cut off or sits in the lower third of the frame, where the subtitles go.
Otherwise "ok". Be strict about these problems, but do not reject a frame for small imperfections.

For every frame return:
- score: 1–10, how good the frame is for the viewer;
- problems: short phrases in Russian (empty when ok);
- fix_prompt: for "redo", a corrected complete English prompt for the same shot that avoids the problem: one single scene, the same character description word for word, the same world and look, positive wording without negations; empty string when ok;
- subject_box: bounding box of the main subject as fractions of the image width and height (x and y of the top-left corner, w, h);
- callouts: for each requested label target, found (clearly visible in the image) and its bounding box (all zeros when not found).`;

const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const AnswerSchema = z.object({
  frames: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["ok", "redo"]),
      score: z.number(),
      problems: z.array(z.string()),
      fix_prompt: z.string(),
      subject_box: BoxSchema,
      callouts: z.array(z.object({ target: z.string(), found: z.boolean(), box: BoxSchema })),
    }),
  ),
});
type Answer = z.infer<typeof AnswerSchema>;

// Рамка в пределах картинки и не точка — иначе null (подпись не рисуем).
export function cleanBox(b: { x: number; y: number; w: number; h: number } | null | undefined): Box | null {
  if (!b || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v))) return null;
  const x = Math.min(1, Math.max(0, b.x));
  const y = Math.min(1, Math.max(0, b.y));
  const w = Math.min(1 - x, Math.max(0, b.w));
  const h = Math.min(1 - y, Math.max(0, b.h));
  return w >= 0.02 && h >= 0.02 ? { x: round3(x), y: round3(y), w: round3(w), h: round3(h) } : null;
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function parseAnswer(text: string, items: ReviewItem[]): Map<string, ReviewVerdict> {
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as unknown;
  const parsed: Answer = AnswerSchema.parse(json);
  const out = new Map<string, ReviewVerdict>();
  const known = new Map(items.map((it) => [it.id, it]));
  for (const f of parsed.frames) {
    const item = known.get(f.id.trim());
    if (!item) continue;
    const boxes: Record<string, Box> = {};
    for (const c of f.callouts) {
      const target = item.targets.find((t) => t.toLowerCase() === c.target.trim().toLowerCase());
      const box = c.found ? cleanBox(c.box) : null;
      if (target && box) boxes[target] = box;
    }
    out.set(item.id, {
      id: item.id,
      ok: f.verdict === "ok",
      score: Math.min(10, Math.max(1, Math.round(f.score))),
      problems: f.problems.map((p) => p.trim()).filter(Boolean),
      fixPrompt: f.verdict === "redo" && f.fix_prompt.trim() ? f.fix_prompt.trim() : null,
      subject: cleanBox(f.subject_box),
      boxes,
    });
  }
  return out;
}

// ---- кэш вердиктов: тот же кадр с тем же заданием — тот же ответ ----

function verdictKey(model: string, item: ReviewItem, image: Buffer, ctx: ReviewContext): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, model, phrase: item.phrase, prompt: item.prompt, targets: item.targets, ctx }))
    .update(image)
    .digest("hex");
}

function readVerdict(env: Env, key: string): ReviewVerdict | null {
  const dir = aiCacheDir(env);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "review", `${key}.json`), "utf8")) as ReviewVerdict;
  } catch {
    return null;
  }
}

function writeVerdict(env: Env, key: string, v: ReviewVerdict): void {
  const dir = aiCacheDir(env);
  if (!dir) return;
  try {
    fs.mkdirSync(path.join(dir, "review"), { recursive: true });
    fs.writeFileSync(path.join(dir, "review", `${key}.json`), JSON.stringify(v));
  } catch {
    // без кэша — следующая проверка просто платная
  }
}

// Кадр для запроса: JPEG 512 px по ширине (PNG генератора весит мегабайты).
async function shrink(file: string): Promise<Buffer> {
  const r = await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${REVIEW_WIDTH}:-2`, "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], 60_000);
  if (r.code !== 0 || !r.stdout.length) throw new Error(`не удалось уменьшить кадр ${path.basename(file)}: ${r.stderr.trim().split("\n")[0] ?? ""}`);
  return r.stdout;
}

export interface ReviewClient {
  beta: { messages: { stream(body: BetaMessageStreamParams, options?: { timeout?: number }): { finalMessage(): Promise<BetaMessage> } } };
}

export async function reviewFrames(
  items: ReviewItem[],
  ctx: ReviewContext,
  cfg: ReviewConfig,
  env: Env = process.env,
  client: ReviewClient = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 1, timeout: cfg.timeoutMs }),
  shrinkImage: (file: string) => Promise<Buffer> = shrink,
): Promise<ReviewOutcome> {
  const verdicts = new Map<string, ReviewVerdict>();
  const todo: { item: ReviewItem; image: Buffer; key: string }[] = [];
  let cached = 0;
  for (const item of items) {
    const raw = fs.readFileSync(item.file);
    const key = verdictKey(cfg.model, item, raw, ctx);
    const hit = readVerdict(env, key);
    if (hit) {
      verdicts.set(item.id, { ...hit, id: item.id });
      cached++;
    } else todo.push({ item, image: await shrinkImage(item.file), key });
  }
  if (!todo.length) return { verdicts, costUsd: 0, inputTokens: 0, outputTokens: 0, cached, model: cfg.model };

  const content: BetaContentBlockParam[] = [];
  const chars = (ctx.characters ?? []).map((c) => `- ${c.name}: ${c.look}`).join("\n");
  content.push({
    type: "text",
    text: `Video: ${ctx.topic}\n${ctx.world ? `World: ${ctx.world}\n` : ""}${ctx.look ? `Look: ${ctx.look}\n` : ""}${chars ? `Characters:\n${chars}\n` : ""}Frames in story order follow.`,
  });
  for (const { item, image } of todo) {
    content.push({
      type: "text",
      text: `Frame ${item.id}\nNarration: ${item.phrase}\nPrompt: ${item.prompt}\nLabel targets: ${item.targets.length ? item.targets.join("; ") : "none"}`,
    });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } });
  }
  content.push({ type: "text", text: `Return one entry in "frames" for each of these ids: ${todo.map((t) => t.item.id).join(", ")}.` });

  const params: BetaMessageStreamParams = {
    model: cfg.model,
    max_tokens: 16_000,
    system: REVIEW_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: {
      ...(supportsEffort(cfg.model) ? { effort: "medium" as const } : {}),
      format: { type: "json_schema", schema: toClaudeJsonSchema(AnswerSchema) },
    },
    ...(supportsDefaultFallbacks(cfg.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
  const msg = await client.beta.messages.stream(params, { timeout: cfg.timeoutMs }).finalMessage();
  const u = msg.usage;
  const costUsd = claudeCostUsd(msg.model || cfg.model, {
    input: u.input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  });
  // Отказ приходит как HTTP 200 — проверяем до чтения текста.
  if (msg.stop_reason === "refusal") throw new ReviewError("модель отказалась проверять кадры", costUsd);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let fresh: Map<string, ReviewVerdict>;
  try {
    fresh = parseAnswer(text, todo.map((t) => t.item));
  } catch (e) {
    throw new ReviewError(`ответ не разобран: ${(e as Error).message.slice(0, 160)}`, costUsd);
  }
  for (const { item, key } of todo) {
    const v = fresh.get(item.id);
    if (!v) continue;
    verdicts.set(item.id, v);
    writeVerdict(env, key, v);
  }
  const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return { verdicts, costUsd, inputTokens, outputTokens: u.output_tokens ?? 0, cached, model: msg.model || cfg.model };
}

export class ReviewError extends Error {
  readonly costUsd: number;
  constructor(message: string, costUsd = 0) {
    super(message);
    this.name = "ReviewError";
    this.costUsd = costUsd;
  }
}
