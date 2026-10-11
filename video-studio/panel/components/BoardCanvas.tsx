"use client";
// «Доска» (/board) — бесконечное полотно на своих pointer-событиях и CSS transform, без пакетов:
// палец или мышь — сдвиг, два пальца — щипок, колесо мыши и щипок тачпада — масштаб (два пальца
// по тачпаду — сдвиг). Касание карточки — её ролик в панели. Раскладку считает сервер
// (lib/board.ts → layoutBoard), здесь — только вид. Сдвиг и масштаб пишем прямо в
// style.transform, без перерисовки React: на телефоне так плавно. Вид помнит устройство.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { boardMarkAction, type ActionResult } from "@/app/actions";
import type { BoardPlan, BoardStatus, PlacedCard, ZoneKey } from "@/lib/board";
import AppShell from "./AppShell";
import s from "./board.module.css";

export interface BoardData {
  plan: BoardPlan;
  todayKey: string;
  shell: { updated: string; generatedAt: string; activeRuns: number; activeIds: number[]; runwayDays: number | null; runwayLabel: string | null };
}

const STATUS_LABEL: Record<BoardStatus, string> = {
  published: "вышел",
  scheduled: "запланирован",
  studio: "в Studio, без времени",
  ready: "готов, не загружен",
  script: "сценарий",
};
const LEGEND: BoardStatus[] = ["published", "scheduled", "ready", "script", "studio"];
const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MIN_K = 0.05;
const MAX_K = 2.5;
const MOVE_PX = 5; // меньше — касание, а не сдвиг
const VIEW_KEY = "board-view-v1";

type View = { x: number; y: number; k: number };
type Pt = { x: number; y: number };
type Gesture = { kind: "pan"; id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean; href: string | null } | { kind: "pinch"; d0: number; k0: number; wx: number; wy: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function dayText(key: string) {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return { wd: WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!, dm: `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}` };
}

function readView(): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "") as Partial<View>;
    if ([v.x, v.y, v.k].every((n) => typeof n === "number" && Number.isFinite(n)) && v.k! >= MIN_K && v.k! <= MAX_K) return v as View;
  } catch {
    // нет сохранённого вида или хранилище закрыто — начинаем с «Сегодня»
  }
  return null;
}

const hrefOf = (zone: ZoneKey, code: string) => (zone === "en" ? "/lang/en" : `/?v=${code}`);

export default function BoardCanvas({ data }: { data: BoardData }) {
  const { plan } = data;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [marks, setMarks] = useState<Record<string, boolean>>({}); // только что нажатые «загрузил»
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(data.shell.generatedAt);
  if (seen !== data.shell.generatedAt) {
    // Свежие данные с сервера — отметки в них уже есть.
    setSeen(data.shell.generatedAt);
    setMarks({});
  }

  const stageRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const raf = useRef(0);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;
  // Высота строки дня — из раскладки (значения lib/board.ts в браузер не берём: он серверный).
  const rowH = plan.days.length > 1 ? plan.days[1]!.y - plan.days[0]!.y : 106;
  const nowMs = Date.parse(data.shell.generatedAt);

  function show(text: string, ok: boolean) {
    setToast({ text, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ok ? 2500 : 6000);
  }

  // ---- вид: сдвиг и масштаб ----

  function apply() {
    const w = worldRef.current;
    const vp = vpRef.current;
    if (!w || !vp) return;
    const { x, y, k } = view.current;
    w.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    // Точки фона едут вместе с полотном — сдвиг виден и на пустом месте.
    vp.style.backgroundSize = `${24 * k}px ${24 * k}px`;
    vp.style.backgroundPosition = `${x}px ${y}px`;
  }
  function redraw() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      apply();
    });
  }
  function rememberView() {
    if (viewTimer.current) clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => {
      setZoom(Math.round(view.current.k * 100));
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(view.current));
      } catch {
        // хранилище недоступно — вид просто не запомнится
      }
    }, 300);
  }
  function zoomAt(px: number, py: number, k: number) {
    const v = view.current;
    const nk = clamp(k, MIN_K, MAX_K);
    v.x = px - ((px - v.x) * nk) / v.k;
    v.y = py - ((py - v.y) * nk) / v.k;
    v.k = nk;
    redraw();
    rememberView();
  }
  function local(clientX: number, clientY: number): Pt {
    const r = vpRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  const size = () => ({ w: vpRef.current?.clientWidth ?? 360, h: vpRef.current?.clientHeight ?? 500 });

  // «Сегодня»: все зоны по ширине (на телефоне — первая зона), сверху — вчерашний день.
  function goToday() {
    const { zones, todayY, width } = planRef.current;
    if (!zones.length) return;
    const { w } = size();
    let k = clamp((w - 24) / width, MIN_K, 1);
    if (k < 0.5) k = clamp((w - 24) / zones[0]!.w, MIN_K, 1);
    view.current = { k, x: 12, y: 12 - Math.max(0, todayY - rowH - 8) * k };
    redraw();
    rememberView();
  }
  // «Всё»: зоны целиком.
  function fitAll() {
    const { width, height } = planRef.current;
    const { w, h } = size();
    const k = clamp(Math.min((w - 24) / Math.max(1, width), (h - 24) / Math.max(1, height)), MIN_K, 1);
    view.current = { k, x: (w - width * k) / 2, y: 12 };
    redraw();
    rememberView();
  }
  // Нажали запас зоны в шапке страницы — показываем эту зону сверху.
  function goZone(key: ZoneKey) {
    const z = planRef.current.zones.find((x) => x.key === key);
    if (!z) return;
    const { w } = size();
    const k = clamp((w - 24) / z.w, MIN_K, 1);
    view.current = { k, x: (w - z.w * k) / 2 - z.x * k, y: 12 - z.y * k };
    redraw();
    rememberView();
  }

  // Высота полотна — до нижнего края экрана (на телефоне — до нижних вкладок); затем вид.
  useLayoutEffect(() => {
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const content = el.closest(".content");
      const bottom = content ? parseFloat(getComputedStyle(content).paddingBottom) || 0 : 0;
      el.style.height = `${Math.max(300, window.innerHeight - top - bottom)}px`;
    };
    fit();
    const saved = readView();
    if (saved) view.current = saved;
    else goToday();
    apply();
    setZoom(Math.round(view.current.k * 100));
    setReady(true);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // Один раз при открытии: дальше вид меняет только человек.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Колесо и тачпад — обработчик не пассивный, иначе вместе с полотном прокручивалась бы страница;
  // щипок тачпада в Safari на Mac — gesture-события (на iPhone щипок идёт pointer-событиями).
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      // Колесо мыши — щелчками по 120 (в Firefox — строками); тачпад — мелкими шагами.
      const mouse = e.deltaMode !== 0 || (e.deltaX === 0 && (legacy !== undefined ? legacy !== 0 && legacy % 120 === 0 : Math.abs(e.deltaY) >= 50));
      if (e.ctrlKey || e.metaKey || mouse) {
        const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
        zoomAt(p.x, p.y, view.current.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
      } else {
        view.current.x -= e.deltaX;
        view.current.y -= e.deltaY;
        redraw();
        rememberView();
      }
    };
    let gk = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gk = view.current.k;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.current.size >= 2) return; // iPhone: щипок уже ведут pointer-события
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const p = local(g.clientX, g.clientY);
      zoomAt(p.x, p.y, gk * g.scale);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("gesturestart", onGestureStart);
    vp.addEventListener("gesturechange", onGestureChange);
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("gesturestart", onGestureStart);
      vp.removeEventListener("gesturechange", onGestureChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- жесты ----

  function startPinch() {
    const [a, b] = [...pointers.current.values()] as [Pt, Pt];
    const v = view.current;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    gesture.current = { kind: "pinch", d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: v.k, wx: (mx - v.x) / v.k, wy: (my - v.y) / v.k };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest("[data-nodrag]")) return; // кнопка «загрузил» работает как обычно
    if (pointers.current.size >= 2) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // указатель уже отпущен — сдвиг просто закончится на краю
    }
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) return startPinch();
    const href = el.closest<HTMLElement>("[data-href]")?.dataset.href ?? null;
    gesture.current = { kind: "pan", id: e.pointerId, sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: false, href };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt | undefined];
      if (!b) return;
      const k = clamp((g.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, MIN_K, MAX_K);
      view.current = { k, x: (a.x + b.x) / 2 - g.wx * k, y: (a.y + b.y) / 2 - g.wy * k };
      redraw();
      return;
    }
    if (e.pointerId !== g.id) return;
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < MOVE_PX) return;
    g.moved = true;
    view.current.x = g.vx + dx;
    view.current.y = g.vy + dy;
    redraw();
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      rememberView();
      // Один палец остался — дальше сдвиг от него, без скачка.
      const rest = [...pointers.current.entries()][0];
      gesture.current = rest ? { kind: "pan", id: rest[0], sx: rest[1].x, sy: rest[1].y, vx: view.current.x, vy: view.current.y, moved: true, href: null } : null;
      return;
    }
    if (e.pointerId !== g.id) return;
    gesture.current = null;
    if (g.moved) rememberView();
    else if (g.href && e.type === "pointerup") router.push(g.href); // касание карточки — её ролик
  }

  // ---- «загрузил» (Instagram, TikTok) ----

  function statusOf(zone: ZoneKey, c: PlacedCard): BoardStatus {
    const on = marks[`${zone}:${c.code}`];
    if (on === undefined || c.marked === undefined || on === c.marked) return c.status;
    return on ? (Date.parse(c.at) <= nowMs ? "published" : "scheduled") : "ready";
  }
  async function mark(zone: ZoneKey, c: PlacedCard, on: boolean) {
    const key = `${zone}:${c.code}`;
    if (busy) return;
    setBusy(key);
    const r: ActionResult = await boardMarkAction(zone, c.code, on ? c.at : null).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy(null);
    show(r.message, r.ok);
    if (!r.ok) return;
    setMarks((m) => ({ ...m, [key]: on }));
    startTransition(() => router.refresh());
  }

  const today = dayText(data.todayKey);
  return (
    <AppShell
      active="board"
      updated={data.shell.updated}
      generatedAt={data.shell.generatedAt}
      activeRuns={data.shell.activeRuns}
      activeIds={data.shell.activeIds}
      runwayDays={data.shell.runwayDays}
      runwayLabel={data.shell.runwayLabel}
    >
      <main className={s.page}>
        <div className={s.head}>
          <h1 className={s.title}>Доска</h1>
          <div className={s.runways}>
            {plan.zones.map((z) => (
              <button key={z.key} type="button" className={`${s.runwayChip} ${z.runway.warn ? s.warn : ""}`} onClick={() => goZone(z.key)} title="Показать зону">
                <b>{z.title}</b> {z.runway.text}
              </button>
            ))}
          </div>
          <div className={s.legend}>
            {LEGEND.map((st) => (
              <span key={st} className={s.legendItem} data-status={st}>
                {STATUS_LABEL[st]}
              </span>
            ))}
          </div>
        </div>

        <div className={s.stage} ref={stageRef}>
          <div
            ref={vpRef}
            className={s.viewport}
            role="application"
            aria-label="Доска: тяните, чтобы сдвинуть; щипок или колесо — масштаб"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div ref={worldRef} className={s.world} style={{ visibility: ready ? "visible" : "hidden" }}>
              {plan.zones.map((z) => (
                <section key={z.key} className={s.zone} style={{ width: z.w, height: z.h, transform: `translate(${z.x}px, ${z.y}px)` }}>
                  <header className={s.zoneHead}>
                    <h2 className={s.zoneTitle}>
                      {z.title} <span className={s.zoneSub}>{z.sub}</span>
                    </h2>
                    <p className={`${s.runway} ${z.runway.warn ? s.warn : ""}`}>{z.runway.text}</p>
                  </header>
                  <div className={s.todayBand} style={{ top: plan.todayY - 5, height: rowH }} aria-hidden="true" />
                  {plan.days.map((d) => {
                    const t = dayText(d.key);
                    return (
                      <div key={d.key} className={`${s.dayLabel} ${d.key === data.todayKey ? s.today : ""}`} style={{ top: d.y }}>
                        {d.key === data.todayKey ? "сегодня" : t.wd}
                        <b>{t.dm}</b>
                      </div>
                    );
                  })}
                  {z.cards.map((c) => {
                    const key = `${z.key}:${c.code}`;
                    const status = statusOf(z.key, c);
                    const on = marks[key] ?? c.marked;
                    const href = hrefOf(z.key, c.code);
                    return (
                      <article
                        key={c.code}
                        className={s.card}
                        data-status={status}
                        data-href={href}
                        style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") router.push(href);
                        }}
                      >
                        <div className={s.cardTop}>
                          <span className={s.code}>{c.code}</span>
                          <span className={s.when} title={c.exact ? undefined : "ориентир: время ещё не стоит"}>
                            {c.dateLabel} {c.exact ? "" : "≈"}
                            {c.time}
                          </span>
                          {c.long && <span className={s.longTag}>Разбор</span>}
                        </div>
                        <div className={s.cardTitle}>{c.title || "—"}</div>
                        <div className={s.cardFoot}>
                          <span className={s.status}>{STATUS_LABEL[status]}</span>
                          {on !== undefined && (
                            <button
                              type="button"
                              data-nodrag=""
                              className={on ? s.unmark : s.markBtn}
                              disabled={busy === key}
                              title={on ? "Снять отметку «загрузил»" : "Выложил (или поставил в расписание) на это время"}
                              onClick={() => void mark(z.key, c, !on)}
                            >
                              {busy === key ? "…" : on ? "снять" : "загрузил"}
                            </button>
                          )}
                        </div>
                        {c.note && <div className={s.cardNote}>{c.note}</div>}
                      </article>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>

          <div className={s.toolbar}>
            <button type="button" className={s.tool} onClick={() => zoomAt(size().w / 2, size().h / 2, view.current.k / 1.25)} aria-label="Мельче">
              −
            </button>
            <span className={s.zoom}>{zoom}%</span>
            <button type="button" className={s.tool} onClick={() => zoomAt(size().w / 2, size().h / 2, view.current.k * 1.25)} aria-label="Крупнее">
              +
            </button>
            <button type="button" className={s.tool} onClick={goToday} title={`${today.wd} ${today.dm}`}>
              Сегодня
            </button>
            <button type="button" className={s.tool} onClick={fitAll}>
              Всё
            </button>
          </div>
          {toast && (
            <div className={`${s.toast} ${toast.ok ? "" : s.warn}`} role="status">
              {toast.text}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
