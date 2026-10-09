"use client";
// «Повторить» упавший запуск: сначала — что это будет стоить (озвучки заново, сколько из
// лимита Gemini уже потрачено сегодня), подтверждение — полоской внизу страницы, а не окном
// браузера. Потом — rerun-failed-jobs: та же ветка и те же настройки, попытка 2.
import { useState } from "react";
import { retryPreviewAction, retryRunAction, type ActionResult, type RetryPreview } from "@/app/actions";

export function useRetry(onResult: (r: ActionResult) => void) {
  const [ask, setAsk] = useState<{ runId: number; text: string; attempt: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(runId: number) {
    setBusy(true);
    try {
      const r = await retryPreviewAction(runId);
      if (!r.ok || !("attempt" in r)) return onResult(r);
      setAsk({ runId, text: r.message, attempt: (r as RetryPreview).attempt });
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!ask) return;
    setBusy(true);
    try {
      onResult(await retryRunAction(ask.runId));
      setAsk(null);
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const bar = ask ? (
    <div className="pickbar" role="dialog" aria-label="Повторить запуск">
      <span>{ask.text}</span>
      <button className="btn small primary" disabled={busy} onClick={() => void confirm()}>
        {busy ? "Запускаю…" : `Повторить (попытка ${ask.attempt})`}
      </button>
      <button className="btn small" disabled={busy} onClick={() => setAsk(null)}>
        Отмена
      </button>
    </div>
  ) : null;

  return { start, bar, busy, open: ask !== null };
}
