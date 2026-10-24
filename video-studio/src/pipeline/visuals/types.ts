// Внутренние типы визуала. Источник (provider) отдаёт кандидатов, а скачивание,
// именование файлов и учёт usedIds делает оркестратор (index.ts) — так у всех
// источников одинаковые таймауты, лимиты размера и пути.

import type { Credit, VisualContext } from "../contracts";
import type { ScriptScene } from "../../types";
import type { VisualQuery } from "./relevance";

export type Env = Record<string, string | undefined>;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface VisualDeps {
  fetch: FetchLike;
  env: Env;
  log: Logger;
  cacheDir: string; // для 24-часового кэша ответов Pixabay
  now: () => number;
}

export interface Candidate {
  id: string; // с префиксом источника: "pexels:video:123" — для ctx.usedIds
  type: "video" | "image";
  url?: string; // откуда скачать (без авторизации)
  data?: Buffer; // уже готовые байты (сгенерированная картинка)
  ext: string; // "mp4" | "jpg" | "png" | "webp"
  durationSec?: number; // для видео
  width?: number;
  height?: number;
  // Как показывать картинку: cover — на весь кадр (по умолчанию), contain —
  // целиком поверх размытой копии (горизонтальное реальное фото в Shorts).
  fit?: "cover" | "contain";
  headers?: Record<string, string>; // для скачивания (User-Agent у Wikimedia)
  credit: Credit;
  // Что известно о кадре: название файла, описание/теги — для логов (видно,
  // ЧТО попало в ролик) и для судьи Claude (VISUALS_JUDGE, judge.ts).
  meta?: { title: string; text?: string; score?: number };
}

export interface StageInput {
  scene: ScriptScene;
  ctx: VisualContext & VisualHints;
  queries: string[]; // английские запросы для стоков, по убыванию точности
  query?: VisualQuery; // разобранный запрос сцены — для проверки «по теме» (relevance.ts)
  deps: VisualDeps;
  key: string; // ключ API источника
}

export interface Stage {
  // 0 — видео со стоков; 1 — запасной вариант стока (фото, обрезка чужой
  // ориентации); AI-генерация — отдельным источником.
  rank: 0 | 1;
  media: "video" | "image";
  run(input: StageInput): Promise<Candidate[]>;
}

export interface VisualProvider {
  name: string; // имя в VISUALS
  title: string; // для логов и атрибуции
  // stock — фото/видео-стоки; photo — архивы реальных фото со свободной
  // лицензией (Wikimedia Commons, Openverse); ai — генерация.
  kind: "stock" | "photo" | "ai";
  keyEnv: string[]; // обязательные переменные (первая — ключ, передаётся в run)
  signup: string; // где получить ключ
  stages(format: VisualContext["format"]): Stage[];
}

// Подсказки конвейера к подбору (contracts.ts не трогаем — поля необязательные).
// realFirst: сцена про реальный объект (рубрики история/природа/космос) —
// сначала реальные фото, потом стоки и генерация.
// topicQueries: visualQuery всех сцен ролика — слово, которое повторяется во
// многих сценах («cat»), считается предметом ролика (relevance.ts).
// topic: название ролика — контекст для судьи Claude (judge.ts).
export interface VisualHints {
  realFirst?: boolean;
  topicQueries?: string[];
  topic?: string;
  style?: string; // общий стиль AI-кадров ролика (styleText(VideoScript.style)); нет — VISUALS_STYLE
  aiOnly?: boolean; // только генерация: кадры планов кинорежима — в одном стиле, без стоков
  rawPrompt?: boolean; // imagePrompt — полный промпт плана: стиль не дописывать (shotPrompts "complete")
  seedSalt?: string; // новая попытка кадра: другой seed при том же промпте
}

// Ошибка источника. quota/auth выключают источник до конца запуска, чтобы не
// бить в закрытую дверь на каждой сцене.
export class VisualError extends Error {
  readonly status: number | null;
  readonly disable: boolean;
  readonly network: boolean; // таймаут / нет связи — считаются подряд, см. index.ts
  constructor(message: string, opts: { status?: number | null; disable?: boolean; network?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "VisualError";
    this.status = opts.status ?? null;
    this.disable = opts.disable ?? false;
    this.network = opts.network ?? false;
  }
}
