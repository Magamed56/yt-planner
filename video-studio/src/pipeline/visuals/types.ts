// Внутренние типы визуала. Источник (provider) отдаёт кандидатов, а скачивание,
// именование файлов и учёт usedIds делает оркестратор (index.ts) — так у всех
// источников одинаковые таймауты, лимиты размера и пути.

import type { Credit, VisualContext } from "../contracts";
import type { ScriptScene } from "../../types";

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
  credit: Credit;
}

export interface StageInput {
  scene: ScriptScene;
  ctx: VisualContext;
  queries: string[]; // английские запросы для стоков, по убыванию точности
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
  kind: "stock" | "ai";
  keyEnv: string[]; // обязательные переменные (первая — ключ, передаётся в run)
  signup: string; // где получить ключ
  stages(format: VisualContext["format"]): Stage[];
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
