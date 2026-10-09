"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fillNewUploadsAction, findNewUploadsAction, moveVideoAction, undoMoveAction } from "@/app/actions";
import type { PanelState, Reminder, Row } from "@/lib/state";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/stages";
import AppShell, { RunwayRing } from "./AppShell";
import BoardView, { movable, type BoardCell } from "./BoardView";
import FeedView from "./FeedView";
import VideoSheet from "./VideoSheet";

type Filter = "ahead" | "all" | Stage;
export type QueueMode = "feed" | "calendar";
type Undo = { videoId: string; publishAt: string }[];

const NOTICE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

function Notice({ m }: { m: Reminder }) {
  return (
    <div className={`notice ${m.level}`}>
      {NOTICE_ICON}
      <span>
        {m.text}{" "}
        {m.href && (
          <a href={m.href} target={m.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            открыть →
          </a>
        )}
      </span>
    </div>
  );
}

export default function QueueView({ state, initialMode }: { state: PanelState; initialMode: QueueMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<QueueMode>(initialMode);
  const [filter, setFilter] = useState<Filter>("ahead");
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: Undo } | null>(null);

  // Вид — в адресе (?view=calendar), без запроса к серверу: данные уже на странице.
  function switchMode(next: QueueMode) {
    setMode(next);
    setPicked(null);
    window.history.replaceState(null, "", next === "calendar" ? "?view=calendar" : "/");
  }

  // Одна кнопка: найти ролики, загруженные в Studio руками, и поставить им тексты и время.
  async function findNew() {
    setBusy(true);
    try {
      const r = await findNewUploadsAction();
      if (!("found" in r)) return setToast({ text: r.message, ok: false });
      const extra = [
        r.withoutTexts.length ? `Загружены, но текстов для них нет (собраны не через Actions): ${r.withoutTexts.join(", ")}.` : "",
        r.pending.length ? `YouTube ещё обрабатывает: ${r.pending.join(", ")} — нажмите ещё раз через пару минут.` : "",
        r.duplicates.length ? `Загружены дважды: ${r.duplicates.join(", ")} — удалите лишний в Studio.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (!r.found.length) {
        return setToast({ text: `Новых загрузок нет. ${extra || "Только что загруженное видео YouTube иногда показывает через пару минут."}`, ok: !extra });
      }
      const list = r.found.map((f) => `${f.code} «${f.title}» → ${f.whenLabel ?? "без времени"}`).join("\n");
      if (!window.confirm(`Нашёл новые загрузки:\n${list}\n\nПоставить им название, описание, теги и время выхода?${extra ? `\n\n${extra}` : ""}`)) return;
      const done = await fillNewUploadsAction(r.found.map((f) => f.code));
      setToast({ text: done.message, ok: done.ok });
      if (done.ok) router.refresh();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  // Перенос: на YouTube меняется только время выхода; занятый слот — обмен местами.
  async function place(code: string, cell: BoardCell) {
    const row = state.rows.find((r) => r.code === code);
    setPicked(null);
    if (!row || !movable(row) || !row.youtube) return;
    if (!cell.iso) return setToast({ text: "Сюда нельзя: слот уже прошёл или дальше двух недель — перенесите в Studio.", ok: false });
    setBusy(true);
    try {
      const r = await moveVideoAction(row.youtube.videoId, cell.iso);
      setToast({ text: r.message, ok: r.ok, undo: "undo" in r ? (r.undo as Undo | undefined) : undefined });
      if (r.ok) router.refresh();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function undo(u: Undo) {
    setBusy(true);
    try {
      const r = await undoMoveAction(u);
      setToast({ text: r.message, ok: r.ok });
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Нажали на ролик на доске: идёт перенос — ставим сюда; запланированный — выбираем для переноса;
  // остальные — открываем карточку.
  function onTile(row: Row, cell: BoardCell) {
    if (picked && picked !== row.code) return void place(picked, cell);
    if (picked === row.code) return setPicked(null);
    if (movable(row)) return setPicked(row.code);
    setSelected(row.code);
  }

  const rows = state.rows.filter((r) => filter === "all" || (filter === "ahead" ? r.stage !== "published" : r.stage === filter));
  const current = selected ? (state.rows.find((r) => r.code === selected) ?? null) : null;
  const pickedRow = picked ? (state.rows.find((r) => r.code === picked) ?? null) : null;
  const urgent = state.reminders.filter((m) => m.kind !== "runway" && m.level !== "info");
  const notes = state.reminders.filter((m) => m.kind !== "runway" && m.level === "info");
  const runway = state.reminders.find((m) => m.kind === "runway");

  return (
    <AppShell
      active={mode}
      onSection={(s) => (s === "runs" ? router.push("/runs") : switchMode(s))}
      updated={state.updatedLabel}
      activeRuns={state.runs.filter((r) => r.active).length}
      runwayDays={state.runwayDays}
      runwayLabel={state.scheduleEndLabel}
    >
      <div className={`workspace${current ? " with-sheet" : ""}`}>
        <main>
          <section className="hero">
            <RunwayRing days={state.runwayDays} size={76} />
            <div>
              <b>{state.scheduleEndLabel ? `Расписание до ${state.scheduleEndLabel}` : "Расписание пустое"}</b>
              <span className="small muted">
                {state.counts.scheduled} ждут выхода · {state.counts.video} загрузить в Studio
              </span>
            </div>
          </section>

          <div className="page-head">
            <h1>{mode === "calendar" ? "Календарь" : "Лента"}</h1>
            <div className="actions">
              <div className="switch desk-only" role="group" aria-label="Вид">
                <button className={mode === "feed" ? "active" : ""} onClick={() => switchMode("feed")}>
                  Лента
                </button>
                <button className={mode === "calendar" ? "active" : ""} onClick={() => switchMode("calendar")}>
                  Календарь
                </button>
              </div>
              <button className="btn primary find-btn" disabled={busy} onClick={findNew} title="Найти ролики, загруженные в Studio, и поставить им название, описание, теги и время выхода">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                {busy ? "Работаю…" : "Найти новые загрузки"}
              </button>
            </div>
          </div>

          <div className="notices">
            {runway && runway.level !== "info" && <Notice m={runway} />}
            {urgent.map((m, i) => (
              <Notice key={i} m={m} />
            ))}
            {notes.length > 0 && (
              <details className="notes">
                <summary>Ещё заметки: {notes.length}</summary>
                <div className="notices">
                  {notes.map((m, i) => (
                    <Notice key={i} m={m} />
                  ))}
                </div>
              </details>
            )}
          </div>

          {mode === "calendar" ? (
            <>
              <p className="board-hint">Перетащите обложку на другой слот или нажмите на ролик, потом на слот. Занятый слот — ролики поменяются местами.</p>
              <BoardView state={state} picked={picked} busy={busy} onTile={onTile} onPlace={(code, cell) => void place(code, cell)} />
            </>
          ) : (
            <>
              <div className="chips">
                <button className={`chip${filter === "ahead" ? " active" : ""}`} onClick={() => setFilter("ahead")}>
                  Впереди {state.rows.length - state.counts.published}
                </button>
                {STAGES.map((s) => (
                  <button key={s} className={`chip${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>
                    {STAGE_LABEL[s]} {state.counts[s]}
                  </button>
                ))}
                <button className={`chip${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
                  Все {state.rows.length}
                </button>
              </div>
              <FeedView state={state} rows={rows} selected={selected} onOpen={setSelected} />
            </>
          )}
        </main>
        {current && (
          <>
            <div className="backdrop" onClick={() => setSelected(null)} />
            <VideoSheet key={current.code} row={current} state={state} onClose={() => setSelected(null)} />
          </>
        )}
      </div>

      {pickedRow && (
        <div className="pickbar" role="status">
          <span>
            Куда перенести {pickedRow.code} ({pickedRow.dateLabel} {pickedRow.timeLabel})? Нажмите на слот.
          </span>
          <button className="btn small" onClick={() => setSelected(pickedRow.code)}>
            Подробнее
          </button>
          <button className="btn small" onClick={() => setPicked(null)}>
            Отмена
          </button>
        </div>
      )}
      {toast && !pickedRow && (
        <div className={`toast${toast.ok ? "" : " err"}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button className="btn small" disabled={busy} onClick={() => void undo(toast.undo!)}>
              Отменить
            </button>
          )}
          <button className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
            ✕
          </button>
        </div>
      )}
    </AppShell>
  );
}
