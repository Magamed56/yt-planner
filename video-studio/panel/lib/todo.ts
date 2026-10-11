// Что сделать руками сейчас — один список для карточки «Сейчас», числа на иконке приложения и
// утреннего уведомления, чтобы все три говорили одно и то же. Чистая функция по уже собранному
// состоянию панели, без сети; проверяет scripts/todo-test.ts.
import { plural, type Stage } from "./stages";
import { canRetry, failedRun } from "./ops";
import { holdLabel } from "./rebuild-hold";
import type { PanelState, Row } from "./state";

export type TodoLevel = "error" | "warn" | "info";

export type TodoAction =
  | { kind: "download"; label: string; codes: string[] } // видео и обложки — лист «Скачать»
  | { kind: "find"; label: string } // «Найти новые загрузки»
  | { kind: "open"; label: string; code: string } // карточка ролика
  | { kind: "href"; label: string; href: string } // страница панели
  | { kind: "retry"; label: string; runId: number } // повтор упавшего запуска (с подтверждением)
  | { kind: "extend"; label: string; count: number }; // новые темы в план (с подтверждением)

export interface Todo {
  id: "youtube" | "run" | "problem" | "upload" | "fill" | "runway" | "topics";
  level: TodoLevel;
  title: string; // что сделать
  detail: string; // срок или подробность
  push: string; // начало строки в уведомлении; коды добавит pushLine
  pushOwnCodes?: boolean; // коды уже в push — не добавлять
  deadline: string | null; // ISO: к какому времени успеть — для порядка
  codes: string[];
  action: TodoAction | null;
  secondary?: { label: string; href: string }; // ссылка наружу (Studio, лог GitHub)
}

export const STUDIO_URL = "https://studio.youtube.com";
const MAX_PUSH_CODES = 6;
// Кто встанет в пустой слот и что с ним сделать.
const GAP_STAGE: Record<Stage, string> = {
  topic: "пока только тема",
  script: "есть сценарий, видео ещё нет",
  video: "видео готово — загрузите в Studio",
  studio: "уже в Studio — поставьте время",
  scheduled: "запланирован",
  published: "вышел",
};
const TOPICS_WARN_DAYS = 10;
const LEVEL_RANK: Record<TodoLevel, number> = { error: 0, warn: 1, info: 2 };
const HOUR_MS = 3_600_000;
const SOON_MS = 48 * HOUR_MS; // загрузить нужно «срочно», если первый ролик выходит раньше

// «08a, 08b, … и ещё 4» — в уведомлении места мало.
export function pushCodes(codes: string[]): string {
  return codes.length > MAX_PUSH_CODES ? `${codes.slice(0, MAX_PUSH_CODES).join(", ")} и ещё ${codes.length - MAX_PUSH_CODES}` : codes.join(", ");
}

export function pushLine(t: Todo): string {
  return t.codes.length && !t.pushOwnCodes ? `${t.push}: ${pushCodes(t.codes)}` : t.push;
}

// «через 20 ч», «через 3 дня»
function inLabel(ms: number): string {
  if (ms < HOUR_MS) return "меньше чем через час";
  if (ms < SOON_MS) {
    const h = Math.round(ms / HOUR_MS);
    return `через ${h} ч`;
  }
  const d = Math.floor(ms / (24 * HOUR_MS));
  return `через ${d} ${plural(d, "день", "дня", "дней")}`;
}

// «завтра 12:00», «сегодня 19:00», «пн, 12.10 12:00»
function slotLabel(state: PanelState, row: Row): string {
  const day = row.dateKey === state.todayKey ? "сегодня" : row.dateKey === state.tomorrowKey ? "завтра" : row.dateLabel;
  return `${day} ${row.timeLabel}`;
}

const byWhen = (a: Row, b: Row) => (a.when && b.when ? Date.parse(a.when) - Date.parse(b.when) : a.when ? -1 : b.when ? 1 : 0);

export function buildTodo(state: PanelState, now: Date): Todo[] {
  const nowMs = now.getTime();
  const rowOf = new Map(state.rows.map((r) => [r.code, r]));
  const reminder = (kind: "fill" | "problem") => state.reminders.find((m) => m.kind === kind);
  const rowsOf = (codes: string[] | undefined) => (codes ?? []).flatMap((c) => rowOf.get(c) ?? []).sort(byWhen);
  const todos: Todo[] = [];

  if (state.youtubeError) {
    todos.push({ id: "youtube", level: "error", title: "YouTube недоступен", detail: state.youtubeError, push: "YouTube недоступен — расписание не проверено", deadline: null, codes: [], action: null });
  }

  const run = failedRun(state.runs, nowMs);
  if (run) {
    const where = run.failedStage ? ` на этапе «${run.failedStage}»` : "";
    todos.push({
      id: "run",
      level: "error",
      title: `Не удался запуск «${run.label}»${where}`,
      detail: `${run.createdLabel}${run.attempt > 1 ? ` · попытка ${run.attempt}` : ""} — подробности в логе`,
      push: `не удался запуск «${run.label}»${where}`,
      deadline: null,
      codes: [],
      action: canRetry(run, state).ok ? { kind: "retry", label: "Повторить", runId: run.id } : { kind: "href", label: "Запуски", href: "/runs" },
      secondary: { label: "Лог ↗", href: run.url },
    });
  }

  const problems = rowsOf(reminder("problem")?.codes);
  if (problems.length) {
    todos.push({
      id: "problem",
      level: "error",
      title: "Проблемы с загрузкой в Studio",
      detail: "что не так и как исправить — в карточке ролика",
      push: "проблемы с загрузкой в Studio",
      deadline: null,
      codes: problems.map((r) => r.code),
      action: { kind: "open", label: `Открыть ${problems[0]!.code}`, code: problems[0]!.code },
    });
  }

  // Ролики, собранные на компьютере (без релиза), скачать из панели нельзя — только назвать.
  // Ждущие пересборки (content/rebuild.json) — не здесь: старую версию грузить не нужно.
  const upload = state.rows.filter((r) => r.stage === "video" && !r.hold).sort(byWhen);
  if (upload.length) {
    const first = upload.find((r) => r.when);
    const downloadable = upload.filter((r) => r.release).map((r) => r.code);
    const local = upload.filter((r) => !r.release).map((r) => r.code);
    const left = first?.when ? Date.parse(first.when) - nowMs : null;
    todos.push({
      id: "upload",
      level: left !== null && left < SOON_MS ? "warn" : "info",
      title: "Сохранить и загрузить в Studio",
      detail: [
        first?.when ? `${upload.length > 1 ? "первый выходит" : "выходит"} ${slotLabel(state, first)} (${inLabel(Math.max(0, left!))})` : "",
        local.length ? `${local.join(", ")} — видео только на компьютере` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      push: "загрузите в Studio",
      deadline: first?.when ?? null,
      codes: upload.map((r) => r.code),
      action: downloadable.length ? { kind: "download", label: downloadable.length > 1 ? `⬇ Скачать ${downloadable.length}` : "⬇ Скачать", codes: downloadable } : null,
      secondary: { label: "YouTube Studio ↗", href: STUDIO_URL },
    });
  }

  // Список — как у напоминания панели: то, что YouTube ещё обрабатывает, не в счёт. Дубли и
  // битые загрузки «Найти новые загрузки» не заполнит — они в деле выше.
  const fill = rowsOf(reminder("fill")?.codes).filter((r) => !problems.includes(r));
  if (fill.length) {
    const first = fill.find((r) => r.when);
    todos.push({
      id: "fill",
      level: "warn",
      title: "Поставить тексты и время выхода",
      detail: `загружены в Studio, но без времени выхода${first ? ` · первый слот — ${slotLabel(state, first)}` : ""}`,
      push: "в Studio без времени выхода",
      deadline: first?.when ?? null,
      codes: fill.map((r) => r.code),
      action: { kind: "find", label: "Найти новые загрузки" },
    });
  }

  // Запас — до первого пустого слота на YouTube (state.firstGap), а не до последнего
  // запланированного. Без YouTube о расписании судить нельзя — молчим, а не пугаем.
  const gap = state.firstGap;
  if (!state.youtubeError) {
    const days = state.runwayDays ?? 0;
    if (!state.scheduleEnd) {
      todos.push({ id: "runway", level: "warn", title: "Расписание пусто", detail: "на YouTube не запланирован ни один ролик", push: "расписание пусто", deadline: null, codes: [], action: null });
    } else if (gap && days < 2) {
      const gapRow = gap.code ? (rowOf.get(gap.code) ?? null) : null;
      const left = days < 1 ? "меньше суток" : `${days} ${plural(days, "день", "дня", "дней")}`;
      // Ждёт пересборки — не «загрузите», а пересобрать (кнопка в карточке) или дождаться сборки.
      const hold = gapRow?.hold ?? null;
      const what = hold ? (hold.rebuilding ? holdLabel(hold) : `${holdLabel(hold)} — старую версию не загружайте`) : gap.stage ? GAP_STAGE[gap.stage] : "";
      todos.push({
        id: "runway",
        level: "warn",
        title: `Пустой слот: ${gapRow?.dateKey ? slotLabel(state, gapRow) : gap.label}`,
        detail: `осталось ${left} · ${gap.code && what ? `встанет ${gap.code} — ${what}` : "роликов в очереди не хватает"}`,
        push: `пустой слот ${gap.label}${gap.code ? ` — встанет ${gap.code}` : ""}`,
        pushOwnCodes: true,
        deadline: gap.iso,
        codes: gap.code ? [gap.code] : [],
        action:
          gapRow?.stage === "studio"
            ? { kind: "find", label: "Найти новые загрузки" }
            : hold
              ? hold.rebuilding
                ? null
                : { kind: "open", label: `Открыть ${gapRow!.code}`, code: gapRow!.code }
              : gapRow?.stage === "video" && gapRow.release
                ? { kind: "download", label: "⬇ Скачать", codes: [gapRow.code] }
                : null,
      });
    }
  }

  // План кончается: меньше чем на 10 дней тем — пора добавить (workflow «план тем» ≈ 3–5 мин).
  if (state.topicsDays !== null && state.topicsDays < TOPICS_WARN_DAYS) {
    todos.push({
      id: "topics",
      level: "warn",
      title: `Темы плана закончатся ≈ ${state.topicsUntilLabel ? (/\d{2}\.\d{2}/.exec(state.topicsUntilLabel)?.[0] ?? state.topicsUntilLabel) : "скоро"}`,
      detail: `без сценария ${state.topicsLeft} ${plural(state.topicsLeft, "тема", "темы", "тем")} — плана хватит на ${state.topicsDays} ${plural(state.topicsDays, "день", "дня", "дней")}`,
      push: `темы плана закончатся через ${state.topicsDays} ${plural(state.topicsDays, "день", "дня", "дней")}`,
      deadline: state.topicsUntil,
      codes: [],
      action: { kind: "extend", label: "Добавить 10 тем", count: 10 },
    });
  }

  return todos.sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      (a.deadline && b.deadline ? Date.parse(a.deadline) - Date.parse(b.deadline) : a.deadline ? -1 : b.deadline ? 1 : 0) ||
      a.id.localeCompare(b.id),
  );
}

// Сколько дел ждёт внимания — число на иконке приложения: «информация» не в счёт.
export function badgeCount(todos: Todo[]): number {
  return todos.filter((t) => t.level !== "info").length;
}

export function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit" }).format(new Date(iso));
}
