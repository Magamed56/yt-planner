// «Доска»: раскладка (свои места зон и сдвиги карточек) и стикеры — та же переменная PANEL_BOARD,
// что и отметки «загрузил» (весь объект разбирает и пишет lib/board.ts: parseBoardState,
// boardStateText). Здесь — разделы без сети и без тяжёлых импортов: модуль берёт и полотно в
// браузере (components/BoardCanvas.tsx) — одни и те же правила локально и на сервере. Проверяет
// scripts/board-test.ts. Из импортов — только коды роликов (codes.ts без импортов).
import { normCode } from "../../src/pipeline/codes";
import type { BoardPlan } from "./board";

export const SOCIAL = ["instagram", "tiktok"] as const;
export type Social = (typeof SOCIAL)[number];
export const isSocial = (k: unknown): k is Social => typeof k === "string" && (SOCIAL as readonly string[]).includes(k);

export type ZoneKey = "ru" | "en" | Social;
export const ZONE_KEYS: ZoneKey[] = ["ru", "en", "instagram", "tiktok"];
export const isZoneKey = (k: unknown): k is ZoneKey => typeof k === "string" && (ZONE_KEYS as string[]).includes(k);

// Координаты — целые точки полотна; дальше ±COORD_MAX не уносим: «Вписать» и мини-карта остаются
// осмысленными, а мусор во входе не раздувает числа.
export const COORD_MAX = 100_000;
export const STICKER_MAX = 100;
export const STICKER_TEXT_MAX = 280;
// Переменная GitHub — до 48 КБ; больше — ошибка до записи, а не обрезанный JSON.
export const BOARD_BYTES_MAX = 48 * 1024;
export const STICKER_W = 200;
export const STICKER_H = 200;
export const STICKER_COLORS = ["yellow", "orange", "pink", "green", "blue"] as const;
export type StickerColor = (typeof STICKER_COLORS)[number];
export const STICKER_COLOR_LABEL: Record<StickerColor, string> = { yellow: "жёлтый", orange: "оранжевый", pink: "розовый", green: "зелёный", blue: "синий" };
const isColor = (c: unknown): c is StickerColor => typeof c === "string" && (STICKER_COLORS as readonly string[]).includes(c);

export interface ZonePos {
  x: number; // левый верхний угол зоны на полотне
  y: number;
}
export interface CardShift {
  dx: number; // сдвиг от места по дате (layoutBoard)
  dy: number;
}
export interface BoardLayout {
  zones: Partial<Record<ZoneKey, ZonePos>>;
  cards: Record<string, CardShift>; // «ru:08a»
}
export interface Sticker {
  id: string;
  x: number;
  y: number;
  text: string;
  color: StickerColor;
}

export const emptyLayout = (): BoardLayout => ({ zones: {}, cards: {} });
export const isLayoutEmpty = (l: BoardLayout) => !Object.keys(l.zones).length && !Object.keys(l.cards).length;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// Целое в пределах ±COORD_MAX; не число — null.
export function coord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(-COORD_MAX, Math.min(COORD_MAX, Math.round(v))) : null;
}

// Ключ карточки — «зона:код», код через normCode: «RU:08A» → «ru:08a», чужое — null.
export function cardKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const i = raw.indexOf(":");
  const zone = raw.slice(0, Math.max(0, i)).trim().toLowerCase();
  const code = normCode(raw.slice(i + 1));
  return i > 0 && isZoneKey(zone) && code ? `${zone}:${code}` : null;
}

// Раздел layout из переменной — терпимо к мусору: кривые записи пропускаем.
export function layoutOf(raw: unknown): BoardLayout {
  const out = emptyLayout();
  const j = obj(raw);
  if (!j) return out;
  for (const [k, v] of Object.entries(obj(j.zones) ?? {})) {
    const p = obj(v);
    const x = coord(p?.x);
    const y = coord(p?.y);
    if (isZoneKey(k) && x !== null && y !== null) out.zones[k] = { x, y };
  }
  for (const [k, v] of Object.entries(obj(j.cards) ?? {})) {
    const key = cardKey(k);
    const p = obj(v);
    const dx = coord(p?.dx);
    const dy = coord(p?.dy);
    if (key && dx !== null && dy !== null && (dx || dy)) out.cards[key] = { dx, dy };
  }
  return out;
}

// Патч раскладки от полотна: зона — новый угол или null (на место по датам), карточка — сдвиг или
// null; reset — «По датам»: всё на места, стикеры не трогаем (они в своём разделе).
export interface LayoutPatch {
  reset?: boolean;
  zones?: Partial<Record<ZoneKey, ZonePos | null>>;
  cards?: Record<string, CardShift | null>;
}

// null — патч непонятен (чужая зона, кривой код, не число): ничего не меняем.
export function patchLayout(layout: BoardLayout, raw: unknown): BoardLayout | null {
  const p = obj(raw);
  if (!p) return null;
  const zones = p.zones === undefined ? {} : obj(p.zones);
  const cards = p.cards === undefined ? {} : obj(p.cards);
  if (!zones || !cards || (p.reset !== undefined && typeof p.reset !== "boolean")) return null;
  const next: BoardLayout = p.reset ? emptyLayout() : { zones: { ...layout.zones }, cards: { ...layout.cards } };
  for (const [k, v] of Object.entries(zones)) {
    if (!isZoneKey(k)) return null;
    if (v === null) {
      delete next.zones[k];
      continue;
    }
    const x = coord(obj(v)?.x);
    const y = coord(obj(v)?.y);
    if (x === null || y === null) return null;
    next.zones[k] = { x, y };
  }
  for (const [k, v] of Object.entries(cards)) {
    const key = cardKey(k);
    if (!key) return null;
    if (v === null) {
      delete next.cards[key];
      continue;
    }
    const dx = coord(obj(v)?.dx);
    const dy = coord(obj(v)?.dy);
    if (dx === null || dy === null) return null;
    // Вернули на место — записи нет: переменная не копит нули.
    if (dx || dy) next.cards[key] = { dx, dy };
    else delete next.cards[key];
  }
  return next;
}

const STICKER_ID = /^[a-z0-9_-]{1,32}$/i;
// Переводы строк — как в textarea; управляющие символы — прочь.
const cleanText = (t: string) => t.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""); // eslint-disable-line no-control-regex
export const textLength = (t: string) => Array.from(t).length;

function stickerOf(raw: unknown, strict: boolean): Sticker | string {
  const s = obj(raw);
  if (!s) return "Неверный стикер — обновите страницу.";
  const x = coord(s.x);
  const y = coord(s.y);
  if (typeof s.id !== "string" || !STICKER_ID.test(s.id) || x === null || y === null) return "Неверный стикер — обновите страницу.";
  let text = typeof s.text === "string" ? cleanText(s.text) : "";
  if (textLength(text) > STICKER_TEXT_MAX) {
    if (strict) return `Стикер — до ${STICKER_TEXT_MAX} знаков.`;
    text = Array.from(text).slice(0, STICKER_TEXT_MAX).join("");
  }
  if (strict && !isColor(s.color)) return "Неверный цвет стикера — обновите страницу.";
  return { id: s.id, x, y, text, color: isColor(s.color) ? s.color : STICKER_COLORS[0] };
}

// Раздел stickers из переменной — терпимо: кривые пропускаем, длинный текст режем, повторы id и
// всё сверх STICKER_MAX — прочь.
export function stickersOf(raw: unknown): Sticker[] {
  if (!Array.isArray(raw)) return [];
  const out: Sticker[] = [];
  for (const r of raw) {
    const s = stickerOf(r, false);
    if (typeof s !== "string" && out.length < STICKER_MAX && !out.some((o) => o.id === s.id)) out.push(s);
  }
  return out;
}

// Действие со стикером: put — добавить или заменить (по id), delete — убрать.
export type StickerOp = { op: "put"; sticker: Sticker } | { op: "delete"; id: string };

// Вход от полотна строже: длинный текст и чужой цвет — ошибка, а не тихая правка.
export function patchStickers(list: Sticker[], raw: unknown): Sticker[] | string {
  const p = obj(raw);
  if (p?.op === "delete") return typeof p.id === "string" ? list.filter((s) => s.id !== p.id) : "Неверный стикер — обновите страницу.";
  if (p?.op !== "put") return "Неверное действие со стикером — обновите страницу.";
  const s = stickerOf(p.sticker, true);
  if (typeof s === "string") return s;
  const i = list.findIndex((o) => o.id === s.id);
  if (i >= 0) return list.map((o, j) => (j === i ? s : o));
  if (list.length >= STICKER_MAX) return `Стикеров уже ${STICKER_MAX} — удалите лишние.`;
  return [...list, s];
}

export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

// ---- раскладка на полотне ----

// Свои места зон и сдвиги карточек поверх раскладки по датам (layoutBoard). Строки дней, линия
// «Сегодня» и колонка дат остаются общими — по датам.
export function applyLayout(plan: BoardPlan, layout: BoardLayout): BoardPlan {
  if (isLayoutEmpty(layout)) return plan;
  return {
    ...plan,
    zones: plan.zones.map((z) => {
      const pos = layout.zones[z.key];
      const cards = z.cards.map((c) => {
        const d = layout.cards[`${z.key}:${c.code}`];
        return d ? { ...c, x: c.x + d.dx, y: c.y + d.dy } : c;
      });
      return { ...z, ...(pos ? { x: pos.x, y: pos.y } : {}), cards };
    }),
  };
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Рамка всего, что стоит на полотне: зоны, вынесенные за них карточки и стикеры — для «Вписать»
// и мини-карты (зоны могли уехать влево или вверх, в минус).
export function boardBounds(plan: BoardPlan, stickers: Pick<Sticker, "x" | "y">[] = []): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const z of plan.zones) {
    add(z.x, z.y, z.w, z.h);
    for (const c of z.cards) add(z.x + c.x, z.y + c.y, plan.card.w, plan.card.h);
  }
  for (const s of stickers) add(s.x, s.y, STICKER_W, STICKER_H);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: Math.max(1, plan.width), h: Math.max(1, plan.height) };
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
