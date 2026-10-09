// Прогресс идущего запуска GitHub Actions: этапы по шагам задания и ожидаемая длительность по
// прошлым удачным запускам того же вида. Чистые функции без сети и без node:* — их зовут сервер
// (state.ts), браузер (полоска тикает каждую секунду) и scripts/queue-test.ts.

export interface StepLike {
  name: string;
  status: string;
  conclusion: string | null;
}

export type StageState = "done" | "active" | "todo" | "failed";

export interface RunProgress {
  stages: { label: string; state: StageState }[];
  stage: string; // текущий этап
  startedAt: string; // начало попытки
  expectedMs: number; // сколько обычно идёт такой запуск целиком
  stepsDone: number;
  stepsTotal: number;
}

const STAGE_ORDER = ["Подготовка", "Сценарий", "Озвучка и видео", "Публикация", "Сохранение"];

// Шаг workflow → этап для человека.
export function stageOf(step: string): string {
  if (/закоммит|уведомить|артефакт|сводка/i.test(step)) return "Сохранение";
  if (/сценари/i.test(step)) return "Сценарий";
  if (/сборка ролика|пакет роликов/i.test(step)) return "Озвучка и видео";
  if (/релиз|youtube|instagram|время публикации|опубликован/i.test(step)) return "Публикация";
  return "Подготовка";
}

// Типичная длительность запуска: медиана прошлых удачных того же вида на один ролик × число
// роликов. Нет истории — ориентиры: сборка ≈ 9 мин на ролик, сценарий ≈ 1,5 мин.
export function expectedMs(kind: string, codes: number, history: { kind: string; codes: number; ms: number }[]): number {
  const n = Math.max(1, codes);
  const per = history
    .filter((h) => h.kind === kind && h.ms > 60_000)
    .map((h) => h.ms / Math.max(1, h.codes))
    .sort((a, b) => a - b);
  const fallback = kind === "draft" ? 90_000 : kind === "fill" || kind === "check" ? 60_000 : 9 * 60_000;
  const median = per.length ? per[Math.floor(per.length / 2)]! : fallback;
  return Math.round(median * n + (kind === "draft" ? 60_000 : 90_000));
}

export function runProgress(steps: StepLike[], startedAt: string, expected: number): RunProgress {
  const real = steps.filter((s) => s.conclusion !== "skipped" && !/^(set up job|complete job|post )/i.test(s.name));
  const labels = [...new Set(real.map((s) => stageOf(s.name)))].sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
  const stateOf = (label: string): StageState => {
    const mine = real.filter((s) => stageOf(s.name) === label);
    if (mine.some((s) => s.conclusion === "failure")) return "failed";
    if (mine.length && mine.every((s) => s.status === "completed")) return "done";
    if (mine.some((s) => s.status === "in_progress" || s.status === "completed")) return "active";
    return "todo";
  };
  const stages = (labels.length ? labels : ["Подготовка"]).map((label) => ({ label, state: stateOf(label) }));
  const current = stages.find((s) => s.state === "active" || s.state === "failed") ?? stages.find((s) => s.state === "todo") ?? stages.at(-1)!;
  return {
    stages,
    stage: current.label,
    startedAt,
    expectedMs: expected,
    stepsDone: real.filter((s) => s.status === "completed").length,
    stepsTotal: real.length,
  };
}

// Доля готовности на момент now: по времени (обычно точнее), но не меньше доли пройденных
// шагов и не 100 %, пока запуск идёт.
export function progressAt(p: RunProgress, now: number): { percent: number; elapsedMs: number; leftMs: number } {
  const elapsedMs = Math.max(0, now - Date.parse(p.startedAt));
  const byTime = p.expectedMs > 0 ? elapsedMs / p.expectedMs : 0;
  const bySteps = p.stepsTotal ? p.stepsDone / p.stepsTotal : 0;
  const percent = Math.min(97, Math.round(Math.max(byTime, bySteps * 0.9) * 100));
  return { percent, elapsedMs, leftMs: Math.max(0, p.expectedMs - elapsedMs) };
}

// «4 мин», «меньше минуты», «1 ч 05 мин».
export function minutesLabel(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "меньше минуты";
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} мин`;
}
