// Данные не загрузились — показываем причину и что проверить, а не пустую страницу.
export default function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="page">
      <div className="card">
        <h2>Не получилось загрузить очередь</h2>
        <p className="error-text">{message}</p>
        <p className="muted small">
          Проверьте переменные в Vercel (Settings → Environment Variables): GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, YT_CLIENT_ID, YT_CLIENT_SECRET,
          YT_REFRESH_TOKEN — и что PR с video-studio слит в ветку GITHUB_BRANCH. После правки переменных нужен новый деплой.
        </p>
        <div className="btn-row">
          <a className="btn" href="/">
            Попробовать ещё раз
          </a>
          <a className="btn ghost" href="/login">
            Вход
          </a>
        </div>
      </div>
    </main>
  );
}
