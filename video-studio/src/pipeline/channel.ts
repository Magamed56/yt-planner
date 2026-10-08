// Настройки канала из channel.json (название, голос, расписание, хэштеги,
// призывы, ссылки, дисклеймер) — умолчания для всего конвейера. Файл
// необязателен: без него всё работает как раньше. Переменные окружения
// (CHANNEL_NAME, GEMINI_TTS_VOICE, PUBLISH_TIMES…) всегда сильнее файла —
// так секреты и переменные GitHub Actions перебивают репозиторий.
// Здесь — разбор и слоты без файловой системы (их берёт и веб-панель); чтение
// channel.json с диска — loadChannel в channel-file.ts.

import { THEME_NAMES, type ThemeName } from "../types";

export interface ChannelSchedule {
  perDay: number;
  publishTimesLocal: string[]; // "HH:MM", по возрастанию
  timezone: string; // IANA, например Europe/Moscow
}

export interface ChannelConfig {
  file: string | null; // откуда прочитан (null — файла нет)
  name: string | null;
  handle: string | null;
  tagline: string | null;
  language: string;
  theme: ThemeName | null;
  voice: { provider: string | null; name: string | null; style: string | null };
  schedule: ChannelSchedule;
  hashtags: { brand: string[]; core: string[]; youtubeShorts: string[]; instagram: string[] };
  cta: { subscribe: string | null; comment: string | null; onScreenComment: string | null };
  links: { youtube: string | null; instagram: string | null };
  disclaimer: string | null;
}

export const DEFAULT_SCHEDULE: ChannelSchedule = { perDay: 2, publishTimesLocal: ["12:00", "19:00"], timezone: "Europe/Moscow" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => Boolean(s)) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// Хэштег в виде «#слово»: без пробелов и знаков, которые его обрывают.
export function normalizeHashtag(raw: string): string | null {
  const body = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return body.length >= 2 ? `#${body}` : null;
}

function hashtagList(v: unknown): string[] {
  return strList(v).map(normalizeHashtag).filter((s): s is string => Boolean(s));
}

export function parseTimes(raw: string[] | string): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[,;\s]+/);
  const out = new Set<string>();
  for (const t of list) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(t.trim());
    if (!m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    out.add(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return [...out].sort();
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Разбор уже прочитанного channel.json (loadChannel читает его с диска, веб-панель — из GitHub).
export function channelFromJson(json: unknown, env: Readonly<Record<string, string | undefined>> = {}, file: string | null = null): ChannelConfig {
  const raw = obj(json);
  const used = file;
  const voice = obj(raw.voice);
  const schedule = obj(raw.schedule);
  const hashtags = obj(raw.hashtags);
  const cta = obj(raw.cta);
  const links = obj(raw.links);
  const theme = str(raw.theme);

  // Расписание: PUBLISH_TIMES / PUBLISH_TZ сильнее файла; старый формат — одно время publishTimeLocal.
  const timesEnv = env.PUBLISH_TIMES?.trim();
  const fileTimes = strList(schedule.publishTimesLocal).length ? strList(schedule.publishTimesLocal) : strList([schedule.publishTimeLocal]);
  let times = parseTimes(timesEnv || fileTimes);
  if (!times.length) times = DEFAULT_SCHEDULE.publishTimesLocal;
  const tz = env.PUBLISH_TZ?.trim() || str(schedule.timezone) || DEFAULT_SCHEDULE.timezone;
  if (!isValidTimeZone(tz)) throw new Error(`Часовой пояс «${tz}» не распознан (PUBLISH_TZ или schedule.timezone в channel.json). Пример: Europe/Moscow, Asia/Bishkek.`);

  return {
    file: used,
    name: env.CHANNEL_NAME?.trim() || str(raw.name),
    handle: str(raw.handle)?.replace(/^@/, "") ?? null,
    tagline: str(raw.tagline),
    language: str(raw.language) ?? "ru",
    theme: theme && THEME_NAMES.includes(theme as ThemeName) ? (theme as ThemeName) : null,
    voice: { provider: str(voice.provider), name: str(voice.name), style: str(voice.style) },
    schedule: { perDay: times.length, publishTimesLocal: times, timezone: tz },
    hashtags: {
      brand: hashtagList(hashtags.brand),
      core: hashtagList(hashtags.core),
      youtubeShorts: hashtagList(hashtags.youtubeShorts),
      instagram: hashtagList(hashtags.instagram),
    },
    cta: { subscribe: str(cta.subscribe), comment: str(cta.comment), onScreenComment: str(cta.onScreenComment) },
    links: { youtube: str(links.youtube), instagram: str(links.instagram) },
    disclaimer: str(raw.disclaimer),
  };
}

// Умолчания конвейера из канала — только туда, где переменная не задана:
// голос Gemini и его манера, подпись к «облачку» комментария в финале.
// Провайдер озвучки не трогаем: auto сам выберет Gemini при ключе, иначе Edge.
export function applyChannelDefaults(ch: ChannelConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const applied: string[] = [];
  const setDefault = (k: string, v: string | null) => {
    if (!v || env[k]?.trim()) return;
    env[k] = v;
    applied.push(k);
  };
  if (!ch.voice.provider || ch.voice.provider === "gemini") {
    setDefault("GEMINI_TTS_VOICE", ch.voice.name);
    setDefault("GEMINI_TTS_STYLE", ch.voice.style);
  }
  setDefault("CTA_COMMENT", ch.cta.onScreenComment);
  return applied;
}

// Тематические хэштеги из тегов сценария: только однословные (из «мозг учёба»
// получился бы нечитаемый #мозгучёба), без служебного «shorts».
export function topicHashtags(tags: string[], limit: number): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (out.length >= limit) break;
    const clean = t.trim();
    if (!clean || /\s/.test(clean) || /^#?shorts$/i.test(clean) || clean.replace(/^#/, "").length < 3 || clean.length > 25) continue;
    const h = normalizeHashtag(clean);
    if (h && !out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out;
}

export function uniqueHashtags(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((h) => {
    const k = h.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- Расписание публикаций ----

// Сдвиг часового пояса (мс) в момент t: «настенное» время минус UTC.
function tzOffsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wall - Math.floor(t / 1000) * 1000;
}

// Местная дата (год, месяц, день) в поясе для момента t.
export function localDate(t: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// Местное «Y-M-D HH:MM» в поясе → момент UTC. Переход на летнее время
// учитывается: сдвиг пересчитываем для найденного момента ещё раз.
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMs(guess, timeZone);
  const second = guess - tzOffsetMs(first, timeZone);
  return second;
}

export interface SlotOptions {
  from?: Date; // от какого момента считать (по умолчанию сейчас)
  minLeadMinutes?: number; // слот должен быть не ближе, чем через столько минут (YouTube нужен запас на обработку)
  taken?: Iterable<string | number | Date>; // уже занятые моменты — пропускаются
}

export const DEFAULT_LEAD_MINUTES = 30;

// Слоты публикации подряд, начиная с ближайшего: count штук.
export function upcomingSlots(schedule: ChannelSchedule, count: number, opts: SlotOptions = {}): Date[] {
  const from = (opts.from ?? new Date()).getTime() + (opts.minLeadMinutes ?? DEFAULT_LEAD_MINUTES) * 60_000;
  const taken = new Set<number>();
  for (const t of opts.taken ?? []) {
    const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
    if (Number.isFinite(ms)) taken.add(Math.floor(ms / 60_000)); // сравниваем с точностью до минуты
  }
  const times = parseTimes(schedule.publishTimesLocal);
  if (!times.length || count <= 0) return [];
  const out: Date[] = [];
  // Начинаем с ВЧЕРАШНЕЙ местной даты: у поясов западнее UTC «сегодня» по UTC ещё не наступило.
  const start = localDate(from - 86_400_000, schedule.timezone);
  for (let day = 0; out.length < count && day < 3700; day++) {
    const base = new Date(Date.UTC(start.y, start.m - 1, start.d + day));
    for (const t of times) {
      const [hh, mm] = t.split(":").map(Number) as [number, number];
      const at = zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, schedule.timezone);
      if (at <= from || taken.has(Math.floor(at / 60_000))) continue;
      out.push(new Date(at));
      if (out.length >= count) break;
    }
  }
  return out;
}

// N-й слот (с 1) после from — без учёта занятых: для пакета, где номер слота
// задаёт workflow и повторный запуск не должен «съезжать».
export function nthSlot(schedule: ChannelSchedule, n: number, opts: Omit<SlotOptions, "taken"> = {}): Date {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Номер слота должен быть целым числом от 1, а не «${n}».`);
  const slots = upcomingSlots(schedule, n, opts);
  const last = slots.at(-1);
  if (!last || slots.length < n) throw new Error("Не удалось рассчитать слот публикации — проверьте publishTimesLocal в channel.json.");
  return last;
}

// RFC 3339 без миллисекунд — так YouTube показывает и принимает publishAt.
export const isoNoMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

// «чт, 8 окт., 12:00 (Europe/Moscow)» — для логов и сводки.
export function formatLocal(d: Date, timeZone: string): string {
  const s = new Intl.DateTimeFormat("ru-RU", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${s} (${timeZone})`;
}

// Дата начала отсчёта слотов: ISO-время или просто «2026-10-14» (= полночь
// этого дня в поясе канала).
export function parseScheduleStart(raw: string, timeZone: string): Date {
  const v = raw.trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (day) return new Date(zonedTimeToUtc(Number(day[1]), Number(day[2]), Number(day[3]), 0, 0, timeZone));
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`Не похоже на дату: «${raw}». Примеры: 2026-10-14 или 2026-10-14T09:00:00Z.`);
  return new Date(ms);
}
