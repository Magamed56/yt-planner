// Достаём JSON из ответа модели. Бесплатные модели регулярно присылают
// <think>…</think>, ```json-блоки, пояснения до/после, висячие запятые и
// «живые» переводы строк внутри строк — всё это чиним здесь, до zod.

export class JsonExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonExtractError";
  }
}

function stripThinking(s: string): string {
  let t = s.replace(/^﻿/, "");
  t = t.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "");
  // Открывающий тег иногда теряется (или наоборот, закрывающий) — берём хвост.
  const close = t.search(/<\/(think|thinking|reasoning)>/i);
  if (close >= 0) t = t.slice(t.indexOf(">", close) + 1);
  const open = t.search(/<(think|thinking|reasoning)>/i);
  if (open >= 0 && t.indexOf("{", open) > open) {
    // незакрытый <think> до JSON — режем всё до первой «{» после него
    t = t.slice(0, open) + t.slice(t.indexOf("{", open));
  }
  return t.trim();
}

function fencedBlocks(s: string): string[] {
  const out: string[] = [];
  const re = /```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1].trim());
  // Незакрытый блок (ответ обрезан или модель забыла закрыть) — берём хвост.
  const lastOpen = s.lastIndexOf("```");
  if (out.length === 0 && lastOpen >= 0) out.push(s.slice(lastOpen + 3).replace(/^[a-zA-Z0-9_-]*\s*\n?/, "").trim());
  return out;
}

// Посимвольный «ремонт» вне строк: висячие запятые, // и /* */ комментарии;
// внутри строк — экранирование сырых переводов строк и табуляций.
export function repairJsonText(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        out += c;
      } else if (c === "\\") {
        esc = true;
        out += c;
      } else if (c === '"') {
        inStr = false;
        out += c;
      } else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "";
      else if (c === "\t") out += "\\t";
      else out += c;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 1;
    } else if (c === ",") {
      // запятая перед } или ] — выбрасываем
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "}" || s[j] === "]") continue;
      out += c;
    } else out += c;
  }
  return out;
}

// Первый сбалансированный {...} начиная с позиции start (с учётом строк).
function balancedObject(s: string, start: number): { text: string; end: number } | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return { text: s.slice(start, i + 1), end: i };
    }
  }
  return null;
}

function tryParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(repairJsonText(s)) };
    } catch {
      return { ok: false };
    }
  }
}

export function extractJson(raw: string): unknown {
  if (typeof raw !== "string" || !raw.trim()) throw new JsonExtractError("пустой ответ модели");
  const cleaned = stripThinking(raw);
  const candidates = [...fencedBlocks(cleaned), cleaned];
  let sawOpen = false;
  for (const cand of candidates) {
    const direct = tryParse(cand);
    if (direct.ok && direct.value !== null && typeof direct.value === "object") return direct.value;
    // Ищем объекты внутри текста; пробуем несколько, если первый не разобрался.
    let from = cand.indexOf("{");
    for (let tries = 0; from >= 0 && tries < 5; tries++) {
      sawOpen = true;
      const bal = balancedObject(cand, from);
      if (!bal) break;
      const p = tryParse(bal.text);
      if (p.ok && p.value !== null && typeof p.value === "object") return p.value;
      // дальше — только ПОСЛЕ этого объекта, иначе вернём вложенный кусок
      from = cand.indexOf("{", bal.end + 1);
    }
  }
  throw new JsonExtractError(
    sawOpen ? "JSON в ответе не разбирается (вероятно, оборван или с синтаксической ошибкой)" : "в ответе нет JSON-объекта",
  );
}
