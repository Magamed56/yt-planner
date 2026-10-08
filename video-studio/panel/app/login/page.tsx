import LoginForm from "./LoginForm";

export const metadata = { title: "Вход — Суть за минуту" };

export default function LoginPage() {
  return (
    <main className="login">
      <h1>Суть за минуту</h1>
      <p className="muted">Панель роликов</p>
      <LoginForm />
    </main>
  );
}
