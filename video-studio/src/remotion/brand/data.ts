// Данные бренда для статичных картинок (аватар, баннер, обложки). Источник
// правды — channel.json: webpack вшивает его в бандл при сборке, поэтому
// после правки названия/слогана достаточно перезапустить `npm run brand`.
import channel from "../../../channel.json";
import { THEMES } from "../theme";

interface PillarRaw {
  id: string;
  title: string;
  icon: string;
}

export interface Pillar extends PillarRaw {
  short: string; // подпись на обложке «Актуального» — одно слово
}

// Короткие подписи для обложек: в кружке «Актуального» влезает одно слово.
// Неизвестную рубрику (добавили в channel.json) подписываем первым словом.
const SHORT: Record<string, string> = {
  memory: "Память",
  sleep: "Сон",
  focus: "Фокус",
  habits: "Привычки",
  emotions: "Эмоции",
  myths: "Мифы",
  perception: "Восприятие",
};

const raw = channel as unknown as {
  name: string;
  handle: string;
  tagline: string;
  pillars: PillarRaw[];
  schedule: { publishTimeLocal: string; timezone: string };
  cta: { subscribe: string };
  links: { youtube: string; instagram: string };
};

// «Europe/Moscow» → «МСК»; для других поясов — как есть, без догадок.
const tzLabel = (tz: string): string => (tz === "Europe/Moscow" ? "МСК" : tz);

export const BRAND = {
  name: raw.name,
  handle: `@${raw.handle}`,
  tagline: raw.tagline,
  schedule: `Новый факт каждый день в ${raw.schedule.publishTimeLocal} ${tzLabel(raw.schedule.timezone)}`,
  time: `${raw.schedule.publishTimeLocal} ${tzLabel(raw.schedule.timezone)}`,
  cta: raw.cta.subscribe,
  pillars: raw.pillars.map((p): Pillar => ({ ...p, short: SHORT[p.id] ?? p.title.split(/\s+/)[0] ?? p.title })),
  theme: THEMES.midnight,
};

// «Нейрофакт» → ["НЕЙРО", "ФАКТ"]: вторая часть красится акцентом. Если
// название сменят на что-то без «факт», красим последнюю треть слова.
export function splitName(name: string): [string, string] {
  const up = name.toUpperCase();
  const i = up.lastIndexOf("ФАКТ");
  if (i > 0) return [up.slice(0, i), up.slice(i)];
  const cut = Math.max(1, Math.round(up.length * 0.6));
  return [up.slice(0, cut), up.slice(cut)];
}

export function pillarById(id: string | undefined): Pillar {
  return BRAND.pillars.find((p) => p.id === id) ?? BRAND.pillars[0] ?? { id: "memory", title: "Память", icon: "brain", short: "Память" };
}
