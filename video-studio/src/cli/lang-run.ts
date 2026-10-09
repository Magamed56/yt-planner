// Язык сборки ролика (npm run make): --lang или язык сценария (scripts/en/… → "en").
// Не русский — канал channels/<язык>.json, голос этого языка, подписи композиции. Загрузка
// с --upload — только в русский канал (у канала на другом языке свой ключ YouTube), поэтому
// для других языков она запрещена: ролик собирается и грузится в Studio нужного канала руками.
import fs from "node:fs";
import { useLanguageChannel } from "../pipeline/channel-file";
import { DEFAULT_LANG, LANGS, knownLangs, normalizeLang } from "../pipeline/lang";
import { UserError, resolveInputPath } from "./common";

export function parseLangArg(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const code = normalizeLang(raw);
  if (!code) throw new UserError(`--lang: не знаю язык «${raw}». Доступны: ${knownLangs()}.`);
  return code;
}

// Поле language сценария — без полной проверки (её сделает loadScriptFile на шаге «Сценарий»).
export function scriptLanguage(file: string | undefined): string | null {
  const abs = file ? resolveInputPath(file) : null;
  if (!abs) return null;
  try {
    const raw = (JSON.parse(fs.readFileSync(abs, "utf8").replace(/^﻿/, "")) as { language?: unknown }).language;
    return typeof raw === "string" && raw.trim() ? (normalizeLang(raw) ?? raw.trim().toLowerCase()) : null;
  } catch {
    return null;
  }
}

export function runLanguage(opts: { lang?: string; script?: string; demo?: boolean }): string {
  const fromScript = opts.demo ? DEFAULT_LANG : scriptLanguage(opts.script);
  if (opts.lang && fromScript && opts.lang !== fromScript) {
    throw new UserError(`Сценарий на «${fromScript}», а указан --lang ${opts.lang}. Сначала переведите его: npm run script -- --plan <код> --lang ${opts.lang} (или уберите --lang).`);
  }
  const lang = opts.lang ?? fromScript ?? DEFAULT_LANG;
  if (!LANGS[lang]) throw new UserError(`Язык сценария «${lang}» не знаю. Доступны: ${knownLangs()}.`);
  return lang;
}

// До loadChannel и проверок ключей: канал языка (CHANNEL_FILE) и запрет загрузки.
export function prepareLanguage(lang: string, uploads: number): string | null {
  if (lang === DEFAULT_LANG) return null;
  if (uploads > 0) {
    throw new UserError(
      `Ролик на «${lang}» нельзя загрузить с --upload: ключ YouTube здесь — от русского канала, а у канала на другом языке свой ключ. ` +
        "Соберите без --upload и загрузите файл в Studio нужного канала руками (README, «Ролики на других языках»).",
    );
  }
  try {
    return useLanguageChannel(lang);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
}
