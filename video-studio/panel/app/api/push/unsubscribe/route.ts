// Выключить уведомления на устройстве: убрать его подписку из списка (PANEL_PUSH_SUBS).
import { githubStore } from "@/lib/push";
import { endpointOf, errorText, jsonBody, reply, sessionDenied } from "@/lib/push-api";

export async function POST(request: Request) {
  const denied = await sessionDenied();
  if (denied) return denied;
  const endpoint = endpointOf(await jsonBody(request));
  if (!endpoint) return reply(false, "Нет адреса подписки.", 400);
  try {
    const list = await githubStore.load();
    const kept = list.filter((s) => s.endpoint !== endpoint);
    if (kept.length !== list.length) await githubStore.save(kept);
    return reply(true, "Уведомления на этом устройстве выключены.");
  } catch (e) {
    return reply(false, `Список устройств не обновился: ${errorText(e)}`, 502);
  }
}
