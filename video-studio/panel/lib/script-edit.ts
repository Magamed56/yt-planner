// Правка сценария из панели: название, описание, теги и тексты сцен (narration, onScreen,
// пункты списка). Структуру (id, kind, stat, визуал) панель не меняет. Проверка — пределы
// LIMITS из src/pipeline/script/schema.ts и правила onScreen из validate.ts: сами они тянут
// zod, которого в панели нет. Совпадение пределов и итог через validateScript — ops-test.ts.

export const SCRIPT_LIMITS = {
  title: 100,
  description: 5000,
  tagsMax: 30,
  tagLen: 60,
  tagsTotalChars: 500,
  narration: 700,
  onScreen: 90,
  onScreenWords: 8,
  itemsMin: 2,
  itemsMax: 4,
  item: 70,
  hookWordsHard: 20,
} as const;

export interface SceneEdit {
  id: string;
  kind: string;
  narration: string;
  onScreen: string;
  items?: string[]; // только у сцен list
}

export interface ScriptEdit {
  title: string;
  description: string;
  tags: string[];
  scenes: SceneEdit[];
}

type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === "object" && !Array.isArray(v);
// Как countWords в validate.ts: слово — токен с буквой или цифрой.
export const countWords = (s: string) => s.replace(/\*/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// Поля для формы из JSON сценария.
export function scriptEditOf(json: unknown): ScriptEdit {
  if (!isObj(json) || !Array.isArray(json.scenes)) throw new Error("Файл сценария битый: нет списка сцен.");
  return {
    title: str(json.title),
    description: str(json.description),
    tags: Array.isArray(json.tags) ? json.tags.map(str).filter(Boolean) : [],
    scenes: json.scenes.map((s: unknown) => {
      const o = isObj(s) ? s : {};
      const kind = str(o.kind);
      return { id: str(o.id), kind, narration: str(o.narration), onScreen: str(o.onScreen), ...(kind === "list" ? { items: Array.isArray(o.items) ? o.items.map(str) : [] } : {}) };
    }),
  };
}

// «теги через запятую» → список без пустых и повторов.
export const parseTags = (text: string) => [...new Set(text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];

const clean = (s: string) => s.replace(/\r\n?/g, "\n").trim();
const normTags = (tags: string[]) => [...new Set(tags.map(clean).filter(Boolean))];

// Все проблемы сразу, по-русски. Пустой список — можно сохранять.
export function checkScriptEdit(edit: ScriptEdit): string[] {
  const L = SCRIPT_LIMITS;
  const out: string[] = [];
  const title = clean(edit.title);
  const description = clean(edit.description);
  if (!title) out.push("Название пустое.");
  else if (title.length > L.title) out.push(`Название длиннее ${L.title} символов (${title.length}).`);
  if (!description) out.push("Описание пустое.");
  else if (description.length > L.description) out.push(`Описание длиннее ${L.description} символов.`);
  const tags = normTags(edit.tags);
  if (tags.length > L.tagsMax) out.push(`Тегов больше ${L.tagsMax} (${tags.length}).`);
  for (const t of tags) if (t.length > L.tagLen) out.push(`Тег «${t.slice(0, 30)}…» длиннее ${L.tagLen} символов.`);
  const total = tags.reduce((n, t) => n + t.length, 0);
  if (total > L.tagsTotalChars) out.push(`Теги суммарно ${total} символов — YouTube принимает не больше ${L.tagsTotalChars}.`);
  edit.scenes.forEach((s, i) => {
    const label = `Сцена ${i + 1}${s.id ? ` (${s.id})` : ""}`;
    const narration = clean(s.narration);
    if (!narration) out.push(`${label}: текст диктора пустой.`);
    else if (narration.length > L.narration) out.push(`${label}: текст диктора длиннее ${L.narration} символов.`);
    else if (s.kind === "hook" && countWords(narration) > L.hookWordsHard) out.push(`${label}: хук длиннее ${L.hookWordsHard} слов — сократите до одной фразы.`);
    const onScreen = clean(s.onScreen);
    if (!onScreen) out.push(`${label}: текст на экране пустой.`);
    else {
      if (onScreen.length > L.onScreen) out.push(`${label}: текст на экране длиннее ${L.onScreen} символов.`);
      const words = countWords(onScreen);
      if (words > L.onScreenWords) out.push(`${label}: на экране ${words} слов — нужно не больше 7.`);
      const stars = (onScreen.match(/\*/g) ?? []).length;
      if (stars % 2 === 1) out.push(`${label}: на экране непарная «*» — акцент пишется как *слово*.`);
      else if (stars > 2) out.push(`${label}: на экране больше одного акцента — оставьте одно *слово*.`);
      else if (stars === 2 && /\*\s*\*/.test(onScreen)) out.push(`${label}: пустой акцент ** на экране.`);
    }
    if (s.kind === "list") {
      const items = (s.items ?? []).map(clean).filter(Boolean);
      if (items.length < L.itemsMin || items.length > L.itemsMax) out.push(`${label}: в списке должно быть от ${L.itemsMin} до ${L.itemsMax} пунктов (сейчас ${items.length}).`);
      for (const it of items) if (it.length > L.item) out.push(`${label}: пункт «${it.slice(0, 30)}…» длиннее ${L.item} символов.`);
    }
  });
  return out;
}

// Правка поверх полного JSON: остальные поля (stat, icon, visualQuery, theme…) и порядок
// ключей — как были. Сцены должны совпасть по id и kind, иначе файл успели поменять.
export function applyScriptEdit(json: unknown, edit: ScriptEdit): Loose {
  if (!isObj(json) || !Array.isArray(json.scenes)) throw new Error("Файл сценария битый: нет списка сцен.");
  const scenes = json.scenes as unknown[];
  const same = scenes.length === edit.scenes.length && scenes.every((s, i) => isObj(s) && s.id === edit.scenes[i]!.id && s.kind === edit.scenes[i]!.kind);
  if (!same) throw new Error("Сценарий успели изменить (сцены не совпадают) — откройте правку заново.");
  return {
    ...json,
    title: clean(edit.title),
    description: clean(edit.description),
    tags: normTags(edit.tags),
    scenes: scenes.map((raw, i) => {
      const s = raw as Loose;
      const e = edit.scenes[i]!;
      return {
        ...s,
        narration: clean(e.narration),
        onScreen: clean(e.onScreen),
        ...(e.kind === "list" ? { items: (e.items ?? []).map(clean).filter(Boolean) } : {}),
      };
    }),
  };
}

// Текст файла как у writeJson в конвейере: 2 пробела, перевод строки в конце.
export const scriptFileText = (json: unknown) => `${JSON.stringify(json, null, 2)}\n`;
