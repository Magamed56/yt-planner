import LoginForm from "./LoginForm";

export const metadata = { title: "Вход — Суть за минуту" };

export default function LoginPage() {
  return (
    <main className="login">
      <h1 className="brand">
        <span className="tag">СУТЬ</span>ЗА МИНУТУ
      </h1>
      <p className="muted">Панель роликов: очередь, календарь, запуски</p>
      <LoginForm />
    </main>
  );
}
