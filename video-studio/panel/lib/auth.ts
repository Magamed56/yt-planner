// Проверка входа внутри действий и маршрутов: proxy.ts уже не пускает без входа, но действие
// сервера — это POST, и проверять его надо там же, где оно выполняется.
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "./session";

export async function requireSession(): Promise<void> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(value)) throw new Error("Вход истёк — обновите страницу и войдите снова.");
}
