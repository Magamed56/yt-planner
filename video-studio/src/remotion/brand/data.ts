// Данные бренда для статичных картинок (аватар, баннер, обложки). Источник
// правды — channel.json: webpack вшивает его в бандл при сборке, поэтому
// после правки названия/слогана/расписания достаточно перезапустить `npm run brand`.
import channel from "../../../channel.json";
import { THEMES } from "../theme";

interface PillarRaw {
  id: string;
  title: string;
  icon: string;
}

export interface Pillar extends PillarRaw {
  short: string; // подпись на обложке «Актуального» — одно короткое слово
}

// Короткие подписи для обложек: в кружке «Актуального» влезает одно слово.
// Неизвестную рубрику (добавили в channel.json) подписываем первым словом названия.
const SHORT: Record<string, string> = {
  mind: "Мозг",
  body: "Тело",
  space: "Космос",
  nature: "Природа",
  history: "История",
  tech: "Техно",
  money: "Деньги",
  why: "Почему?",
};

const raw = channel as unknown as {
  name: string;
  handle: string;
  tagline: string;
  pillars: PillarRaw[];
  // publishTimeLocal — старый формат (один ролик в день), оставлен для совместимости.
  schedule: { perDay?: number; publishTimesLocal?: string[]; publishTimeLocal?: string; timezone: string };
  cta: { subscribe: string };
  links: { youtube: string; instagram: string };
};

// «Europe/Moscow» → «МСК»; для других поясов — как есть, без догадок.
const tzLabel = (tz: string): string => (tz === "Europe/Moscow" ? "МСК" : tz);

// ["12:00", "19:00"] → «12:00 и 19:00»; три и больше — через запятую.
function joinTimes(times: string[]): string {
  if (times.length <= 1) return times[0] ?? "";
  return `${times.slice(0, -1).join(", ")} и ${times[times.length - 1]}`;
}

const times = (raw.schedule.publishTimesLocal?.length ? raw.schedule.publishTimesLocal : [raw.schedule.publishTimeLocal ?? ""]).filter(Boolean);
const tz = tzLabel(raw.schedule.timezone);
const timesText = `${joinTimes(times)} ${tz}`.trim();

export const BRAND = {
  name: raw.name,
  handle: `@${raw.handle}`,
  tagline: raw.tagline,
  times, // ["12:00", "19:00"]
  tz, // «МСК»
  timesText, // «12:00 и 19:00 МСК»
  // Одна строка про расписание — для баннера и поста.
  schedule: times.length > 1 ? `Новые ролики каждый день в ${timesText}` : `Новый ролик каждый день в ${timesText}`,
  cta: raw.cta.subscribe,
  pillars: raw.pillars.map((p): Pillar => ({ ...p, short: SHORT[p.id] ?? p.title.split(/\s+/)[0] ?? p.title })),
  theme: THEMES.midnight,
};

// «Суть за минуту» → ["СУТЬ", "ЗА МИНУТУ"]: первое слово — на жёлтом маркере
// (как акцентные слова в роликах), остальное — белым. Одно слово — целиком маркер.
export function splitName(name: string): [string, string] {
  const up = name.trim().toUpperCase();
  const i = up.indexOf(" ");
  return i > 0 ? [up.slice(0, i), up.slice(i + 1)] : [up, ""];
}

export function pillarById(id: string | undefined): Pillar {
  return BRAND.pillars.find((p) => p.id === id) ?? BRAND.pillars[0] ?? { id: "why", title: "Почему так?", icon: "lightbulb", short: "Почему?" };
}
