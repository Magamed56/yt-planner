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
export function planNotes(item: PlanItem): string {
  const facts = item.keyFacts.map((f, i) => `${i + 1}. ${f.claim.trim()} (источник: ${f.source.trim()})`);
  return [
    item.hook.trim() ? `Первая фраза — хук: «${item.hook.trim()}»` : "",
    item.angle.trim() ? `Угол подачи: ${item.angle.trim()}` : "",
    facts.length
      ? `Опирайся только на эти проверенные факты, других фактов и цифр не добавляй:\n${facts.join("\n")}`
      : "Добавляй только общеизвестные проверяемые факты, без цифр, которых нельзя проверить.",
  ]
    .filter(Boolean)
    .join("\n");
}
