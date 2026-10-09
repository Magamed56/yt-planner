// Языки роликов и субтитров: коды, имена для LLM, голоса по умолчанию, имена файлов.
// Без файловой системы и npm-пакетов — модуль можно брать и в панель, и в тесты.
// Русский — язык основного канала: для него всё ведёт себя ровно как раньше.

export interface LangInfo {
  code: string; // код YouTube / BCP-47: "en", "kk", "uz"
  name: string; // по-английски — для промптов LLM
  native: string; // самоназвание: подпись дорожки субтитров «English (AI)»
  edgeVoice: string; // голос Edge по умолчанию (мужской, как ru-RU-DmitryNeural у канала)
  piperVoice: string | null; // офлайн-запасной голос Piper; null — у Piper этого языка нет
  geminiTts: boolean; // Gemini TTS официально знает язык (иначе auto → Edge)
  cyrillic: boolean; // письменность — кириллица (проверка «текст не переведён»)
}

export const DEFAULT_LANG = "ru";

// Голоса Edge — из списка edge-tts; Piper — модели vits-piper-* из релизов sherpa-onnx.
// У Gemini TTS нет казахского и узбекского — для них по умолчанию Edge.
export const LANGS: Record<string, LangInfo> = {
  ru: { code: "ru", name: "Russian", native: "Русский", edgeVoice: "ru-RU-DmitryNeural", piperVoice: "ru_RU-dmitri-medium", geminiTts: true, cyrillic: true },
  en: { code: "en", name: "English", native: "English", edgeVoice: "en-US-ChristopherNeural", piperVoice: "en_US-lessac-medium", geminiTts: true, cyrillic: false },
  kk: { code: "kk", name: "Kazakh (Cyrillic script)", native: "Қазақша", edgeVoice: "kk-KZ-DauletNeural", piperVoice: "kk_KZ-issai-high", geminiTts: false, cyrillic: true },
  uz: { code: "uz", name: "Uzbek (Latin script)", native: "Oʻzbekcha", edgeVoice: "uz-UZ-SardorNeural", piperVoice: null, geminiTts: false, cyrillic: false },
  uk: { code: "uk", name: "Ukrainian", native: "Українська", edgeVoice: "uk-UA-OstapNeural", piperVoice: "uk_UA-ukrainian_tts-medium", geminiTts: true, cyrillic: true },
  es: { code: "es", name: "Spanish", native: "Español", edgeVoice: "es-ES-AlvaroNeural", piperVoice: "es_ES-davefx-medium", geminiTts: true, cyrillic: false },
  de: { code: "de", name: "German", native: "Deutsch", edgeVoice: "de-DE-ConradNeural", piperVoice: "de_DE-thorsten-medium", geminiTts: true, cyrillic: false },
  fr: { code: "fr", name: "French", native: "Français", edgeVoice: "fr-FR-HenriNeural", piperVoice: "fr_FR-siwis-medium", geminiTts: true, cyrillic: false },
  pt: { code: "pt", name: "Portuguese (Brazil)", native: "Português", edgeVoice: "pt-BR-AntonioNeural", piperVoice: "pt_BR-faber-medium", geminiTts: true, cyrillic: false },
  tr: { code: "tr", name: "Turkish", native: "Türkçe", edgeVoice: "tr-TR-AhmetNeural", piperVoice: "tr_TR-dfki-medium", geminiTts: true, cyrillic: false },
};

// Как люди пишут коды на самом деле: «kz», «eng», «uz-Latn», «EN-us».
const ALIASES: Record<string, string> = { kz: "kk", kaz: "kk", uzb: "uz", eng: "en", rus: "ru", ua: "uk", ukr: "uk", spa: "es", ger: "de", deu: "de", fra: "fr", fre: "fr", por: "pt", tur: "tr" };

export function normalizeLang(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!v) return null;
  const base = v.split("-")[0]!;
  if (LANGS[base]) return base;
  return ALIASES[base] ?? ALIASES[v] ?? null;
}

// «en, kk uz» → ["en", "kk", "uz"] + нераспознанные (для понятной ошибки).
export function parseLangs(raw: string | null | undefined): { langs: string[]; unknown: string[] } {
  const langs: string[] = [];
  const unknown: string[] = [];
  for (const part of (raw ?? "").split(/[\s,;]+/).filter(Boolean)) {
    const code = normalizeLang(part);
    if (!code) unknown.push(part);
    else if (!langs.includes(code)) langs.push(code);
  }
  return { langs, unknown };
}

export function langInfo(code: string): LangInfo {
  const info = LANGS[normalizeLang(code) ?? ""];
  if (!info) throw new Error(`Язык «${code}» не знаю. Доступны: ${knownLangs()}.`);
  return info;
}

export const knownLangs = (): string => Object.keys(LANGS).join(", ");

// ---- Имена файлов ----

// Дорожка субтитров на YouTube: «English (AI)» — зритель видит, что перевод машинный.
export const captionTrackName = (lang: string): string => `${langInfo(lang).native} (AI)`;
export const captionFileName = (lang: string): string => `captions.${normalizeLang(lang) ?? lang}.srt`;

// Сценарии других языков — в своей папке scripts/<язык>/: пакет, панель и проверка повторов
// ищут русские сценарии только в scripts/ (без подпапок), и перевод их не путает.
export const langScriptDir = (lang: string): string => (lang === DEFAULT_LANG ? "scripts" : `scripts/${lang}`);

// Файл ролика в релизе. Русский — «08a-<slug>.mp4» (по нему панель и youtube-fill узнают ролик
// канала). Другие языки — «en-08a-<slug>.mp4»: панель считает любой «08a-….mp4» русским роликом
// 08a и предложила бы залить перевод на русский канал; код остаётся отдельным словом в имени.
export function langVideoName(code: string, lang: string, slug: string): string {
  return lang === DEFAULT_LANG ? `${code}-${slug}` : `${lang}-${code}-${slug}`;
}

// Файл канала: русский — channel.json, остальные — channels/<язык>.json (та же схема).
export const channelFileForLang = (lang: string): string => (lang === DEFAULT_LANG ? "channel.json" : `channels/${lang}.json`);

// ---- Голос ----

// Язык голоса по имени: «en-US-…Neural» (Edge) → en, «kk_KZ-issai-high» (Piper) → kk; Gemini — без языка.
export function voiceLang(voice: string | null | undefined): string | null {
  const m = /^([a-z]{2,3})[-_][A-Z]{2}\b/.exec((voice ?? "").trim());
  return m ? normalizeLang(m[1]) : null;
}

// Голос под язык ролика — только туда, где пусто (как applyPillarVoice): явные --voice,
// переменные GitHub Actions и channels/<язык>.json сильнее. Исключение — TTS_VOICE другого
// языка (например, ru-RU-SvetlanaNeural из переменных репозитория): английский текст он
// прочёл бы с русским акцентом, поэтому меняем его на голос языка ролика.
// Для русского ничего не меняется.
export function applyLanguageVoice(lang: string, env: Record<string, string | undefined> = process.env): string[] {
  const applied: string[] = [];
  const empty = (k: string) => !env[k]?.trim();
  const set = (k: string, v: string) => {
    env[k] = v;
    applied.push(`${k}=${v}`);
  };
  if (empty("TTS_LANGUAGE")) set("TTS_LANGUAGE", lang);
  if (lang === DEFAULT_LANG) return applied;
  const info = langInfo(lang);
  const own = voiceLang(env.TTS_VOICE);
  if (empty("TTS_VOICE") || (own && own !== info.code)) set("TTS_VOICE", info.edgeVoice);
  const provider = env.TTS_PROVIDER?.trim().toLowerCase() ?? "";
  if (!info.geminiTts && (!provider || provider === "auto")) set("TTS_PROVIDER", "edge");
  // Без Piper этого языка запасной офлайн-голос заговорил бы по-русски — лучше честная ошибка.
  if (!info.piperVoice && empty("TTS_FALLBACK")) set("TTS_FALLBACK", "edge");
  return applied;
}
