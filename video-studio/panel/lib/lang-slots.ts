// Время выхода роликов канала другого языка — то, что нужно и серверу, и телефону: подписи
// «12 окт, 12:00» и какой ролик грузить следующим. Без импортов: модуль берёт клиентский
// LangView. Слоты считает сервер — lib/lang-plan.ts.

export interface VideoSlot {
  at: string; // ISO-момент выхода
  label: string; // «12 окт, 12:00» в поясе канала — считает сервер: у телефона пояс свой
  past: boolean; // слот прошёл к загрузке страницы
  inStudio: boolean; // отмечен «запланирован в Studio»: время — из отметки, слот не съедет
}

// «12 окт, 12:00». Без timeZone — пояс устройства: так телефон показывает своё время.
export function slotLabel(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month").replace(/\.$/, "")}, ${get("hour")}:${get("minute")}`;
}

// «по Нью-Йорку»: город — в дательном падеже, незнакомый пояс — как есть.
const CITY: Record<string, string> = {
  "America/New_York": "Нью-Йорку",
  "America/Chicago": "Чикаго",
  "America/Denver": "Денверу",
  "America/Los_Angeles": "Лос-Анджелесу",
  "Europe/London": "Лондону",
  "Europe/Moscow": "Москве",
  "Asia/Bishkek": "Бишкеку",
  "Asia/Almaty": "Алматы",
  "Asia/Tashkent": "Ташкенту",
};
export const zoneLabel = (timeZone: string): string => (CITY[timeZone] ? `по ${CITY[timeZone]}` : `по поясу ${timeZone}`);

// Ближайший к загрузке: первый по времени ролик, чей слот ещё впереди и который не отмечен в
// Studio. inStudio — отметка с учётом только что нажатой кнопки (до обновления страницы).
export function nextToUpload(order: string[], slots: Readonly<Record<string, VideoSlot>>, inStudio: (code: string) => boolean = (c) => slots[c]?.inStudio === true): string | null {
  return order.find((c) => slots[c] && !slots[c].past && !inStudio(c)) ?? null;
}
