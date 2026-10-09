// Состояние уведомлений для карточки «Уведомления на телефон»: заданы ли ключи VAPID, открытый
// ключ для подписки и подписанные устройства — вместо адресов короткие отпечатки.
import { deviceId, githubStore, PUSH_MAX_DEVICES, vapidSetup } from "@/lib/push";
import { errorText, reply, sessionDenied } from "@/lib/push-api";

export async function GET() {
  const denied = await sessionDenied();
  if (denied) return denied;
  const { keys, problems } = vapidSetup();
  let devices: { id: string; label: string; addedAt: string }[] = [];
  let storageError: string | null = null;
  try {
    devices = (await githubStore.load()).map((s) => ({ id: deviceId(s.endpoint), label: s.label, addedAt: s.addedAt }));
  } catch (e) {
    storageError = errorText(e);
  }
  return reply(true, "", 200, { configured: keys !== null, problems, publicKey: keys?.publicKey ?? null, devices, max: PUSH_MAX_DEVICES, storageError });
}
