// channel.json с диска. Отдельно от channel.ts: там только разбор и расчёт слотов без
// файловой системы — его берёт и веб-панель (panel/), которая читает channel.json из GitHub.

import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./audio/paths";
import { channelFromJson, type ChannelConfig } from "./channel";
import { DEFAULT_LANG, channelFileForLang } from "./lang";

export function channelFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const own = env.CHANNEL_FILE?.trim();
  if (own && /^(none|off|0)$/i.test(own)) return null;
  if (own) return path.isAbsolute(own) ? own : path.resolve(projectRoot(), own);
  return path.join(projectRoot(), "channel.json");
}

// Чтение и проверка channel.json. Битый файл — понятная ошибка (это правка
// человека, молча игнорировать её нельзя); отсутствующий — пустые умолчания.
export function loadChannel(opts: { file?: string | null; env?: NodeJS.ProcessEnv } = {}): ChannelConfig {
  const env = opts.env ?? process.env;
  const file = opts.file === undefined ? channelFile(env) : opts.file;
  let raw: unknown = {};
  let used: string | null = null;
  if (file && fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
      used = file;
    } catch (e) {
      throw new Error(`${path.basename(file)}: битый JSON (${e instanceof Error ? e.message : String(e)}). Проверьте запятые и кавычки или удалите файл.`);
    }
  }
  return channelFromJson(raw, env, used);
}

// Канал языка ролика: channels/<язык>.json (та же схема, что channel.json) → CHANNEL_FILE, если
// его не задали явно. Русский — channel.json, как раньше. Файла языка нет — ошибка: иначе
// английский ролик ушёл бы с русскими хэштегами, призывами и подвалом описания.
export function useLanguageChannel(lang: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (lang === DEFAULT_LANG || env.CHANNEL_FILE?.trim()) return null;
  const rel = channelFileForLang(lang);
  if (!fs.existsSync(path.join(projectRoot(), rel))) {
    throw new Error(`Для роликов на «${lang}» нужен файл канала ${rel} (та же схема, что channel.json): скопируйте channels/en.json и переведите тексты, или задайте CHANNEL_FILE.`);
  }
  env.CHANNEL_FILE = rel;
  return rel;
}
