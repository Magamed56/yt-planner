// «Проверить»: пробное уведомление на это устройство (только на него — остальные не будим).
import { notifyDevices } from "@/lib/push";
import { endpointOf, jsonBody, reply, sessionDenied } from "@/lib/push-api";

export const maxDuration = 30;

export async function POST(request: Request) {
  const denied = await sessionDenied();
  if (denied) return denied;
  const endpoint = endpointOf(await jsonBody(request));
  if (!endpoint) return reply(false, "Нет адреса подписки — сначала нажмите «Включить».", 400);
  const report = await notifyDevices(
    { title: "Проверка уведомлений", body: "Всё работает. Утром здесь будут дела на сегодня, после сборки — «видео готово».", url: "/settings", tag: "test" },
    // Пробное через 5 минут уже никому не нужно — пусть служба push его не хранит.
    { only: endpoint, ttl: 300, urgency: "high" },
  );
  if (report.problem) return reply(false, report.problem, 400);
  if (report.sent) return reply(true, "Отправлено — уведомление придёт через несколько секунд.");
  if (report.removed) return reply(false, "Подписки этого устройства больше нет — нажмите «Включить» заново.", 410);
  return reply(false, `Не дошло: ${report.errors.join("; ")}`, 502);
}
