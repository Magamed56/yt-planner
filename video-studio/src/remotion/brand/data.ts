// Данные бренда для статичных картинок (аватар, баннер, обложки) и заставки роликов.
// Источник правды — файл канала: `npm run brand` читает его с диска (channel.json или
// channels/<язык>.json с --channel) и передаёт в inputProps; ролик другого языка несёт
// свой канал в props.json (make → brandChannelOf). В Studio и в русском ролике ключа
// нет — тогда channel.json, который webpack вшивает в бандл.
import { getInputProps } from "remotion";
import channelJson from "../../../channel.json";
import { THEMES } from "../theme";
import { BRAND_CHANNEL_PROP } from "./jobs";
import { brandTexts } from "./texts";

interface PillarRaw {
  id: string;
  title: string;
  icon: string;
}

export interface Pillar extends PillarRaw {
  short: string; // подпись на обложке «Актуального» — одно короткое слово
}

// Поля, кроме name, необязательны: в ролик может прийти свой CHANNEL_FILE без рубрик и
// расписания — заставке нужно только название, а падение здесь уронило бы весь рендер.
interface ChannelRaw {
  name: string;
  handle?: string | null;
  tagline?: string;
  language?: string;
  pillars?: PillarRaw[];
  // publishTimeLocal — старый формат (один ролик в день), оставлен для совместимости.
  schedule?: { perDay?: number; publishTimesLocal?: string[]; publishTimeLocal?: string; timezone?: string };
  cta?: { subscribe?: string };
  links?: { youtube: string | null; instagram: string | null };
}

// Remotion кладёт inputProps в страницу до загрузки бандла (evaluateOnNewDocument),
// поэтому на уровне модуля канал уже виден — и для renderStill, и для selectComposition.
function inputChannel(): ChannelRaw | null {
  // В Node getInputProps() не работает и только предупреждает в консоль.
  if (typeof window === "undefined") return null;
  try {
    const value = (getInputProps() as Record<string, unknown>)[BRAND_CHANNEL_PROP];
    return value && typeof value === "object" ? (value as ChannelRaw) : null;
  } catch {
    // <Player> или страница без inputProps — канал по умолчанию.
    return null;
  }
}

const raw: ChannelRaw = inputChannel() ?? (channelJson as unknown as ChannelRaw);
const text = brandTexts(raw.language);

// Время выхода и часовой пояс на картинки не пишем: зрители живут в разных поясах,
// а расписание может меняться. Из расписания берём только число роликов в день.
const schedule = raw.schedule ?? {};
const times = (schedule.publishTimesLocal?.length ? schedule.publishTimesLocal : [schedule.publishTimeLocal ?? ""]).filter(Boolean);
const perDay = Math.max(1, schedule.perDay ?? times.length);
const handle = raw.handle?.trim().replace(/^@/, "") ?? "";

export const BRAND = {
  name: raw.name,
  language: raw.language ?? "ru",
  handle: handle ? `@${handle}` : "",
  tagline: raw.tagline ?? "",
  perDay,
  perDayText: text.perDay(perDay), // «2 ролика в день» — для поста
  schedule: text.schedule(perDay), // плашка баннера
  text,
  cta: raw.cta?.subscribe ?? "",
  pillars: (raw.pillars ?? []).map((p): Pillar => ({ ...p, short: text.short[p.id] ?? p.title.split(/\s+/)[0] ?? p.title })),
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
  return BRAND.pillars.find((p) => p.id === id) ?? BRAND.pillars[0] ?? text.fallbackPillar;
}
