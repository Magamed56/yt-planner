"use client";
import { useState } from "react";
import type { PanelState, Row } from "@/lib/state";
import { STAGE_LABEL } from "@/lib/stages";

// Подпись на обложке: этап и, если нужно, что сделать.
function chipText(r: Row): string {
  if (r.running) return `в работе: ${r.running}`;
  if (r.stage === "video") return "Видео — загрузить в Studio";
  if (r.stage === "studio") return "В Studio — нужно время";
  return STAGE_LABEL[r.stage];
}

function Cover({ row }: { row: Row }) {
  const [broken, setBroken] = useState(false);
  const views = row.stage === "published" && row.stats ? <span className="views-badge" title="просмотры">👁 {row.stats.viewsLabel}</span> : null;
  if (!row.cover || broken) {
    return (
      <span className="cover empty">
        {row.code}
        <small>{row.localVideo ? "файл на компьютере" : STAGE_LABEL[row.stage]}</small>
        <span className="time">{row.timeLabel}</span>
        {views}
      </span>
    );
  }
  return (
    <span className="cover">
      <img src={row.cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      <span className="time">{row.timeLabel}</span>
      {views}
      <span className="chip-stage">{chipText(row)}</span>
    </span>
  );
}

// Лента: день — две обложки (12:00 и 19:00), как ролики встанут на канале.
export default function FeedView({ state, rows, selected, onOpen }: { state: PanelState; rows: Row[]; selected: string | null; onOpen: (code: string) => void }) {
  const days: { key: string; label: string; approx: boolean; today: boolean; future: boolean; rows: Row[] }[] = [];
  for (const r of rows) {
    const key = r.dateKey ?? "none";
    let d = days.at(-1);
    if (!d || d.key !== key) {
      const prefix = key === state.todayKey ? "Сегодня · " : key === state.tomorrowKey ? "Завтра · " : "";
      d = { key, label: key === "none" ? "Без даты" : `${prefix}${r.dateLabel}`, approx: true, today: key === state.todayKey, future: key >= state.todayKey, rows: [] };
      days.push(d);
    }
    d.rows.push(r);
    if (r.whenExact) d.approx = false;
  }
  if (!days.length) return <p className="muted">Здесь пусто.</p>;

  return (
    <div className="feed">
      {days.map((d) => {
        const taken = new Set(d.rows.map((r) => r.timeLabel));
        const free = d.future && d.key !== "none" ? state.slotTimes.filter((t) => !taken.has(t)) : [];
        return (
          <section key={d.key} className={`feed-day${d.today ? " today" : ""}`}>
            <h2>
              <span className="dot" />
              {d.label}
              {d.approx && <span className="approx">ориентир</span>}
            </h2>
            <div className="feed-cards">
              {d.rows.map((r) => (
                <button key={r.code} className={`vcard stage-${r.stage}${r.code === selected ? " active" : ""}`} onClick={() => onOpen(r.code)}>
                  <Cover row={r} />
                  <span className="code">{r.code}</span>
                  <span className="title">{r.title}</span>
                  {r.flags[0] && <span className="hint">{r.flags[0]}</span>}
                </button>
              ))}
              {free.map((t) => (
                <div key={t} className="vcard free">
                  <span className="cover empty">
                    свободно
                    <small>{t}</small>
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
