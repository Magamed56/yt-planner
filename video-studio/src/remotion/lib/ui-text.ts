// Подписи, которые рисует сама композиция (не из сценария): кнопка подписки, викторина,
// карточка главы, запись чисел. Язык — props.language (из сценария); нет или незнакомый —
// английский для чужих языков и русский по умолчанию, чтобы старые props.json не менялись.

export interface UiText {
  subscribe: string;
  subscribed: string;
  truth: string;
  myth: string;
  quizTitle: string;
  quizQuestion: string; // вопрос под вердиктом, если в сценарии его нет
  chapter: (n: number) => string;
  decimal: string; // десятичный разделитель
  group: string; // разделитель тысяч
  groupFrom?: number; // с какого значения делить разряды (нет — с 1000, как в английском)
}

const RU: UiText = {
  subscribe: "Подписаться",
  subscribed: "Вы подписаны",
  truth: "ПРАВДА",
  myth: "МИФ",
  quizTitle: "ПРАВДА ИЛИ МИФ?",
  quizQuestion: "А ты угадал? Пиши в комментариях",
  chapter: (n) => `ГЛАВА ${n}`,
  decimal: ",",
  group: " ", // узкий неразрывный пробел, как принято в русском
  groupFrom: 10_000, // четырёхзначные по-русски не делят: «2560», но «12 500»
};

const EN: UiText = {
  subscribe: "Subscribe",
  subscribed: "Subscribed",
  truth: "FACT",
  myth: "MYTH",
  quizTitle: "FACT OR MYTH?",
  quizQuestion: "Did you guess right? Tell me in the comments",
  chapter: (n) => `CHAPTER ${n}`,
  decimal: ".",
  group: ",",
};

// Казахский и узбекский — заготовка: проверить носителю языка перед запуском канала.
const KK: UiText = {
  subscribe: "Жазылу",
  subscribed: "Жазылдыңыз",
  truth: "ШЫНДЫҚ",
  myth: "МИФ",
  quizTitle: "ШЫНДЫҚ ПА, МИФ ПЕ?",
  quizQuestion: "Таптың ба? Пікіріңді жаз",
  chapter: (n) => `${n}-ТАРАУ`,
  decimal: ",",
  group: " ",
};

const UZ: UiText = {
  subscribe: "Obuna boʻlish",
  subscribed: "Obuna boʻldingiz",
  truth: "HAQIQAT",
  myth: "AFSONA",
  quizTitle: "HAQIQATMI YOKI AFSONA?",
  quizQuestion: "Topdingizmi? Izohlarda yozing",
  chapter: (n) => `${n}-BOB`,
  decimal: ",",
  group: " ",
};

const UK: UiText = {
  ...RU,
  subscribe: "Підписатися",
  subscribed: "Ви підписані",
  myth: "МІФ",
  quizTitle: "ПРАВДА ЧИ МІФ?",
  quizQuestion: "А ти вгадав? Пиши в коментарях",
  chapter: (n) => `РОЗДІЛ ${n}`,
};

const BY_LANG: Record<string, UiText> = { ru: RU, en: EN, kk: KK, uz: UZ, uk: UK };

export function uiText(lang?: string | null): UiText {
  const code = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (!code) return RU;
  return BY_LANG[code] ?? EN;
}
