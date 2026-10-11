"use client";
// «Доска» (/board) — бесконечное полотно на своих pointer-событиях и CSS transform, без пакетов:
// палец или мышь — сдвиг, два пальца — щипок, колесо мыши и щипок тачпада — масштаб (два пальца
// по тачпаду — сдвиг). Касание карточки — её лист прямо на доске (BoardSheet), адрес — ?v=зона:код.
// Раскладку считает сервер (lib/board.ts → layoutBoard), здесь — только вид. Сдвиг и масштаб пишем
// прямо в style.transform, без перерисовки React: на телефоне так плавно; липкие названия зон и
// колонка дат поверх полотна берут сдвиг из переменных --vx, --vy, --k.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { boardMarkAction, type ActionResult } from "@/app/actions";
import type { BoardData, BoardStatus, PlacedCard, PlacedZone, Social, ZoneKey } from "@/lib/board";
import {
  cardVisible,
  clampK,
  FLY_MS,
  lerpView,
  markTime,
  MOVE_PX,
  parseSelected,
  READABLE_K,
  restoreView,
  STATUS_LABEL,
  storeView,
  VIEW_KEY,
  wheelAction,
  type BoardFilters,
  type MarkState,
  type View,
} from "@/lib/board-view";
import { shiftDateKey } from "@/lib/stages";
import AppShell from "./AppShell";
import { ZoneIcon } from "./BoardIcons";
import BoardSheet from "./BoardSheet";
import s from "./board.module.css";

const LEGEND: BoardStatus[] = ["published", "scheduled", "ready", "script", "studio"];
const SHORT: Record<ZoneKey, string> = { ru: "RU", en: "EN", instagram: "IG", tiktok: "TT" };
const ZONES: ZoneKey[] = ["ru", "en", "instagram", "tiktok"];
const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTH = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const SHEET_W = 380; // лист ролика справа на компьютере
const REFRESH_MS = 2500; // после последнего «загрузил» — одно обновление данных

type Pt = { x: number; y: number };
type Gesture =
  | { kind: "pan"; id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean; slop: number; tap: string | null }
  | { kind: "pinch"; d0: number; k0: number; wx: number; wy: number };
type Toast = { text: string; ok: boolean; undo?: () => void };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const keyOf = (zone: ZoneKey, code: string) => `${zone}:${code}`;

export function dayText(key: string) {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return { wd: WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!, dm: `${d} ${MONTH[m - 1]}`, monday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1 };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const desktopQuery = "(min-width: 1000px)";
function subscribeDesktop(cb: () => void) {
  const m = window.matchMedia(desktopQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
export const useDesktop = () =>
  useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  );

// Миниатюра 9:16: обложка с YouTube или из релиза; не загрузилась (ссылка устарела, GitHub не
// ответил) — плитка с кодом, а не значок битой картинки.
function CardThumb({ src, code }: { src: string | null; code: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={s.thumb}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- обложки с YouTube и из релиза, без оптимизатора Vercel
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{code}</span>
      )}
    </div>
  );
}

// Лист открыли мы (pushState) — «Назад» его закроет. Пришли по ссылке — заменяем адрес.
const ourSheet = () => typeof window !== "undefined" && typeof (window.history.state as { boardSheet?: unknown } | null)?.boardSheet === "string";
const sheetUrl = (key: string | null) => (key ? `${window.location.pathname}?v=${encodeURIComponent(key)}` : window.location.pathname);

export default function BoardCanvas({ data, initialSelected = null }: { data: BoardData; initialSelected?: string | null }) {
  const { plan } = data;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const desktop = useDesktop();
  const findCard = (zone: string, code: string) => plan.zones.find((z) => z.key === zone)?.cards.find((c) => c.code === code) ?? null;
  const initial = (() => {
    const p = parseSelected(initialSelected, ZONES);
    return p && findCard(p.zone, p.code) ? keyOf(p.zone as ZoneKey, p.code) : null;
  })();
  const [selected, setSelected] = useState<string | null>(initial);
  const [marks, setMarks] = useState<Record<string, MarkState>>({}); // только что нажатые отметки
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [choose, setChoose] = useState<{ zone: Social; card: PlacedCard } | null>(null);
  const [filters, setFilters] = useState<BoardFilters>({ notUploaded: false, week: false });
  const [legend, setLegend] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(data.shell.generatedAt);
  const wantRefresh = useRef(false);
  if (seen !== data.shell.generatedAt) {
    // Свежие данные с сервера — отметки в них уже есть.
    setSeen(data.shell.generatedAt);
    setMarks({});
  }
  useEffect(() => {
    wantRefresh.current = false;
  }, [data.shell.generatedAt]);

  const headRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const raf = useRef(0);
  const flyRaf = useRef(0);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const timers = useRef<{ view?: ReturnType<typeof setTimeout>; will?: ReturnType<typeof setTimeout>; refresh?: ReturnType<typeof setTimeout>; toast?: ReturnType<typeof setTimeout> }>({});
  const planRef = useRef(plan);
  planRef.current = plan;
  const sheetOpen = useRef(false);
  sheetOpen.current = selected !== null;
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  const nowMs = Date.parse(data.nowIso);
  const weekEnd = shiftDateKey(data.todayKey, 6);
  const rowH = plan.days.find((d) => d.key === data.todayKey)?.h ?? plan.card.h + 10;

  function showToast(text: string, ok: boolean, undo?: () => void) {
    setToast({ text, ok, undo });
    if (timers.current.toast) clearTimeout(timers.current.toast);
    timers.current.toast = setTimeout(() => setToast(null), undo ? 5000 : ok ? 2500 : 6000);
  }

  // ---- вид: сдвиг и масштаб ----

  // Отступы полотна под липкими слоями: сверху — названия зон, слева — колонка дат.
  function insets() {
    const st = stageRef.current;
    const css = st ? getComputedStyle(st) : null;
    const num = (name: string, fallback: number) => (css ? parseFloat(css.getPropertyValue(name)) || fallback : fallback);
    return { left: num("--datecol", 56) + 8, top: num("--titles", 40) + 8, bottom: num("--dock", 64) };
  }
  // Видимая часть полотна: справа на компьютере может стоять лист ролика.
  function size() {
    const vp = vpRef.current;
    const w = vp?.clientWidth ?? 360;
    return { w: w - (desktopRef.current && sheetOpen.current ? SHEET_W : 0), h: vp?.clientHeight ?? 500 };
  }

  function apply() {
    const w = worldRef.current;
    const vp = vpRef.current;
    if (!w || !vp) return;
    const { x, y, k } = view.current;
    w.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
    // will-change — только пока полотно двигается: потом браузер перерисует текст чётко.
    w.style.willChange = "transform";
    if (timers.current.will) clearTimeout(timers.current.will);
    timers.current.will = setTimeout(() => {
      if (worldRef.current) worldRef.current.style.willChange = "";
    }, 300);
    // Сетка точек едет и масштабируется вместе с полотном — как в Miro.
    // Сильно отдалили — шаг сетки удваиваем, чтобы точки не слились в сплошную заливку.
    let g = 24 * k;
    while (g < 12) g *= 2;
    vp.style.backgroundSize = `${g}px ${g}px`;
    vp.style.backgroundPosition = `${x}px ${y}px`;
    const o = overlayRef.current;
    if (o) {
      o.style.setProperty("--vx", `${x}px`);
      o.style.setProperty("--vy", `${y}px`);
      o.style.setProperty("--k", String(k));
      // Строки дат стали ниже подписи — оставляем только понедельники; зона уже названия — один значок.
      o.dataset.dense = rowH * k < 34 ? "1" : "";
      o.dataset.narrow = (planRef.current.zones[0]?.w ?? 0) * k < 200 ? "1" : "";
    }
    const m = miniRef.current;
    const p = planRef.current;
    if (m && p.width && p.height) {
      const sx = 120 / p.width;
      const sy = 80 / p.height;
      const { w: vw, h: vh } = size();
      m.style.left = `${(-x / k) * sx}px`;
      m.style.top = `${(-y / k) * sy}px`;
      m.style.width = `${(vw / k) * sx}px`;
      m.style.height = `${(vh / k) * sy}px`;
    }
  }
  function redraw() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      apply();
    });
  }
  // «Сегодня» по высоте: строка сегодняшнего дня под названиями зон, видно хвост вчерашнего.
  function baseY(k: number) {
    return insets().top - (planRef.current.todayY - 26) * k;
  }
  function rememberView() {
    if (timers.current.view) clearTimeout(timers.current.view);
    timers.current.view = setTimeout(() => {
      setZoom(Math.round(view.current.k * 100));
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(storeView(view.current, data.todayKey, baseY)));
      } catch {
        // хранилище недоступно — вид просто не запомнится
      }
    }, 300);
  }
  function stopFly() {
    if (flyRaf.current) cancelAnimationFrame(flyRaf.current);
    flyRaf.current = 0;
  }
  // Плавный перелёт камеры (300 мс, ease-out); «уменьшить движение» — сразу.
  function flyTo(target: View) {
    stopFly();
    if (reducedMotion()) {
      view.current = target;
      apply();
      rememberView();
      return;
    }
    const from = { ...view.current };
    const t0 = performance.now();
    const step = (t: number) => {
      const p = (t - t0) / FLY_MS;
      view.current = lerpView(from, target, p);
      apply();
      if (p < 1) flyRaf.current = requestAnimationFrame(step);
      else {
        flyRaf.current = 0;
        rememberView();
      }
    };
    flyRaf.current = requestAnimationFrame(step);
  }
  function zoomAt(px: number, py: number, k: number, animate = false) {
    const v = view.current;
    const nk = clampK(k);
    const next = { k: nk, x: px - ((px - v.x) * nk) / v.k, y: py - ((py - v.y) * nk) / v.k };
    if (animate) return flyTo(next);
    view.current = next;
    redraw();
    rememberView();
  }
  function local(clientX: number, clientY: number): Pt {
    const r = vpRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  // Масштаб для зоны (или всех): целиком по ширине, но не мельче читаемого.
  function readableK(width: number) {
    const { w } = size();
    return clamp((w - insets().left - 12) / Math.max(1, width), READABLE_K, 1);
  }
  function todayView(): View {
    const { zones, width } = planRef.current;
    const { w } = size();
    const ins = insets();
    const all = (w - ins.left - 12) / Math.max(1, width);
    if (all >= READABLE_K) {
      const k = Math.min(1, all);
      return { k, x: ins.left + (w - ins.left - 12 - width * k) / 2, y: baseY(k) };
    }
    const first = zones[0];
    const k = readableK(first?.w ?? width);
    return { k, x: ins.left - (first?.x ?? 0) * k, y: baseY(k) };
  }
  const goToday = () => flyTo(todayView());
  // Зона — по ширине и по высоте как «Сегодня».
  function zoneView(key: ZoneKey): View | null {
    const z = planRef.current.zones.find((x) => x.key === key);
    if (!z) return null;
    const { w } = size();
    const ins = insets();
    const k = readableK(z.w);
    const free = w - ins.left - 12 - z.w * k;
    return { k, x: ins.left + Math.max(0, free / 2) - z.x * k, y: baseY(k) };
  }
  function goZone(key: ZoneKey) {
    const v = zoneView(key);
    if (v) flyTo(v);
  }
  // «Вписать»: все зоны целиком.
  function fitAll() {
    const { width, height } = planRef.current;
    const { w, h } = size();
    const ins = insets();
    const k = clampK(Math.min((w - ins.left - 12) / Math.max(1, width), (h - ins.top - ins.bottom - 8) / Math.max(1, height), 1));
    flyTo({ k, x: ins.left + (w - ins.left - 12 - width * k) / 2, y: ins.top });
  }
  // Карточка — в середину видимой части (лист справа её не закрывает).
  function showCard(zone: ZoneKey, code: string) {
    const z = planRef.current.zones.find((x) => x.key === zone);
    const c = z?.cards.find((x) => x.code === code);
    if (!z || !c) return;
    const { w, h } = size();
    const k = Math.max(view.current.k, READABLE_K);
    const cx = z.x + c.x + planRef.current.card.w / 2;
    const cy = z.y + c.y + planRef.current.card.h / 2;
    const vh = desktopRef.current ? h : h * 0.3; // на телефоне снизу — лист на 70 % высоты
    flyTo({ k, x: w / 2 - cx * k, y: Math.max(insets().top, vh / 2) - cy * k + (desktopRef.current ? 0 : planRef.current.card.h * k * 0.2) });
  }

  // Высота полотна — до нижних вкладок (на компьютере — до низа окна); затем вид.
  useLayoutEffect(() => {
    // При гидратации useDesktop ещё отдаёт серверное «телефон» — для первого расчёта берём экран сами.
    desktopRef.current = window.matchMedia(desktopQuery).matches;
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tab = document.querySelector<HTMLElement>(".tabbar");
      const tabH = tab && getComputedStyle(tab).display !== "none" ? tab.offsetHeight : 0;
      const content = el.closest(".content");
      const pad = tabH ? 8 : content ? parseFloat(getComputedStyle(content).paddingBottom) || 0 : 0;
      el.style.height = `${Math.max(240, window.innerHeight - top - tabH - pad)}px`;
      redraw();
    };
    fit();
    let saved: View | null = null;
    try {
      saved = restoreView(localStorage.getItem(VIEW_KEY), data.todayKey, baseY);
    } catch {
      // нет доступа к хранилищу — начинаем с «Сегодня»
    }
    view.current = saved ?? todayView();
    apply();
    setZoom(Math.round(view.current.k * 100));
    setReady(true);
    if (initial) {
      const p = parseSelected(initial, ZONES)!;
      showCard(p.zone as ZoneKey, p.code);
    }
    window.addEventListener("resize", fit);
    // Шапка стала выше или ниже (раскрыли легенду «?», полоса «YouTube не ответил», перенос чипов) —
    // полотно снова до нижних вкладок, панель вида не уходит под них.
    const head = headRef.current;
    const ro = typeof ResizeObserver !== "undefined" && head ? new ResizeObserver(() => fit()) : null;
    if (ro && head) ro.observe(head);
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
    // Один раз при открытии: дальше вид меняет только человек.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Колесо и тачпад — обработчик не пассивный, иначе вместе с полотном прокручивалась бы страница;
  // щипок тачпада в Safari на Mac — gesture-события (на iPhone щипок идёт pointer-событиями).
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopFly();
      const a = wheelAction(e as WheelEvent & { wheelDeltaY?: number });
      if ("zoom" in a) {
        const p = local(e.clientX, e.clientY);
        zoomAt(p.x, p.y, view.current.k * a.zoom);
      } else {
        view.current.x += a.pan[0];
        view.current.y += a.pan[1];
        redraw();
        rememberView();
      }
    };
    let gk = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      stopFly();
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

  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) if (t) clearTimeout(t);
      stopFly();
    },
    [],
  );

  // ---- лист ролика: в адресе (?v=зона:код), «Назад» закрывает ----

  function openSheet(key: string) {
    if (key === selected) return;
    setSelected(key);
    if (ourSheet()) window.history.replaceState({ ...window.history.state, boardSheet: key }, "", sheetUrl(key));
    // Лист открыт по ссылке — только меняем адрес: иначе ✕ вернул бы «Назад» к первому листу.
    else if (selected) window.history.replaceState(window.history.state, "", sheetUrl(key));
    else window.history.pushState({ boardSheet: key }, "", sheetUrl(key));
    refreshAgainIfLost();
  }
  function closeSheet() {
    if (!selected) return;
    const key = selected;
    setSelected(null);
    if (ourSheet()) window.history.back();
    else window.history.replaceState(window.history.state, "", sheetUrl(null));
    refreshAgainIfLost();
    // Фокус — обратно на карточку, с которой открыли лист (клавиатура и экранный диктор).
    requestAnimationFrame(() => vpRef.current?.querySelector<HTMLElement>(`[data-card="${key}"] [data-open]`)?.focus({ preventScroll: true }));
  }
  // Карточка, на которую пришёл фокус с клавиатуры, — на экран, если она за краем или под слоями.
  function ensureVisible(el: HTMLElement, zone: ZoneKey, code: string) {
    const vp = vpRef.current;
    if (!vp) return;
    const r = el.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const ins = insets();
    const { w, h } = size();
    if (r.left >= v.left + ins.left && r.right <= v.left + w && r.top >= v.top + ins.top && r.bottom <= v.top + h - ins.bottom) return;
    showCard(zone, code);
  }
  const close = useRef(closeSheet);
  const refresh = useRef(refreshAgainIfLost);
  const chooseOpen = useRef(false);
  chooseOpen.current = choose !== null;
  useEffect(() => {
    close.current = closeSheet;
    refresh.current = refreshAgainIfLost;
  });
  useEffect(() => {
    const onPop = () => {
      const p = parseSelected(new URLSearchParams(window.location.search).get("v"), ZONES);
      setSelected(p && findCard(p.zone, p.code) ? keyOf(p.zone as ZoneKey, p.code) : null);
      refresh.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Сначала — окно «когда выложили», потом лист.
      if (chooseOpen.current) setChoose(null);
      else close.current();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  // Пришли по ссылке на ролик, которого на доске нет, — говорим и убираем его из адреса.
  useEffect(() => {
    if (!initialSelected || initial) return;
    showToast(`На доске нет ролика «${initialSelected}».`, false);
    window.history.replaceState(window.history.state, "", sheetUrl(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- «загрузил» ----

  function statusOf(zone: ZoneKey, c: PlacedCard): BoardStatus {
    const m = marks[keyOf(zone, c.code)];
    if (!m) return c.status;
    if (!m.on) return "ready";
    // «Сейчас» — позже момента данных страницы: сравниваем со временем нажатия.
    return Date.parse(m.at ?? c.at) <= Math.max(nowMs, m.t ?? 0) ? "published" : "scheduled";
  }
  const markedOf = (zone: ZoneKey, c: PlacedCard) => marks[keyOf(zone, c.code)]?.on ?? c.marked;
  // Время отметки на сервере сейчас: только что нажатая — её, иначе — у отмеченной карточки её время.
  const markAtOf = (zone: ZoneKey, c: PlacedCard) => {
    const m = marks[keyOf(zone, c.code)];
    return m ? (m.on ? m.at : null) : c.marked ? c.at : null;
  };

  function scheduleRefresh() {
    wantRefresh.current = true;
    if (timers.current.refresh) clearTimeout(timers.current.refresh);
    timers.current.refresh = setTimeout(() => startTransition(() => router.refresh()), REFRESH_MS);
  }
  // Смена адреса (лист открыли/закрыли, «Назад») отменяет идущее обновление в роутере Next —
  // пока свежие данные не пришли, просим их снова.
  function refreshAgainIfLost() {
    if (wantRefresh.current) scheduleRefresh();
  }
  // Отметка в PANEL_BOARD; nextAt — момент («загрузил») или null («снять»). Каждая карточка ждёт
  // только свой ответ: соседние кнопки нажимаются сразу.
  async function setMark(zone: Social, c: PlacedCard, nextAt: string | null, isUndo = false) {
    const key = keyOf(zone, c.code);
    if (busy.has(key)) return;
    const prevAt = markAtOf(zone, c);
    setBusy((b) => new Set(b).add(key));
    const r: ActionResult = await boardMarkAction(zone, c.code, nextAt).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy((b) => {
      const n = new Set(b);
      n.delete(key);
      return n;
    });
    if (!r.ok) return showToast(r.message, false);
    setMarks((m) => ({ ...m, [key]: { on: nextAt !== null, at: nextAt, t: Date.now() } }));
    scheduleRefresh();
    if (isUndo) return showToast("Отменено.", true);
    showToast(nextAt ? `${SHORT[zone]} · ${c.code}: отмечено` : `${SHORT[zone]} · ${c.code}: отметка снята`, true, () => void setMark(zone, c, prevAt, true));
  }
  // «Загрузил»: время прошло или только ориентир — сейчас; впереди и точное — спросить.
  function requestMark(zone: Social, c: PlacedCard, on: boolean) {
    if (!on) return void setMark(zone, c, null);
    const t = markTime(c, Date.now());
    if (t.kind === "choose") setChoose({ zone, card: c });
    else void setMark(zone, c, new Date().toISOString());
  }
  // Английский ролик — отметка «запланирован в Studio» из листа: держим её на карточке до обновления.
  function noteEnMark(code: string, on: boolean, at: string | null) {
    setMarks((m) => ({ ...m, [keyOf("en", code)]: { on, at, t: Date.now() } }));
    scheduleRefresh();
  }

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
    if (el.closest("[data-nodrag]")) return; // кнопки работают как обычно
    if (pointers.current.size >= 2) return;
    stopFly();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // указатель уже отпущен — сдвиг просто закончится на краю
    }
    const p = local(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) return startPinch();
    const tap = el.closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
    const slop = e.pointerType === "mouse" ? MOVE_PX.mouse : MOVE_PX.touch;
    gesture.current = { kind: "pan", id: e.pointerId, sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: false, slop, tap };
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
      const k = clampK((g.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0);
      view.current = { k, x: (a.x + b.x) / 2 - g.wx * k, y: (a.y + b.y) / 2 - g.wy * k };
      redraw();
      return;
    }
    if (e.pointerId !== g.id) return;
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < g.slop) return;
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
      // Один палец остался — дальше сдвиг от него, без скачка (и без касания карточки).
      const rest = [...pointers.current.entries()][0];
      gesture.current = rest ? { kind: "pan", id: rest[0], sx: rest[1].x, sy: rest[1].y, vx: view.current.x, vy: view.current.y, moved: true, slop: 0, tap: null } : null;
      return;
    }
    if (e.pointerId !== g.id) return;
    gesture.current = null;
    // Касание могло остановить перелёт — запоминаем вид, на котором он встал.
    rememberView();
    if (g.moved) return;
    // Касание без сдвига по карточке — её лист прямо на доске.
    if (e.type !== "pointerup") return;
    if (g.tap) openSheet(g.tap);
  }

  // Мини-карта: касание — перелёт к этому месту полотна.
  function onMini(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const p = planRef.current;
    const wx = ((e.clientX - r.left) / r.width) * p.width;
    const wy = ((e.clientY - r.top) / r.height) * p.height;
    const { w, h } = size();
    const k = view.current.k;
    flyTo({ k, x: w / 2 - wx * k, y: h / 2 - wy * k });
  }

  // ---- разметка ----

  const sel = selected ? parseSelected(selected, ZONES) : null;
  const selCard = sel ? findCard(sel.zone, sel.code) : null;
  const zoneOf = (key: ZoneKey) => plan.zones.find((z) => z.key === key)!;
  const filtering = filters.notUploaded || filters.week;
  const visible = (c: { status: string; dateKey: string }) => !filtering || cardVisible(c, filters, data.todayKey, weekEnd);

  const zoneHead = (z: PlacedZone) => (
    <header className={s.zoneHead}>
      <div className={s.zoneName}>
        <ZoneIcon zone={z.key} size={26} />
        <h2>{z.title}</h2>
        <span className={s.zoneSub}>{z.sub}</span>
      </div>
      <p className={`${s.runway} ${z.runway.warn ? s.warn : ""}`}>{z.runway.text}</p>
      <div className={s.zoneMeta}>
        <span>
          вышло {z.counts.published} · запланировано {z.counts.scheduled} · готово {z.counts.ready}
        </span>
        {z.runway.gap && <span className={s.gapChip}>первая дыра: {z.runway.gap.label}</span>}
      </div>
    </header>
  );

  const card = (z: PlacedZone, c: PlacedCard) => {
    const key = keyOf(z.key, c.code);
    const status = statusOf(z.key, c);
    const on = markedOf(z.key, c);
    const social = z.key === "instagram" || z.key === "tiktok";
    const past = c.dateKey < data.todayKey;
    return (
      <article
        key={c.code}
        className={[s.card, past ? s.past : "", c.gap ? s.gapCard : "", selected === key ? s.selected : "", visible({ ...c, status }) ? "" : s.hidden].join(" ")}
        data-status={status}
        data-card={key}
        style={{ left: c.x, top: c.y, width: plan.card.w, height: plan.card.h }}
      >
        {/* Открыть лист — своя кнопка на всю карточку (не кнопка в кнопке: «загрузил» лежит поверх неё).
            Enter и пробел — её собственные: на «загрузил» они нажимают только «загрузил». */}
        <button
          type="button"
          className={s.open}
          data-open=""
          aria-label={`${c.code} · ${z.title} · ${STATUS_LABEL[status]} · ${c.dateLabel} ${c.time}${c.exact ? "" : " (ориентир)"} — открыть`}
          onClick={() => openSheet(key)}
          onFocus={(e) => ensureVisible(e.currentTarget.parentElement!, z.key, c.code)}
        />
        <CardThumb src={c.cover} code={c.code} />
        <div className={s.body}>
          <div className={s.top}>
            <span className={s.code}>{c.code}</span>
            {social && <span className={`${s.tag} ${s[`tag_${z.key}`] ?? ""}`}>{SHORT[z.key]}</span>}
            <span className={s.when} title={c.exact ? undefined : "ориентир: время ещё не стоит"}>
              {c.dateLabel} {c.exact ? "" : "≈"}
              {c.time}
            </span>
          </div>
          <div className={s.cardTitle}>{c.title || "—"}</div>
          {c.note && <div className={s.cardNote}>{c.note}</div>}
          <div className={s.foot} {...(social ? { "data-nodrag": "" } : {})}>
            {/* Рядом с «загрузил» — коротко: что ролик готов и не выложен, говорит сама кнопка. */}
            <span className={s.pill}>{social && on === false && status === "ready" ? "готов" : STATUS_LABEL[status]}</span>
            {c.long && <span className={s.tag}>Разбор</span>}
            {social && on !== undefined && (
              <button
                type="button"
                className={on ? s.unmark : s.markBtn}
                disabled={busy.has(key)}
                aria-label={on ? `Снять отметку «загрузил»: ${c.code}, ${z.title}` : `Загрузил ${c.code} в ${z.title}`}
                onClick={() => requestMark(z.key as Social, c, !on)}
              >
                {busy.has(key) ? "…" : on ? "снять" : "загрузил"}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  const today = dayText(data.todayKey);
  const runwayChips = (
    <div className={s.runways}>
      {plan.zones.map((z) => (
        <button key={z.key} type="button" className={`${s.runwayChip} ${z.runway.warn ? s.warn : ""}`} onClick={() => goZone(z.key)} aria-label={`${z.title}: ${z.runway.text}. Показать зону`}>
          <ZoneIcon zone={z.key} size={16} />
          <b>{z.title}</b> <span>{z.runway.text}</span>
        </button>
      ))}
    </div>
  );
  const filterChips = (
    <>
      <button type="button" className={`${s.toggle} ${filters.notUploaded ? s.on : ""}`} aria-pressed={filters.notUploaded} onClick={() => setFilters((f) => ({ ...f, notUploaded: !f.notUploaded }))}>
        <span className={s.long}>только не загруженные</span>
        <span className={s.short}>не загружены</span>
      </button>
      <button type="button" className={`${s.toggle} ${filters.week ? s.on : ""}`} aria-pressed={filters.week} onClick={() => setFilters((f) => ({ ...f, week: !f.week }))}>
        <span className={s.long}>ближайшие 7 дней</span>
        <span className={s.short}>7 дней</span>
      </button>
    </>
  );
  const legendList = (
    <ul className={s.legend} aria-label="Цвета статусов">
      {LEGEND.map((st) => (
        <li key={st} className={s.legendItem} data-status={st}>
          {STATUS_LABEL[st]}
        </li>
      ))}
    </ul>
  );

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
        <div className={s.head} ref={headRef}>
          <div className={s.headRow}>
            <h1 className={s.title}>Доска</h1>
            {runwayChips}
          </div>
          <div className={s.headRow}>
            {filterChips}
            {desktop ? (
              legendList
            ) : (
              <button type="button" className={`${s.toggle} ${s.help}`} aria-expanded={legend} aria-label="Что значат цвета" onClick={() => setLegend(!legend)}>
                ?
              </button>
            )}
          </div>
          {!desktop && legend && <div className={s.legendPop}>{legendList}</div>}
          {data.youtubeError && (
            <p className={s.ytError} role="status">
              YouTube не ответил — статусы ориентир, «загрузил» скрыта
            </p>
          )}
        </div>

        <div className={`${s.stage} ${selected && desktop ? s.withSheet : ""}`} ref={stageRef}>
          <div
            ref={vpRef}
            className={s.viewport}
            role="application"
            aria-label="Доска: тяните, чтобы сдвинуть; щипок или колесо — масштаб; Tab — по карточкам"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div ref={worldRef} className={s.world} style={{ visibility: ready ? "visible" : "hidden" }}>
              {plan.zones.map((z) => (
                <section key={z.key} className={`${s.zone} ${s[`zone_${z.key}`] ?? ""}`} style={{ left: z.x, top: z.y, width: z.w, height: z.h }} aria-label={z.title}>
                  {zoneHead(z)}
                  {plan.days.map((d) => (
                    <div key={d.key} className={s.dayLine} style={{ top: d.y - 5 }} aria-hidden="true" />
                  ))}
                  {z.empty.map((e) => (
                    <div
                      key={e.at}
                      className={`${s.empty} ${e.gap ? s.gapEmpty : ""} ${filtering ? s.hidden : ""}`}
                      style={{ left: e.x, top: e.y, width: plan.card.w, height: plan.card.h }}
                      aria-label={`${e.time}: пусто${e.gap ? ", первая дыра" : ""}`}
                    >
                      <span>{e.gap ? "дыра" : "пусто"}</span>
                      <small>{e.time}</small>
                    </div>
                  ))}
                  {z.cards.map((c) => card(z, c))}
                </section>
              ))}
            </div>
          </div>

          {/* Поверх полотна: линия «Сегодня», колонка дат и названия зон — не масштабируются. */}
          <div ref={overlayRef} className={s.overlay} aria-hidden="true">
            <div className={s.lineLayer}>
              <div className={s.todayLine} style={{ "--y": `${plan.todayY - 5}px` } as React.CSSProperties}>
                <span>Сегодня</span>
              </div>
            </div>
            <div className={s.dateCol}>
              {plan.days.map((d) => {
                const t = dayText(d.key);
                return (
                  <div
                    key={d.key}
                    className={`${s.date} ${d.key === data.todayKey ? s.today : ""} ${d.key < data.todayKey ? s.pastDate : ""}`}
                    data-monday={t.monday ? "1" : undefined}
                    style={{ "--y": `${d.y}px`, "--h": `${d.h}px` } as React.CSSProperties}
                  >
                    <span>{t.wd}</span>
                    <b>{t.dm}</b>
                  </div>
                );
              })}
            </div>
            <div className={s.titles}>
              {plan.zones.map((z) => (
                <div key={z.key} className={`${s.ztitle} ${s[`zone_${z.key}`] ?? ""}`} style={{ "--zx": `${z.x}px`, "--zw": `${z.w}px` } as React.CSSProperties}>
                  <ZoneIcon zone={z.key} size={16} />
                  <span>{z.title}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Мини-карта — для пальца и мыши; с клавиатуры то же делают кнопки зон и «Сегодня». */}
          <div className={s.mini} onPointerDown={onMini} aria-hidden="true" title="Мини-карта: нажмите, чтобы перелететь">
            {plan.zones.map((z) => (
              <span key={z.key} className={`${s.miniZone} ${s[`zone_${z.key}`] ?? ""}`} style={{ left: (z.x / plan.width) * 120, width: Math.max(2, (z.w / plan.width) * 120) }} />
            ))}
            <span className={s.miniToday} style={{ top: (plan.todayY / plan.height) * 80 }} />
            <span ref={miniRef} className={s.miniView} />
          </div>

          <div className={s.dock} role="toolbar" aria-label="Вид доски">
            {desktop && (
              <button type="button" className={s.tool} onClick={() => zoomAt(size().w / 2, size().h / 2, view.current.k / 1.25, true)} aria-label="Мельче">
                −
              </button>
            )}
            <span className={s.zoom} aria-live="polite">
              {zoom}%
            </span>
            {desktop && (
              <button type="button" className={s.tool} onClick={() => zoomAt(size().w / 2, size().h / 2, view.current.k * 1.25, true)} aria-label="Крупнее">
                +
              </button>
            )}
            <button type="button" className={s.tool} onClick={goToday} title={`${today.wd}, ${today.dm}`}>
              Сегодня
            </button>
            <button type="button" className={s.tool} onClick={fitAll}>
              Вписать
            </button>
            {!desktop && (
              <span className={s.zoneChips}>
                {plan.zones.map((z) => (
                  <button key={z.key} type="button" className={s.zoneChip} onClick={() => goZone(z.key)} aria-label={`Показать зону ${z.title}`}>
                    <ZoneIcon zone={z.key} size={18} />
                  </button>
                ))}
              </span>
            )}
          </div>

          {selected && sel && (
            <BoardSheet
              key={selected}
              data={data}
              zone={sel.zone as ZoneKey}
              code={sel.code}
              card={selCard}
              zoneTitle={zoneOf(sel.zone as ZoneKey).title}
              status={selCard ? statusOf(sel.zone as ZoneKey, selCard) : null}
              marked={selCard ? markedOf(sel.zone as ZoneKey, selCard) : undefined}
              busy={busy.has(selected)}
              desktop={desktop}
              onClose={closeSheet}
              onMark={(on) => selCard && (sel.zone === "instagram" || sel.zone === "tiktok") && requestMark(sel.zone, selCard, on)}
              onEnMark={noteEnMark}
              onToast={showToast}
            />
          )}
        </div>

        {choose && (
          <div className={s.choose} role="dialog" aria-label={`Когда ${choose.card.code} в ${SHORT[choose.zone]}`}>
            <p>
              <b>
                {choose.card.code} · {zoneOf(choose.zone).title}
              </b>
              <br />
              Выложили сейчас или поставили в расписание?
            </p>
            <div className={s.chooseBtns}>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  const c = choose;
                  setChoose(null);
                  void setMark(c.zone, c.card, new Date().toISOString());
                }}
              >
                Выложил сейчас
              </button>
              <button
                type="button"
                className="btn small primary"
                autoFocus
                onClick={() => {
                  const c = choose;
                  setChoose(null);
                  void setMark(c.zone, c.card, c.card.at);
                }}
              >
                Поставил на {choose.card.dateLabel} {choose.card.time}
              </button>
              <button type="button" className="btn small ghost" onClick={() => setChoose(null)}>
                Отмена
              </button>
            </div>
          </div>
        )}
        {toast && (
          <div className={`toast ${s.toast}${toast.ok ? "" : " err"}`} role="status">
            <span>{toast.text}</span>
            {toast.undo && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  const u = toast.undo!;
                  setToast(null);
                  u();
                }}
              >
                Отменить
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
              ✕
            </button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
