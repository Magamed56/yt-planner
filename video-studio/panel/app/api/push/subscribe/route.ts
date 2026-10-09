// Включить уведомления на устройстве: подписка браузера → список устройств (PANEL_PUSH_SUBS).
import { githubStore, PUSH_MAX_DEVICES, PushInputError, subscriptionFromClient, upsertSub, vapidSetup, type PushSub } from "@/lib/push";
import { errorText, jsonBody, reply, sessionDenied } from "@/lib/push-api";

export async function POST(request: Request) {
  const denied = await sessionDenied();
  if (denied) return denied;
  const { keys, problems } = vapidSetup();
  if (!keys) return reply(false, `Уведомления не настроены: ${problems.join(" ")}`, 503);
  const body = await jsonBody(request);
  let sub: PushSub;
  try {
    sub = subscriptionFromClient(body.subscription, body.label);
  } catch (e) {
    return reply(false, e instanceof PushInputError ? e.message : `Подписка не разобрана: ${errorText(e)}`, 400);
  }
  try {
    const before = await githubStore.load();
    const list = upsertSub(before, sub);
    await githubStore.save(list);
    const dropped = before.filter((s) => !list.some((l) => l.endpoint === s.endpoint)).map((s) => s.label);
    const tail = dropped.length ? ` Больше ${PUSH_MAX_DEVICES} устройств нельзя — отключено самое давнее: ${dropped.join(", ")}.` : "";
    return reply(true, `Уведомления включены: ${sub.label}. Устройств: ${list.length} из ${PUSH_MAX_DEVICES}.${tail}`);
  } catch (e) {
    return reply(false, `Список устройств не сохранился: ${errorText(e)}`, 502);
  }
}
