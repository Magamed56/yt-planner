// «Доска» (/board): четыре зоны — YouTube «Суть за минуту», YouTube на английском, Instagram,
// TikTok — с карточками роликов, их статусом и запасом расписания над каждой. Чистые функции без
// сети — их проверяет scripts/board-test.ts; данные собирает app/board/page.tsx.
//   RU — очередь панели (state.ts): этап и время с YouTube, у остальных — ориентир по слотам;
//        запас и первая дыра — те же coverage() и firstGap, что у кольца запаса.
//   EN — план выхода от schedule.start (lang-plan.ts) и отметки «запланирован в Studio»
//        (PANEL_LANG_STUDIO); название — английское из релиза, русское — запасное.
//   Instagram и TikTok — русские Shorts из релизов в те же слоты; «загрузил» — отметка в
//        переменной PANEL_BOARD (как PANEL_LANG_STUDIO): время карточки закрепляется.
// Без YouTube статусы русской очереди — ориентир: «загрузил» у неотмеченных прячем.
import { localDate, parseDay, startPlanOf, upcomingSlots, zonedTimeToUtc } from "../../src/pipeline/channel";
import { compareCodes, isLongCode } from "../../src/pipeline/codes";
import { langPlanOf, parseMarks, withMark, type StudioMarks } from "./lang-plan";
import type { LangVideo } from "./lang-videos";
import { zoneLabel } from "./lang-slots";
import { plural, shiftDateKey, type Stage } from "./stages";
import { coverage, SLOT_GRID_DAYS, type FirstGap, type PanelState, type Row, type SlotCell } from "./state";

export const BOARD_VAR = "PANEL_BOARD";
export const SOCIAL = ["instagram", "tiktok"] as const;
export type Social = (typeof SOCIAL)[number];
export const isSocial = (k: unknown): k is Social => typeof k === "string" && (SOCIAL as readonly string[]).includes(k);
export const SOCIAL_LABEL: Record<Social, string> = { instagram: "Instagram", tiktok: "TikTok" };

// { "instagram": { "08a": "2026-10-12T09:00:00Z" }, "tiktok": { … } } — разбор как у PANEL_LANG_STUDIO.
export const parseBoardMarks = (raw: string | null | undefined): StudioMarks => parseMarks(raw, isSocial);
export const withBoardMark = (marks: StudioMarks, platform: string, code: string, at: number | null): StudioMarks => withMark(marks, platform, code, at, isSocial);

const DAY_MS = 86_400_000;

export type ZoneKey = "ru" | "en" | Social;
export const ZONE_KEYS: ZoneKey[] = ["ru", "en", "instagram", "tiktok"];
export type BoardStatus = "published" | "scheduled" | "studio" | "ready" | "script";

export interface BoardItem {
  code: string;
  title: string;
  at: string; // ISO — время выхода
  dateKey: string; // YYYY-MM-DD по поясу зоны
  dateLabel: string; // «11.10»
  time: string; // «12:00»
  exact: boolean; // время точное (YouTube, отметка); false — ориентир («≈»)
  status: BoardStatus;
  cover: string | null; // миниатюра 9:16: обложка с YouTube или из релиза
  marked?: boolean; // есть кнопка «загрузил»: true — отмечен (можно снять), false — можно отметить
  // Instagram, TikTok без отметки: русский ролик уже стоит в расписании YouTube — его слот точный,
  // «загрузил» спросит: выложил сейчас или поставил на это время.
  fixedSlot?: boolean;
  note?: string;
  long?: boolean; // «Разбор» (L01)
}

export interface BoardGap {
  at: string; // ISO первого пустого слота
  label: string; // «13.10 19:00»
}

export interface BoardRunway {
  text: string; // «запас до 14.10 (3 дня)»
  warn: boolean; // меньше двух дней или посчитать не вышло
  gap: BoardGap | null; // первая дыра (coverage → firstGap); null — нет или неизвестно
}

export interface BoardEmpty {
  at: string;
  dateKey: string;
  time: string;
}

export interface BoardZone {
  key: ZoneKey;
  title: string;
  sub: string; // «YouTube · по Москве»
  items: BoardItem[];
  empty: BoardEmpty[]; // будущие слоты Shorts без ролика — рамка «пусто»
  runway: BoardRunway;
}

type RuRow = Pick<Row, "code" | "title" | "stage" | "when" | "whenExact" | "long" | "hold" | "cover"> & { release: unknown };

export interface BoardInput {
  now: Date;
  ru: Pick<PanelState, "channelName" | "timezone" | "slotGrid" | "coverage" | "runwayDays" | "youtubeError"> & { rows: RuRow[]; firstGap: FirstGap | null };
  en: {
    name: string;
    json: unknown; // channels/en.json
    released: { code: string; title: string; cover: string | null }[]; // ролики en-08a-….mp4 (lang-videos.ts)
    marks: Record<string, number> | null; // PANEL_LANG_STUDIO → en; null — не прочитались
  };
  marks: StudioMarks | null; // PANEL_BOARD; null — не прочиталась: кнопок нет, запас неизвестен
}

// Тема без сценария — ещё не ролик: на доске её нет.
const RU_STATUS: Partial<Record<Stage, BoardStatus>> = { published: "published", scheduled: "scheduled", studio: "studio", video: "ready", script: "script" };

function format(tz: string) {
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit" });
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const key = (t: number) => {
    const d = localDate(t, tz);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  };
  return { key, day: (t: number) => day.format(t), time: (t: number) => time.format(t) };
}
type Format = ReturnType<typeof format>;

const minute = (t: number) => Math.floor(t / 60_000);
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

function item(f: Format, code: string, title: string, at: number, rest: Pick<BoardItem, "exact" | "status" | "cover"> & Partial<BoardItem>): BoardItem {
  return { code, title, at: iso(at), dateKey: f.key(at), dateLabel: f.day(at), time: f.time(at), ...rest };
}
const byTime = (a: { at: string; code?: string }, b: { at: string; code?: string }) => Date.parse(a.at) - Date.parse(b.at) || compareCodes(a.code ?? "", b.code ?? "");

function runway(until: number | null, days: number, f: Format, gap: BoardGap | null): BoardRunway {
  if (until === null) return { text: "запаса нет — ближайший слот пуст", warn: true, gap };
  return { text: `запас до ${f.day(until)} (${days} ${plural(days, "день", "дня", "дней")})`, warn: days < 2, gap };
}
const unknownRunway = (why: string): BoardRunway => ({ text: `запас неизвестен — ${why}`, warn: true, gap: null });
const gapOf = (at: number, f: Format): BoardGap => ({ at: iso(at), label: `${f.day(at)} ${f.time(at)}` });

// Запас по слотам grid: coverage() из state.ts — слоты подряд, на которые что-то стоит, и первая
// дыра; дней — до неё (как у кольца запаса).
function gridRunway(grid: SlotCell[], nowMs: number, f: Format): BoardRunway {
  const { coverage: levels, firstGap } = coverage([], grid, (s) => s);
  const until = levels.find((l) => l.level === "scheduled")?.untilIso ?? null;
  const gap = firstGap ? Date.parse(firstGap.iso) : null;
  const days = gap !== null ? Math.max(0, Math.floor((gap - nowMs) / DAY_MS)) : SLOT_GRID_DAYS;
  return runway(until ? Date.parse(until) : null, days, f, gap !== null ? gapOf(gap, f) : null);
}
const cell = (f: Format, t: number, occupant: string | null): SlotCell => ({ iso: new Date(t).toISOString(), dateKey: f.key(t), dateLabel: f.day(t), time: f.time(t), occupant });

// Будущие слоты Shorts, на которых в зоне нет ни одной карточки.
function emptySlots(slots: number[], items: BoardItem[], f: Format): BoardEmpty[] {
  const busy = new Set(items.map((i) => minute(Date.parse(i.at))));
  return slots.filter((t) => !busy.has(minute(t))).map((t) => ({ at: iso(t), dateKey: f.key(t), time: f.time(t) }));
}

function ruZone({ ru, now }: BoardInput): BoardZone {
  const f = format(ru.timezone);
  const items = ru.rows
    .filter((r) => r.when && RU_STATUS[r.stage])
    .map((r) =>
      item(f, r.code, r.title, Date.parse(r.when!), {
        // Без YouTube время любого ролика — ориентир.
        exact: r.whenExact && !ru.youtubeError,
        status: RU_STATUS[r.stage]!,
        cover: r.cover,
        ...(r.hold ? { note: r.hold.rebuilding ? "пересобирается" : "ждёт пересборки" } : {}),
        ...(r.long ? { long: true } : {}),
      }),
    )
    .sort(byTime);
  const base = { key: "ru" as const, title: ru.channelName, sub: `YouTube · ${zoneLabel(ru.timezone)}`, items };
  // Без YouTube не знаем, что стоит в расписании, — ни запаса, ни пустых слотов.
  if (ru.youtubeError || ru.runwayDays === null) return { ...base, empty: [], runway: unknownRunway("YouTube не ответил") };
  // Запас — уже посчитанный очередью (coverage() по слотам Shorts): тот же, что у кольца.
  const until = ru.coverage.find((c) => c.level === "scheduled")?.untilIso ?? null;
  const gap = ru.firstGap ? gapOf(Date.parse(ru.firstGap.iso), f) : null;
  const slots = ru.slotGrid.map((c) => Date.parse(c.iso)).filter((t) => t > now.getTime());
  return { ...base, empty: emptySlots(slots, items, f), runway: runway(until ? Date.parse(until) : null, ru.runwayDays, f, gap) };
}

function enZone({ en, now }: BoardInput, titles: Map<string, string>): BoardZone {
  const nowMs = now.getTime();
  const { plan, problem } = startPlanOf(en.json);
  if (!plan) return { key: "en", title: en.name, sub: "YouTube", items: [], empty: [], runway: unknownRunway(`нет плана выхода: ${problem}`) };
  const tz = plan.schedule.timezone;
  const f = format(tz);
  const released = new Map(en.released.map((v) => [v.code, v]));
  const lp = langPlanOf(en.json, [...released.keys()], en.marks, nowMs);
  const items = lp.order
    .map((code) => {
      const s = lp.slots[code]!;
      const v = released.get(code);
      return item(f, code, v?.title || titles.get(code) || "", Date.parse(s.at), {
        // Точно — только время, поставленное в Studio; остальное — по плану, ориентир.
        exact: s.inStudio,
        status: s.inStudio ? (s.past ? "published" : "scheduled") : "ready",
        cover: v?.cover ?? null,
        ...(!s.inStudio && s.past ? { note: "слот прошёл" } : {}),
        ...(isLongCode(code) ? { long: true } : {}),
      });
    })
    .sort(byTime);
  const sub = `YouTube · ${zoneLabel(tz)}`;
  // Слоты Shorts от сегодня (или от первого дня, если он впереди).
  const day = parseDay(plan.start)!;
  const from = Math.max(nowMs, zonedTimeToUtc(day.y, day.m, day.d, 0, 0, tz) - 60_000);
  const perDay = Math.max(1, plan.schedule.publishTimesLocal.length);
  const times = upcomingSlots(plan.schedule, SLOT_GRID_DAYS * perDay, { from: new Date(from) }).map((d) => d.getTime());
  const empty = emptySlots(times, items, f);
  if (!en.marks) return { key: "en", title: en.name, sub, items, empty, runway: unknownRunway("отметки PANEL_LANG_STUDIO не прочитались") };
  // Занят — отмечен в Studio.
  const inStudio = new Map(lp.order.filter((c) => !isLongCode(c) && lp.slots[c]!.inStudio).map((c) => [minute(Date.parse(lp.slots[c]!.at)), c]));
  const grid = times.map((t) => cell(f, t, inStudio.get(minute(t)) ?? null));
  return { key: "en", title: en.name, sub, items, empty, runway: gridRunway(grid, nowMs, f) };
}

function socialZone(platform: Social, { ru, now, marks: all }: BoardInput): BoardZone {
  const nowMs = now.getTime();
  const f = format(ru.timezone);
  const marks = all?.[platform] ?? {};
  const blind = Boolean(ru.youtubeError); // без YouTube время и этап — ориентир
  const items = ru.rows
    // Русские Shorts, у которых есть файл в релизе (или уже отмеченные); «Разборы» (16:9) — не сюда.
    .filter((r) => !r.long && ((r.release && r.when) || marks[r.code] !== undefined))
    .map((r) => {
      const m = marks[r.code];
      const at = m ?? Date.parse(r.when!);
      // Ждёт пересборки — старую версию никуда не грузим. Без YouTube у неотмеченных кнопки нет:
      // время ролика — ориентир, отметка закрепила бы неверное.
      const canMark = all !== null && (m !== undefined || (!r.hold && !blind));
      let note: string | undefined;
      if (m === undefined && r.hold) note = "ждёт пересборки";
      else if (m === undefined && !blind && at < nowMs) note = "не выложен";
      return item(f, r.code, r.title, at, {
        // Точно — только время отметки; без неё карточка идёт за русским каналом (ориентир).
        exact: m !== undefined,
        status: m === undefined ? "ready" : m <= nowMs ? "published" : "scheduled",
        cover: r.cover,
        ...(canMark ? { marked: m !== undefined } : {}),
        ...(m === undefined && r.whenExact && !blind ? { fixedSlot: true } : {}),
        ...(note ? { note } : {}),
      });
    })
    .sort(byTime);
  const title = SOCIAL_LABEL[platform];
  const sub = platform === "instagram" ? "Reels · слоты русского канала" : "слоты русского канала";
  const slots = ru.slotGrid.map((c) => Date.parse(c.iso)).filter((t) => t > nowMs);
  const empty = emptySlots(slots, items, f);
  if (all === null) return { key: platform, title, sub, items, empty, runway: unknownRunway(`отметки ${BOARD_VAR} не прочитались`) };
  // Те же слоты, что у русского канала; занят — на это время стоит отметка «загрузил».
  const byMinute = new Map(Object.entries(marks).map(([c, t]) => [minute(t), c]));
  const grid = ru.slotGrid.map((c) => ({ ...c, occupant: byMinute.get(minute(Date.parse(c.iso))) ?? null }));
  return { key: platform, title, sub, items, empty, runway: gridRunway(grid, nowMs, f) };
}

export function buildBoard(input: BoardInput): BoardZone[] {
  const titles = new Map(input.ru.rows.map((r) => [r.code, r.title]));
  return [ruZone(input), enZone(input, titles), socialZone("instagram", input), socialZone("tiktok", input)];
}

// ---- раскладка полотна ----

// Первый день канала — постоянная точка отсчёта строк: у даты всегда одна и та же высота на полотне,
// сколько бы роликов ни добавилось. Ролик раньше неё (если вдруг) — строки начнутся с него.
export const BOARD_FIRST_DAY = "2026-10-06";
// Размеры в точках полотна при масштабе 100 %.
export const CARD_W = 216;
export const CARD_H = 104;
export const GAP = 10;
export const ROW = CARD_H + GAP;
export const PAD = 14;
export const HEAD = 104; // шапка зоны: полоса, название, запас, счётчики
export const ZONE_GAP = 40;
// В строке дня — столько карточек, сколько слотов Shorts (12:00, 19:00). Лишняя («Разбор» в
// 21:00) — второй строкой этого дня во всех зонах: зона из-за одного дня не шире.
export const COLS = 2;
export const DAYS_AHEAD = 7;

export interface PlacedCard extends BoardItem {
  x: number; // от левого верхнего угла зоны
  y: number;
  gap?: boolean; // стоит на первой дыре запаса
}
export interface PlacedEmpty extends BoardEmpty {
  x: number;
  y: number;
  gap?: boolean;
}
export interface PlacedZone extends Omit<BoardZone, "items" | "empty"> {
  x: number;
  y: number;
  w: number;
  h: number;
  cards: PlacedCard[];
  empty: PlacedEmpty[];
  counts: { published: number; scheduled: number; ready: number };
}
export interface BoardPlan {
  days: { key: string; y: number; h: number }[]; // строки дней — одни на все зоны
  todayY: number;
  zones: PlacedZone[];
  width: number;
  height: number;
  card: { w: number; h: number };
}

const keyMin = (a: string, b: string) => (a < b ? a : b);
const keyMax = (a: string, b: string) => (a > b ? a : b);

// Зоны слева направо в своих местах; в каждой — строки дней, один и тот же день на одной высоте во
// всех зонах (площадки читаются поперёк), ролики дня — по времени слева направо, пустые слоты —
// между ними. Дни — от первого дня канала до последнего ролика, и не меньше недели вперёд.
export function layoutBoard(zones: BoardZone[], todayKey: string): BoardPlan {
  let from = BOARD_FIRST_DAY;
  let to = shiftDateKey(todayKey, DAYS_AHEAD);
  for (const z of zones)
    for (const it of z.items) {
      from = keyMin(from, it.dateKey);
      to = keyMax(to, it.dateKey);
    }
  const keys: string[] = [];
  for (let k = from; k <= to && keys.length < 1500; k = shiftDateKey(k, 1)) keys.push(k);
  const inRange = (k: string) => k >= from && k <= to;

  // Что стоит в каждой зоне по дням: карточки и пустые слоты вместе, по времени.
  type Entry = { at: string; code?: string; card?: BoardItem; empty?: BoardEmpty };
  const perZone = zones.map((z) => {
    const byDay = new Map<string, Entry[]>();
    const add = (k: string, e: Entry) => byDay.set(k, [...(byDay.get(k) ?? []), e]);
    for (const it of z.items) add(it.dateKey, { at: it.at, code: it.code, card: it });
    for (const e of z.empty) if (inRange(e.dateKey)) add(e.dateKey, { at: e.at, empty: e });
    for (const list of byDay.values()) list.sort(byTime);
    return byDay;
  });
  // Высота дня — по самой полной зоне.
  const days: BoardPlan["days"] = [];
  let y = HEAD;
  for (const key of keys) {
    const lines = Math.max(1, ...perZone.map((m) => Math.ceil((m.get(key)?.length ?? 0) / COLS)));
    days.push({ key, y, h: lines * ROW });
    y += lines * ROW;
  }
  const rowY = new Map(days.map((d) => [d.key, d.y]));
  const height = y + PAD;
  const w = PAD * 2 + COLS * CARD_W + (COLS - 1) * GAP;

  let x = 0;
  const placed = zones.map(({ items, empty, ...zone }, zi) => {
    const gapMin = zone.runway.gap ? minute(Date.parse(zone.runway.gap.at)) : null;
    const isGap = (at: string) => gapMin !== null && minute(Date.parse(at)) === gapMin;
    const cards: PlacedCard[] = [];
    const holes: PlacedEmpty[] = [];
    for (const [key, list] of perZone[zi]!) {
      const top = rowY.get(key);
      if (top === undefined) continue;
      list.forEach((e, i) => {
        const pos = { x: PAD + (i % COLS) * (CARD_W + GAP), y: top + Math.floor(i / COLS) * ROW, ...(isGap(e.at) ? { gap: true } : {}) };
        if (e.card) cards.push({ ...e.card, ...pos });
        else if (e.empty) holes.push({ ...e.empty, ...pos });
      });
    }
    cards.sort(byTime);
    holes.sort(byTime);
    const counts = {
      published: items.filter((i) => i.status === "published").length,
      scheduled: items.filter((i) => i.status === "scheduled").length,
      ready: items.filter((i) => i.status === "ready").length,
    };
    const z = { ...zone, x, y: 0, w, h: height, cards, empty: holes, counts };
    x += w + ZONE_GAP;
    return z;
  });
  return { days, todayY: rowY.get(todayKey) ?? HEAD, zones: placed, width: Math.max(0, x - ZONE_GAP), height, card: { w: CARD_W, h: CARD_H } };
}

// ---- данные страницы ----

// Английский ролик для листа на доске: тексты для Studio, файлы — из релиза (lang-videos.ts).
export type EnVideo = Pick<LangVideo, "code" | "file" | "title" | "texts" | "url" | "mp4" | "cover" | "thumb" | "caption">;

// Всё, что нужно полотну и листу ролика (components/BoardCanvas.tsx).
export interface BoardData {
  plan: BoardPlan;
  todayKey: string;
  nowIso: string; // момент данных: «вышел» / «впереди» для только что нажатых отметок
  timezone: string; // пояс русского канала (МСК) — «по Москве» у английского ролика
  youtubeError: string | null; // YouTube не ответил: статусы — ориентир, «загрузил» скрыта
  state: PanelState; // для карточки русского ролика (VideoSheet)
  en: { videos: EnVideo[]; zone: string; timezone: string; canMark: boolean };
  shell: { updated: string; generatedAt: string; activeRuns: number; activeIds: number[]; runwayDays: number | null; runwayLabel: string | null };
}

const coverOf = (v: Pick<LangVideo, "cover" | "thumb">) => (v.cover ? `/api/asset/${v.cover.id}/file` : v.thumb ? `/api/asset/${v.thumb.id}/file` : null);

// Данные страницы из очереди, английских роликов и отметок — общий путь страницы и демо.
export function boardData(input: {
  now: Date;
  state: PanelState;
  enName: string;
  enJson: unknown;
  enVideos: LangVideo[];
  enMarks: Record<string, number> | null;
  boardMarks: StudioMarks | null;
}): BoardData {
  const { now, state } = input;
  const zones = buildBoard({
    now,
    ru: state,
    en: { name: input.enName, json: input.enJson, released: input.enVideos.map((v) => ({ code: v.code, title: v.texts?.title || v.title, cover: coverOf(v) })), marks: input.enMarks },
    marks: input.boardMarks,
  });
  const enPlan = startPlanOf(input.enJson).plan;
  const enTz = enPlan?.schedule.timezone ?? "America/New_York";
  const active = state.runs.filter((r) => r.active);
  return {
    plan: layoutBoard(zones, state.todayKey),
    todayKey: state.todayKey,
    nowIso: now.toISOString(),
    timezone: state.timezone,
    youtubeError: state.youtubeError,
    state,
    en: {
      videos: input.enVideos.map(({ code, file, title, texts, url, mp4, cover, thumb, caption }) => ({ code, file, title, texts, url, mp4, cover, thumb, caption })),
      zone: zoneLabel(enTz),
      timezone: enTz,
      canMark: input.enMarks !== null,
    },
    shell: {
      updated: state.updatedLabel,
      generatedAt: state.generatedAt,
      activeRuns: active.length,
      activeIds: active.map((r) => r.id),
      runwayDays: state.runwayDays,
      runwayLabel: state.runwayLabel,
    },
  };
}
