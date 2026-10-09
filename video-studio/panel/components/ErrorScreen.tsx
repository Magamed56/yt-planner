"use client";
// Данные не загрузились — показываем причину и что проверить, а не пустую страницу.
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function ErrorScreen({ message, title = "Не получилось загрузить очередь" }: { message: string; title?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main className="page solo">
      <div className="card">
        <h2>{title}</h2>
        <p className="error-text">{message}</p>
        <p className="muted small">
          Проверьте переменные в Vercel (Settings → Environment Variables): GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, YT_CLIENT_ID, YT_CLIENT_SECRET,
          YT_REFRESH_TOKEN — и что PR с video-studio слит в ветку GITHUB_BRANCH. После правки переменных нужен новый деплой.
        </p>
        <div className="btn-row">
          {/* Ещё раз — эту же страницу, а не главную. */}
          <button className="btn" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
            {pending ? "Пробую…" : "Попробовать ещё раз"}
          </button>
          <a className="btn ghost" href="/login">
            Вход
          </a>
        </div>
      </div>
    </main>
  );
}
