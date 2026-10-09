// Порядок тем плана (экран «План»). Код «08a» позиционный — день и слот, он же в именах
// сценариев и файлов видео. Поэтому позиции (id, day, slot) стоят на месте, а между ними
// переезжает содержимое темы: название, хук, угол, факты, рубрика… Двигать можно только темы
// planned без сценария, видео и релиза. Чистые функции — их зовёт и браузер, и сервер.
import type { ContentPlan, PlanItem } from "../../src/pipeline/plan";
import type { Row } from "./state";

const POSITION_KEYS = new Set(["id", "day", "slot"]);

// Коды, которые двигать нельзя: дальше этапа «тема» (сценарий, видео, релиз, YouTube) или в работе.
export function lockedCodes(rows: Pick<Row, "code" | "stage" | "running">[]): Set<string> {
  return new Set(rows.filter((r) => r.stage !== "topic" || r.running).map((r) => r.code));
}

// Подвижные позиции по порядку плана; locked — коды, у которых уже есть сценарий, видео,
// релиз, ролик на YouTube или запуск (это знает очередь панели).
export function movableIds(plan: ContentPlan, locked: Set<string>): string[] {
  return plan.items.filter((it) => it.status === "planned" && !it.script && !locked.has(it.id)).map((it) => it.id);
}

// order[i] — чьё содержимое встаёт на i-ю подвижную позицию (позиции — по порядку плана).
export function reorderPlan(plan: ContentPlan, movable: string[], order: string[]): ContentPlan {
  const set = new Set(movable);
  const positions = plan.items.filter((it) => set.has(it.id)).map((it) => it.id);
  const sameSet = order.length === positions.length && new Set(order).size === order.length && order.every((id) => set.has(id));
  if (positions.length !== set.size || !sameSet) throw new Error("Список тем изменился (сценарий записался или план правили) — обновите страницу.");
  const byId = new Map(plan.items.map((it) => [it.id, it]));
  const from = new Map(positions.map((id, i) => [id, order[i]!]));
  const items = plan.items.map((it): PlanItem => {
    const src = from.get(it.id);
    if (!src || src === it.id) return it;
    const content = Object.entries(byId.get(src)!).filter(([k]) => !POSITION_KEYS.has(k));
    // Порядок ключей прежний (id, day, slot, затем содержимое) — дифф в git остаётся читаемым.
    return { id: it.id, day: it.day, slot: it.slot, ...Object.fromEntries(content) } as PlanItem;
  });
  return { ...plan, items };
}

// Перенос в списке: элемент с места from — на место to (остальные сдвигаются).
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

// Заготовка для кнопки «по рейтингу рубрик»: темы по месту рубрики в pillarOrder (лучшие —
// раньше), внутри рубрики — прежний порядок; рубрики не из списка — в конце.
export function sortByPillars(items: { id: string; pillar: string }[], pillarOrder: string[]): string[] {
  const rank = (p: string) => {
    const i = pillarOrder.indexOf(p);
    return i < 0 ? pillarOrder.length : i;
  };
  return items
    .map((it, i) => ({ id: it.id, i, r: rank(it.pillar) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.id);
}
