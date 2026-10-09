"use client";
// Полоска идущего запуска: этапы, доля готовности, сколько прошло и сколько осталось. Тикает
// каждую секунду сама (без запросов к серверу); этапы обновляет автообновление страницы.
import { useEffect, useState } from "react";
import { minutesLabel, progressAt, type RunProgress } from "@/lib/progress";

export default function RunProgressBar({ progress, compact = false }: { progress: RunProgress; compact?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // До первого тика (и на сервере) — без цифр времени: разметка сервера и браузера совпадает.
  const at = now === null ? null : progressAt(progress, now);
  const late = at !== null && at.leftMs === 0;
  // В карточке ленты (она — кнопка) — только строчные элементы: полоска и «≈ N мин».
  if (compact) {
    return (
      <span className="run-progress compact">
        <span className="run-progress-track">
          <span style={{ width: `${at?.percent ?? 0}%` }} />
        </span>
        <span className="small muted">{at ? (late ? `${progress.stage} · почти готово` : `${progress.stage} · ≈ ${minutesLabel(at.leftMs)}`) : progress.stage}</span>
      </span>
    );
  }
  return (
    <div className="run-progress">
      <div className="run-progress-top small">
        <b>{progress.stage}</b>
        {at && (
          <span className="muted">
            {at.percent}% · прошло {minutesLabel(at.elapsedMs)} · {late ? "почти готово, дольше обычного" : `осталось ≈ ${minutesLabel(at.leftMs)}`}
          </span>
        )}
      </div>
      <div className="run-progress-track" role="progressbar" aria-label={`Готово ${at?.percent ?? 0}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={at?.percent ?? 0}>
        <span style={{ width: `${at?.percent ?? 0}%` }} />
      </div>
      <ol className="run-stages">
        {progress.stages.map((s) => (
          <li key={s.label} className={s.state}>
            {s.state === "done" ? "✓ " : s.state === "failed" ? "✕ " : ""}
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
