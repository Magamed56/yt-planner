// «Отключить TikTok»: отозвать доступ и стереть ключи из переменной репозитория.
import { errorText, reply, sessionDenied } from "@/lib/push-api";
import { disconnect } from "@/lib/tiktok";

export async function POST() {
  const denied = await sessionDenied();
  if (denied) return denied;
  try {
    await disconnect();
    return reply(true, "TikTok отключён: доступ отозван, ключи удалены.");
  } catch (e) {
    return reply(false, `Не получилось отключить: ${errorText(e)}`, 502);
  }
}
