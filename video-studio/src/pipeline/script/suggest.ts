// Подсказки поиска YouTube для заголовка и тегов: как зрители на самом деле
// формулируют запрос по теме. Публичный эндпоинт автодополнения, только чтение,
// без ключа. Всё — по мере возможности: таймаут, любая ошибка → пустой список,
// сценарий пишется как раньше. YT_SUGGEST=0 — выключить.

import { linkedAbort, type FetchLike } from "./llm/types";

const ENDPOINT = "https://suggestqueries.google.com/complete/search";
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_SUGGESTIONS = 10;
const MAX_LEN = 70; // длиннее рекомендуемого заголовка — как формулировка бесполезно

export function suggestEnabled(env: Record<string, string | undefined>): boolean {
  return !/^(0|off|false|no|нет)$/i.test((env.YT_SUGGEST ?? "").trim());
}

// Ответ client=youtube — JSONP: window.google.ac.h(["запрос",[["подсказка",0,[512]],…],{…}]);
// у других клиентов — просто ["запрос",["подсказка",…]].
export function parseSuggestResponse(body: string): string[] {
  let text = body.trim();
  const open = text.indexOf("(");
  if (!text.startsWith("[") && open >= 0) text = text.slice(open + 1).replace(/\)\s*;?\s*$/, "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  const out: string[] = [];
  for (const entry of data[1] as unknown[]) {
    const s = typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : null;
    if (s) out.push(s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
  }
  return out.filter(Boolean);
}

// Кодировка — из заголовка: без oe=utf-8 Google отдаёт кириллицу в windows-1251.
function decode(bytes: ArrayBuffer, contentType: string | null): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? "")?.[1]?.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export interface SuggestOptions {
  fetch: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  lang?: string;
}

export async function fetchSuggestions(query: string, opts: SuggestOptions): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${ENDPOINT}?client=youtube&ds=yt&hl=${encodeURIComponent(opts.lang ?? "ru")}&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`;
  const { signal, cleanup } = linkedAbort(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const res = await opts.fetch(url, { method: "GET", signal });
    if (!res.ok) return [];
    return parseSuggestResponse(decode(await res.arrayBuffer(), res.headers.get("content-type")));
  } catch {
    return []; // нет сети, таймаут, блокировка — без подсказок
  } finally {
    cleanup();
  }
}

// Служебные и вопросительные слова: «почему» и так в первой фразе, вторая — о предмете темы.
const STOP = new Set(["и", "в", "во", "на", "не", "с", "со", "к", "по", "о", "об", "от", "до", "за", "из", "у", "а", "но", "что", "как", "это", "твой", "твоя", "ты", "почему", "зачем", "когда", "где", "кто", "какой", "какая", "сколько", "свой", "своя", "всего", "очень"]);

// 1–2 ключевые фразы из темы: начало заголовка (так люди и начинают печатать)
// и пара значимых слов без служебных.
export function searchPhrases(title: string, max = 2): string[] {
  const words = title
    .toLowerCase()
    .replace(/[«»"“”„()[\]]/g, " ")
    .split(/[\s,.!?:;—–]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  if (!words.length) return [];
  const out: string[] = [];
  const head = words.slice(0, 4).join(" ");
  if (head.length >= 3) out.push(head);
  const content = words.filter((w) => w.length >= 4 && !STOP.has(w)).slice(0, 2).join(" ");
  if (content && !out.includes(content) && !head.startsWith(content)) out.push(content);
  return out.slice(0, max);
}

// Подсказки по фразам: параллельно, без дублей и без повторения самой фразы.
export async function suggestionsFor(phrases: string[], opts: SuggestOptions): Promise<string[]> {
  const lists = await Promise.all(phrases.map((p) => fetchSuggestions(p, opts)));
  const seen = new Set(phrases.map((p) => p.toLowerCase().trim()));
  const out: string[] = [];
  for (const list of lists) {
    for (const s of list) {
      const key = s.toLowerCase();
      if (seen.has(key) || s.length > MAX_LEN) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}
