// Про то ли найденный файл, что просит сцена. Источники ищут по словам, а не
// по смыслу, и без проверки в ролик попадало случайное совпадение слова:
// «old circuit board» → гоночный «circuit», «cat tongue» → «Tongue of the
// forest», «old book candle desk» → гравюра стола 1720 года, «city street
// through window» → улица со статуями поваров (ролики 10a–12b). Здесь — общая
// для всех источников проверка: какие слова запроса важны, есть ли они в
// названии/категориях/описании файла, не рисунок ли это (гравюра, карта,
// схема, логотип, скан), и итоговый балл. Лучше сцена на чистой моушен-графике,
// чем картинка не по теме.
//
// Только чистые функции без сети и файловой системы — их проверяет
// src/dev/visuals-test.ts на настоящих названиях файлов Commons.

import type { ScriptScene } from "../../types";

// ---- Слова ----

// Связки — не несут смысла.
const STOP = new Set(
  "a an the of in on at with and or for to from by into onto over under near through across behind between above below inside outside along around against about as is are be its it this that these those his her their there here very some any one two three four five six seven eight nine ten".split(
    " ",
  ),
);

// Стиль, ракурс, свет — к предмету кадра отношения не имеют, а поиск по ним
// сужает выдачу Commons до случайных файлов со словом «dark» в описании.
const STYLE = new Set(
  "cinematic dramatic close closeup up macro micro shot view top down wide angle photo photos photograph photography image picture style lighting light lights lit soft hard rim warm cold cool moody background minimal minimalist abstract concept detailed realistic 4k 8k hd glowing glow beautiful stunning silhouette silhouetted shallow depth bokeh blur blurred motion foreground aerial overhead low high side front perspective timelapse lapse slow".split(
    " ",
  ),
);

// Признаки: цвет, возраст, размер, время суток. Чуть уточняют, но не решают.
const MODIFIER = new Set(
  "old vintage antique retro new modern ancient historic historical medieval classic common small tiny little big large huge giant great dark bright night day daytime morning evening sunny cloudy clear wet dry hot empty full young elderly red blue green yellow orange purple violet pink white black golden gold silver brown grey gray colorful colourful single wooden plastic metallic".split(
    " ",
  ),
);

// Обстановка и «кто угодно»: есть почти в любом кадре, поэтому совпадение
// только по ним (улица, вода, рука) — не доказательство, что файл про сцену.
const SETTING = new Set(
  "space planet museum desert reef ocean sea sky forest field street city town village room lab laboratory landscape nature animal animals object people person man woman men women child children kid boy girl hand finger face body building house home interior exterior studio display exhibit exhibition collection table desk floor wall window door water ground road surface scene world time doctor scientist student worker tourist crowd".split(
    " ",
  ),
);

// Существительные на -ing — не действия.
const NOUN_ING = new Set(
  "ring string spring king wing thing sling swing viking ceiling building painting drawing clothing morning evening pudding wedding earring landing sibling seedling dumpling ending opening icing awning lightning ping engraving etching carving".split(
    " ",
  ),
);

// Слова названий файлов, которые ничего не говорят о сюжете.
const FILE_NOISE = new Set("jpg jpeg png webp tif tiff img dsc dscf dscn file edit edited crop cropped retouched version cc by sa".split(" "));

// Слова о виде изображения, а не о предмете: «Edme Mariotte portrait» — это
// сам Мариотт, слово portrait у файла может и не стоять.
const IMAGE_KIND = new Set("portrait painting drawing engraving illustration sketch lithograph etching".split(" "));

// Слова без ударений и регистра: «México» → «mexico», «façonirter» → «faconirter».
export function words(text: string | null | undefined): string[] {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function undouble(w: string): string {
  return /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w) ? w.slice(0, -1) : w;
}

// Лёгкая «основа» английского слова: множественное число, -ing, -ed.
// pyramids → pyramid, skies → sky, sniffing → sniff, wrinkled → wrinkl.
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith("'s")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes|zzes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith("ing") && !NOUN_ING.has(w)) return undouble(w.slice(0, -3));
  if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) return undouble(w.slice(0, -2));
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// Совпадение основ: равны или отличаются последней буквой («wrinkl» ≈
// «wrinkle»). Длиннее одной буквы разницу не берём: «rock» ≠ «rocket».
export function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.length - s.length === 1 && l.startsWith(s);
}

const hasStem = (stems: string[], s: string) => stems.some((x) => sameStem(x, s));

// Материалы: перед другим существительным («iron helmet») — признак, а не предмет (stockFit).
const MATERIAL = new Set("iron steel stone glass wood copper bronze brass tin paper leather marble brick clay concrete rubber cotton wool silk ceramic porcelain".split(" "));

// ---- Запрос ----

export type TermKind = "subject" | "noun" | "setting" | "action" | "modifier";

export interface Term {
  word: string;
  stem: string;
  // 2 — предмет ролика или имя собственное, 1 — конкретное существительное,
  // 0.5 — обстановка/действие, 0.3 — признак (цвет, «старый»).
  weight: number;
  kind: TermKind;
  pos: number; // номер слова в запросе — соседние слова бывают одним понятием («sea lion»)
  qualifies?: boolean; // имя из imagePrompt стоит прямо перед предметом запроса — идёт в запрос Commons
}

export interface VisualQuery {
  text: string; // visualQuery сцены (как есть)
  terms: Term[]; // значимые слова по порядку
  proper: string[]; // основы имён собственных (Apollo, Tenochtitlan): у стоков их обычно нет
  // Предмет, к которому имя — лишь определение: «Greenland shark» → shark,
  // «Bengal tiger» → tiger, «Tenochtitlan model» → model. Одно имя без него —
  // другой предмет (ледник Гренландии, бенгальская кошка).
  heads: string[];
  bonus: Term[]; // имена собственные из imagePrompt (Saturn V) — только добавка к баллу и к запросу Commons
  subjectStems: string[]; // слова предмета (без признаков) — для «точности» названия
  lower: string; // запрос строчными — что он сам просит (map, painting…)
}

function classify(w: string): { weight: number; kind: TermKind } | null {
  if (w.length < 2 || STOP.has(w) || STYLE.has(w) || /^\d+$/.test(w)) return null;
  if (MODIFIER.has(w)) return { weight: 0.3, kind: "modifier" };
  if (SETTING.has(w) || SETTING.has(stem(w))) return { weight: 0.5, kind: "setting" };
  if (w.length > 5 && w.endsWith("ing") && !NOUN_ING.has(w)) return { weight: 0.5, kind: "action" };
  return { weight: 1, kind: "noun" };
}

// Имена собственные: слово с заглавной не в начале строки, все слова с
// заглавной («Apollo Guidance Computer»), аббревиатура (ISS, NASA) или первое
// слово с заглавной, если остальные запросы ролика пишутся строчными
// («Tenochtitlan model» среди «cat tongue close up»).
function properWords(text: string, firstWordCaps: boolean): string[] {
  const raw = text.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  const caps = raw.map((w) => /^\p{Lu}/u.test(w));
  const out: string[] = [];
  raw.forEach((w, i) => {
    const lw = words(w)[0];
    if (!lw || STOP.has(lw) || STYLE.has(lw) || MODIFIER.has(lw) || lw.length < 2) return;
    const acronym = /^\p{Lu}{2,}$/u.test(w);
    if (acronym || (caps[i] && (i > 0 || firstWordCaps || caps.filter(Boolean).length > 1))) out.push(lw);
  });
  return out;
}

// Имена собственные из imagePrompt не в начале предложения: «a giant Saturn V
// style rocket» → saturn. Commons по ним находит настоящий объект. near —
// основы трёх следующих слов: имя, стоящее прямо перед предметом запроса
// («Saturn V style rocket»), уточняет сам предмет, а «the Moon reflected on
// the screen» — лишь деталь кадра.
function promptProperWords(prompt: string): { word: string; near: string[] }[] {
  const out: { word: string; near: string[] }[] = [];
  for (const sentence of prompt.split(/[.!?;:]\s+/)) {
    const raw = sentence.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
    raw.forEach((w, i) => {
      if (i === 0 || !/^\p{Lu}/u.test(w)) return;
      const lw = words(w)[0];
      if (!lw || lw.length < 3 || STOP.has(lw) || STYLE.has(lw) || MODIFIER.has(lw) || out.some((o) => o.word === lw)) return;
      out.push({ word: lw, near: raw.slice(i + 1, i + 4).flatMap((x) => words(x)).map(stem) });
    });
  }
  return out;
}

// Предмет ролика: конкретное существительное, которое повторяется в запросах
// многих сцен («cat» в 4 сценах из 7 у ролика про кошек, «eye» в 3 — про
// слепое пятно). Совпадение по нему весит вдвое. Порог — треть сцен, но не
// меньше двух: «horizon» в 2 сценах из 7 — ещё не тема ролика.
export function topicAnchors(topicQueries: readonly string[] | undefined): Set<string> {
  const qs = (topicQueries ?? []).filter((q) => q && q.trim());
  const out = new Set<string>();
  if (qs.length < 3) return out;
  const min = Math.max(2, Math.ceil(qs.length * 0.35));
  const count = new Map<string, number>();
  for (const q of qs) {
    const seen = new Set<string>();
    for (const w of words(q)) if (classify(w)?.kind === "noun") seen.add(stem(w));
    for (const s of seen) count.set(s, (count.get(s) ?? 0) + 1);
  }
  for (const [s, n] of count) if (n >= min) out.add(s);
  return out;
}

export function visualQuery(scene: Pick<ScriptScene, "visualQuery" | "imagePrompt">, hints: { topicQueries?: readonly string[] } = {}): VisualQuery {
  const text = (scene.visualQuery ?? "").trim();
  const anchors = topicAnchors(hints.topicQueries);
  // Сценарист пишет запросы с заглавной «по стилю» — тогда первое слово не имя.
  const all = (hints.topicQueries ?? []).filter((x) => x && x.trim());
  const styleCaps = all.filter((x) => /^\p{Lu}/u.test(x.trim())).length * 2 > all.length;
  const proper = new Set(properWords(text, all.length > 0 && !styleCaps).map(stem));
  const terms: Term[] = [];
  words(text).forEach((w, pos) => {
    const s = stem(w);
    const c = classify(w);
    if (!c || terms.some((t) => t.stem === s)) return;
    const subject = proper.has(s) || (c.kind === "noun" && anchors.has(s));
    terms.push({ word: w, stem: s, weight: subject ? 2 : c.weight, kind: subject ? "subject" : c.kind, pos });
  });
  const bonus: Term[] = [];
  const core = terms.filter((t) => t.weight >= 0.5);
  for (const { word: w, near } of promptProperWords(scene.imagePrompt ?? "")) {
    const s = stem(w);
    if (terms.some((t) => sameStem(t.stem, s)) || bonus.some((t) => t.stem === s)) continue;
    const qualifies = near.some((n) => core.some((t) => sameStem(t.stem, n)));
    bonus.push({ word: w, stem: s, weight: 0.5, kind: "subject", pos: -1, ...(qualifies ? { qualifies } : {}) });
  }
  const top = bonus.slice(0, 3);
  const subjectStems = [...terms.filter((t) => t.weight >= 0.5), ...top].map((t) => t.stem);
  // Имя (не аббревиатура: DNA, ISS — сами предмет) и следом обычное
  // существительное — это «какой именно предмет». Слова о виде изображения
  // (portrait) предметом не считаются. Если имя — предмет всего ролика
  // («Saturn rings» в ролике про Сатурн), следующее слово — лишь деталь.
  const acronyms = new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => /^\p{Lu}{2,}$/u.test(w)).map((w) => stem(words(w)[0] ?? "")));
  const heads: string[] = [];
  terms.forEach((t, i) => {
    const next = terms[i + 1];
    if (!proper.has(t.stem) || acronyms.has(t.stem) || !next || proper.has(next.stem)) return;
    if (anchors.has(t.stem) && !anchors.has(next.stem)) return;
    if ((next.kind === "noun" || next.kind === "subject") && !IMAGE_KIND.has(next.stem) && !heads.includes(next.stem)) heads.push(next.stem);
  });
  return { text, terms, proper: [...proper], heads, bonus: top, subjectStems, lower: text.toLowerCase() };
}

// Запросы к архивам реальных фото (Commons): только предмет кадра, без стиля и
// признаков — поиск Commons требует ВСЕ слова, и «dark», «close up», «old»
// лишь отсекают нужные файлы. По убыванию точности: с именем собственным из
// imagePrompt → предмет целиком → два главных слова (с «sea» при «lion»:
// составное понятие не разрываем).
export function photoQueries(q: VisualQuery, max = 3): string[] {
  const core = q.terms.filter((t) => t.weight >= 0.5);
  const out: string[] = [];
  const add = (ws: string[]) => {
    const s = ws.join(" ").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  const extra = q.bonus.filter((t) => t.qualifies).slice(0, 2).map((t) => t.word);
  if (extra.length && core.length) add([...extra, ...core.map((t) => t.word)]);
  add(core.map((t) => t.word));
  if (core.length >= 3) {
    const top = new Set([...core].sort((a, b) => b.weight - a.weight).slice(0, 2));
    for (const t of [...top]) {
      const left = core.find((x) => x.pos === t.pos - 1 && x.kind === "setting");
      if (left) top.add(left);
    }
    add(core.filter((t) => top.has(t)).map((t) => t.word));
  }
  if (out.length === 0) add(q.terms.map((t) => t.word));
  return out.slice(0, max);
}

// ---- Не фото ----

interface KindRule {
  kind: string; // для логов
  title: RegExp;
  cats: RegExp;
  desc?: RegExp;
  allow: RegExp; // запрос сам просит такой файл
}

// Гравюры, карты, схемы, логотипы, сканы и рендеры — не «нормальное фото» для
// Shorts. Проверяем название, категории Commons и описание; запрос, который
// сам просит карту или портрет («Edme Mariotte portrait»), их пропускает.
const KIND_RULES: KindRule[] = [
  {
    kind: "гравюра/рисунок/живопись",
    title:
      /\b(engravings?|etchings?|lithographs?|lithography|woodcuts?|woodblock|mezzotint|aquatint|drawings?|sketch(es)?|paintings?|oil on canvas|watercolou?rs?|gouache|frescoe?s?|murals?|illustrations?|caricatures?|cartoons?|comics?)\b|^(print|drawing|painting|sketch|textile|sidewall|poster)\s*[,(-]/i,
    cats: /\b(engravings?|etchings?|lithographs?|woodcuts?|woodblock prints|mezzotints?|aquatints?|prints|drawings?|sketches|paintings?|watercolou?rs?|frescoe?s|murals?|illustrations?|caricatures?|cartoons?|comics|artworks?)\b/i,
    desc: /\b(engraving|etching|lithograph|woodcut|mezzotint|aquatint|oil on canvas|oil on panel|watercolou?r on|gouache|pen and ink|ink on paper|tempera on)\b/i,
    allow: /\b(engraving|etching|lithograph|woodcut|drawing|sketch|painting|fresco|mural|illustration|artwork|portrait|print|art)s?\b/,
  },
  {
    kind: "карта",
    // «atlas of», а не просто atlas: ракета Atlas V, горы Атлас, бабочка-атлас — фото.
    title: /\b(maps?|atlas of|plan of|nautical chart)\b/i,
    cats: /\b(maps?|atlases|cartography)\b/i,
    desc: /\b(map of|topographic map)\b/i,
    allow: /\b(maps?|atlas|chart)\b/,
  },
  {
    kind: "схема",
    title: /\b(diagrams?|schematics?|schema|blueprints?|infographics?|charts?|graphs?|flowchart)\b/i,
    cats: /\b(diagrams?|schematics?|blueprints?|infographics?|charts?|graphs?)\b/i,
    desc: /\b(diagram of|schematic of|chart showing|graph of)\b/i,
    allow: /\b(diagram|schematic|scheme|blueprint|chart|graph|infographic)s?\b/,
  },
  {
    kind: "логотип/герб/флаг",
    title: /\b(logos?|icons?|emblems?|coats? of arms|flags? of|seals? of|insignia|clip ?art|vector|pictograms?)\b/i,
    cats: /\b(logos?|icons?|emblems?|coats of arms|flags of|seals of|insignia|clip art|vector|pictograms?|svg)\b/i,
    allow: /\b(logo|icon|emblem|coat|arms|flag|seal|insignia|badge|symbol)s?\b/,
  },
  {
    kind: "скан/документ",
    // Не просто «scan»: «retina scan», «CT scan» — снимки, а не сканы книг.
    title:
      /\b(page|pages|pg\.?\s?\d+|plate \d+|fig\.?\s?\d+|book cover|(?:book|page|document) scans?|scanned|document|newspaper|letter|manuscript|codex|postcard|postage stamp|stamp|banknote|ticket|poster|screenshot|screen shot|bulletin|journal|catalogu?e|guide to|account of)\b|\bp\.\s?\d+/i,
    cats: /\b(book scans?|scanned|scans|pages? from|plates? from|illustrations? from|documents|newspapers|letters|manuscripts|postcards|postage stamps|stamps of|banknotes|posters|screenshots|internet archive book images|biodiversity heritage library)\b/i,
    desc: /\b(?:plate|fig(?:ure)?|page)\.?\s*[0-9ivxlc]+\b|\bpp?\.\s*\d+\b|\bscanned from\b/i,
    allow: /\b(manuscript|document|newspaper|letter|page|scroll|parchment|codex|stamp|postcard|poster|screenshot|banknote|ticket)s?\b/,
  },
  {
    kind: "рендер/концепт",
    title: /\b(render|rendering|3d model|artist'?s (concept|impression|rendering)|concept art|cgi|computer[- ]generated)\b/i,
    cats: /\b(renders?|renderings|3d models?|artist'?s concepts?|artist'?s impressions?|computer-generated|cgi)\b/i,
    desc: /\b(artist'?s (concept|impression|rendering)|computer[- ]generated|3d render)\b/i,
    allow: /\b(render|rendering|concept|illustration|cgi|3d)\b/,
  },
];

const JUNK_AUTHOR = /internet archive book images|biodiversity heritage library/i;

// Служебные категории Commons (геометка, лицензия, способ загрузки, Wikidata)
// ничего не говорят о сюжете, а их слова ловят правила: «Pages with maps» есть
// у множества фото с координатами — это не карта, и «pages» в ней — не страницы.
const SERVICE_CATEGORY =
  /^(pages?|files?|media|images?|uploads?|artworks?|items?|photos?) (with|without|using|needing|missing|lacking|from|by|uploaded|reviewed|taken by)\b|^(uploaded|transferred|imported) (with|via|from|by)\b|^self-published|^(cc|cc0|gfdl|pd|fal)\b|^licen[cs]e\b|^flickr(review| images| streams)|\bwikidata\b|\bcampaign:/i;

export function subjectCategories(raw: string | null | undefined): string {
  return (raw ?? "")
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c && !SERVICE_CATEGORY.test(c))
    .join("|");
}

export interface MatchFields {
  title: string; // название файла без «File:» и расширения
  categories?: string; // категории Commons через «|» или теги Openverse
  description?: string; // описание (уже без HTML)
  author?: string | null;
}

// Что это за «не фото» (или null — похоже на фото).
export function nonPhotoKind(q: Pick<VisualQuery, "lower">, f: MatchFields): string | null {
  const scan = KIND_RULES.find((r) => r.kind === "скан/документ");
  if (f.author && JUNK_AUTHOR.test(f.author) && !scan?.allow.test(q.lower)) return "скан/документ";
  const cats = subjectCategories(f.categories);
  for (const r of KIND_RULES) {
    if (r.allow.test(q.lower)) continue;
    if (r.title.test(f.title) || r.cats.test(cats) || (r.desc ? r.desc.test(f.description ?? "") : false)) return r.kind;
  }
  return null;
}

// ---- Балл ----

export interface Fit {
  ok: boolean;
  score: number; // для сортировки подходящих
  recall: number; // доля веса слов запроса, найденных у файла
  precision: number; // доля слов названия, которые есть в запросе
  evidence: number; // вес главных слов, найденных в названии/категориях
  why: string; // для логов и тестов
}

const QUALITY = /\b(quality images|featured pictures|valued images|pictures? of the day)\b/i;
const PHOTO_SIGNS = /\b(taken with|photographs? by|photos? by|photographs? taken)\b/i;

// Слова названия «про предмет»: без связок, стиля, признаков и номеров кадра.
function contentWords(title: string): string[] {
  return words(title).filter((w) => w.length >= 2 && !STOP.has(w) && !STYLE.has(w) && !MODIFIER.has(w) && !FILE_NOISE.has(w) && !/\d/.test(w));
}

// Пороги подобраны на настоящих подборах роликов 10a–12b (см. visuals-test):
// берём файл, если в названии/категориях есть главные слова сцены и найдена
// хотя бы половина веса запроса, — или если короткое название почти целиком
// из слов запроса («Red Sunset» на «red sunset horizon city»; но не «Racing
// circuit» на «old circuit board»).
export const MIN_RECALL = 0.5;
export const MIN_RECALL_PRECISE = 0.4;
export const MIN_PRECISION = 0.66;
// Название из 8+ слов, где из запроса меньше десятой части, — описание
// чужой сцены (самое низкое у удачных подборов 10a–12b — 0.17).
export const MIN_WORDS_FOR_PRECISION = 8;
export const MIN_PRECISION_LONG = 0.1;

export function photoFit(q: VisualQuery, f: MatchFields): Fit {
  const kind = nonPhotoKind(q, f);
  if (kind) return { ok: false, score: 0, recall: 0, precision: 0, evidence: 0, why: `не фото: ${kind}` };
  if (q.terms.length === 0) return { ok: false, score: 0, recall: 0, precision: 0, evidence: 0, why: "пустой запрос" };
  const title = words(f.title).map(stem);
  const cats = words(subjectCategories(f.categories)).map(stem);
  const desc = words(f.description).map(stem);
  // Главные слова: конкретные существительные (и предмет ролика); если их
  // нет — обстановка («city street»), иначе всё, что есть.
  const strong = q.terms.filter((t) => t.weight >= 1);
  const setting = q.terms.filter((t) => t.weight >= 0.5);
  const main = new Set(strong.length ? strong : setting.length ? setting : q.terms);
  const mainTotal = [...main].reduce((a, t) => a + t.weight, 0);
  // Где нашлось слово: название весит больше категорий, категории — описания.
  const where: number[] = q.terms.map((t) => (hasStem(title, t.stem) ? 1 : hasStem(cats, t.stem) ? 0.6 : hasStem(desc, t.stem) ? 0.35 : 0));
  // Разорванное составное слово в начале запроса: «sea lion rocks» → у файла
  // только «lion» — это другой зверь; такое совпадение весит вдвое меньше.
  // Только в начале: «blue sky ocean horizon» — это не «ocean horizon» как понятие.
  let broken = false;
  const [t0, t1] = q.terms;
  if (t0 && t1 && t0.kind === "setting" && t1.pos === t0.pos + 1 && t1.weight >= 1 && where[0]! < 0.6 && where[1]! >= 0.6) {
    where[1] = where[1]! / 2;
    broken = true;
  }
  let total = 0;
  let got = 0;
  let evidence = 0;
  q.terms.forEach((t, i) => {
    total += t.weight;
    got += t.weight * where[i]!;
    if (main.has(t) && where[i]! >= 0.5) evidence += t.weight * Math.min(1, where[i]! / 0.6);
  });
  const recall = total ? got / total : 0;
  const cw = contentWords(f.title);
  const precision = cw.length ? cw.filter((w) => hasStem(q.subjectStems, stem(w))).length / cw.length : 0;
  const need = Math.min(2, mainTotal) - 1e-9;
  // Имя совпало, а предмета при нём нет ни в названии, ни в категориях:
  // «Greenland shark» → «Ilulissat Icefjord, Greenland» — это не акула, даже
  // если акула упомянута в описании (поиск Commons находит и по описанию).
  const headless = q.heads.find((h) => !hasStem(title, h) && !hasStem(cats, h));
  if (headless) return { ok: false, score: 0, recall, precision, evidence, why: `есть имя, но нет предмета «${headless}»` };
  // Длинное название-предложение, где слово запроса — мимоходом: «A night
  // market stall… vendors weigh durians… on their smartphone» на «hand holding
  // smartphone». Короткие названия («IMG 1234») этим не задеваем.
  if (cw.length >= MIN_WORDS_FOR_PRECISION && precision < MIN_PRECISION_LONG) {
    return { ok: false, score: 0, recall, precision, evidence, why: `в длинном названии слова запроса мимоходом (точность ${precision.toFixed(2)})` };
  }
  const ok = evidence > 0 && ((recall >= MIN_RECALL && evidence >= need) || (!broken && recall >= MIN_RECALL_PRECISE && precision >= MIN_PRECISION));
  let score = recall + 0.3 * precision;
  const bonus = q.bonus.filter((t) => hasStem(title, t.stem) || hasStem(cats, t.stem)).length;
  score += Math.min(0.15, 0.05 * bonus);
  if (QUALITY.test(f.categories ?? "")) score += 0.1;
  if (PHOTO_SIGNS.test(f.categories ?? "")) score += 0.05;
  const why = `совпадение ${recall.toFixed(2)}, точность ${precision.toFixed(2)}, главные ${evidence.toFixed(1)}/${Math.min(2, mainTotal).toFixed(1)}`;
  return { ok, score: Math.round(score * 1000) / 1000, recall, precision, evidence, why };
}

// Для стоков слово может стоять частью составного: «smartphone» ↔ «mobile
// phone», «sunlight» ↔ «light», «fingertips» ↔ «fingers», «bathtub» ↔ «bath».
// Только для мягкой проверки стоков: у фото Commons это дало бы «rock» ↔ «rocket».
function looseHas(stems: string[], s: string): boolean {
  return stems.some((x) => {
    if (sameStem(x, s)) return true;
    const [a, b] = x.length <= s.length ? [x, s] : [s, x];
    return a.length >= 4 && (b.startsWith(a) || b.endsWith(a));
  });
}

// Стоки (Pexels, Pixabay): описание скупое (адрес страницы, alt, теги), а поиск
// Pixabay отдаёт популярные клипы и по ОДНОМУ слову запроса. Прогон CI 10.10
// (12a, 11a): водопад на «wrinkled fingertips water bath», дождливая улица на
// «tire tread wet road», подсолнух в руке на «hand holding smartphone night» —
// по одному общему слову (water, road, hand) прошли 8 клипов не по теме из 10.
// Поэтому клип берём, если в описании есть главный предмет сцены — первое
// конкретное существительное запроса (сценарист ставит его первым; причастие
// «wrinkled» и материал в «iron helmet» — не предмет) — или хотя бы половина
// веса слов сюжета (без признаков и действий: «holding» не в счёт; «books» на
// «old library books» — да, одно «road» на «tire tread wet road» — нет).
// Предмет ролика (cat в ролике про кошек) обязателен: собака на «person
// petting cat» — промах. Имя собственное (Apollo, Tenochtitlan) сток не покажет —
// такой клип берём, только если имя есть в описании, иначе очередь реальных фото.
export function stockFit(q: VisualQuery, text: string): Fit {
  const stems = words(text).map(stem);
  const base = { score: 0, recall: 0, precision: 0, evidence: 0 };
  if (q.proper.length && !q.proper.some((p) => hasStem(stems, p))) return { ...base, ok: false, why: "в описании нет имени из запроса" };
  // «Greenland shark»: клип «greenland landscape» — имя есть, а акулы нет.
  const headless = q.heads.find((h) => !hasStem(stems, h));
  if (headless) return { ...base, ok: false, why: `есть имя, но нет предмета «${headless}»` };
  if (stems.length === 0 || q.terms.length === 0) return { ...base, ok: true, why: "без описания" };
  const anchor = q.terms.find((t) => t.kind === "subject" && !q.proper.includes(t.stem) && !looseHas(stems, t.stem));
  if (anchor) return { ...base, ok: false, why: `в описании нет предмета ролика «${anchor.word}»` };
  let total = 0;
  let got = 0;
  for (const t of q.terms) {
    total += t.weight;
    if (looseHas(stems, t.stem)) got += t.weight;
  }
  const recall = total ? got / total : 0;
  // Слова сюжета: предметы и обстановка; главный — первое конкретное существительное.
  const plot = q.terms.filter((t) => t.weight >= 0.5 && t.kind !== "action");
  const found = plot.filter((t) => looseHas(stems, t.stem));
  // Причастие на -ed («wrinkled») — признак, а не предмет: classify() считает его
  // существительным, и черепаха с тегом «wrinkled» прошла на «wrinkled fingertips
  // water bath» (прогон CI 38022757599). Главным берём следующее слово; в вес
  // сюжета причастие по-прежнему идёт. classify() не трогаем — на нём пороги Commons.
  const participle = (t: Term) => !q.proper.includes(t.stem) && t.word.length > 5 && t.word.endsWith("ed") && !t.word.endsWith("eed");
  // Материал прямо перед предметом («iron helmet», «copper wire») — тоже признак: на «iron
  // helmet artifact» (06a) прошло ущелье Iron Gates (прогон CI 38063702244).
  const material = (t: Term) => MATERIAL.has(t.word) && plot.some((n) => n.pos === t.pos + 1 && n.weight >= 1);
  const head = plot.find((t) => t.weight >= 1 && !participle(t) && !material(t));
  if (plot.length === 0) {
    const ok = recall >= 0.3;
    return { ...base, ok, recall, score: recall, why: ok ? `совпадение ${recall.toFixed(2)}` : "в описании нет слов запроса" };
  }
  const weight = (ts: Term[]) => ts.reduce((a, t) => a + t.weight, 0);
  const ok = (head !== undefined && found.includes(head)) || weight(found) >= 0.5 * weight(plot);
  const why = ok
    ? `совпадение ${recall.toFixed(2)}`
    : found.length
      ? `в описании нет главного предмета «${head?.word ?? plot[0]!.word}», совпало только «${found[0]!.word}»`
      : "в описании нет ни предмета, ни обстановки запроса";
  return { ...base, ok, recall, score: recall, why };
}

// Описание клипа Pexels — в адресе страницы: /video/a-cat-sniffing-a-cake-855029/.
export function slugText(url: string | null | undefined): string {
  try {
    const parts = new URL(url ?? "").pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return last.replace(/-?\d+$/, "").replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}
