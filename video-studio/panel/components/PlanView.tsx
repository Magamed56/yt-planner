"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePlanOrderAction } from "@/app/actions";
import { moveItem } from "@/lib/plan-order";
import type { PanelState } from "@/lib/state";
import AppShell from "./AppShell";

export interface PlanTopic {
  title: string;
  hook: string;
  pillar: string; // название рубрики
  pillarId: string;
}

export interface PlanPosition {
  id: string; // код позиции: «09a» — день и слот, не двигается
  when: string;
  exact: boolean;
  lock: string | null; // почему тема закреплена (null — двигается)
}

// Экран «План»: порядок будущих тем. Двигается содержимое тем между подвижными позициями;
// на компьютере — перетаскиванием, на телефоне — стрелками. Сохраняет savePlanOrderAction.
export default function PlanView({
  state,
  sha,
  positions,
  topics,
  movable,
}: {
  state: PanelState;
  sha: string;
  positions: PlanPosition[];
  topics: Record<string, PlanTopic>;
  movable: string[];
}) {
  const router = useRouter();
  // order[k] — чья тема стоит на k-й подвижной позиции.
  const [order, setOrder] = useState<string[]>(movable);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const index = new Map(movable.map((id, k) => [id, k]));
  const changed = order.some((id, k) => id !== movable[k]);
  // Кнопка «по рейтингу рубрик» (позже): setOrder(sortByPillars(order.map((id) => ({ id, pillar: topics[id]!.pillarId })), рейтинг)).

  const move = (from: number, to: number) => setOrder((o) => moveItem(o, from, to));

  async function save() {
    setBusy(true);
    try {
      const r = await savePlanOrderAction(order, sha);
      setToast({ text: r.message, ok: r.ok });
      if (r.ok) router.refresh();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      active="plan"
      updated={state.updatedLabel}
      activeRuns={state.runs.filter((r) => r.active).length}
      runwayDays={state.runwayDays}
      runwayLabel={state.scheduleEndLabel}
    >
      <main className="page plan-page">
        <section className="card">
          <h2>Порядок тем</h2>
          <p className="muted small">
            На компьютере перетащите тему, на телефоне — стрелки ▲▼. Код («09a») и день остаются на месте: к ним переезжает сама тема — название, хук, факты и
            рубрика. Темы со сценарием, видео или в работе закреплены 🔒 — их код уже в именах файлов.
          </p>
          <p className="small">
            Подвижных тем: {movable.length} из {positions.length}.
          </p>
          <div className="btn-row">
            <button className="btn primary" disabled={!changed || busy} onClick={save}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
            <button className="btn" disabled={!changed || busy} onClick={() => setOrder(movable)}>
              Сбросить
            </button>
          </div>
        </section>

        <ol className="plan-list">
          {positions.map((p) => {
            const k = index.get(p.id);
            const from = k === undefined ? p.id : order[k]!;
            const t = topics[from];
            const moved = from !== p.id;
            const free = k !== undefined;
            return (
              <li
                key={p.id}
                className={`plan-item${free ? "" : " locked"}${moved ? " moved" : ""}${free && over === k ? " over" : ""}${free && dragging === k ? " dragging" : ""}`}
                draggable={free && !busy}
                onDragStart={(e) => {
                  if (!free) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", from);
                  setDragging(k);
                }}
                onDragOver={(e) => {
                  if (!free || dragging === null) return;
                  e.preventDefault();
                  if (over !== k) setOver(k);
                }}
                onDragLeave={() => {
                  if (over === k) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (free && dragging !== null) move(dragging, k);
                  setDragging(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <span className="plan-code">{p.id}</span>
                <span className="plan-main">
                  <span className="plan-title">{t?.title ?? from}</span>
                  <span className="plan-sub">
                    {p.when}
                    {p.exact ? "" : " · ориентир"} · {t?.pillar}
                    {moved ? ` · тема с ${from}` : ""}
                    {p.lock ? ` · 🔒 ${p.lock}` : ""}
                  </span>
                </span>
                {free && (
                  <span className="plan-move">
                    <button className="btn small" aria-label={`${p.id}: выше`} disabled={busy || k === 0} onClick={() => move(k, k - 1)}>
                      ▲
                    </button>
                    <button className="btn small" aria-label={`${p.id}: ниже`} disabled={busy || k === order.length - 1} onClick={() => move(k, k + 1)}>
                      ▼
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </main>
      {toast && (
        <div className={`toast${toast.ok ? "" : " err"}`} role="status">
          <span>{toast.text}</span>
          <button className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
            ✕
          </button>
        </div>
      )}
    </AppShell>
  );
}
