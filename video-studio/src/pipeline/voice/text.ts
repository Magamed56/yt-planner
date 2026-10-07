// Подготовка текста к озвучке и разбиение на слова для субтитров.
// Нормализация одна для всех провайдеров: тогда и голос, и субтитры, и
// оценка таймингов работают с одинаковым текстом.

// Эмодзи и прочие пиктограммы TTS читает вслух или спотыкается на них.
const PICTO = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export function normalizeText(input: string): string {
  let s = input.normalize("NFC");
  s = s.replace(PICTO, " ");
  // Разметка акцентов из сценария (*слово*, _слово_) — не для диктора.
  s = s.replace(/[*_#`~^]+/g, "");
  s = s.replace(/[  -​  　]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Многоточия и тире к одному виду.
  s = s.replace(/\.{3,}/g, "…").replace(/…+/g, "…");
  s = s.replace(/\s+[-–—]+\s+/g, " — ").replace(/^[-–—]+\s*/, "— ");
  s = s.replace(/\s*[–—]\s*$/, "");
  // Кавычки: всё двойное → «ёлочки», одинарные «умные» → апостроф.
  s = s.replace(/[„“”‟″]/g, '"').replace(/[‘’‚‛′]/g, "'");
  let open = true;
  s = s.replace(/"/g, () => {
    const q = open ? "«" : "»";
    open = !open;
    return q;
  });
  s = s.replace(/«\s+/g, "«").replace(/\s+»/g, "»");
  // Пробелы перед знаками препинания убираем, после — ставим.
  s = s.replace(/\s+([,.;:!?…»)])/g, "$1");
  s = s.replace(/([,;:!?…])(?=[^\s\d»)"'.,!?…])/gu, "$1 ");
  s = s.replace(/([а-яёa-z])\.(?=[А-ЯЁA-Z])/gu, "$1. ");
  s = s.replace(/([!?]){2,}/g, "$1");
  s = s.replace(/,{2,}/g, ",");
  s = s.replace(/\s+/g, " ").trim();
  // Завершающая пунктуация: без неё некоторые движки обрывают интонацию «на взлёте».
  if (!/[.!?…][»)"']*$/.test(s)) s = s.replace(/[,;:]+$/, "") + ".";
  return s;
}

// Буквы и цифры слова в нижнем регистре, ё → е: для сравнения слов от разных
// провайдеров (Edge отдаёт слова без пунктуации, ElevenLabs — с ней).
export function normWord(w: string): string {
  return w.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");
}

export interface Token {
  text: string; // как показывать в субтитрах (с пунктуацией)
  norm: string;
  pause: number; // «сила» паузы ПОСЛЕ слова: 0 — нет, 1.5 запятая, 2 тире/двоеточие, 3 конец фразы
}

// Слова для субтитров. Отдельно стоящие знаки («—», «»») приклеиваются к соседям,
// чтобы у каждого слова было что произнести.
export function tokenize(text: string): Token[] {
  const raw = text.split(/\s+/).filter(Boolean);
  const out: Token[] = [];
  let pendingPrefix = "";
  for (const r of raw) {
    const norm = normWord(r);
    if (!norm) {
      if (out.length) out[out.length - 1]!.text += r === "—" || r === "–" ? " —" : r;
      else pendingPrefix += r;
      continue;
    }
    out.push({ text: pendingPrefix + r, norm, pause: 0 });
    pendingPrefix = "";
  }
  for (const t of out) t.pause = pauseStrength(t.text);
  return out;
}

function pauseStrength(word: string): number {
  const tail = word.replace(/[»)"'\]]+$/, "");
  if (/[.!?…]$/.test(tail)) return 3;
  if (/(^|\s)—$|[:;]$/.test(tail)) return 2;
  if (/,$/.test(tail)) return 1.5;
  return 0;
}

// Темп из TTS_RATE ("+5%", "-10%", "5") → множитель скорости (1.05, 0.9).
export function rateMultiplier(rate: string | undefined): number {
  if (!rate) return 1;
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*%?\s*$/.exec(rate);
  if (!m) return 1;
  return Math.min(2, Math.max(0.5, 1 + Number(m[1]) / 100));
}
