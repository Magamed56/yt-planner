// Почему на «Статистике» нет удержания и что сделать — один раз, без поломки остальной страницы.
import type { AnalyticsProblem } from "@/lib/analytics";
import r from "./retention.module.css";

const CLOUD_LIBRARY = "https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com";

export default function RetentionCard({ problem }: { problem: AnalyticsProblem }) {
  if (problem.kind === "error") {
    // Точку в конце текста отказа (сообщения Google её ставят) не удваиваем.
    return (
      <p className="notice info wide">
        Удержание (% досмотра) сейчас недоступно: {problem.text.replace(/[.\s]+$/, "")}. Остальные цифры — как обычно; обновите страницу позже.
      </p>
    );
  }
  return (
    <section className={`card wide ${r.card}`} id="retention">
      <h2>Удержание (% досмотра)</h2>
      {problem.kind === "scope" ? (
        <>
          <p>Ключ YouTube выдан без права на YouTube Analytics — остальная статистика работает. Чтобы видеть % досмотра и средний просмотр, один раз:</p>
          <ol className="small">
            <li>
              На компьютере, в папке <code>video-studio</code>: <code>npm run youtube-auth -- --save</code> — войдите в аккаунт канала и оставьте отмеченными все
              галочки.
            </li>
            <li>
              Новый <code>YT_REFRESH_TOKEN</code> из <code>.env</code> — в Vercel (Settings → Environment Variables, затем Redeploy) и в GitHub (Settings → Secrets and
              variables → Actions).
            </li>
          </ol>
        </>
      ) : (
        <>
          <p>YouTube Analytics API не включён в проекте Google Cloud, где создан ключ YouTube. Ключ менять не нужно:</p>
          <ol className="small">
            <li>
              Откройте{" "}
              <a href={problem.activationUrl ?? CLOUD_LIBRARY} target="_blank" rel="noreferrer">
                YouTube Analytics API в Google Cloud ↗
              </a>{" "}
              (проект — тот же, где OAuth-клиент YouTube) → <b>Enable</b>.
            </li>
            <li>Через пару минут обновите эту страницу.</li>
          </ol>
        </>
      )}
    </section>
  );
}
