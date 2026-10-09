// Утреннее уведомление по состоянию панели: те же дела, что в карточке «Сейчас» (lib/todo.ts), и
// до какого дня хватит расписания. Чистая функция без сети — её зовёт ежедневный cron, проверяет
// scripts/push-test.ts.
import type { PushMessage } from "./push";
import type { PanelState } from "./state";
import { badgeCount, buildTodo, pushLine, shortDate } from "./todo";

// Одна строка вида «Загрузите в Studio: 08a, 08b · расписание до 14.10» — или null, если
// сегодня руками делать нечего, а расписания хватает минимум на двое суток.
export function dailySummary(state: PanelState, now = new Date(state.generatedAt)): PushMessage | null {
  const todos = buildTodo(state, now);
  if (!todos.length) return null;
  const parts = todos.map(pushLine);
  // Запас расписания — для ориентира, даже когда он в порядке (короткий уже в списке дел).
  if (state.scheduleEnd && !state.youtubeError && !todos.some((t) => t.id === "runway")) parts.push(`расписание до ${shortDate(state.scheduleEnd, state.timezone)}`);
  const body = parts.join(" · ");
  return {
    title: todos.some((t) => t.level === "error" || t.id === "runway") ? "Нужно внимание" : "Дела на сегодня",
    body: body.charAt(0).toUpperCase() + body.slice(1),
    url: todos.some((t) => t.id === "run") ? "/runs" : "/",
    tag: "daily",
    badge: badgeCount(todos),
  };
}
