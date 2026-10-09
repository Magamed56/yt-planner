// Не запускать платное дважды: второе нажатие «Сценарий и видео» (с того же телефона или с
// компьютера) снова заплатило бы за Claude и потратило дневную квоту голоса Gemini. Чистые
// функции без сети; запросы — lib/dispatch.ts, проверка — scripts/ops-test.ts.

export const DISPATCH_VAR = "PANEL_DISPATCHES";
export const RECENT_MS = 3 * 60_000; // «только что запускали»
const KEEP_MS = 10 * 60_000;
const SEEN_SLACK_MS = 15_000; // запуск появился в списке GitHub — запись о нажатии больше не нужна

// Что запускаем: файл workflow, вид запуска (draft / batch / … — как его называет панель), коды.
export interface DispatchWant {
  file: string;
  kind: string;
  codes: string[];
}

export interface Dispatch extends DispatchWant {
  at: string; // ISO — когда нажали
}

export interface RunLike {
  file: string;
  kind: string;
  codes: string[];
  active: boolean;
  conclusion: string | null;
  createdAt: string;
}

export function parseDispatches(raw: string | null, nowMs: number): Dispatch[] {
  try {
    const j: unknown = JSON.parse(raw ?? "");
    if (!Array.isArray(j)) return [];
    return j.filter(
      (d): d is Dispatch =>
        typeof d?.file === "string" && typeof d.kind === "string" && Array.isArray(d.codes) && d.codes.every((c: unknown) => typeof c === "string") && typeof d.at === "string" && nowMs - Date.parse(d.at) < KEEP_MS,
    );
  } catch {
    return [];
  }
}

// Записи о нажатиях — последние 10 минут, свежие первыми.
export function addDispatch(list: Dispatch[], d: Dispatch, nowMs: number): Dispatch[] {
  return [d, ...list.filter((x) => nowMs - Date.parse(x.at) < KEEP_MS)].slice(0, 20);
}

const overlap = (a: string[], b: string[]) => a.filter((c) => b.includes(c));
// Запуск без роликов (план тем) — «тот же», если совпадают файл и вид.
const touches = (want: DispatchWant, codes: string[], kind: string) => (want.codes.length ? overlap(codes, want.codes).length > 0 : kind === want.kind);

// Причина отказа или null. Отказываем, если по тем же роликам того же workflow:
// - идёт (или ждёт в очереди) запуск — любой вид: сборка поверх сценария тоже конфликт;
// - тот же вид запускали меньше 3 минут назад и он не упал (повтор после сбоя — можно);
// - нажимали меньше 3 минут назад, а GitHub ещё не показал этот запуск.
export function dispatchConflict(want: DispatchWant, runs: RunLike[], recent: Dispatch[], nowMs: number, timeLabel: (iso: string) => string): string | null {
  const same = runs.filter((r) => r.file === want.file && touches(want, r.codes, r.kind));
  const say = (codes: string[], what: string) => `${codes.length ? codes.join(", ") : "Этот запуск"} ${what} — второй раз не запускаю.`;
  const active = same.find((r) => r.active);
  if (active) return say(overlap(active.codes, want.codes), `уже в работе (запуск ${timeLabel(active.createdAt)})`);
  const fresh = same.find((r) => r.kind === want.kind && nowMs - Date.parse(r.createdAt) < RECENT_MS && r.conclusion !== "failure" && r.conclusion !== "cancelled");
  if (fresh) return say(overlap(fresh.codes, want.codes), `только что запускали (${timeLabel(fresh.createdAt)}); если нужно ещё раз — через 3 минуты`);
  const pressed = recent.find(
    (d) =>
      d.file === want.file &&
      touches(want, d.codes, d.kind) &&
      nowMs - Date.parse(d.at) < RECENT_MS &&
      !same.some((r) => Date.parse(r.createdAt) >= Date.parse(d.at) - SEEN_SLACK_MS),
  );
  if (pressed) return say(overlap(pressed.codes, want.codes), `уже запущен (${timeLabel(pressed.at)}), GitHub ещё ставит его в очередь`);
  return null;
}
