"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, newSession, passwordMatches, sessionConfigError } from "@/lib/session";

export async function loginAction(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const config = sessionConfigError();
  if (config) return { error: config };
  if (!passwordMatches(String(form.get("password") ?? ""))) {
    // Пауза на неверный пароль — перебор становится бессмысленно медленным.
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "Неверный пароль." };
  }
  const { value, maxAge } = newSession();
  (await cookies()).set(SESSION_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge, path: "/" });
  redirect("/");
}
