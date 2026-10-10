// Коды роликов — одно место на весь проект (конвейер, workflow-сводки, панель):
//   Shorts   — «08a»: день плана + буква слота (content/plan.json);
//   «Разбор» — «L01»: номер по порядку выхода (content/long-plan.json), 16:9, ~7 минут.
// Код стоит в имени сценария (sut-08a-… / razbor-L01-…), файла видео (08a-….mp4 / L01-….mp4),
// в content/videos.json и в названии запуска («batch: 08a,L01»). Без импортов: модуль берут
// и браузерные компоненты панели.

export const SHORT_CODE = /^\d{2}[a-z]$/;
export const LONG_CODE = /^L\d{2}$/;
// Любой код в каноническом виде: «08a» строчными, «L01» с заглавной L.
export const VIDEO_CODE = /^(?:\d{2}[a-z]|L\d{2})$/;
// Для вставки в другие регулярки (с флагом i): «08a», «L01», «l01».
export const CODE_SRC = "\\d{2}[a-z]|l\\d{2}";

// Канонический вид кода или null: « 08A » → «08a», «l01» → «L01».
export function normCode(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (/^l\d{2}$/i.test(s)) return `L${s.slice(1)}`;
  if (/^\d{2}[a-z]$/i.test(s)) return s.toLowerCase();
  return null;
}

export const isLongCode = (code: string | null | undefined): boolean => /^l\d{2}$/i.test((code ?? "").trim());

// Все коды отдельными словами в тексте («batch: 08a,L01», «L01-chto-takoe.mp4»), без повторов.
export function codesIn(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(new RegExp(`(?:^|[^0-9a-zа-яё])(${CODE_SRC})(?=$|[^0-9a-zа-яё])`, "gi"))) {
    const c = normCode(m[1]);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// Файл ролика в релизе: «08a-….mp4» или «L01-….mp4» (у других языков — «en-08a-…», это не он).
export const MP4_WITH_CODE = new RegExp(`^(${CODE_SRC})-.+\\.mp4$`, "i");
export const mp4Code = (name: string): string | null => normCode(MP4_WITH_CODE.exec(name)?.[1]);

// «L01-chto-takoe» → «chto-takoe».
export const stripCode = (file: string): string => file.replace(new RegExp(`^(?:${CODE_SRC})-`, "i"), "");

// Порядок выхода внутри своего потока: Shorts по коду (день, слот), «Разборы» — после них по номеру.
export const compareCodes = (a: string, b: string): number => Number(isLongCode(a)) - Number(isLongCode(b)) || a.localeCompare(b);
