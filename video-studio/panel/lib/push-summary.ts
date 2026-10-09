// Утреннее уведомление по состоянию панели: те же дела, что в карточке «Сейчас» (lib/todo.ts), и
// до какого дня хватит расписания. Чистая функция без сети — её зовёт ежедневный cron, проверяет
// scripts/push-test.ts.
import type { PushMessage } from "./push";
import type { PanelState } from "./state";
import { notable, yesterdayLine } from "./pulse";
import { badgeCount, buildTodo, pushLine, shortDate } from "./todo";

const BODY_MAX = 178; // столько iPhone показывает в уведомлении без раскрытия

// Одна строка вида «Загрузите в Studio: 08a, 08b · расписание до 14.10» — или null, если
// сегодня руками делать нечего, а расписания хватает минимум на двое суток.
export function dailySummary(state: PanelState, now = new Date(state.generatedAt)): PushMessage | null {
  const todos = buildTodo(state, now);
  const y = state.pulse.yesterday;
  // Дел нет — пишем, только если прошлые сутки заметные (±30 % к обычному, ролик от ×3, рубеж).
  if (!todos.length) {
    if (!y || !notable(y, y.milestone)) return null;
    const body = [y.milestone ? `🎉 ${y.milestone} подписчиков` : "", yesterdayLine(y)].filter(Boolean).join(" · ");
    return { title: "Сводка канала", body: clip(body.charAt(0).toUpperCase() + body.slice(1)), url: "/stats", tag: "daily", badge: 0 };
  }
  const parts = todos.map(pushLine);
  // Запас расписания без пропусков — для ориентира, даже когда он в порядке (короткий уже в
  // списке дел).
  const until = state.coverage.find((c) => c.level === "scheduled")?.untilIso;
  if (until && !state.youtubeError && !todos.some((t) => t.id === "runway")) parts.push(state.firstGap ? `расписание до ${shortDate(until, state.timezone)}` : "расписание без пропусков на 60 дней");
  // Цифры прошлых суток — в конце, если влезают в уведомление.
  const withNumbers = y ? [...parts, yesterdayLine(y)].join(" · ") : null;
  const body = withNumbers && withNumbers.length <= BODY_MAX ? withNumbers : parts.join(" · ");
  return {
    title: todos.some((t) => t.level === "error" || t.id === "runway") ? "Нужно внимание" : "Дела на сегодня",
    body: clip(body.charAt(0).toUpperCase() + body.slice(1)),
    // Нажатие ведёт к делу: упавший запуск — «Запуски», одно видео — сразу его карточка.
    url: todos.some((t) => t.id === "run") ? "/runs" : todos[0]!.codes.length === 1 ? `/?v=${todos[0]!.codes[0]}` : "/",
    tag: "daily",
    badge: badgeCount(todos),
  };
}

const clip = (s: string) => (s.length > BODY_MAX ? `${s.slice(0, BODY_MAX - 1).trimEnd()}…` : s);
