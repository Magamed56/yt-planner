// Удержание из YouTube Analytics API v2 для «Статистики»: один запрос на загрузку страницы — отчёт
// «Top videos» (dimensions=video, до 200 строк) со средним % и длительностью просмотра. Только чистые
// функции без сети и без node:* — запрос и токен в lib/youtube.ts, проверки — scripts/analytics-test.ts.
import { apiErrorInfo, isApiDisabled, isScopeError } from "../../src/pipeline/google-api";

export const ANALYTICS_REPORTS = "https://youtubeanalytics.googleapis.com/v2/reports";
export const ANALYTICS_MAX_ROWS = 200; // предел отчёта «Top videos»
// Сутки отчётов Analytics — по тихоокеанскому времени (данные приходят с задержкой 1–3 дня).
const ANALYTICS_TZ = "America/Los_Angeles";
const day = new Intl.DateTimeFormat("en-CA", { timeZone: ANALYTICS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export interface Retention {
  views: number; // просмотры по Analytics (у Shorts с 2025 года — каждый запуск и повтор)
  engagedViews: number | null; // засчитанные (прежний подсчёт — по ним порог монетизации); null — метрики нет
  avgDurationSec: number; // средняя длительность просмотра
  avgPercent: number; // средний % досмотра; у Shorts бывает больше 100 — из-за повторов
}

export interface AnalyticsRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

// С первой загрузки канала по сегодня. Дат нет (роликов нет) — null: спрашивать нечего.
export function analyticsRange(videos: { publishedAt?: string | null }[], now: Date): AnalyticsRange | null {
  const times = videos.map((v) => Date.parse(v.publishedAt ?? "")).filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  const endDate = day.format(now);
  const startDate = day.format(Math.min(...times));
  return { startDate: startDate < endDate ? startDate : endDate, endDate };
}

// Запрос отчёта: engaged=false — без engagedViews (если отчёт её не примет).
export function retentionQuery(range: AnalyticsRange, engaged: boolean): string {
  const metrics = ["views", ...(engaged ? ["engagedViews"] : []), "averageViewDuration", "averageViewPercentage"];
  return new URLSearchParams({
    ids: "channel==MINE",
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: "video",
    metrics: metrics.join(","),
    sort: "-views",
    maxResults: String(ANALYTICS_MAX_ROWS),
  }).toString();
}

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// Ответ — таблица: columnHeaders с именами и rows в том же порядке. Колонки ищем по имени: порядок
// не обещан, а engagedViews может не быть.
export function parseRetention(json: unknown): Map<string, Retention> {
  const out = new Map<string, Retention>();
  const j = json as { columnHeaders?: unknown; rows?: unknown } | null;
  const headers = Array.isArray(j?.columnHeaders) ? (j.columnHeaders as { name?: unknown }[]) : [];
  const names = headers.map((h) => (typeof h?.name === "string" ? h.name : ""));
  const at = (n: string) => names.indexOf(n);
  const [iVideo, iViews, iEngaged, iDur, iPct] = [at("video"), at("views"), at("engagedViews"), at("averageViewDuration"), at("averageViewPercentage")];
  if (iVideo < 0 || iViews < 0 || iDur < 0 || iPct < 0) return out;
  for (const row of Array.isArray(j?.rows) ? (j.rows as unknown[]) : []) {
    if (!Array.isArray(row)) continue;
    const id = row[iVideo];
    const views = num(row[iViews]);
    const dur = num(row[iDur]);
    const pct = num(row[iPct]);
    if (typeof id !== "string" || !id || views === null || dur === null || pct === null) continue;
    out.set(id, { views, engagedViews: iEngaged < 0 ? null : num(row[iEngaged]), avgDurationSec: dur, avgPercent: pct });
  }
  return out;
}

// ---- отказы: что показать на «Статистике» ----

export interface AnalyticsProblem {
  kind: "scope" | "disabled" | "error"; // нет права у ключа | API не включён в Google Cloud | прочее
  text: string;
  activationUrl: string | null; // где включить API (kind=disabled)
}

export function analyticsProblem(status: number, body: string): AnalyticsProblem {
  if (isScopeError(status, body)) return { kind: "scope", text: "у ключа YouTube нет права на YouTube Analytics", activationUrl: null };
  const info = apiErrorInfo(body);
  if (isApiDisabled(status, body)) return { kind: "disabled", text: "YouTube Analytics API не включён в проекте Google Cloud", activationUrl: info.activationUrl };
  return { kind: "error", text: `YouTube Analytics: HTTP ${status}${info.reason ? ` ${info.reason}` : ""} — ${info.message}`, activationUrl: null };
}

// 400 из-за engagedViews (метрика новая, 2025 год): повторяем без неё — % досмотра важнее.
export function engagedRejected(status: number, body: string): boolean {
  if (status !== 400) return false;
  const { message } = apiErrorInfo(body);
  return /engagedViews/i.test(message) || /query is not supported/i.test(message);
}

// ---- подписи и отметка слабого досмотра ----

// Слабый досмотр: в среднем смотрят меньше половины Shorts (у длинных — меньше 30 %). По паре
// просмотров выводов не делаем.
export const WEAK_RETENTION = { shortsPercent: 50, longPercent: 30, minViews: 20 };

export interface VideoRetention {
  views: number; // просмотры по Analytics — вес в среднем по каналу
  engagedViews: number | null;
  percent: number;
  percentLabel: string; // «68 %»
  durationSec: number;
  durationLabel: string; // «0:37»
  weak: boolean;
}

// Неразрывный пробел: в строке графика «досмотр 74 %» иначе переносится как «74» / «%».
export const percentText = (p: number) => `${Math.round(p)}\u00a0%`;

// 37 → «0:37», 605 → «10:05».
export function durationText(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function videoRetention(r: Retention | undefined, shorts: boolean, rule = WEAK_RETENTION): VideoRetention | null {
  if (!r) return null;
  const limit = shorts ? rule.shortsPercent : rule.longPercent;
  return {
    views: r.views,
    engagedViews: r.engagedViews,
    percent: r.avgPercent,
    percentLabel: percentText(r.avgPercent),
    durationSec: r.avgDurationSec,
    durationLabel: durationText(r.avgDurationSec),
    weak: r.views >= rule.minViews && r.avgPercent < limit,
  };
}

export interface RetentionOverview {
  videos: number; // роликов с данными Analytics
  percentLabel: string; // средний досмотр, взвешенный по просмотрам
  durationLabel: string;
  weak: number; // роликов со слабым досмотром
  engaged: boolean; // есть засчитанные просмотры — порог монетизации посчитан по ним
}

// Среднее по каналу — с весом по просмотрам: ролик на 10 просмотров не тянет среднее как хит.
export function retentionOverview(list: (VideoRetention | null | undefined)[]): RetentionOverview | null {
  const have = list.filter((r): r is VideoRetention => Boolean(r));
  const views = have.reduce((s, r) => s + r.views, 0);
  if (!have.length || views <= 0) return null;
  const avg = (f: (r: VideoRetention) => number) => have.reduce((s, r) => s + f(r) * r.views, 0) / views;
  return {
    videos: have.length,
    percentLabel: percentText(avg((r) => r.percent)),
    durationLabel: durationText(avg((r) => r.durationSec)),
    weak: have.filter((r) => r.weak).length,
    engaged: have.some((r) => r.engagedViews !== null),
  };
}
