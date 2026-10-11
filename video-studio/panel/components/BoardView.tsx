"use client";
import { useRef } from "react";
import { holdLabel } from "@/lib/rebuild-hold";
import type { PanelState, Row } from "@/lib/state";
import { RATIO_CLASS, STAGE_LABEL, shiftDateKey } from "@/lib/stages";
import { usePressDrag } from "@/lib/use-press-drag";
import CoverMedia, { frameOf } from "./CoverMedia";

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const weekday = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

// Переносить на YouTube можно только то, что уже стоит в его расписании.
export const movable = (r: Row) => r.stage === "scheduled" && Boolean(r.youtube);
// Ролик без точного времени (ещё не в расписании YouTube): его место — очередь выхода панели.
export const queued = (r: Row) => !r.whenExact && r.when !== null && r.stage !== "published";
export const draggable = (r: Row) => movable(r) || queued(r);

// Куда можно бросить ролик: запланированный — в слот ближайших 60 дней (занятый — обмен),
// ролик-ориентир — на место другого ориентира (обмен в очереди). «Разбор» — только в слоты и на
// места «Разборов» (вт/чт/сб 21:00), Shorts — только в свои: потоки не смешиваются.
export function canDrop(dragged: Row, cell: BoardCell): boolean {
  if (cell.row?.code === dragged.code) return false;
  const sameKind = cell.row ? Boolean(cell.row.long) === Boolean(dragged.long) : Boolean(cell.long) === Boolean(dragged.long);
  if (!sameKind) return false;
  if (movable(dragged)) return Boolean(cell.iso) && (!cell.row || cell.row.stage !== "published");
  return Boolean(cell.row && queued(cell.row));
}

export interface BoardCell {
  key: string;
  time: string;
  row: Row | null;
  iso: string | null; // слот, на который можно перенести (ближайшие 60 дней), иначе null
  long?: boolean; // слот «Разборов» (вт/чт/сб 21:00)
}

// Доска недели. Перетаскивание — общий хук usePressDrag: мышью сразу, пальцем — после короткого
// удержания. Нажатие без перетаскивания — как раньше (onTile): выбрать для переноса или открыть карточку.
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
  const cells = useRef(new Map<string, BoardCell>());
  const drag = usePressDrag((code, key) => {
    const cell = cells.current.get(key);
    if (cell) onPlace(code, cell);
  });
  const { dragging, over: hover } = drag;
  const rowsByCode = new Map(state.rows.map((r) => [r.code, r]));
  const dragRow = dragging ? (rowsByCode.get(dragging) ?? null) : null;

  const dated = state.rows.filter((r) => r.dateKey);
  if (!dated.length) return <p className="muted">Нет роликов с датой выхода.</p>;
  const start = shiftDateKey(state.todayKey, -((weekday(state.todayKey) + 6) % 7));
  const last = dated.reduce((a, r) => (r.dateKey! > a ? r.dateKey! : a), state.todayKey);
  const end = shiftDateKey(last, (7 - weekday(last)) % 7);
  const byDay = new Map<string, Row[]>();
  for (const r of dated) byDay.set(r.dateKey!, [...(byDay.get(r.dateKey!) ?? []), r]);
  const grid = new Map(state.slotGrid.map((c) => [`${c.dateKey} ${c.time}`, c]));
  // Слоты «Разборов» — строка 21:00 во вт/чт/сб (дни и время — channel.json → longSlots).
  const longGrid = new Map((state.longSlotGrid ?? []).map((c) => [`${c.dateKey} ${c.time}`, c]));
  // Пустые 21:00 — только когда «Разборы» уже в плане, иначе это шум.
  const longDays = new Set(state.rows.some((r) => r.long) ? (state.longWeekdays ?? []) : []);
  const weeks: string[][] = [];
  for (let k = start; k <= end; k = shiftDateKey(k, 1)) {
    if (!weeks.length || weeks.at(-1)!.length === 7) weeks.push([]);
    weeks.at(-1)!.push(k);
  }
  const pickedRow = picked ? (rowsByCode.get(picked) ?? null) : null;
  const moving = dragRow ?? pickedRow;
  cells.current.clear();

  return (
    <>
      {weeks.map((week) => (
        <div className={`board-week${dragging ? " is-dragging" : ""}`} key={week[0]}>
          {week.map((key) => {
            const rows = byDay.get(key) ?? [];
            const past = key < state.todayKey;
            // Прошлое — только то, что вышло (во сколько вышло), без пустых слотов; сегодня —
            // без уже прошедших.
            const open = past ? [] : state.slotTimes.filter((t) => key !== state.todayKey || grid.has(`${key} ${t}`));
            const openLong = past || !longDays.has(weekday(key)) ? [] : (state.longSlotTimes ?? []).filter((t) => key !== state.todayKey || longGrid.has(`${key} ${t}`));
            const times = [...new Set([...open, ...openLong, ...rows.map((r) => r.timeLabel)])].sort();
            return (
              <div key={key} className={`bday${past ? " past" : ""}${key === state.todayKey ? " today" : ""}`}>
                <div className="bday-head">
                  <span>{WEEKDAYS[weekday(key)]}</span>
                  <span className="num">{Number(key.slice(8, 10))}</span>
                </div>
                <div className="bday-slots">
                  {times.map((t) => {
                    const lg = longGrid.get(`${key} ${t}`);
                    const g = grid.get(`${key} ${t}`) ?? lg;
                    const row = rows.find((r) => r.timeLabel === t) ?? null;
                    const isLongSlot = row ? Boolean(row.long) : Boolean(lg) || (openLong.includes(t) && !open.includes(t));
                    const cell: BoardCell = { key: `${key} ${t}`, time: t, row, iso: g?.iso ?? null, long: isLongSlot };
                    cells.current.set(cell.key, cell);
                    const isTarget = Boolean(moving && canDrop(moving, cell));
                    const over = hover === cell.key && isTarget;
                    if (!row) {
                      // Свободный слот: при выборе нажатием — кнопка «сюда».
                      return isTarget && !dragging ? (
                        <button key={t} type="button" data-drop={cell.key} className="bslot free target" disabled={busy} onClick={() => moving && onPlace(moving.code, cell)}>
                          <span className="t">{t}</span>сюда
                        </button>
                      ) : (
                        <div key={t} data-drop={cell.key} className={`bslot free${isTarget ? " target" : ""}${over ? " over" : ""}`}>
                          <span className="t">{t}</span>
                          {g?.occupant === "другое видео" ? "другое видео" : past ? "" : isTarget ? "сюда" : isLongSlot ? "«Разбор»: свободно" : "свободно"}
                        </div>
                      );
                    }
                    const canMove = draggable(row) && !busy;
                    // Ждущий пересборки — так и подписан (без «ориентира»: на телефоне не влезет), «Видео»
                    // звало бы загрузить старую версию.
                    const stageText = row.hold ? holdLabel(row.hold) : STAGE_LABEL[row.stage];
                    return (
                      <div key={t} data-drop={cell.key} className={`bslot stage-${row.stage}${row.hold ? ` hold${row.hold.rebuilding ? " rebuilding" : ""}` : ""}${isTarget ? " target" : ""}${over ? " over" : ""}`}>
                        <span className="t">{t}</span>
                        <button
                          type="button"
                          className={`btile${row.long ? " long" : ""}${picked === row.code ? " picked" : ""}${dragging === row.code ? " dragging" : ""}${canMove ? " can-drag" : ""}`}
                          disabled={busy}
                          onPointerDown={canMove ? (e) => drag.start(e, row.code) : undefined}
                          onContextMenu={canMove ? (e) => e.preventDefault() : undefined}
                          onClick={() => {
                            if (drag.swallowClick()) return;
                            onTile(row, cell);
                          }}
                        >
                          <TileImg row={row} />
                          <span className="info">
                            <span className="code">{row.code}</span>
                            {row.long && <span className="long-badge">Разбор</span>}
                            <span className="title">{row.title}</span>
                            {!movable(row) && <span className="mark">{row.whenExact || row.hold ? stageText : `${stageText} · ориентир`}</span>}
                            {row.stage === "published" && row.stats?.ratioLabel && (
                              <span className={`ratio ${RATIO_CLASS[row.stats.verdict ?? "typical"]}`} title={row.stats.basis}>
                                {row.stats.ratioLabel}
                              </span>
                            )}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {dragRow && (
        <div ref={drag.ghostRef} className="drag-ghost" aria-hidden="true" style={{ transform: `translate(${drag.ghostAt.x - 36}px, ${drag.ghostAt.y - 52}px)` }}>
          <TileImg row={dragRow} />
          <span>{dragRow.code}</span>
        </div>
      )}
    </>
  );
}

function TileImg({ row }: { row: Row }) {
  return <CoverMedia src={row.cover} video={frameOf(row)} fallback={<span className="ph">{row.code}</span>} />;
}
