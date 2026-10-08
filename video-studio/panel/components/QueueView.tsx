"use client";
import { useState } from "react";
import type { PanelState, Row } from "@/lib/state";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/stages";
import Dots from "./Dots";
import TopBar from "./TopBar";
import VideoSheet from "./VideoSheet";

type Filter = "ahead" | "all" | Stage;

// Подсказка под строкой: что сейчас происходит или что сделать.
function rowNote(r: Row): { text: string; warn: boolean } | null {
  if (r.running) return { text: `⚙ ${r.running}`, warn: false };
  if (r.flags.length) return { text: `⚠ ${r.flags[0]}`, warn: true };
  if (r.stage === "video") return { text: r.localVideo ? "файл на компьютере → загрузить в Studio" : "видео готово → скачать и загрузить в Studio", warn: false };
  if (r.stage === "studio") return { text: "в Studio без времени → «Запуски» → «Проверить»", warn: true };
  return null;
}

export default function QueueView({ state }: { state: PanelState }) {
  const [filter, setFilter] = useState<Filter>("ahead");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = state.rows.filter((r) => filter === "all" || (filter === "ahead" ? r.stage !== "published" : r.stage === filter));
  const groups: { key: string; label: string; approx: boolean; rows: Row[] }[] = [];
  for (const r of rows) {
    const key = r.dateKey ?? "none";
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      const day = key === state.todayKey ? "Сегодня, " : key === state.tomorrowKey ? "Завтра, " : "";
      g = { key, label: key === "none" ? "Без даты" : `${day}${r.dateLabel}`, approx: true, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
    if (r.whenExact) g.approx = false;
  }
  const current = selected ? (state.rows.find((r) => r.code === selected) ?? null) : null;
  const ahead = state.rows.length - state.counts.published;
  // Сверху — запас расписания одной строкой и то, что требует действий; остальное свёрнуто,
  // чтобы на телефоне очередь начиналась на первом экране.
  const runway = state.reminders.find((m) => m.kind === "runway");
  const urgent = state.reminders.filter((m) => m.kind !== "runway" && m.level !== "info");
  const notes = state.reminders.filter((m) => m.kind !== "runway" && m.level === "info");
  const reminder = (m: (typeof state.reminders)[number], i: number) => (
    <div key={i} className={`reminder ${m.level}`}>
      {m.text}{" "}
      {m.href && (
        <a href={m.href} target={m.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          открыть →
        </a>
      )}
    </div>
  );

  return (
    <>
      <TopBar channel={state.channelName} updated={state.updatedLabel} activeRuns={state.runs.filter((r) => r.active).length} />
      <div className={`layout${current ? " with-sheet" : ""}`}>
        <main>
          <div className="reminders">
            {runway && <p className={`runway ${runway.level}`}>{runway.text}</p>}
            {urgent.map(reminder)}
            {notes.length > 0 && (
              <details className="notes">
                <summary>Ещё заметки: {notes.length}</summary>
                <div className="reminders">{notes.map(reminder)}</div>
              </details>
            )}
          </div>
          <div className="chips">
            <button className={`chip${filter === "ahead" ? " active" : ""}`} onClick={() => setFilter("ahead")}>
              Впереди {ahead}
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
          {groups.length === 0 && <p className="muted">Здесь пусто.</p>}
          {groups.map((g) => (
            <section className="day" key={g.key}>
              <h2>
                {g.label}
                {g.approx && <span className="tag">ориентир</span>}
              </h2>
              {g.rows.map((r) => {
                const note = rowNote(r);
                return (
                  <button key={r.code} className={`row stage-${r.stage}${r.code === selected ? " active" : ""}`} onClick={() => setSelected(r.code)}>
                    <span className="code">{r.code}</span>
                    <span className="time">{r.timeLabel}</span>
                    <span className="title">{r.title}</span>
                    <span className="badge">{STAGE_LABEL[r.stage]}</span>
                    <span className={`note${note?.warn ? " warn" : ""}`}>
                      <Dots stage={r.stage} /> {note?.text}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </main>
        {current && (
          <>
            <div className="backdrop" onClick={() => setSelected(null)} />
            <VideoSheet key={current.code} row={current} state={state} onClose={() => setSelected(null)} />
          </>
        )}
      </div>
    </>
  );
}
