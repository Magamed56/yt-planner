// Общее для CLI: .env, логи шагов с таймингом, понятные ошибки, вывод для
// GitHub Actions. Работает одинаково на Windows и Linux (только path.join).

import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { projectRoot } from "../pipeline/audio/paths";

export const ROOT = projectRoot();

// .env из корня video-studio (а не из текущей папки): на Windows CLI часто
// запускают «не оттуда». Переменные окружения сильнее файла — так секреты
// GitHub Actions не перебиваются случайным .env.
export function loadEnv(): string | null {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return null;
  loadDotenv({ path: file, quiet: true });
  return file;
}

export const fmtDuration = (ms: number): string => {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} с`;
  const m = Math.floor(s / 60);
  return `${m} мин ${String(Math.round(s - m * 60)).padStart(2, "0")} с`;
};

export class Steps {
  private n = 0;
  private readonly t0 = Date.now();
  readonly timings: { name: string; ms: number }[] = [];
  constructor(private readonly total: number) {}

  async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.n++;
    console.log(`\n▶ [${this.n}/${this.total}] ${name}`);
    const t = Date.now();
    const out = await fn();
    const ms = Date.now() - t;
    this.timings.push({ name, ms });
    console.log(`✔ ${name} — ${fmtDuration(ms)}`);
    return out;
  }

  skip(name: string, why: string): void {
    this.n++;
    console.log(`\n▷ [${this.n}/${this.total}] ${name} — пропущено (${why})`);
  }

  elapsedMs(): number {
    return Date.now() - this.t0;
  }
}

// Ошибка с подсказкой, что делать. Печатается без стека.
export class UserError extends Error {}

export function fail(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\n✖ Ошибка: ${msg}`);
  if (process.env.DEBUG && e instanceof Error && e.stack) console.error(e.stack);
  else if (!(e instanceof UserError)) console.error("  (подробности: запустите с DEBUG=1)");
  process.exit(1);
}

// GitHub Actions: значения шагов для следующих шагов и сводка запуска.
export function ghOutput(values: Record<string, string | number | null | undefined>): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (s.includes("\n")) {
      const delim = `EOF_${Math.random().toString(36).slice(2)}`;
      lines.push(`${k}<<${delim}`, s, delim);
    } else lines.push(`${k}=${s}`);
  }
  fs.appendFileSync(file, lines.join("\n") + "\n");
}

export function ghSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, markdown.endsWith("\n") ? markdown : markdown + "\n");
}

// Путь к файлу из аргумента: от текущей папки, затем от корня video-studio,
// затем без префикса «video-studio/» (в GitHub Actions путь часто дают от корня репозитория).
export function resolveInputPath(p: string): string | null {
  const candidates = [path.resolve(p), path.join(ROOT, p), path.join(ROOT, p.replace(/^[./\\]*video-studio[/\\]/, ""))];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

// Путь для печати: относительно video-studio, с «/»; вне проекта — как есть.
export const rel = (p: string): string => {
  const r = path.relative(ROOT, p);
  if (r.startsWith("..") || path.isAbsolute(r)) return p;
  return r.split(path.sep).join("/") || ".";
};

// Сообщения node:util parseArgs — по-русски. «Лишний аргумент» почти всегда
// значит тему с пробелами без кавычек.
export function argsError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m
    .replace(/^Unknown option '([^']+)'.*$/s, "Неизвестный параметр $1")
    .replace(/^Option '([^' ]+)[^']*' argument missing.*$/s, "У параметра $1 не указано значение")
    .replace(/^Option '([^' ]+)[^']*' argument is ambiguous.*$/s, "Значение параметра $1 начинается с «-» — запишите его как $1=значение")
    .replace(/^Unexpected argument '([^']+)'.*$/s, "Лишний аргумент «$1» — текст с пробелами берите в кавычки: --topic \"тема ролика\"");
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export const escapeMd = (s: string): string => s.replace(/([|\\`*_[\]<>])/g, "\\$1");
