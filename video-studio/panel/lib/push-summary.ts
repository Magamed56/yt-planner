// Утреннее уведомление по состоянию панели: что сделать руками сегодня и до какого дня хватит
// расписания. Чистая функция без сети — её зовёт ежедневный cron, проверяет scripts/push-test.ts.
import type { PushMessage } from "./push";
import { plural } from "./stages";
import type { PanelState, Reminder } from "./state";

const CODE = /\b\d{2}[a-z]\b/gi; // коды роликов в тексте напоминания: «08a, 08b»
const MAX_CODES = 6;

const codesLabel = (codes: string[]) => (codes.length > MAX_CODES ? `${codes.slice(0, MAX_CODES).join(", ")} и ещё ${codes.length - MAX_CODES}` : codes.join(", "));
const codesIn = (text: string) => [...new Set((text.match(CODE) ?? []).map((c) => c.toLowerCase()))];

function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

// Одна строка вида «Загрузите в Studio: 08a, 08b · расписание до 14.10» — или null, если
// сегодня руками делать нечего, а расписания хватает минимум на двое суток.
export function dailySummary(state: PanelState): PushMessage | null {
  const reminder = (kind: Reminder["kind"]) => state.reminders.find((r) => r.kind === kind);
  const urgent: string[] = [];
  const todo: string[] = [];
  let url = "/";

  if (state.youtubeError) urgent.push("YouTube недоступен — расписание не проверено");
  const run = reminder("run");
  if (run) {
    const title = /«([^»]+)»/.exec(run.text)?.[1];
    urgent.push(title ? `не удался запуск «${title}»` : "не удался запуск");
    url = "/runs";
  }
  const problem = reminder("problem");
  if (problem) urgent.push(`проблемы с загрузкой в Studio: ${codesLabel(codesIn(problem.text))}`);

  const upload = state.rows.filter((r) => r.stage === "video").map((r) => r.code);
  if (upload.length) todo.push(`загрузите в Studio: ${codesLabel(upload)}`);
  // Список «без времени» — как у напоминания панели: ролики, которые YouTube ещё обрабатывает, не в счёт.
  const fill = reminder("fill");
  if (fill) todo.push(`в Studio без времени выхода: ${codesLabel(codesIn(fill.text))}`);

  let runway: string | null = null;
  let runwayShort = false;
  if (!state.youtubeError) {
    if (!state.scheduleEnd) {
      runway = "расписание пусто";
      runwayShort = true;
    } else {
      runway = `расписание до ${shortDate(state.scheduleEnd, state.timezone)}`;
      const days = state.runwayDays ?? 0;
      if (days < 2) {
        runway += days < 1 ? " — осталось меньше суток" : ` — остался ${days} ${plural(days, "день", "дня", "дней")}`;
        runwayShort = true;
      }
    }
  }

  const parts = [...urgent, ...todo];
  if (!parts.length && !runwayShort) return null;
  if (runway) parts.push(runway);
  const body = parts.join(" · ");
  return {
    title: urgent.length || runwayShort ? "Нужно внимание" : "Дела на сегодня",
    body: body.charAt(0).toUpperCase() + body.slice(1),
    url,
    tag: "daily",
  };
}
