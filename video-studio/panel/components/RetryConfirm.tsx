"use client";
// Подтверждение действия, у которого есть цена, — полоской внизу страницы, а не окном
// браузера: сначала сервер говорит, что будет («Повтор озвучит заново 2 ролика · Gemini
// сегодня 4/10», «10 тем — бесплатно (Gemini)»), потом — одна кнопка.
import { useState } from "react";
import { planExtendAction, planExtendPreviewAction, retryPreviewAction, retryRunAction, type ActionResult } from "@/app/actions";

type Preview = ActionResult & { confirmLabel?: string };

export function useConfirmBar(onResult: (r: ActionResult) => void) {
  const [ask, setAsk] = useState<{ text: string; label: string; run: () => Promise<ActionResult> } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => onResult({ ok: false, message: e instanceof Error ? e.message : String(e) });

  async function start(preview: () => Promise<Preview>, run: () => Promise<ActionResult>) {
    setBusy(true);
    try {
      const r = await preview();
      if (!r.ok) return onResult(r);
      setAsk({ text: r.message, label: r.confirmLabel ?? "Да", run });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!ask) return;
    setBusy(true);
    try {
      onResult(await ask.run());
      setAsk(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const bar = ask ? (
    <div className="pickbar" role="dialog" aria-label="Подтверждение">
      <span>{ask.text}</span>
      <button className="btn small primary" disabled={busy} onClick={() => void confirm()}>
        {busy ? "Запускаю…" : ask.label}
      </button>
      <button className="btn small" disabled={busy} onClick={() => setAsk(null)}>
        Отмена
      </button>
    </div>
  ) : null;

  return { start, bar, busy, open: ask !== null };
}

// «Повторить» упавший запуск: rerun-failed-jobs — та же ветка и те же настройки, попытка 2.
export function useRetry(onResult: (r: ActionResult) => void) {
  const c = useConfirmBar(onResult);
  return { ...c, start: (runId: number) => c.start(() => retryPreviewAction(runId), () => retryRunAction(runId)) };
}

// «Добавить 10 тем» в план (workflow «video-studio: план тем»).
export function usePlanExtend(onResult: (r: ActionResult) => void) {
  const c = useConfirmBar(onResult);
  return { ...c, start: (count = 10) => c.start(() => planExtendPreviewAction(count), () => planExtendAction(count)) };
}
