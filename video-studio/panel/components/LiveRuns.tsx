"use client";
// Свежие этапы идущих запусков из /api/runs — полоска прогресса берёт их отсюда, а если опроса
// ещё не было, то те, что пришли со страницей.
import { createContext, useContext } from "react";
import type { RunProgress } from "@/lib/progress";

export const LiveRunsContext = createContext<Map<number, RunProgress>>(new Map());

export function useLiveProgress(runId: number | undefined, fallback: RunProgress): RunProgress {
  const live = useContext(LiveRunsContext);
  return (runId !== undefined ? live.get(runId) : undefined) ?? fallback;
}
