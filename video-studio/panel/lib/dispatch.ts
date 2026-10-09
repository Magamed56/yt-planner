// Запуск workflow с защитой от повтора (lib/dispatch-guard.ts): сначала смотрим запуски GitHub и
// недавние нажатия, потом запускаем и записываем нажатие в переменную репозитория — GitHub
// показывает новый запуск не сразу, а второе нажатие может прийти с другого устройства.
import { dispatchWorkflow, getVariable, listRuns, setVariable } from "./github";
import { addDispatch, dispatchConflict, DISPATCH_VAR, parseDispatches } from "./dispatch-guard";
import { runInfos } from "./state";

export class DispatchRefused extends Error {}

export async function dispatchOnce(file: string, inputs: Record<string, string>, kind: string, codes: string[], timeZone: string): Promise<{ codes: string[]; at: string }> {
  const now = Date.now();
  const [runs, raw] = await Promise.all([listRuns(), getVariable(DISPATCH_VAR).catch(() => null)]);
  const recent = parseDispatches(raw, now);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const why = dispatchConflict({ file, kind, codes }, runInfos(runs, undefined, timeZone), recent, now, (iso) => time.format(new Date(iso)));
  if (why) throw new DispatchRefused(why);
  await dispatchWorkflow(file, inputs);
  const at = new Date(now).toISOString();
  // Запись нажатия — по возможности: без неё защитит список запусков GitHub.
  await setVariable(DISPATCH_VAR, JSON.stringify(addDispatch(recent, { file, kind, codes, at }, now))).catch(() => {});
  return { codes, at };
}
