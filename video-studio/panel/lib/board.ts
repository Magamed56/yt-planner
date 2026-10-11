// «Доска» (/board): четыре зоны — YouTube «Суть за минуту», YouTube на английском, Instagram,
// TikTok — с карточками роликов, их статусом и запасом расписания над каждой. Чистые функции без
// сети — их проверяет scripts/board-test.ts; данные собирает app/board/page.tsx.
//   RU — очередь панели (state.ts): этап и время с YouTube, у остальных — ориентир по слотам;
//        запас — тот же coverage(), что у кольца запаса.
//   EN — план выхода от schedule.start (lang-plan.ts) и отметки «запланирован в Studio»
//        (PANEL_LANG_STUDIO).
//   Instagram и TikTok — русские Shorts из релизов в те же слоты; «загрузил» — отметка в
//        переменной PANEL_BOARD (как PANEL_LANG_STUDIO): время карточки закрепляется.
import { localDate, parseDay, startPlanOf, upcomingSlots, zonedTimeToUtc } from "../../src/pipeline/channel";
import { compareCodes, isLongCode } from "../../src/pipeline/codes";
import { langPlanOf, parseMarks, withMark, type StudioMarks } from "./lang-plan";
import { zoneLabel } from "./lang-slots";
import { plural, shiftDateKey, type Stage } from "./stages";
import { coverage, SLOT_GRID_DAYS, type PanelState, type Row, type SlotCell } from "./state";

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
export type BoardStatus = "published" | "scheduled" | "studio" | "ready" | "script";

export interface BoardItem {
  code: string;
  title: string;
  at: string; // ISO — время выхода
  dateKey: string; // YYYY-MM-DD по поясу зоны
  dateLabel: string; // «11.10»
  time: string; // «12:00»
  exact: boolean; // время точное (YouTube, план, отметка); false — ориентир
  status: BoardStatus;
  marked?: boolean; // есть кнопка «загрузил»: true — отмечен (можно снять), false — можно отметить
  note?: string;
  long?: boolean; // «Разбор» (L01)
}

export interface BoardRunway {
  text: string; // «запас до 14.10 (3 дня)»
  warn: boolean; // меньше двух дней или посчитать не вышло
}

export interface BoardZone {
  key: ZoneKey;
  title: string;
  sub: string; // «YouTube · по Москве»
  items: BoardItem[];
  runway: BoardRunway;
}

type RuRow = Pick<Row, "code" | "title" | "stage" | "when" | "whenExact" | "long" | "hold"> & { release: unknown };

export interface BoardInput {
  now: Date;
  ru: Pick<PanelState, "channelName" | "timezone" | "slotGrid" | "coverage" | "runwayDays" | "youtubeError"> & { rows: RuRow[] };
  en: {
    name: string;
    json: unknown; // channels/en.json
    released: string[]; // коды с релизом en-08a-….mp4 (lang-videos.ts)
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

function item(f: Format, code: string, title: string, at: number, rest: Pick<BoardItem, "exact" | "status"> & Partial<BoardItem>): BoardItem {
  return { code, title, at: new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z"), dateKey: f.key(at), dateLabel: f.day(at), time: f.time(at), ...rest };
}
const byTime = (a: BoardItem, b: BoardItem) => Date.parse(a.at) - Date.parse(b.at) || compareCodes(a.code, b.code);

function runway(until: number | null, days: number, f: Format): BoardRunway {
  if (until === null) return { text: "запаса нет — ближайший слот пуст", warn: true };
  return { text: `запас до ${f.day(until)} (${days} ${plural(days, "день", "дня", "дней")})`, warn: days < 2 };
}
const unknownRunway = (why: string): BoardRunway => ({ text: `запас неизвестен — ${why}`, warn: true });

// Запас по слотам grid: coverage() из state.ts — слоты подряд, на которые что-то стоит, и первая
// дыра; дней — до неё (как у кольца запаса).
function gridRunway(grid: SlotCell[], nowMs: number, f: Format): BoardRunway {
  const { coverage: levels, firstGap } = coverage([], grid, (iso) => iso);
  const until = levels.find((l) => l.level === "scheduled")?.untilIso ?? null;
  const days = firstGap ? Math.max(0, Math.floor((Date.parse(firstGap.iso) - nowMs) / DAY_MS)) : SLOT_GRID_DAYS;
  return runway(until ? Date.parse(until) : null, days, f);
}
const cell = (f: Format, t: number, occupant: string | null): SlotCell => ({ iso: new Date(t).toISOString(), dateKey: f.key(t), dateLabel: f.day(t), time: f.time(t), occupant });

function ruZone({ ru }: BoardInput): BoardZone {
  const f = format(ru.timezone);
  const items = ru.rows
    .filter((r) => r.when && RU_STATUS[r.stage])
    .map((r) =>
      item(f, r.code, r.title, Date.parse(r.when!), {
        exact: r.whenExact,
        status: RU_STATUS[r.stage]!,
        ...(r.hold ? { note: r.hold.rebuilding ? "пересобирается" : "ждёт пересборки" } : {}),
        ...(r.long ? { long: true } : {}),
      }),
    )
    .sort(byTime);
  // Запас — уже посчитанный очередью (coverage() по слотам Shorts): тот же, что у кольца.
  const until = ru.coverage.find((c) => c.level === "scheduled")?.untilIso ?? null;
  const rw = ru.youtubeError || ru.runwayDays === null ? unknownRunway("YouTube не ответил") : runway(until ? Date.parse(until) : null, ru.runwayDays, f);
  return { key: "ru", title: ru.channelName, sub: `YouTube · ${zoneLabel(ru.timezone)}`, items, runway: rw };
}

function enZone({ en, now }: BoardInput, titles: Map<string, string>): BoardZone {
  const nowMs = now.getTime();
  const { plan, problem } = startPlanOf(en.json);
  if (!plan) return { key: "en", title: en.name, sub: "YouTube", items: [], runway: unknownRunway(`нет плана выхода: ${problem}`) };
  const tz = plan.schedule.timezone;
  const f = format(tz);
  const lp = langPlanOf(en.json, en.released, en.marks, nowMs);
  const items = lp.order
    .map((code) => {
      const s = lp.slots[code]!;
      return item(f, code, titles.get(code) ?? "", Date.parse(s.at), {
        exact: true,
        status: s.inStudio ? (s.past ? "published" : "scheduled") : "ready",
        ...(!s.inStudio && s.past ? { note: "слот прошёл" } : {}),
        ...(isLongCode(code) ? { long: true } : {}),
      });
    })
    .sort(byTime);
  if (!en.marks) return { key: "en", title: en.name, sub: `YouTube · ${zoneLabel(tz)}`, items, runway: unknownRunway("отметки PANEL_LANG_STUDIO не прочитались") };
  // Слоты Shorts от сегодня (или от первого дня, если он впереди); занят — отмечен в Studio.
  const day = parseDay(plan.start)!;
  const from = Math.max(nowMs, zonedTimeToUtc(day.y, day.m, day.d, 0, 0, tz) - 60_000);
  const inStudio = new Map(lp.order.filter((c) => !isLongCode(c) && lp.slots[c]!.inStudio).map((c) => [minute(Date.parse(lp.slots[c]!.at)), c]));
  const perDay = Math.max(1, plan.schedule.publishTimesLocal.length);
  const grid = upcomingSlots(plan.schedule, SLOT_GRID_DAYS * perDay, { from: new Date(from) }).map((d) => cell(f, d.getTime(), inStudio.get(minute(d.getTime())) ?? null));
  return { key: "en", title: en.name, sub: `YouTube · ${zoneLabel(tz)}`, items, runway: gridRunway(grid, nowMs, f) };
}

function socialZone(platform: Social, { ru, now, marks: all }: BoardInput): BoardZone {
  const nowMs = now.getTime();
  const f = format(ru.timezone);
  const marks = all?.[platform] ?? {};
  const items = ru.rows
    // Русские Shorts, у которых есть файл в релизе (или уже отмеченные); «Разборы» (16:9) — не сюда.
    .filter((r) => !r.long && ((r.release && r.when) || marks[r.code] !== undefined))
    .map((r) => {
      const m = marks[r.code];
      const at = m ?? Date.parse(r.when!);
      // Ждёт пересборки — старую версию никуда не грузим: кнопки нет, пока не будет новой.
      const canMark = all !== null && (m !== undefined || !r.hold);
      let note: string | undefined;
      if (m === undefined && r.hold) note = "ждёт пересборки";
      else if (m === undefined && at < nowMs) note = "не выложен";
      return item(f, r.code, r.title, at, {
        exact: m !== undefined || r.whenExact,
        status: m === undefined ? "ready" : m <= nowMs ? "published" : "scheduled",
        ...(canMark ? { marked: m !== undefined } : {}),
        ...(note ? { note } : {}),
      });
    })
    .sort(byTime);
  // Те же слоты, что у русского канала; занят — на это время стоит отметка «загрузил».
  const byMinute = new Map(Object.entries(marks).map(([c, t]) => [minute(t), c]));
  const rw = all === null ? unknownRunway(`отметки ${BOARD_VAR} не прочитались`) : gridRunway(ru.slotGrid.map((c) => ({ ...c, occupant: byMinute.get(minute(Date.parse(c.iso))) ?? null })), nowMs, f);
  return { key: platform, title: SOCIAL_LABEL[platform], sub: "слоты русского канала", items, runway: rw };
}

export function buildBoard(input: BoardInput): BoardZone[] {
  const titles = new Map(input.ru.rows.map((r) => [r.code, r.title]));
  return [ruZone(input), enZone(input, titles), socialZone("instagram", input), socialZone("tiktok", input)];
}

// ---- раскладка полотна ----

// Размеры в точках полотна при масштабе 100 %.
export const CARD_W = 172;
export const CARD_H = 96;
export const GAP = 10;
export const ROW = CARD_H + GAP;
export const LABEL_W = 56; // столбец с датами слева в каждой зоне
export const PAD = 14;
export const HEAD = 72; // шапка зоны: название и запас
export const ZONE_GAP = 48;

export interface PlacedCard extends BoardItem {
  x: number; // от левого верхнего угла зоны
  y: number;
}
export interface PlacedZone extends Omit<BoardZone, "items"> {
  x: number;
  y: number;
  w: number;
  h: number;
  cards: PlacedCard[];
}
export interface BoardPlan {
  days: { key: string; y: number }[]; // строки дней — одни на все зоны
  todayY: number;
  zones: PlacedZone[];
  width: number;
  height: number;
}

// Зоны слева направо в своих местах; в каждой — строка на день, один и тот же день на одной
// высоте во всех зонах (площадки читаются поперёк), ролики дня — по времени слева направо.
// Дни — от самого раннего ролика до самого позднего, и не уже, чем от позавчера до недели вперёд.
export function layoutBoard(zones: BoardZone[], todayKey: string): BoardPlan {
  let from = shiftDateKey(todayKey, -2);
  let to = shiftDateKey(todayKey, 7);
  for (const z of zones)
    for (const it of z.items) {
      if (it.dateKey < from) from = it.dateKey;
      if (it.dateKey > to) to = it.dateKey;
    }
  const days: { key: string; y: number }[] = [];
  for (let k = from; k <= to && days.length < 1000; k = shiftDateKey(k, 1)) days.push({ key: k, y: HEAD + days.length * ROW });
  const rowY = new Map(days.map((d) => [d.key, d.y]));
  const height = HEAD + days.length * ROW + PAD;
  let x = 0;
  const placed = zones.map(({ items, ...zone }) => {
    const inDay = new Map<string, number>();
    const cards = items.map((it) => {
      const n = inDay.get(it.dateKey) ?? 0;
      inDay.set(it.dateKey, n + 1);
      return { ...it, x: PAD + LABEL_W + n * (CARD_W + GAP), y: rowY.get(it.dateKey) ?? HEAD };
    });
    const most = Math.max(2, ...inDay.values());
    const w = PAD * 2 + LABEL_W + most * CARD_W + (most - 1) * GAP;
    const z = { ...zone, x, y: 0, w, h: height, cards };
    x += w + ZONE_GAP;
    return z;
  });
  return { days, todayY: rowY.get(todayKey) ?? HEAD, zones: placed, width: Math.max(0, x - ZONE_GAP), height };
}
