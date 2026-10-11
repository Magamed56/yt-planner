// «Ждёт пересборки»: content/rebuild.json — ролики, чьи релизы собраны с ошибкой и пересобираются.
// Пока у такого ролика нет релиза, опубликованного позже since, панель не зовёт грузить старую
// версию в Studio (карточка «Сейчас», «Скачать», напоминание, утреннее уведомление). Появился
// релиз новее — ролик сам снова «видео готово». Из импортов — только коды: модуль нужен и браузеру.
import { normCode } from "../../src/pipeline/codes";

export const REBUILD_FILE = "content/rebuild.json";

export interface RebuildMark {
  since: string; // ISO: годится только релиз, опубликованный позже
  reason: string;
}

export interface Hold {
  reason: string;
  since: string;
  sinceLabel: string; // «вс, 11.10 15:00» — в поясе канала
  rebuilding: boolean; // сейчас идёт сборка этого ролика (video-studio.yml, batch/render)
}

// Время с поясом («…Z», «…+03:00») или просто дата: без пояса строку сервер и браузер поняли бы
// по-разному.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const isoOf = (v: unknown): string | null => {
  if (typeof v !== "string" || !ISO_WITH_ZONE.test(v.trim())) return null;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// { since, reason, codes: ["08a", { code: "11b", since: "…", reason: "…" }] } → код → отметка.
// Битый файл или запись — молча мимо: без списка панель ведёт себя как раньше.
export function parseRebuildList(raw: unknown): Map<string, RebuildMark> {
  const out = new Map<string, RebuildMark>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const j = raw as { since?: unknown; reason?: unknown; codes?: unknown };
  if (!Array.isArray(j.codes)) return out;
  const since = isoOf(j.since);
  const reason = text(j.reason);
  for (const c of j.codes) {
    const own = c && typeof c === "object" ? (c as { code?: unknown; since?: unknown; reason?: unknown }) : null;
    const code = normCode(own ? own.code : c);
    const at = (own ? isoOf(own.since) : null) ?? since;
    if (code && at) out.set(code, { since: at, reason: (own ? text(own.reason) : "") || reason });
  }
  return out;
}

// Что в файле не понято — для заметки в панели: опечатка в since иначе молча вернула бы старые
// версии в «Загрузить в Studio». Файла нет (null) — не ошибка.
export function rebuildProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const j = typeof raw === "object" && !Array.isArray(raw) ? (raw as { codes?: unknown }) : null;
  if (!j || !Array.isArray(j.codes)) return `${REBUILD_FILE} не понят — нужен { "since": "…", "reason": "…", "codes": [ … ] }. Пока никто не ждёт пересборки.`;
  const name = (c: unknown) => (c && typeof c === "object" ? String((c as { code?: unknown }).code ?? "?") : String(c));
  const list = (cs: unknown[]) => `${cs.slice(0, 6).map(name).join(", ")}${cs.length > 6 ? "…" : ""}`;
  const lost = j.codes.filter((c) => parseRebuildList({ ...j, codes: [c] }).size === 0);
  // Свой since не понят — запись держится на общем: так безопаснее, но задумано было другое.
  const own = j.codes.filter((c) => !lost.includes(c) && c && typeof c === "object" && (c as { since?: unknown }).since !== undefined && parseRebuildList({ codes: [c] }).size === 0);
  if (!lost.length && !own.length) return null;
  return [
    `${REBUILD_FILE}: время нужно с поясом («2026-10-11T12:00:00Z») или просто дата, код — как «08a».`,
    lost.length ? `Не понято: ${list(lost)} — их панель пока зовёт загружать как обычно.` : "",
    own.length ? `У ${list(own)} свой since не понят — взят общий.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// Релиз «свежий», если опубликован позже since. Именно published_at: created_at у релиза GitHub —
// дата коммита, и пересборка с коммита до since выглядела бы старой.
export const releaseIsFresh = (release: { publishedAt: string | null; createdAt: string } | null, since: string): boolean =>
  release !== null && Date.parse(release.publishedAt ?? release.createdAt) > Date.parse(since);

export const holdLabel = (h: Pick<Hold, "rebuilding">): string => (h.rebuilding ? "пересобирается" : "ждёт пересборки");

// Запуск сборки русского ролика: у других языков в названии «[en]» — их ролики свои.
export const buildsVideo = (r: { kind: string; title: string }): boolean => (r.kind === "batch" || r.kind === "render") && !/\[[a-z-]+\]\s*$/i.test(r.title);
