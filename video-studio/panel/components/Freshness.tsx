"use client";
// «обновлено 3 мин назад» — насколько свежие данные на экране. Сервер рисует время («14:05»),
// после загрузки в браузере — «только что / N мин назад» (до этого текст тот же, что с сервера:
// иначе React ругается на расхождение). Через 15 минут — жёлтым. Нажатие — обновить.
import { useEffect, useState } from "react";

const STALE_MS = 15 * 60_000;
const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto", style: "short" });

function ago(ms: number): string {
  if (ms < 60_000) return "только что";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return rtf.format(-min, "minute");
  const h = Math.floor(min / 60);
  return h < 24 ? rtf.format(-h, "hour") : rtf.format(-Math.floor(h / 24), "day");
}

export default function Freshness({ at, label, pending, loading, onRefresh, className = "" }: { at: string | null; label: string; pending: boolean; loading?: boolean; onRefresh: () => void; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  // Часы телефона могут отставать от сервера — отрицательный возраст считаем «только что».
  const age = now !== null && at ? Math.max(0, now - Date.parse(at)) : null;
  const text = loading ? "загружаю…" : pending ? "обновляю…" : age !== null ? `обновлено ${ago(age)}` : `обновлено ${label}`;
  const stale = !loading && !pending && age !== null && age > STALE_MS;
  return (
    <button type="button" className={`fresh${stale ? " stale" : ""} ${className}`} onClick={onRefresh} disabled={pending || loading} title={`Данные на ${label}. Нажмите, чтобы обновить`}>
      {text}
    </button>
  );
}
