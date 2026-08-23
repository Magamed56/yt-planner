import type { VideoStage } from "@prisma/client";

export const STAGE_ORDER: VideoStage[] = [
  "IDEA",
  "SCRIPT",
  "FILMING",
  "EDITING",
  "READY",
  "PUBLISHED",
  "REJECTED",
];

export const STAGE_LABELS: Record<VideoStage, string> = {
  IDEA: "Идея",
  SCRIPT: "Сценарий",
  FILMING: "Съёмка",
  EDITING: "Монтаж",
  READY: "Готово к публикации",
  PUBLISHED: "Опубликовано",
  REJECTED: "Отклонено",
};

// Вкладки верхнего меню — без "Отклонено" (редко используется, но доступно
// через прямую ссылку и в выпадающем списке смены этапа).
export const TAB_STAGES: VideoStage[] = ["IDEA", "SCRIPT", "FILMING", "EDITING", "READY", "PUBLISHED"];

export const STAGE_COLORS: Record<VideoStage, string> = {
  IDEA: "bg-slate-400/15 text-slate-300 ring-1 ring-inset ring-slate-400/20",
  SCRIPT: "bg-cyan-400/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/20",
  FILMING: "bg-blue-400/15 text-blue-300 ring-1 ring-inset ring-blue-400/20",
  EDITING: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/20",
  READY: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/20",
  PUBLISHED: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/20",
  REJECTED: "bg-red-400/15 text-red-300 ring-1 ring-inset ring-red-400/20",
};

export const STAGE_SLUGS: Record<VideoStage, string> = {
  IDEA: "idea",
  SCRIPT: "script",
  FILMING: "filming",
  EDITING: "editing",
  READY: "ready",
  PUBLISHED: "published",
  REJECTED: "rejected",
};

export function stageFromSlug(slug: string): VideoStage | undefined {
  return STAGE_ORDER.find((s) => STAGE_SLUGS[s] === slug);
}
