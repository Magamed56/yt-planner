// Мелкие помощники визуала.

import type { Env } from "./types";

export function envNumber(env: Env, name: string, fallback: number): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const MB = 1024 * 1024;
