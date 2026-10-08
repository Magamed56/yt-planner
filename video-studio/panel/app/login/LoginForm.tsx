"use client";
import { useActionState } from "react";
import { loginAction } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action} className="login-form">
      <label htmlFor="password">Пароль</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Проверяю…" : "Войти"}
      </button>
      {state.error && <p className="error-text">{state.error}</p>}
    </form>
  );
}
