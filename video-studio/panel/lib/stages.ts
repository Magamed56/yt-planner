// Этапы ролика и мелочи для текста — без импортов: модуль нужен и серверу, и браузеру
// (state.ts тянет код video-studio с node:fs — в клиентские компоненты его брать нельзя).

export type Stage = "topic" | "script" | "video" | "studio" | "scheduled" | "published";

export const STAGES: Stage[] = ["topic", "script", "video", "studio", "scheduled", "published"];

export const STAGE_LABEL: Record<Stage, string> = {
  topic: "Тема",
  script: "Сценарий",
  video: "Видео",
  studio: "В Studio",
  scheduled: "Запланирован",
  published: "Вышел",
};

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const codesLabel = (codes: string[], max = 8) => (codes.length > max ? `${codes.slice(0, max).join(", ")} и ещё ${codes.length - max}` : codes.join(", "));

// «2026-10-15» ± дни — календарная арифметика без часовых поясов.
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// Название запуска по-русски для списка «Запусков», «Сейчас» и уведомлений — вместо заголовка
// GitHub («batch: 08a,08b»). kind — RunKind из state.ts (здесь строкой: модуль без импортов).
export function runLabel(kind: string, title: string, codes: string[]): string {
  const list = codes.length ? ` · ${codes.join(", ")}` : "";
  const check = /\(проверка\)/.test(title) ? " (проверка)" : "";
  switch (kind) {
    case "batch":
      return `Ролик${list}`;
    case "render":
      return `Сборка видео${list}`;
    case "draft":
      return codes.length ? `${codes.length > 1 ? "Сценарии" : "Сценарий"}${list}` : "Сценарии по расписанию";
    case "plan":
      return `План ${/\+\d+/.exec(title)?.[0] ?? "+"} тем`;
    case "titles":
      return `Названия${list}`;
    case "captions":
      return `Субтитры${list}${check}`;
    case "fill":
      return `Заполнение YouTube${list}${check}`;
    case "check":
      return "Проверка ключей";
    case "instagram":
      return "Публикация в Instagram";
    default:
      return title;
  }
}
