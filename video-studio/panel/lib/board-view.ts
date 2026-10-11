// «Доска» в браузере: вид полотна (сдвиг и масштаб), время отметки «загрузил», фильтры, колесо.
// Модуль берёт полотно (components/BoardCanvas.tsx), а проверяет scripts/board-test.ts; из импортов —
// только коды роликов (codes.ts без импортов).
import { normCode } from "../../src/pipeline/codes";

export type View = { x: number; y: number; k: number };

// Статус карточки словами — на карточке, в легенде и в листе ролика.
export const STATUS_LABEL: Record<"published" | "scheduled" | "studio" | "ready" | "script", string> = {
  published: "вышел",
  scheduled: "запланирован",
  studio: "в Studio, без времени",
  ready: "готов, не загружен",
  script: "сценарий",
};

// Только что нажатая отметка («загрузил» или «запланирован в Studio») — поверх данных сервера,
// пока страница не обновилась: on — отмечен, at — время отметки.
export interface MarkState {
  on: boolean;
  at: string | null;
  t?: number; // когда нажали (мс): отметка «сейчас» позже момента данных — она уже «вышел»
}

export const MIN_K = 0.05;
export const MAX_K = 2.5;
// Мельче этого текст карточек не читается — «Сегодня» и перелёт к зоне берут одну зону по ширине.
export const READABLE_K = 0.8;
// Сдвиг меньше — касание, а не перетаскивание. Палец дрожит сильнее мыши.
export const MOVE_PX = { mouse: 5, touch: 10 } as const;
export const VIEW_KEY = "board-view-v2";

export const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

// Вид в памяти устройства: масштаб, сдвиг по горизонтали и сдвиг по высоте от строки «сегодня» —
// на следующий день строка «сегодня» другая, и вид встаёт по ней, как «Сегодня».
export interface StoredView {
  k: number;
  x: number;
  dy: number;
  day: string;
}

// baseY(k) — где по высоте стоит полотно у «Сегодня» при этом масштабе.
export function storeView(v: View, todayKey: string, baseY: (k: number) => number): StoredView {
  return { k: v.k, x: Math.round(v.x), dy: Math.round(v.y - baseY(v.k)), day: todayKey };
}

export function restoreView(raw: string | null, todayKey: string, baseY: (k: number) => number): View | null {
  let s: Partial<StoredView>;
  try {
    s = JSON.parse(raw ?? "") as Partial<StoredView>;
  } catch {
    return null;
  }
  if (!s || typeof s !== "object") return null;
  const { k, x, dy, day } = s;
  if (typeof k !== "number" || typeof x !== "number" || !Number.isFinite(k) || !Number.isFinite(x) || k < MIN_K || k > MAX_K) return null;
  // Другой день — по высоте как «Сегодня», масштаб и сдвиг вбок — как были.
  const same = day === todayKey && typeof dy === "number" && Number.isFinite(dy);
  return { k, x, y: baseY(k) + (same ? dy : 0) };
}

// «Загрузил»: время прошло или только примерное — отмечаем текущий момент; впереди и точное —
// спросить: выложил сейчас или поставил в расписание на это время. Точное — время самой карточки
// или слота (русский ролик стоит в расписании YouTube).
export type MarkTime = { kind: "now" } | { kind: "choose"; at: string };
export function markTime(card: { at: string; exact: boolean; fixedSlot?: boolean }, nowMs: number): MarkTime {
  const at = Date.parse(card.at);
  return (card.exact || card.fixedSlot) && Number.isFinite(at) && at > nowMs ? { kind: "choose", at: card.at } : { kind: "now" };
}

// Фильтры над полотном: «только не загруженные» и «ближайшие 7 дней».
export interface BoardFilters {
  notUploaded: boolean;
  week: boolean;
}
export function cardVisible(card: { status: string; dateKey: string }, f: BoardFilters, todayKey: string, weekEndKey: string): boolean {
  if (f.notUploaded && card.status !== "ready" && card.status !== "script") return false;
  if (f.week && (card.dateKey < todayKey || card.dateKey > weekEndKey)) return false;
  return true;
}

// Колесо: щипок тачпада (ctrlKey) и колесо мыши — масштаб, два пальца по тачпаду — сдвиг.
// Шаг ограничен ±60 точек: рывок колеса не уносит масштаб в край; коэффициент — по устройству:
// щипок шлёт мелкие шаги, мышь — крупные щелчки.
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  wheelDeltaY?: number;
}
export function wheelAction(e: WheelLike): { zoom: number } | { pan: [number, number] } {
  const mouse = e.deltaMode !== 0 || (e.deltaX === 0 && (e.wheelDeltaY !== undefined ? e.wheelDeltaY !== 0 && e.wheelDeltaY % 120 === 0 : Math.abs(e.deltaY) >= 50));
  if (!(e.ctrlKey || e.metaKey || mouse)) return { pan: [-e.deltaX, -e.deltaY] };
  const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const dy = Math.max(-60, Math.min(60, px));
  const pinch = e.ctrlKey && e.deltaMode === 0 && !mouse;
  return { zoom: Math.exp(-dy * (pinch ? 0.012 : 0.0025)) };
}

// Плавный перелёт камеры: 300 мс, ease-out.
export const FLY_MS = 300;
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export function lerpView(a: View, b: View, t: number): View {
  const e = easeOut(t);
  // Масштаб — по логарифму: при сильном приближении перелёт не «проваливается».
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * e);
  return { k, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

// ?v=instagram:08a — ключ листа в адресе.
export function parseSelected(raw: string | null | undefined, zones: string[]): { zone: string; code: string } | null {
  const [zone, rawCode, extra] = (raw ?? "").trim().split(":");
  const code = normCode(rawCode);
  const z = (zone ?? "").toLowerCase();
  return extra === undefined && code && zones.includes(z) ? { zone: z, code } : null;
}
