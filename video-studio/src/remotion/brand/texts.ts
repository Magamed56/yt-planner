// Надписи бренд-картинок, которые уходят на YouTube и в Instagram, — на языке канала
// (поле language в channel.json / channels/<язык>.json). Чистый TS без React: его читают
// и композиции (data.ts), и CLI (`npm run brand` заранее проверяет, что язык здесь есть).
// Листы самопроверки (banner-safe-preview, avatar-preview) видит только владелец — они по-русски.

export interface BrandTexts {
  // Подписи обложек «Актуального»: в кружок влезает одно короткое слово.
  short: Record<string, string>;
  perDay: (n: number) => string; // пост-знакомство: «2 ролика в день»
  // Плашка баннера; «каждый день» уже есть в слогане рядом, поэтому — число в день.
  schedule: (n: number) => string;
  hello: string; // плашка в шапке поста-знакомства
  // Абзац поста: lead + [gist — белым жирным] + tail. Неразрывные пробелы — против «висячих» слов.
  about: { lead: string; gist: string; tail: string };
  markWord: string; // слово слогана на жёлтом маркере (нет в слогане — последнее слово первой фразы)
  fallbackPillar: { id: string; title: string; icon: string; short: string }; // рубрик в файле нет
}

const NBSP = " ";

const ru: BrandTexts = {
  short: { mind: "Мозг", body: "Тело", space: "Космос", nature: "Природа", history: "История", tech: "Техно", money: "Деньги", why: "Почему?" },
  perDay: (n) => (n === 1 ? "1 ролик в день" : `${n} ${n < 5 ? "ролика" : "роликов"} в день`),
  schedule: (n) => (n > 1 ? `${n} новых ${n < 5 ? "ролика" : "роликов"} в день` : "Новый ролик каждый день"),
  hello: "Знакомство",
  about: {
    lead: "Короткие ролики обо всём: одна тема — ",
    gist: `одна понятная суть за${NBSP}минуту`,
    tail: `. Только проверяемые факты, без эзотерики и${NBSP}кликбейта.`,
  },
  markWord: "просто",
  fallbackPillar: { id: "why", title: "Почему так?", icon: "lightbulb", short: "Почему?" },
};

const en: BrandTexts = {
  short: { mind: "Mind", body: "Body", space: "Space", nature: "Nature", history: "History", tech: "Tech", money: "Money", why: "Why?" },
  perDay: (n) => (n === 1 ? "1 video a day" : `${n} videos a day`),
  schedule: (n) => (n > 1 ? `${n} new videos a day` : "New video every day"),
  hello: "Hello",
  about: {
    lead: "Short videos about everything: one topic — ",
    // Суть — одной строкой: иначе «one clear» остаётся висеть в конце первой строки.
    gist: ["one", "clear", "gist", "in", "a", "minute"].join(NBSP),
    tail: `. Only verifiable facts. No${NBSP}mysticism, no${NBSP}clickbait.`,
  },
  markWord: "simple",
  fallbackPillar: { id: "why", title: "Why is that?", icon: "lightbulb", short: "Why?" },
};

export const BRAND_TEXTS: Record<string, BrandTexts> = { ru, en };

// Языка нет в списке — английский: на картинке лучше нейтральный английский, чем русский.
// CLI до этого не доходит — он просит сначала добавить язык сюда.
export const brandTexts = (lang: string | null | undefined): BrandTexts => BRAND_TEXTS[lang ?? "ru"] ?? en;
