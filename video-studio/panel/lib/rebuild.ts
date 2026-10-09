// «Пересобрать» с другим голосом, палитрой или без музыки → входные данные запуска
// «video-studio: ролик» (batch, plan = код, в релиз). Значения — как options полей voice,
// theme и music в .github/workflows/video-studio.yml. Только импорт типов: модуль нужен и браузеру.
import type { Row } from "./state";

// Почему сценарий нельзя править и пересобирать (null — можно). YouTube не даёт заменить файл
// загруженного видео, поэтому после загрузки в Studio — только тексты в самой Studio.
export function editLock(row: Pick<Row, "youtube" | "running" | "scriptPath">, youtubeError: string | null): string | null {
  if (!row.scriptPath) return "Сценария ещё нет.";
  if (row.youtube) return "Ролик уже загружен в YouTube — заменить там видео нельзя, поэтому правка сценария и пересборка закрыты. Название и описание меняйте в Studio.";
  if (youtubeError) return "YouTube сейчас недоступен — не проверить, загружен ли ролик. Обновите страницу позже.";
  if (row.running) return `Сейчас ${row.running} — дождитесь конца запуска.`;
  return null;
}

export const VOICES = ["auto", "gemini", "edge", "piper"] as const;
export const THEMES = ["auto", "midnight", "sunset", "emerald", "mono"] as const;

export const VOICE_LABEL: Record<(typeof VOICES)[number], string> = {
  auto: "как обычно (Gemini, при сбое — Edge)",
  gemini: "Gemini",
  edge: "Edge",
  piper: "Piper (офлайн)",
};

export const THEME_LABEL: Record<(typeof THEMES)[number], string> = {
  auto: "как обычно",
  midnight: "midnight — ночь",
  sunset: "sunset — закат",
  emerald: "emerald — изумруд",
  mono: "mono — чёрно-белая",
};

export interface RebuildOptions {
  voice: string;
  voiceName: string; // необязательно: Charon, Puck… (gemini), ru-RU-SvetlanaNeural (edge)
  theme: string;
  music: boolean;
}

export const DEFAULT_REBUILD: RebuildOptions = { voice: "auto", voiceName: "", theme: "auto", music: true };

const VOICE_NAME = /^[A-Za-z0-9_.-]{1,60}$/;

export function rebuildInputs(code: string, o: RebuildOptions): Record<string, string> {
  if (!(VOICES as readonly string[]).includes(o.voice)) throw new Error("Неизвестная озвучка — обновите страницу.");
  if (!(THEMES as readonly string[]).includes(o.theme)) throw new Error("Неизвестная палитра — обновите страницу.");
  const name = (o.voiceName ?? "").trim();
  if (name && !VOICE_NAME.test(name)) throw new Error("Имя голоса — латиница, цифры, «-», «_», «.»: например Charon или ru-RU-SvetlanaNeural.");
  const inputs: Record<string, string> = { mode: "batch", plan: code, upload: "release", voice: o.voice, theme: o.theme };
  if (name) inputs.voice_name = name;
  // music передаём, только когда её выключили: остальные пересборки работают и с workflow,
  // в котором этого поля ещё нет.
  if (o.music === false) inputs.music = "none";
  return inputs;
}

export function rebuildLabel(o: RebuildOptions): string {
  const voice = o.voice === "auto" ? "голос как обычно" : `голос ${o.voice}${o.voiceName.trim() ? ` (${o.voiceName.trim()})` : ""}`;
  const theme = o.theme === "auto" ? "палитра как обычно" : `палитра ${o.theme}`;
  return `${voice}, ${theme}, ${o.music ? "с музыкой" : "без музыки"}`;
}
