"use client";
import { useEffect, useRef, useState } from "react";
import type { PanelState, Row } from "@/lib/state";
import { STAGE_LABEL, shiftDateKey } from "@/lib/stages";
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

// Куда можно бросить ролик: запланированный — в слот ближайших двух недель (занятый — обмен),
// ролик-ориентир — на место другого ориентира (обмен в очереди).
export function canDrop(dragged: Row, cell: BoardCell): boolean {
  if (cell.row?.code === dragged.code) return false;
  if (movable(dragged)) return Boolean(cell.iso) && (!cell.row || cell.row.stage !== "published");
  return Boolean(cell.row && queued(cell.row));
}

export interface BoardCell {
  key: string;
  time: string;
  row: Row | null;
  iso: string | null; // слот, на который можно перенести (ближайшие 14 дней), иначе null
}

const LONG_PRESS_MS = 320; // палец: «нажать и подержать», иначе это прокрутка
const MOVE_SLOP = 8; // px: сдвиг, после которого нажатие — уже не касание
const EDGE = 90; // px от края экрана — там доска прокручивается сама

type Drag = {
  code: string;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  active: boolean;
  timer: number | null;
};

// Доска недели. Перетаскивание — на pointer-событиях: мышью сразу, пальцем — после короткого
// удержания (обычный свайп остаётся прокруткой). HTML5 drag-and-drop на iPhone не работает.
// Нажатие без перетаскивания — как раньше (onTile): выбрать для переноса или открыть карточку.
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
  const [ghostAt, setGhostAt] = useState({ x: -200, y: -200 }); // где палец в момент начала
  const drag = useRef<Drag | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, BoardCell>());
  const swallowClick = useRef(false);
  const frame = useRef<number | null>(null);
  // Свежие обработчики без перевешивания слушателей окна.
  const onPlaceRef = useRef(onPlace);
  const startRef = useRef<(e: React.PointerEvent, code: string) => void>(() => {});
  useEffect(() => {
    onPlaceRef.current = onPlace;
  }, [onPlace]);

  const rowsByCode = new Map(state.rows.map((r) => [r.code, r]));
  const dragRow = dragging ? (rowsByCode.get(dragging) ?? null) : null;

  // Слушатели на окне живут, пока идёт нажатие; touchmove — не пассивный, чтобы во время
  // перетаскивания страница не прокручивалась под пальцем.
  useEffect(() => {
    const cellAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
      return el?.dataset.cell ?? null;
    };
    const place = () => {
      const d = drag.current;
      if (ghost.current && d) ghost.current.style.transform = `translate(${d.x - 36}px, ${d.y - 52}px)`;
    };
    const scrollLoop = () => {
      const d = drag.current;
      frame.current = null;
      if (!d?.active) return;
      const bottom = window.innerHeight - (d.touch ? EDGE + 70 : EDGE); // внизу на телефоне — меню
      const dy = d.y < EDGE ? -Math.ceil((EDGE - d.y) / 6) : d.y > bottom ? Math.ceil((d.y - bottom) / 6) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        setHover(cellAt(d.x, d.y));
        frame.current = requestAnimationFrame(scrollLoop);
      }
    };
    const activate = () => {
      const d = drag.current;
      if (!d || d.active) return;
      d.active = true;
      setGhostAt({ x: d.x, y: d.y });
      setDragging(d.code);
      navigator.vibrate?.(12);
      requestAnimationFrame(place);
    };
    const end = (drop: boolean) => {
      const d = drag.current;
      drag.current = null;
      if (d?.timer) clearTimeout(d.timer);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (!d?.active) return;
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 400);
      const key = drop ? cellAt(d.x, d.y) : null;
      setDragging(null);
      setHover(null);
      const cell = key ? cells.current.get(key) : undefined;
      if (cell) onPlaceRef.current(d.code, cell);
    };
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.active) {
        const far = Math.hypot(d.x - d.x0, d.y - d.y0) > MOVE_SLOP;
        if (!far) return;
        // Палец сдвинулся до удержания — это прокрутка; мышь — начало перетаскивания.
        if (d.touch) return end(false);
        activate();
      }
      place();
      const key = cellAt(d.x, d.y);
      setHover((h) => (h === key ? h : key));
      if (frame.current === null) frame.current = requestAnimationFrame(scrollLoop);
    };
    const onUp = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pointerId) end(true);
    };
    const onCancel = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pointerId) end(false);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (drag.current?.active) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end(false);
    };
    startRef.current = (e: React.PointerEvent, code: string) => {
      if (e.button !== 0 || drag.current) return;
      const touch = e.pointerType !== "mouse";
      const d: Drag = { code, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, timer: null };
      if (touch) d.timer = window.setTimeout(activate, LONG_PRESS_MS);
      drag.current = d;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      if (drag.current?.timer) clearTimeout(drag.current.timer);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

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
            // Прошлое — только то, что вышло (во сколько вышло), без пустых слотов.
            const times = [...new Set([...(past ? [] : state.slotTimes), ...rows.map((r) => r.timeLabel)])].sort();
            return (
              <div key={key} className={`bday${past ? " past" : ""}${key === state.todayKey ? " today" : ""}`}>
                <div className="bday-head">
                  <span>{WEEKDAYS[weekday(key)]}</span>
                  <span className="num">{Number(key.slice(8, 10))}</span>
                </div>
                <div className="bday-slots">
                  {times.map((t) => {
                    const g = grid.get(`${key} ${t}`);
                    const row = rows.find((r) => r.timeLabel === t) ?? null;
                    const cell: BoardCell = { key: `${key} ${t}`, time: t, row, iso: g?.iso ?? null };
                    cells.current.set(cell.key, cell);
                    const isTarget = Boolean(moving && canDrop(moving, cell));
                    const over = hover === cell.key && isTarget;
                    if (!row) {
                      // Свободный слот: при выборе нажатием — кнопка «сюда».
                      return isTarget && !dragging ? (
                        <button key={t} type="button" data-cell={cell.key} className="bslot free target" disabled={busy} onClick={() => moving && onPlace(moving.code, cell)}>
                          <span className="t">{t}</span>сюда
                        </button>
                      ) : (
                        <div key={t} data-cell={cell.key} className={`bslot free${isTarget ? " target" : ""}${over ? " over" : ""}`}>
                          <span className="t">{t}</span>
                          {g?.occupant === "другое видео" ? "другое видео" : past ? "" : isTarget ? "сюда" : "свободно"}
                        </div>
                      );
                    }
                    const canMove = draggable(row) && !busy;
                    return (
                      <div key={t} data-cell={cell.key} className={`bslot stage-${row.stage}${isTarget ? " target" : ""}${over ? " over" : ""}`}>
                        <span className="t">{t}</span>
                        <button
                          type="button"
                          className={`btile${picked === row.code ? " picked" : ""}${dragging === row.code ? " dragging" : ""}${canMove ? " can-drag" : ""}`}
                          disabled={busy}
                          onPointerDown={canMove ? (e) => startRef.current(e, row.code) : undefined}
                          onContextMenu={canMove ? (e) => e.preventDefault() : undefined}
                          onClick={() => {
                            if (swallowClick.current) return;
                            onTile(row, cell);
                          }}
                        >
                          <TileImg row={row} />
                          <span className="info">
                            <span className="code">{row.code}</span>
                            <span className="title">{row.title}</span>
                            {!movable(row) && <span className="mark">{row.whenExact ? STAGE_LABEL[row.stage] : `${STAGE_LABEL[row.stage]} · ориентир`}</span>}
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
        <div ref={ghost} className="drag-ghost" aria-hidden="true" style={{ transform: `translate(${ghostAt.x - 36}px, ${ghostAt.y - 52}px)` }}>
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
