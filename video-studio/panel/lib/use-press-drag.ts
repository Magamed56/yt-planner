"use client";
// Перетаскивание на pointer-событиях — одно на календарь и «План»: мышью сразу, пальцем — после
// короткого удержания (обычный свайп остаётся прокруткой). HTML5 drag-and-drop на iPhone не
// работает. Цели — элементы с атрибутом data-drop="<ключ>"; под пальцем ищем elementFromPoint.
import { useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 320; // палец: «нажать и подержать», иначе это прокрутка
const MOVE_SLOP = 8; // px: сдвиг, после которого нажатие — уже не касание
const EDGE = 90; // px от края экрана — там страница прокручивается сама

type Drag = { id: string; pointerId: number; touch: boolean; x0: number; y0: number; x: number; y: number; active: boolean; timer: number | null };

export interface PressDrag {
  dragging: string | null; // что тащим
  over: string | null; // data-drop под курсором/пальцем
  ghostAt: { x: number; y: number }; // где был палец в момент начала (дальше «призрак» двигается сам)
  ghostRef: React.RefObject<HTMLDivElement | null>;
  start: (e: React.PointerEvent, id: string) => void; // в onPointerDown перетаскиваемого
  swallowClick: () => boolean; // true — это был конец перетаскивания, нажатие не обрабатывать
}

export function usePressDrag(onDrop: (id: string, target: string) => void): PressDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [ghostAt, setGhostAt] = useState({ x: -200, y: -200 });
  const drag = useRef<Drag | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const swallow = useRef(false);
  const frame = useRef<number | null>(null);
  const onDropRef = useRef(onDrop);
  const startRef = useRef<(e: React.PointerEvent, id: string) => void>(() => {});
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  // Слушатели на окне живут всё время, но работают, только пока идёт нажатие; touchmove — не
  // пассивный, чтобы во время перетаскивания страница не прокручивалась под пальцем.
  useEffect(() => {
    const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;
    const place = () => {
      const d = drag.current;
      if (ghostRef.current && d) ghostRef.current.style.transform = `translate(${d.x - 36}px, ${d.y - 52}px)`;
    };
    const scrollLoop = () => {
      const d = drag.current;
      frame.current = null;
      if (!d?.active) return;
      const bottom = window.innerHeight - (d.touch ? EDGE + 70 : EDGE); // внизу на телефоне — меню
      const dy = d.y < EDGE ? -Math.ceil((EDGE - d.y) / 6) : d.y > bottom ? Math.ceil((d.y - bottom) / 6) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        setOver(targetAt(d.x, d.y));
        frame.current = requestAnimationFrame(scrollLoop);
      }
    };
    const activate = () => {
      const d = drag.current;
      if (!d || d.active) return;
      d.active = true;
      setGhostAt({ x: d.x, y: d.y });
      setDragging(d.id);
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
      swallow.current = true;
      setTimeout(() => (swallow.current = false), 400);
      const target = drop ? targetAt(d.x, d.y) : null;
      setDragging(null);
      setOver(null);
      if (target) onDropRef.current(d.id, target);
    };
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.active) {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) <= MOVE_SLOP) return;
        // Палец сдвинулся до удержания — это прокрутка; мышь — начало перетаскивания.
        if (d.touch) return end(false);
        activate();
      }
      place();
      const t = targetAt(d.x, d.y);
      setOver((o) => (o === t ? o : t));
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
    startRef.current = (e, id) => {
      if (e.button !== 0 || drag.current) return;
      const touch = e.pointerType !== "mouse";
      const d: Drag = { id, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, timer: null };
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

  return {
    dragging,
    over,
    ghostAt,
    ghostRef,
    start: (e, id) => startRef.current(e, id),
    swallowClick: () => swallow.current,
  };
}
