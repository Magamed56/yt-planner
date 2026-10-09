// План тем канала — content/plan.json: 60 тем, по 2 в день, у каждой хук, угол подачи и
// факты с источниками. Читают npm run script -- --plan 08a (сценарий по теме плана) и
// веб-панель (panel/). Без зависимостей: модуль импортирует и панель.

export interface PlanFact {
  claim: string;
  source: string;
}

export interface PlanItem {
  id: string; // «08a» — код ролика: в имени сценария (sut-08a-…), файла видео и черновика Studio
  day: number; // порядковый день выкладки, а не дата
  slot: string; // «12:00»
  pillar: string;
  title: string;
  hook: string;
  angle: string;
  keyFacts: PlanFact[];
  status: string; // planned | script-ready
  script?: string; // scripts/sut-08a-….json — когда сценарий написан
  sequelOf?: string; // «Часть 2»: код первой части (npm run plan-sequel)
}

export interface ContentPlan {
  channel?: string;
  timezone?: string;
  slots?: string[];
  pillars?: { id: string; title: string }[];
  items: PlanItem[];
  [key: string]: unknown; // остальные поля файла (note, handle…) сохраняем как есть
}

export const PLAN_CODE = /^\d{2}[a-z]$/;

export function parsePlan(json: unknown): ContentPlan {
  const plan = json as ContentPlan | null;
  if (!plan || !Array.isArray(plan.items)) throw new Error("content/plan.json: нет списка тем (items).");
  const seen = new Set<string>();
  for (const [i, it] of plan.items.entries()) {
    const where = `content/plan.json, тема ${i + 1}`;
    if (!PLAN_CODE.test(it?.id ?? "")) throw new Error(`${where}: id должен быть вида «08a», а не «${it?.id}».`);
    if (seen.has(it.id)) throw new Error(`${where}: id «${it.id}» повторяется.`);
    seen.add(it.id);
    if (!it.title?.trim()) throw new Error(`${where} (${it.id}): нет title.`);
    if (!Array.isArray(it.keyFacts)) throw new Error(`${where} (${it.id}): keyFacts должен быть списком.`);
  }
  return plan;
}

// Код ролика из имени сценария: «scripts/sut-08a-pochemu.json» → «08a».
export function scriptCode(file: string): string | null {
  const m = /(?:^|[\\/])sut-(\d{2}[a-z])-[^\\/]*\.json$/i.exec(file);
  return m ? m[1]!.toLowerCase() : null;
}

// «Пожелания автора» для LLM: хук, угол и только факты из плана — у каждого есть источник,
// а факты без источника в план не попадают (см. note в plan.json).
// strict: false — для «Разбора» на 5–8 минут: факты плана обязательны, но двух-трёх
// фактов на такой ролик мало — можно добавить общеизвестные проверяемые.
export function planNotes(item: PlanItem, opts: { strict?: boolean; sequel?: PlanItem | null } = {}): string {
  const strict = opts.strict ?? true;
  const facts = item.keyFacts.map((f, i) => `${i + 1}. ${f.claim.trim()} (источник: ${f.source.trim()})`);
  const sequel = opts.sequel
    ? `Это вторая часть ролика ${opts.sequel.id} «${opts.sequel.title.trim()}»: можно одной фразой сослаться на первую часть, но её факты не повторяй.`
    : "";
  return [
    item.hook.trim() ? `Первая фраза — хук: «${item.hook.trim()}»` : "",
    item.angle.trim() ? `Угол подачи: ${item.angle.trim()}` : "",
    sequel,
    facts.length
      ? strict
        ? `Опирайся только на эти проверенные факты, других фактов и цифр не добавляй:\n${facts.join("\n")}`
        : `Обязательно используй эти проверенные факты; другие добавляй, только если они общеизвестны и проверяемы, без выдуманных цифр и исследований:\n${facts.join("\n")}`
      : "Добавляй только общеизвестные проверяемые факты, без цифр, которых нельзя проверить.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- Новые темы: позиции, рубрики, «Часть 2» (npm run plan-extend / plan-sequel) ----

export interface PlanPosition {
  id: string; // «31a»
  day: number;
  slot: string; // «12:00»
}

const SLOT_LETTERS = "abcdefghijklmnopqrstuvwxyz";

// Слоты дня: из channel.json (если передали), иначе из плана, иначе 12:00/19:00.
export function planSlots(plan: Pick<ContentPlan, "slots">, channelSlots?: string[] | null): string[] {
  const list = channelSlots?.length ? channelSlots : plan.slots?.length ? plan.slots : ["12:00", "19:00"];
  return list.slice(0, SLOT_LETTERS.length);
}

// Следующие свободные коды после последней темы: 30b → 31a, 31b, 32a… (буква — слот дня).
export function nextPlanPositions(plan: Pick<ContentPlan, "items" | "slots">, count: number, channelSlots?: string[] | null): PlanPosition[] {
  const slots = planSlots(plan, channelSlots);
  const taken = new Set(plan.items.map((i) => i.id));
  let day = 0;
  let slot = -1;
  for (const it of plan.items) {
    const m = /^(\d{2})([a-z])$/.exec(it.id);
    if (!m) continue;
    const d = Number(m[1]);
    const s = SLOT_LETTERS.indexOf(m[2]!);
    if (d > day || (d === day && s > slot)) {
      day = d;
      slot = s;
    }
  }
  const out: PlanPosition[] = [];
  while (out.length < count) {
    slot += 1;
    if (slot >= slots.length) {
      day += 1;
      slot = 0;
    }
    if (day < 1) day = 1;
    if (day > 99) throw new Error("content/plan.json: коды тем — две цифры дня (до 99), места для новых тем больше нет.");
    const id = `${String(day).padStart(2, "0")}${SLOT_LETTERS[slot]}`;
    if (taken.has(id)) continue;
    out.push({ id, day, slot: slots[slot]! });
  }
  return out;
}

// Рубрики для новых тем: сначала самые редкие в плане (и в этом слоте), без
// одной рубрики два раза подряд — лента остаётся разнообразной.
export function pickPillars(plan: Pick<ContentPlan, "items">, positions: PlanPosition[], pillarIds: string[]): string[] {
  if (!pillarIds.length) return positions.map(() => "why");
  const total = new Map(pillarIds.map((p) => [p, 0]));
  const bySlot = new Map<string, Map<string, number>>();
  const bump = (pillar: string, slot: string) => {
    total.set(pillar, (total.get(pillar) ?? 0) + 1);
    const m = bySlot.get(slot) ?? new Map<string, number>();
    m.set(pillar, (m.get(pillar) ?? 0) + 1);
    bySlot.set(slot, m);
  };
  const ordered = [...plan.items].sort((a, b) => a.id.localeCompare(b.id));
  for (const it of ordered) if (total.has(it.pillar)) bump(it.pillar, it.slot);
  let prev = ordered.at(-1)?.pillar ?? "";
  return positions.map((pos) => {
    const slotCounts = bySlot.get(pos.slot);
    const best = [...pillarIds]
      .filter((p) => p !== prev || pillarIds.length === 1)
      .sort((a, b) => (total.get(a) ?? 0) - (total.get(b) ?? 0) || (slotCounts?.get(a) ?? 0) - (slotCounts?.get(b) ?? 0) || pillarIds.indexOf(a) - pillarIds.indexOf(b))[0]!;
    bump(best, pos.slot);
    prev = best;
    return best;
  });
}

// «Почему X. Часть 2» → «Почему X. Часть 3»; без номера — «… Часть 2».
export function sequelTitle(title: string): { title: string; part: number } {
  const t = title.trim().replace(/\s+/g, " ");
  const m = /^(.*?)[.,:—\s-]*\s*Часть\s+(\d+)\s*$/i.exec(t);
  const base = (m ? m[1]! : t).replace(/[.!?…\s]+$/u, "");
  const part = m ? Number(m[2]) + 1 : 2;
  return { title: `${base}. Часть ${part}`, part };
}

// Сводка рубрик и число дней в шапке плана — после добавления тем.
export function refreshPlanStats(plan: ContentPlan): void {
  const days = plan.items.reduce((a, it) => Math.max(a, Number(it.day) || 0), 0);
  if (typeof plan.days === "number" || plan.days === undefined) plan.days = Math.max(days, Number(plan.days) || 0);
  if (!Array.isArray(plan.pillars)) return;
  for (const p of plan.pillars as (Record<string, unknown> & { id: string })[]) {
    const items = plan.items.filter((it) => it.pillar === p.id);
    if ("total" in p) p.total = items.length;
    for (const slot of plan.slots ?? []) if (slot in p) p[slot] = items.filter((it) => it.slot === slot).length;
  }
}
