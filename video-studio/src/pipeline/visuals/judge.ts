// Судья Claude для визуала — ПЛАТНО и только по явному согласию:
// VISUALS_JUDGE=claude и ANTHROPIC_API_KEY. По умолчанию выключен, и подбор
// идёт по бесплатным правилам relevance.ts.
//
// Зачем: правила видят только английские слова запроса и названия файла, а
// судья читает и русский текст сцены — и отличает «Primbon, old manuscripts
// of Indonesia» от рукописи для ролика про Оксфорд. Он получает до
// JUDGE_TOP_N уже прошедших правила кандидатов (название, описание,
// категории — без картинок, так дешевле) и отвечает одним числом: номер
// лучшего или 0 — «ни один не подходит», тогда сцена идёт к следующему
// источнику или остаётся на моушен-графике.
//
// Цена: модель по умолчанию — claude-haiku-4-5 (самая дешёвая из тех, что уже
// есть в проекте, см. script/pricing.ts): ≈ 1–1,5 тыс. входных токенов и пара
// выходных на вызов ≈ $0.0015; на Shorts из 7–8 сцен 8–15 вызовов ≈ $0.01–0.02
// за ролик. VISUALS_JUDGE_MODEL — другая модель (например, claude-haiku-5-5).
// Любая ошибка (нет денег, нет связи, отказ) — подбор продолжается без судьи.

import Anthropic from "@anthropic-ai/sdk";
import type { ScriptScene } from "../../types";
import { claudeCostUsd } from "../script/pricing";
import type { Candidate, Env, FetchLike } from "./types";
import { envNumber } from "./util";

export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";
export const JUDGE_TOP_N = 6;

export interface JudgeConfig {
  model: string;
  apiKey: string;
  timeoutMs: number;
}

// null — судья не нужен; problem — его просили, но включить нельзя (сообщение для лога).
export function judgeConfig(env: Env): { config: JudgeConfig | null; problem: string | null } {
  const mode = (env.VISUALS_JUDGE ?? "").trim().toLowerCase();
  if (!mode || mode === "off" || mode === "none" || mode === "0") return { config: null, problem: null };
  if (mode !== "claude") return { config: null, problem: `VISUALS_JUDGE=${mode}: поддерживается только claude — подбираю по бесплатным правилам.` };
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) return { config: null, problem: "VISUALS_JUDGE=claude, но не задан ANTHROPIC_API_KEY — подбираю по бесплатным правилам (добавьте ключ в .env или секреты GitHub)." };
  return { config: { model: env.VISUALS_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL, apiKey, timeoutMs: envNumber(env, "VISUALS_JUDGE_TIMEOUT_MS", 20_000) }, problem: null };
}

export type Verdict = { kind: "pick"; index: number } | { kind: "none" };

export const JUDGE_SYSTEM = `Ты подбираешь фото и видео для сцен научно-популярного ролика (YouTube Shorts, русский язык).
Тебе дают сцену (что говорит диктор, текст на экране, английский поисковый запрос) и пронумерованный список найденных файлов: название, описание, категории или теги.
Выбери файл, который буквально показывает то, о чём сцена, — чтобы зритель сразу узнал предмет.
Отклоняй:
- совпадение только по слову («racing circuit» на запрос «circuit board», «Tongue of the forest» на «cat tongue»);
- другой предмет, место, страну или эпоху, чем в сцене;
- гравюры, рисунки, картины, карты, схемы, логотипы, сканы страниц и рендеры, если сцена их не просит.
Лучше ни одного, чем не по теме.
Ответь одним числом: номер лучшего файла или 0, если не подходит ни один.`;

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function judgeUserText(scene: Pick<ScriptScene, "id" | "narration" | "onScreen" | "visualQuery">, topic: string | undefined, candidates: Candidate[]): string {
  const head = [
    topic ? `Ролик: ${clip(topic, 120)}` : "",
    `Сцена ${scene.id}: ${clip(scene.narration, 400)}`,
    scene.onScreen ? `На экране: ${clip(scene.onScreen.replace(/\*/g, ""), 120)}` : "",
    scene.visualQuery ? `Запрос: ${clip(scene.visualQuery, 80)}` : "",
  ].filter(Boolean);
  const files = candidates.map((c, i) => {
    const title = clip(c.meta?.title ?? c.id, 160);
    const text = clip(c.meta?.text, 260);
    return `${i + 1}. ${title}${text ? ` — ${text}` : ""} (${c.type === "video" ? "видео" : "фото"}, ${c.credit.provider})`;
  });
  return [...head, "", "Файлы:", ...files].join("\n");
}

// Первое число ответа: 1…n — выбор, 0 — «ничего». Иное — ответ не понят.
export function parseVerdict(text: string, n: number): Verdict | null {
  const m = /\d+/.exec(text);
  if (!m) return null;
  const k = Number(m[0]);
  if (k === 0) return { kind: "none" };
  return k >= 1 && k <= n ? { kind: "pick", index: k - 1 } : null;
}

export class JudgeError extends Error {
  readonly disable: boolean; // ключ/деньги/модель — дальше в этом запуске не спрашиваем
  readonly costUsd: number;
  constructor(message: string, disable: boolean, costUsd = 0) {
    super(message);
    this.name = "JudgeError";
    this.disable = disable;
    this.costUsd = costUsd;
  }
}

// Модели 4.x без размышлений по умолчанию принимают temperature 0 (ответ
// стабильнее при повторной сборке); 5.x думают всегда — им нужен запас
// max_tokens и низкий effort, temperature они не принимают.
const allowsTemperature = (model: string) => /haiku-4|sonnet-4-[56]|opus-4-[56]|claude-3/.test(model);
const thinksByDefault = (model: string) => !/haiku-4|sonnet-4|opus-4|claude-3/.test(model);

export interface JudgeAnswer {
  verdict: Verdict;
  costUsd: number;
  model: string;
}

export async function askJudge(cfg: JudgeConfig, scene: Pick<ScriptScene, "id" | "narration" | "onScreen" | "visualQuery">, topic: string | undefined, candidates: Candidate[], fetchImpl: FetchLike): Promise<JudgeAnswer> {
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 0, timeout: cfg.timeoutMs, fetch: fetchImpl });
  const thinks = thinksByDefault(cfg.model);
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: cfg.model,
      max_tokens: thinks ? 2048 : 16,
      ...(allowsTemperature(cfg.model) ? { temperature: 0 } : {}),
      ...(thinks ? { output_config: { effort: "low" as const } } : {}),
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: judgeUserText(scene, topic, candidates) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new JudgeError("ключ ANTHROPIC_API_KEY неверный или без доступа к модели", true);
    if (e instanceof Anthropic.NotFoundError) throw new JudgeError(`модель ${cfg.model} не найдена (проверьте VISUALS_JUDGE_MODEL)`, true);
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) throw new JudgeError("на балансе Anthropic закончились средства", true);
    if (e instanceof Anthropic.BadRequestError) throw new JudgeError(`запрос отклонён (400): ${e.message.slice(0, 160)}`, true);
    if (e instanceof Anthropic.RateLimitError) throw new JudgeError("превышен лимит запросов (429)", false);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new JudgeError(`нет ответа за ${Math.round(cfg.timeoutMs / 1000)} с`, false);
    if (e instanceof Anthropic.APIConnectionError) throw new JudgeError("нет связи с api.anthropic.com", false);
    if (e instanceof Anthropic.APIError) throw new JudgeError(`ошибка API ${e.status ?? ""}`.trim(), false);
    throw new JudgeError((e as Error)?.message ?? String(e), false);
  }
  const u = msg.usage;
  const costUsd = claudeCostUsd(msg.model || cfg.model, {
    input: u.input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  });
  // Отказ приходит как HTTP 200 — проверяем до чтения текста.
  if (msg.stop_reason === "refusal") throw new JudgeError("модель отказалась отвечать", false, costUsd);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
  const verdict = parseVerdict(text, candidates.length);
  if (!verdict) throw new JudgeError(`непонятный ответ «${clip(text, 40)}»`, false, costUsd);
  return { verdict, costUsd, model: msg.model || cfg.model };
}
