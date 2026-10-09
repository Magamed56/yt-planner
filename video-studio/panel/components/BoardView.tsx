"use client";
import { useState } from "react";
import type { PanelState, Row } from "@/lib/state";
import { STAGE_LABEL, shiftDateKey } from "@/lib/stages";

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const weekday = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

// Переносить можно только то, что уже стоит в расписании YouTube.
export const movable = (r: Row) => r.stage === "scheduled" && Boolean(r.youtube);

export interface BoardCell {
  key: string;
  time: string;
  row: Row | null;
  iso: string | null; // слот, на который можно перенести (ближайшие 14 дней), иначе null
}

function TileImg({ row }: { row: Row }) {
  const [broken, setBroken] = useState(false);
  if (!row.cover || broken) return <span className="ph">{row.code}</span>;
  return <img src={row.cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />;
}

// Доска недели: обложку перетаскивают на другой слот (компьютер) или нажимают ролик, потом слот
// (телефон). Занятый слот — ролики меняются местами (это делает moveVideoAction).
export default function BoardView({
  state,
  picked,
  busy,
  onTile,
  onPlace,
}: {
  state: PanelState;
  picked: string | null;
  busy: boolean;
  onTile: (row: Row, cell: BoardCell) => void;
  onPlace: (code: string, cell: BoardCell) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const dated = state.rows.filter((r) => r.dateKey);
  if (!dated.length) return <p className="muted">Нет роликов с датой выхода.</p>;
  const start = shiftDateKey(state.todayKey, -((weekday(state.todayKey) + 6) % 7));
  const last = dated.reduce((a, r) => (r.dateKey! > a ? r.dateKey! : a), state.todayKey);
  const end = shiftDateKey(last, (7 - weekday(last)) % 7);
  const byDay = new Map<string, Row[]>();
  for (const r of dated) byDay.set(r.dateKey!, [...(byDay.get(r.dateKey!) ?? []), r]);
  const grid = new Map(state.slotGrid.map((c) => [`${c.dateKey} ${c.time}`, c]));
  const weeks: string[][] = [];
  for (let k = start; k <= end; k = shiftDateKey(k, 1)) {
    if (!weeks.length || weeks.at(-1)!.length === 7) weeks.push([]);
    weeks.at(-1)!.push(k);
  }
  const moving = dragging ?? picked;

  return (
    <>
      {weeks.map((week) => (
        <div className="board-week" key={week[0]}>
          {week.map((key) => {
            const rows = byDay.get(key) ?? [];
            const past = key < state.todayKey;
            // Прошлое — только то, что вышло (во сколько вышло), без пустых слотов.
            const times = [...new Set([...(past ? [] : state.slotTimes), ...rows.map((r) => r.timeLabel)])].sort();
            return (
              <div key={key} className={`bday${past ? " past" : ""}${key === state.todayKey ? " today" : ""}`}>
                <div className="bday-head">
                  <span>{WEEKDAYS[weekday(key)]}</span>
                  <span className="num">{Number(key.slice(8, 10))}</span>
                </div>
                {times.map((t) => {
                  const g = grid.get(`${key} ${t}`);
                  const row = rows.find((r) => r.timeLabel === t) ?? null;
                  const cell: BoardCell = { key: `${key} ${t}`, time: t, row, iso: g?.iso ?? null };
                  const isTarget = Boolean(moving && cell.iso && row?.code !== moving);
                  const drop = cell.iso
                    ? {
                        onDragOver: (e: React.DragEvent) => {
                          if (dragging && row?.code !== dragging) {
                            e.preventDefault();
                            if (hover !== cell.key) setHover(cell.key);
                          }
                        },
                        onDragLeave: () => {
                          if (hover === cell.key) setHover(null);
                        },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault();
                          const code = e.dataTransfer.getData("text/plain") || dragging;
                          setDragging(null);
                          setHover(null);
                          if (code && code !== row?.code) onPlace(code, cell);
                        },
                      }
                    : {};
                  if (!row) {
                    return isTarget ? (
                      <button key={t} type="button" className="bslot free target" disabled={busy} onClick={() => moving && onPlace(moving, cell)} {...drop}>
                        <span className="t">{t}</span>сюда
                      </button>
                    ) : (
                      <div key={t} className={`bslot free${hover === cell.key ? " target" : ""}`} {...drop}>
                        <span className="t">{t}</span>
                        {g?.occupant === "другое видео" ? "другое видео" : past ? "" : "свободно"}
                      </div>
                    );
                  }
                  const canMove = movable(row);
                  return (
                    <div key={t} className={`bslot stage-${row.stage}${isTarget || hover === cell.key ? " target" : ""}`} {...drop}>
                      <span className="t">{t}</span>
                      <button
                        type="button"
                        className={`btile${picked === row.code ? " picked" : ""}${dragging === row.code ? " dragging" : ""}`}
                        disabled={busy}
                        draggable={canMove}
                        onDragStart={
                          canMove
                            ? (e) => {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", row.code);
                                setDragging(row.code);
                              }
                            : undefined
                        }
                        onDragEnd={() => {
                          setDragging(null);
                          setHover(null);
                        }}
                        onClick={() => onTile(row, cell)}
                      >
                        <TileImg row={row} />
                        <span className="info">
                          <span className="code">{row.code}</span>
                          <span className="title">{row.title}</span>
                          {!canMove && <span className="mark">{row.whenExact ? STAGE_LABEL[row.stage] : `${STAGE_LABEL[row.stage]} · ориентир`}</span>}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
