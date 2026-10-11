// План выхода роликов канала другого языка (/lang/en). Грузит их человек руками в Studio, поэтому
// панель только считает время: ролики по порядку кодов — в слоты подряд от schedule.start из
// channels/<язык>.json (src/pipeline/channel.ts → planFromStart). Отметки «запланирован в Studio» —
// в переменной репозитория PANEL_LANG_STUDIO: время отмеченного ролика больше не съезжает.
// Чистые функции без сети — их проверяет scripts/lang-plan-test.ts.
import { isoNoMs, planFromStart, startPlanOf } from "../../src/pipeline/channel";
import { normCode } from "../../src/pipeline/codes";
import { nextToUpload, slotLabel, zoneLabel, type VideoSlot } from "./lang-slots";

export const STUDIO_MARKS_VAR = "PANEL_LANG_STUDIO";
// Отметок на язык — не больше (переменная GitHub — до 48 КБ); лишними уходят самые ранние.
export const STUDIO_MARKS_MAX = 400;

// язык → код → момент (мс), который стоит в Studio.
export type StudioMarks = Record<string, Record<string, number>>;

const LANG_KEY = /^[a-z]{2,3}$/;

// Терпимо к мусору: битое — пусто, кривые записи — пропускаем.
export function parseStudioMarks(raw: string | null | undefined): StudioMarks {
  let j: unknown;
  try {
    j = JSON.parse(raw ?? "");
  } catch {
    return {};
  }
  const out: StudioMarks = {};
  if (!j || typeof j !== "object" || Array.isArray(j)) return out;
  for (const [lang, list] of Object.entries(j as Record<string, unknown>)) {
    if (!LANG_KEY.test(lang) || !list || typeof list !== "object" || Array.isArray(list)) continue;
    const mine: Record<string, number> = {};
    for (const [c, at] of Object.entries(list as Record<string, unknown>)) {
      const code = normCode(c);
      const ms = typeof at === "string" ? Date.parse(at) : NaN;
      if (code && Number.isFinite(ms)) mine[code] = ms;
    }
    if (Object.keys(mine).length) out[lang] = mine;
  }
  return out;
}

// Поставить (at — момент) или снять (null) отметку; лишние — самые ранние по времени.
export function withStudioMark(marks: StudioMarks, lang: string, code: string, at: number | null): StudioMarks {
  const c = normCode(code);
  if (!c || !LANG_KEY.test(lang)) return marks;
  const mine = { ...(marks[lang] ?? {}) };
  if (at === null || !Number.isFinite(at)) delete mine[c];
  else mine[c] = at;
  const kept = Object.entries(mine)
    .sort((a, b) => b[1] - a[1])
    .slice(0, STUDIO_MARKS_MAX);
  const next = { ...marks };
  if (kept.length) next[lang] = Object.fromEntries(kept);
  else delete next[lang];
  return next;
}

// ISO без миллисекунд: переменную удобно читать и на GitHub.
export function studioMarksText(marks: StudioMarks): string {
  const out: Record<string, Record<string, string>> = {};
  for (const [lang, list] of Object.entries(marks)) {
    out[lang] = Object.fromEntries(
      Object.entries(list)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([c, at]) => [c, isoNoMs(new Date(at))]),
    );
  }
  return JSON.stringify(out);
}

export interface LangPlan {
  problem: string | null; // план не посчитан: что поправить в channels/<язык>.json
  zone: string; // «по Нью-Йорку»
  start: string | null; // «12 окт» — первый день выхода
  marks: boolean; // отметки прочитаны — кнопку «Запланирован в Studio» показываем
  order: string[]; // коды по времени выхода
  slots: Record<string, VideoSlot>;
  next: string | null; // ближайший к загрузке
}

// json — channels/<язык>.json; marks — отметки этого языка (null — не прочитались: время
// считаем без них, кнопку прячем, чтобы не затереть). Страница не падает ни на чём.
export function langPlanOf(json: unknown, codes: string[], marks: Readonly<Record<string, number>> | null, nowMs: number): LangPlan {
  const { plan, problem } = startPlanOf(json);
  const empty: LangPlan = { problem, zone: "", start: null, marks: marks !== null, order: [], slots: {}, next: null };
  if (!plan) return empty;
  const tz = plan.schedule.timezone;
  const planned = planFromStart(plan, codes, marks ?? {});
  const slots: Record<string, VideoSlot> = {};
  for (const [code, s] of planned) {
    slots[code] = { at: s.at.toISOString(), label: slotLabel(s.at, tz), past: s.at.getTime() <= nowMs, inStudio: s.fixed };
  }
  const order = [...planned.entries()].sort((a, b) => a[1].at.getTime() - b[1].at.getTime() || a[0].localeCompare(b[0])).map(([c]) => c);
  const [y, m, d] = plan.start.split("-").map(Number) as [number, number, number];
  // Полдень по UTC — та же календарная дата в любом поясе.
  const start = slotLabel(new Date(Date.UTC(y, m - 1, d, 12)), "UTC").split(",")[0]!;
  return { ...empty, zone: zoneLabel(tz), start, order, slots, next: nextToUpload(order, slots) };
}
