// Вход по одному паролю без базы: в cookie — срок и подпись HMAC(SESSION_SECRET, срок +
// отпечаток пароля). Смена пароля или SESSION_SECRET сразу выкидывает все входы.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "panel_session";
export const SESSION_DAYS = 30;

const password = () => process.env.PANEL_PASSWORD?.trim() ?? "";
const secret = () => process.env.SESSION_SECRET?.trim() ?? "";

function sign(exp: number): string {
  const print = createHash("sha256").update(password()).digest("hex");
  return createHmac("sha256", secret()).update(`${exp}.${print}`).digest("base64url");
}

// Что не так с настройкой входа — или null, если всё задано.
export function sessionConfigError(): string | null {
  if (!password()) return "Не задан PANEL_PASSWORD (Vercel → Settings → Environment Variables).";
  if (secret().length < 32) return "SESSION_SECRET не задан или короче 32 символов.";
  return null;
}

export function newSession(now = Date.now()): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86400;
  const exp = Math.floor(now / 1000) + maxAge;
  return { value: `${exp}.${sign(exp)}`, maxAge };
}

export function isValidSession(value: string | undefined, now = Date.now()): boolean {
  if (!value || sessionConfigError()) return false;
  const [expRaw, sig] = value.split(".");
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < now) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function passwordMatches(input: string): boolean {
  if (sessionConfigError()) return false;
  // Сравниваем отпечатки одинаковой длины — время ответа не выдаёт длину пароля.
  const want = createHash("sha256").update(password()).digest();
  const got = createHash("sha256").update(input.trim()).digest();
  return timingSafeEqual(want, got);
}
