import Link from "next/link";
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
      {/* Ссылки на политику и условия обязательны для клиентов YouTube API — видны до входа. */}
      <p className="muted small">
        <Link href="/privacy">Конфиденциальность</Link> · <Link href="/terms">Условия</Link> · использует YouTube API Services
      </p>
    </main>
  );
}
