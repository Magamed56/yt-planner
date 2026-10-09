"use client";
import type { PanelState, Row } from "@/lib/state";
import { STAGE_LABEL, shiftDateKey } from "@/lib/stages";
import Thumb from "./Thumb";

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const weekday = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const dayLabel = (key: string) => `${WEEKDAYS[weekday(key)]} ${key.slice(8, 10)}.${key.slice(5, 7)}`;

// Календарь выхода: с понедельника этой недели до последнего ролика плана, в каждом дне — слоты
// канала (12:00, 19:00). Пустой будущий слот виден сразу — «свободно».
export default function CalendarView({ state, selected, onOpen }: { state: PanelState; selected: string | null; onOpen: (code: string) => void }) {
  const dated = state.rows.filter((r) => r.dateKey);
  if (!dated.length) return <p className="muted">Нет роликов с датой выхода.</p>;
  const start = shiftDateKey(state.todayKey, -((weekday(state.todayKey) + 6) % 7));
  const last = dated.reduce((a, r) => (r.dateKey! > a ? r.dateKey! : a), state.todayKey);
  const end = shiftDateKey(last, (7 - weekday(last)) % 7);
  const byDay = new Map<string, Row[]>();
  for (const r of dated) byDay.set(r.dateKey!, [...(byDay.get(r.dateKey!) ?? []), r]);
  const otherVideo = new Set(state.slotGrid.filter((c) => c.occupant === "другое видео").map((c) => `${c.dateKey} ${c.time}`));
  const days: string[] = [];
  for (let k = start; k <= end; k = shiftDateKey(k, 1)) days.push(k);

  return (
    <div className="calendar">
      {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => (
        <div key={d} className="cal-head">
          {d}
        </div>
      ))}
      {days.map((key) => {
        const rows = byDay.get(key) ?? [];
        const times = [...new Set([...state.slotTimes, ...rows.map((r) => r.timeLabel)])].sort();
        const past = key < state.todayKey;
        return (
          <section key={key} className={`cal-day${past ? " past" : ""}${key === state.todayKey ? " today" : ""}`}>
            <h3>
              {dayLabel(key)}
              {key === state.todayKey ? " · сегодня" : ""}
            </h3>
            {times.map((t) => {
              const here = rows.filter((r) => r.timeLabel === t);
              if (!here.length) {
                return (
                  <div key={t} className={`cal-slot empty${past ? " gone" : ""}`}>
                    <span className="time">{t}</span> {otherVideo.has(`${key} ${t}`) ? "другое видео" : past ? "" : "свободно"}
                  </div>
                );
              }
              return here.map((r) => (
                <button key={r.code} className={`cal-slot stage-${r.stage}${r.code === selected ? " active" : ""}`} onClick={() => onOpen(r.code)}>
                  <Thumb src={r.cover} code={r.code} />
                  <span className="cal-text">
                    <span className="time">
                      {t} · <b>{r.code}</b>
                    </span>
                    <span className="cal-title">{r.title}</span>
                    <span className="badge">
                      {STAGE_LABEL[r.stage]}
                      {r.whenExact ? "" : " · ориентир"}
                    </span>
                  </span>
                </button>
              ));
            })}
          </section>
        );
      })}
    </div>
  );
}
