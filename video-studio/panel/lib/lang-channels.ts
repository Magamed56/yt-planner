// Каналы на других языках: video-studio/channels/<язык>.json вшиты при сборке (как channel.json в
// channel-name.ts) — меню и заголовок страницы не ходят в GitHub. Поменяли файл — нужен новый
// деплой (Vercel делает его сам после пуша в ветку). Новый язык — строчка импорта ниже.
// Только для сервера: в браузер уходит готовый список пунктов меню (LangNav).
import { channelFromJson } from "../../src/pipeline/channel";
import { DEFAULT_LANG, LANGS, channelFileForLang, normalizeLang } from "../../src/pipeline/lang";
import ruChannel from "../../channel.json";
import en from "../../channels/en.json";
import kk from "../../channels/kk.json";
import uz from "../../channels/uz.json";

const FILES: Record<string, unknown> = { en, kk, uz };

export interface LangChannel {
  lang: string;
  label: string; // самоназвание языка — пункт меню: «English»
  name: string; // название канала из файла; нет файла — самоназвание языка
  handle: string | null;
  youtube: string | null; // ссылка на канал (links.youtube)
  placeholder: boolean; // заготовка («placeholder»: true), файла нет или он не разобрался
  file: string; // «channels/en.json» — где поправить
}

// json — содержимое channels/<язык>.json (null — файла нет). Битый файл страницу не роняет:
// показываем его как заготовку.
export function langChannelOf(lang: string, json: unknown): LangChannel {
  const code = normalizeLang(lang) ?? lang;
  const label = LANGS[code]?.native ?? code;
  const base: LangChannel = { lang: code, label, name: label, handle: null, youtube: null, placeholder: true, file: channelFileForLang(code) };
  if (json === null || json === undefined) return base;
  try {
    const ch = channelFromJson(json);
    return { ...base, name: ch.name ?? label, handle: ch.handle, youtube: ch.links.youtube, placeholder: ch.placeholder === true };
  } catch {
    return base;
  }
}

export interface NavLang {
  code: string;
  label: string;
}

// Канал, который владелец заводит вторым, — в меню всегда, даже пока он заготовка.
export const ALWAYS_IN_NAV = ["en"];

// Пункты меню: английский всегда; другие языки — когда их канал настроен или у них уже есть
// ролики в релизах (withVideos). Заготовки kk и uz без роликов меню не загромождают — их
// страница открывается по адресу /lang/kk.
export function navLangs(channels: LangChannel[], withVideos: string[] = []): NavLang[] {
  return Object.keys(LANGS)
    .filter((code) => code !== DEFAULT_LANG)
    .flatMap((code) => {
      const ch = channels.find((c) => c.lang === code);
      const show = ALWAYS_IN_NAV.includes(code) || withVideos.includes(code) || (ch !== undefined && !ch.placeholder);
      return show ? [{ code, label: ch?.label ?? LANGS[code]!.native }] : [];
    });
}

export const LANG_CHANNELS: LangChannel[] = Object.entries(FILES).map(([lang, json]) => langChannelOf(lang, json));

export const langChannel = (lang: string): LangChannel => LANG_CHANNELS.find((c) => c.lang === lang) ?? langChannelOf(lang, null);

// Меню всех страниц (корневой layout → LangNav): без похода в GitHub, поэтому по релизам — только
// на самой странице языка.
export const NAV_LANGS: NavLang[] = navLangs(LANG_CHANNELS);

// Время в подписях страницы — в поясе основного канала, как во всей панели.
export const PANEL_TZ = channelFromJson(ruChannel).schedule.timezone;
