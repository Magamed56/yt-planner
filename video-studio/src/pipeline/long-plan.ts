// «Разбор» — третий поток канала: длинные ролики 16:9 (~7 минут) на свои темы, которых нет среди
// Shorts. План — content/long-plan.json: та же форма, что у plan.json, коды L01, L02… по порядку
// выхода, у темы 8–12 фактов с источниками и (необязательно) набросок глав. Слоты — channel.json →
// longSlots (вт/чт/сб 21:00 МСК). Без зависимостей и без чтения файлов: модуль берёт и панель.
import { LONG_CODE } from "./codes";
import { planNotes, type ContentPlan, type PlanItem, type PlanPosition } from "./plan";

export const LONG_PLAN_FILE = "content/long-plan.json"; // от папки video-studio

// Факты темы: просим 8–12, тема остаётся, если после проверки ссылок живы хотя бы 6 —
// на 7 минут сценарист добавит общеизвестное (planNotes strict: false), но не выдумает цифры.
export const LONG_FACTS = { min: 8, max: 12 } as const;
export const LONG_MIN_FACTS = 6;
export const LONG_CHAPTERS_MAX = 8;

// Бюджеты бесплатных лимитов на один «Разбор»: ~7000 символов озвучки — ≈ 3 запроса Gemini TTS
// (GEMINI_TTS_BATCH_CHARS = 2500) из ~10 в сутки; сборка в GitHub Actions — 40–60 минут.
export const LONG_TTS_REQUESTS = 3;
export const LONG_BUILD_LABEL = "≈ 40–60 минут";

// Пустой план: файла нет или в нём нет тем — это не ошибка, темы допишет plan-extend --long.
export function parseLongPlan(json: unknown): ContentPlan {
  if (json === null || json === undefined) return { items: [] };
  const plan = json as ContentPlan;
  if (typeof plan !== "object" || !Array.isArray(plan.items)) throw new Error(`${LONG_PLAN_FILE}: нет списка тем (items).`);
  const seen = new Set<string>();
  for (const [i, it] of plan.items.entries()) {
    const where = `${LONG_PLAN_FILE}, тема ${i + 1}`;
    if (!LONG_CODE.test(it?.id ?? "")) throw new Error(`${where}: id должен быть вида «L01», а не «${it?.id}».`);
    if (seen.has(it.id)) throw new Error(`${where}: id «${it.id}» повторяется.`);
    seen.add(it.id);
    if (!it.title?.trim()) throw new Error(`${where} (${it.id}): нет title.`);
    if (!Array.isArray(it.keyFacts)) throw new Error(`${where} (${it.id}): keyFacts должен быть списком.`);
    if (it.chapters !== undefined && (!Array.isArray(it.chapters) || it.chapters.some((c) => typeof c !== "string"))) {
      throw new Error(`${where} (${it.id}): chapters — список названий глав.`);
    }
  }
  return plan;
}

// Следующие коды после самого большого номера: L03 → L04, L05… «День» — порядковый номер выхода.
export function nextLongPositions(plan: Pick<ContentPlan, "items">, count: number, time: string): PlanPosition[] {
  const last = plan.items.reduce((n, it) => (LONG_CODE.test(it.id) ? Math.max(n, Number(it.id.slice(1))) : n), 0);
  const out: PlanPosition[] = [];
  for (let n = last + 1; out.length < count; n++) {
    if (n > 99) throw new Error(`${LONG_PLAN_FILE}: коды «Разборов» — L01…L99, места для новых тем больше нет.`);
    out.push({ id: `L${String(n).padStart(2, "0")}`, day: n, slot: time });
  }
  return out;
}

// Пожелания сценаристу: как у «Разбора» темы Shorts (факты плана обязательны, общеизвестное
// можно добавить) плюс набросок глав, если он есть в плане.
export function longPlanNotes(item: PlanItem): string {
  const chapters = (item.chapters ?? []).map((c) => c.trim()).filter(Boolean);
  return [
    planNotes(item, { strict: false }),
    chapters.length ? `Набросок глав (порядок мысли; названия можно уточнить):\n${chapters.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Темы без сценария и видео — запас плана (автопилот заказывает новые, когда их меньше трёх).
export const LONG_TOPICS_LOW = 3;
