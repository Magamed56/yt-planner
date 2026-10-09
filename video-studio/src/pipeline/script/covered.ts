// «Уже было на канале»: что канал уже рассказал — сцены готовых сценариев
// (narration/onScreen) и факты тем плана, по которым ролик уже сделан.
// Зачем: YouTube понижает однотипный контент, а зритель замечает повтор фактов.
// Два применения:
//   1) компактный список в промпте — самое похожее на новую тему;
//   2) пост-проверка готового сценария — пересечение нормализованных словесных
//      n-грамм (почти дословный повтор). Перефраз так не поймать, поэтому
//      главная защита — список в промпте, а проверка ловит копипасту.

import fs from "node:fs";
import path from "node:path";
import type { ContentPlan } from "../plan";
import type { ScriptScene } from "../../types";

export interface CoveredEntry {
  code: string | null; // «05a», если известен
  title: string; // заголовок ролика или темы плана
  texts: string[]; // факты: narration/onScreen сцен, claim из плана
  cta?: string; // финал ролика: не факт, но по нему видно одинаковые концовки
}

// Код ролика из имени сценария: sut-08a-… (Shorts) и razbor-08a-… («Разбор»).
export function coveredCode(file: string): string | null {
  const m = /(?:^|[\\/])(?:sut|razbor)-(\d{2}[a-z])-[^\\/]*\.json$/i.exec(file);
  return m ? m[1]!.toLowerCase() : null;
}

// ---- Нормализация ----

// Частые слова без смысла факта: иначе «и это всё ещё» дало бы ложные совпадения.
const STOP = new Set(
  "это что как так его она они оно для или все всё уже при без под над чем даже только когда если тебя твой твоя твои тебе тот эта эти этот того тоже потому почему зачем кто где там тут здесь вот был была было были есть быть будет может можно нужно нужен очень просто ещё еще себя свой своя свои них нам нас вам вас мой моя наш ваш который которая которые которое один одна одно"
    .split(" ")
    .map((w) => w.replace(/ё/g, "е")),
);

// Грубый «стеммер»: русские окончания — 1–3 буквы, обрезаем хвост длинных слов
// («золотая»/«золотые» → «золот», «рыбка»/«рыбки» → «рыбк»).
function stem(w: string): string {
  if (/^\d+$/.test(w)) return w;
  if (w.length >= 6) return w.slice(0, 5);
  if (w.length === 5) return w.slice(0, 4);
  return w;
}

export function stems(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\*/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && (w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w))
    .map(stem);
}

export function ngrams(tokens: string[], n = 3): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) {
    // короткий текст (onScreen «3 сердца») — целиком одной «граммой», если в нём 2+ слова
    if (tokens.length >= 2) out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

// ---- Корпус ----

const sceneText = (s: Pick<ScriptScene, "narration" | "onScreen">) => `${s.narration} ${s.onScreen.replace(/\*/g, "")}`.trim();

export function coveredFromScript(file: string, script: { title?: unknown; scenes?: unknown }): CoveredEntry | null {
  if (!Array.isArray(script.scenes)) return null;
  const texts = (script.scenes as Partial<ScriptScene>[])
    // призыв в конце у всех роликов одинаковый — это не факт
    .filter((s) => s && typeof s.narration === "string" && s.kind !== "cta")
    .map((s) => sceneText({ narration: s.narration ?? "", onScreen: typeof s.onScreen === "string" ? s.onScreen : "" }));
  if (!texts.length) return null;
  const last = (script.scenes as Partial<ScriptScene>[]).at(-1);
  const cta = last && last.kind === "cta" && typeof last.narration === "string" ? last.narration.trim() : "";
  return { code: coveredCode(file), title: typeof script.title === "string" ? script.title : path.basename(file, ".json"), texts, ...(cta ? { cta } : {}) };
}

// ---- Финалы прошлых роликов ----

export interface RecentCta {
  code: string | null;
  title: string;
  cta: string;
}

// Последние финалы: loadCovered идёт по именам файлов (sut-01a…), то есть по порядку выхода.
export function recentCtas(entries: CoveredEntry[], limit = 10): RecentCta[] {
  return entries.flatMap((e) => (e.cta ? [{ code: e.code, title: e.title, cta: e.cta }] : [])).slice(-limit);
}

// Финал повторяет прошлый, если половина его значимых слов уже была в одном из
// прошлых финалов («Напиши в комментариях и подпишись» у всех подряд).
export function ctaRepeat(cta: string, recent: RecentCta[], minShare = 0.5): RecentCta | null {
  const mine = new Set(stems(cta));
  if (!mine.size) return null;
  let best: RecentCta | null = null;
  let bestShare = 0;
  for (const r of recent) {
    const theirs = new Set(stems(r.cta));
    let common = 0;
    for (const w of mine) if (theirs.has(w)) common++;
    const share = common / mine.size;
    if (share >= minShare && share > bestShare) {
      best = r;
      bestShare = share;
    }
  }
  return best;
}

// Сценарии из scripts/ + факты тем плана, у которых ролик уже есть.
// exclude — коды текущей темы: её собственные факты повтором не считаются.
export function loadCovered(root: string, opts: { plan?: ContentPlan | null; exclude?: string[] } = {}): CoveredEntry[] {
  const exclude = new Set((opts.exclude ?? []).map((c) => c.toLowerCase()));
  const dir = path.join(root, "scripts");
  const entries: CoveredEntry[] = [];
  const done = new Set<string>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = []; // папки нет — канал пустой
  }
  for (const f of files.sort()) {
    try {
      const e = coveredFromScript(f, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^﻿/, "")) as Record<string, unknown>);
      if (!e || (e.code && exclude.has(e.code))) continue;
      if (e.code) done.add(e.code);
      entries.push(e);
    } catch {
      // битый черновик не мешает писать новый
    }
  }
  for (const it of opts.plan?.items ?? []) {
    if (exclude.has(it.id)) continue;
    const made = done.has(it.id) || it.status === "script-ready" || Boolean(it.script);
    if (!made) continue;
    const claims = it.keyFacts.map((f) => f.claim.trim()).filter(Boolean);
    const own = entries.find((e) => e.code === it.id);
    if (own) own.texts.push(...claims);
    else if (claims.length) entries.push({ code: it.id, title: it.title, texts: claims });
  }
  return entries;
}

// ---- Пост-проверка ----

export interface CoveredIndex {
  entries: CoveredEntry[];
  grams: Map<string, number[]>; // n-грамма → номера записей
  n: number;
}

export function indexCovered(entries: CoveredEntry[], n = 3): CoveredIndex {
  const grams = new Map<string, number[]>();
  entries.forEach((e, i) => {
    for (const t of e.texts) {
      for (const g of ngrams(stems(t), n)) {
        const list = grams.get(g);
        if (!list) grams.set(g, [i]);
        else if (list[list.length - 1] !== i) list.push(i);
      }
    }
  });
  return { entries, grams, n };
}

export interface RepeatHit {
  sceneId: string;
  code: string | null;
  title: string;
  shared: number; // общих n-грамм
  ratio: number; // доля n-грамм сцены, которые уже были
  sample: string; // самый похожий текст из уже сказанного
}

export interface RepeatOptions {
  minShared?: number;
  minRatio?: number;
}

export function findRepeats(scenes: Pick<ScriptScene, "id" | "kind" | "narration" | "onScreen">[], index: CoveredIndex, opts: RepeatOptions = {}): RepeatHit[] {
  const minShared = opts.minShared ?? 2;
  const minRatio = opts.minRatio ?? 0.25;
  const hits: RepeatHit[] = [];
  if (!index.entries.length) return hits;
  for (const s of scenes) {
    if (s.kind === "cta") continue;
    const grams = ngrams(stems(sceneText(s)), index.n);
    if (!grams.size) continue;
    const perEntry = new Map<number, number>();
    for (const g of grams) for (const i of index.grams.get(g) ?? []) perEntry.set(i, (perEntry.get(i) ?? 0) + 1);
    let best = -1;
    let bestShared = 0;
    for (const [i, c] of perEntry) {
      if (c > bestShared) {
        best = i;
        bestShared = c;
      }
    }
    const ratio = bestShared / grams.size;
    if (best < 0 || bestShared < minShared || ratio < minRatio) continue;
    const e = index.entries[best]!;
    // Какой именно текст совпал — его и покажем модели/человеку.
    let sample = e.texts[0] ?? "";
    let sampleScore = -1;
    for (const t of e.texts) {
      const tg = ngrams(stems(t), index.n);
      let c = 0;
      for (const g of grams) if (tg.has(g)) c++;
      if (c > sampleScore) {
        sample = t;
        sampleScore = c;
      }
    }
    hits.push({ sceneId: s.id, code: e.code, title: e.title, shared: bestShared, ratio: Math.round(ratio * 100) / 100, sample });
  }
  return hits;
}

const short = (s: string, max = 110) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const where = (h: Pick<RepeatHit, "code" | "title">) => `${h.code ? `ролике ${h.code} ` : "ролике "}«${short(h.title, 70)}»`;

export function repeatProblems(hits: RepeatHit[]): string[] {
  return hits.map((h) => `сцена ${h.sceneId} почти дословно повторяет то, что уже было в ${where(h)}: «${short(h.sample)}» — замени на факт или формулировку, которых на канале ещё не было`);
}

export function repeatWarnings(hits: RepeatHit[]): string[] {
  return hits.map((h) => `сцена ${h.sceneId} похожа на уже сказанное в ${where(h)} («${short(h.sample, 80)}») — проверь, не повтор ли это`);
}

// Повтор → один ремонтный запрос с конкретными сценами; не помогло → только
// предупреждение (ролик всё равно нужен, решает человек). Ремонт — только по
// ПЕРВОМУ ответу: если повтор появился уже в исправленном, это замечание, а не
// повод бросать ответ и идти к следующей (более слабой) модели.
export class RepeatGuard {
  private armed = true;
  readonly warnings: string[] = []; // замечания принятых ответов — в итог генерации
  constructor(private readonly index: CoveredIndex | null) {}

  // Ответ принят — его замечания о повторах идут в итог (у отклонённых — нет).
  accept(warnings: string[]): void {
    this.warnings.push(...warnings);
  }

  check(scenes: Pick<ScriptScene, "id" | "kind" | "narration" | "onScreen">[]): { problems: string[]; warnings: string[] } {
    if (!this.index) return { problems: [], warnings: [] };
    const first = this.armed;
    this.armed = false;
    const hits = findRepeats(scenes, this.index);
    if (!hits.length) return { problems: [], warnings: [] };
    return first ? { problems: repeatProblems(hits), warnings: [] } : { problems: [], warnings: repeatWarnings(hits) };
  }
}

// ---- Блок для промпта ----

// Самое похожее на тему — с фактами, остальное — только названиями: модель
// видит, что уже было, а промпт остаётся компактным (лимиты бесплатных моделей).
export function coveredPromptBlock(entries: CoveredEntry[], topicText: string, opts: { maxEntries?: number; maxChars?: number; maxTitles?: number } = {}): string {
  if (!entries.length) return "";
  const maxEntries = opts.maxEntries ?? 6;
  const maxChars = opts.maxChars ?? 1800;
  const maxTitles = opts.maxTitles ?? 24;
  const topic = new Set(stems(topicText));
  const scored = entries
    .map((e, i) => {
      const words = new Set(stems(`${e.title} ${e.texts.join(" ")}`));
      let score = 0;
      for (const w of topic) if (words.has(w)) score++;
      return { e, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const lines: string[] = [];
  let size = 0;
  const detailed = new Set<number>();
  for (const { e, i, score } of scored) {
    if (score === 0 || detailed.size >= maxEntries) break;
    // Самые короткие тексты — обычно факты плана и onScreen: ёмко и без воды.
    const facts = [...new Set(e.texts)].sort((a, b) => a.length - b.length).slice(0, 3).map((t) => short(t, 120));
    const line = `- ${e.code ? `${e.code} ` : ""}«${short(e.title, 80)}»: ${facts.join("; ")}`;
    if (size + line.length > maxChars) break;
    lines.push(line);
    size += line.length;
    detailed.add(i);
  }
  const rest = scored.filter((x) => !detailed.has(x.i)).slice(0, maxTitles).map((x) => `«${short(x.e.title, 60)}»`);
  if (rest.length) lines.push(`- другие ролики канала: ${rest.join(", ")}`);
  return `Уже было на канале — эти факты и формулировки не повторяй (если без них никак — упомяни мельком и дай новый угол):\n${lines.join("\n")}`;
}
