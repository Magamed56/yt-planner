"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fillNewUploadsAction, findNewUploadsAction, moveVideoAction, restoreQueueAction, swapQueueAction, undoMoveAction } from "@/app/actions";
import { setBadge } from "@/lib/badge";
import type { CoverageLevel, PanelState, Reminder, Row } from "@/lib/state";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/stages";
import { badgeCount, buildTodo } from "@/lib/todo";
import AppShell, { RunwayRing } from "./AppShell";
import BoardView, { movable, queued, type BoardCell } from "./BoardView";
import DownloadSheet from "./DownloadSheet";
import FeedView from "./FeedView";
import NowCard from "./NowCard";
import PipelineStrip from "./PipelineStrip";
import VideoSheet from "./VideoSheet";

type Filter = "ahead" | "all" | Stage;
export type QueueMode = "feed" | "calendar";
// Чем отменить последнее: переносы на YouTube или прежний порядок очереди выхода.
type Undo = { moves: { videoId: string; publishAt: string }[] } | { order: string[] };

const NOTICE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

const CHECK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

// Эти напоминания — дела с кнопкой в карточке «Сейчас»; в заметках остаются остальные.
const IN_NOW = new Set<Reminder["kind"]>(["youtube", "runway", "upload", "fill", "problem", "run"]);

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

// Кто встанет в пустой слот — коротко, для шапки.
const GAP_STAGE: Record<Stage, string> = { topic: "только тема", script: "есть сценарий", video: "видео готово", studio: "уже в Studio", scheduled: "", published: "" };
const FEED_DAYS = 10;
const HINT_KEY = "sut.boardHint"; // «Впереди» — ближайшие дни, остальное по кнопке

const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} МБ`;
// Сколько весят файлы ролика целиком: видео и обе обложки.
const rowBytes = (r: Row) => (r.release ? r.release.mp4.size + (r.release.cover?.size ?? 0) + (r.release.thumb?.size ?? 0) : 0);

// Адрес главной: ?view=calendar и ?v=08a — открытая карточка (ссылка из уведомления или «Статистики»).
function queueUrl(mode: QueueMode, code: string | null): string {
  const p = new URLSearchParams();
  if (mode === "calendar") p.set("view", "calendar");
  if (code) p.set("v", code);
  const q = p.toString();
  return q ? `?${q}` : "/";
}
// Карточку открыли мы (pushState) — «Назад» её закроет. Пришли по ссылке — заменяем адрес.
const ourSheet = () => typeof window !== "undefined" && typeof (window.history.state as { sheet?: unknown } | null)?.sheet === "string";

export default function QueueView({ state, initialMode, initialSelected = null }: { state: PanelState; initialMode: QueueMode; initialSelected?: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<QueueMode>(initialMode);
  const [filter, setFilter] = useState<Filter>("ahead");
  const known = (code: string | null) => (code && state.rows.some((r) => r.code === code) ? code : null);
  const [selected, setSelected] = useState<string | null>(() => known(initialSelected));
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: Undo } | null>(null);
  // Выбор роликов для скачивания: null — режим выключен; saving — открыт лист «Скачать».
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Подсказку про перетаскивание можно убрать — запоминаем в браузере (может не быть доступа).
  const [hintHidden, setHintHidden] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_KEY) === "hidden") setHintHidden(true);
    } catch {
      // хранилище недоступно — подсказка просто остаётся
    }
  }, []);
  function hideHint() {
    setHintHidden(true);
    try {
      localStorage.setItem(HINT_KEY, "hidden");
    } catch {
      // не запомнили — в следующий раз покажется снова
    }
  }

  // Вид — в адресе (?view=calendar), без запроса к серверу: данные уже на странице. Открытая
  // карточка остаётся в адресе.
  function switchMode(next: QueueMode) {
    setMode(next);
    setPicked(null);
    if (next === "calendar") stopChoosing();
    window.history.replaceState(window.history.state, "", queueUrl(next, selected));
  }

  // Карточка ролика — в адресе (?v=08a): одно «Назад» (и свайп назад на iPhone) закрывает её.
  function openSheet(code: string) {
    if (code === selected) return;
    setSelected(code);
    if (ourSheet()) window.history.replaceState({ ...window.history.state, sheet: code }, "", queueUrl(mode, code));
    else window.history.pushState({ sheet: code }, "", queueUrl(mode, code));
  }
  function closeSheet() {
    if (!selected) return;
    setSelected(null);
    if (ourSheet()) window.history.back();
    else window.history.replaceState(window.history.state, "", queueUrl(mode, null));
  }
  const close = useRef(closeSheet);
  useEffect(() => {
    close.current = closeSheet;
  });

  // Назад/вперёд по истории — карточка из адреса; Escape — закрыть.
  useEffect(() => {
    const onPop = () => {
      const v = new URLSearchParams(window.location.search).get("v");
      setSelected(v && state.rows.some((r) => r.code === v) ? v : null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [state.rows]);

  // По ссылке пришёл код, которого нет в плане, — говорим и убираем его из адреса.
  useEffect(() => {
    if (!initialSelected || known(initialSelected)) return;
    setToast({ text: `Ролика ${initialSelected} нет в плане.`, ok: false });
    window.history.replaceState(window.history.state, "", queueUrl(initialMode, null));
  }, []);

  function startChoosing(codes: string[] = []) {
    closeSheet();
    setChosen(new Set(codes));
  }

  function stopChoosing() {
    setChosen(null);
    setSaving(false);
  }

  function toggleChosen(code: string) {
    if (!chosen) return;
    const next = new Set(chosen);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setChosen(next);
    if (!next.size) setSaving(false);
  }

  // «Сохранить и загрузить в Studio» — сразу к скачиванию этих роликов.
  function saveWaiting(codes: string[]) {
    if (mode !== "feed") switchMode("feed");
    startChoosing(codes);
    setSaving(true);
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

  // Перенос. Запланированный на YouTube — меняется только время выхода (занятый слот — обмен
  // местами). Ролик-ориентир — меняется местами с другим ориентиром в очереди выхода.
  async function place(code: string, cell: BoardCell) {
    const row = state.rows.find((r) => r.code === code);
    setPicked(null);
    if (!row || cell.row?.code === row.code) return;
    if (movable(row) && row.youtube) {
      if (!cell.iso) return setToast({ text: "Сюда нельзя: слот уже прошёл или дальше 60 дней — перенесите в Studio.", ok: false });
      if (cell.row?.stage === "published") return setToast({ text: "Этот ролик уже вышел — его место занято.", ok: false });
      const videoId = row.youtube.videoId;
      return void act(async () => {
        const r = await moveVideoAction(videoId, cell.iso!);
        return { ...r, undo: "undo" in r && r.undo ? { moves: r.undo } : undefined };
      });
    }
    if (!queued(row)) return;
    const other = cell.row;
    if (!other) return setToast({ text: "Ролики без времени на YouTube встают в слоты по очереди — перетащите его на место другого такого ролика.", ok: false });
    if (!queued(other)) {
      return setToast({ text: `Здесь ${other.code} — он уже ${other.stage === "published" ? "вышел" : "в расписании YouTube"}. Перетащите ${code} на место ролика с пометкой «ориентир».`, ok: false });
    }
    return void act(async () => {
      const r = await swapQueueAction(row.code, other.code);
      return { ...r, undo: "undoOrder" in r && r.undoOrder ? { order: r.undoOrder } : undefined };
    });
  }

  async function act(fn: () => Promise<{ ok: boolean; message: string; undo?: Undo }>) {
    setBusy(true);
    try {
      const r = await fn();
      setToast({ text: r.message, ok: r.ok, undo: r.undo });
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
      const r = "order" in u ? await restoreQueueAction(u.order) : await undoMoveAction(u.moves);
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
    openSheet(row.code);
  }

  const rows = state.rows.filter((r) => filter === "all" || (filter === "ahead" ? r.stage !== "published" : r.stage === filter));
  const current = selected ? (state.rows.find((r) => r.code === selected) ?? null) : null;
  const pickedRow = picked ? (state.rows.find((r) => r.code === picked) ?? null) : null;
  const urgent = state.reminders.filter((m) => !IN_NOW.has(m.kind) && m.level !== "info");
  const notes = state.reminders.filter((m) => !IN_NOW.has(m.kind) && m.level === "info");
  // Время — момента сборки данных: на сервере и в браузере тексты «через 20 ч» совпадут.
  const todos = useMemo(() => buildTodo(state, new Date(state.generatedAt)), [state]);
  const attention = badgeCount(todos);
  useEffect(() => setBadge(attention), [attention, state.generatedAt]);

  // Шапка: до какого слота расписание без пропусков и где первая дыра.
  const gap = state.firstGap;
  const gapCell = gap ? (state.slotGrid.find((c) => c.iso === gap.iso) ?? null) : null;
  const gapWhen = gapCell ? `${gapCell.dateKey === state.todayKey ? "сегодня" : gapCell.dateKey === state.tomorrowKey ? "завтра" : gapCell.dateLabel} ${gapCell.time}` : (gap?.label ?? "");
  const heroTitle = state.youtubeError
    ? "Расписание не проверено"
    : !state.scheduleEnd
      ? "Расписание пустое"
      : !gap
        ? "Заполнено на 60 дней вперёд"
        : state.runwayLabel
          ? `Заполнено до ${state.runwayLabel}`
          : "Ближайший слот пуст";
  const heroSub = gap
    ? `первая дыра: ${gapWhen}${gap.code && gap.stage ? ` (встанет ${gap.code} — ${GAP_STAGE[gap.stage]})` : ""}`
    : `${state.counts.scheduled} ждут выхода · ${state.counts.video} загрузить в Studio`;
  function pickLevel(level: CoverageLevel) {
    if (mode !== "feed") switchMode("feed");
    setFilter(level);
  }

  // Скачивание пачкой: ролики с файлами в релизе (собранные на компьютере — без файлов).
  const chosenRows = chosen ? state.rows.filter((r) => chosen.has(r.code) && r.release) : [];
  const chosenBytes = chosenRows.reduce((s, r) => s + rowBytes(r), 0);
  const visibleWithFiles = rows.filter((r) => r.release);
  const allVisibleChosen = chosen !== null && visibleWithFiles.length > 0 && visibleWithFiles.every((r) => chosen.has(r.code));
  const choosingBar = chosen !== null && !saving;

  function toggleVisible() {
    if (!chosen) return;
    const next = new Set(chosen);
    for (const r of visibleWithFiles) {
      if (allVisibleChosen) next.delete(r.code);
      else next.add(r.code);
    }
    setChosen(next);
  }

  return (
    <AppShell
      active={mode}
      onSection={(s) => (s === "runs" ? router.push("/runs") : switchMode(s))}
      updated={state.updatedLabel}
      generatedAt={state.generatedAt}
      activeIds={state.runs.filter((r) => r.active).map((r) => r.id)}
      activeRuns={state.runs.filter((r) => r.active).length}
      runwayDays={state.runwayDays}
      runwayLabel={state.runwayLabel}
    >
      <div className={`workspace${current || (chosen && saving) ? " with-sheet" : ""}`}>
        <main>
          <section className="hero">
            <RunwayRing days={state.runwayDays} size={76} />
            <div>
              <b>{heroTitle}</b>
              <span className="small muted">{heroSub}</span>
            </div>
          </section>
          <PipelineStrip coverage={state.coverage} perDay={state.slotTimes.length} gridSlots={state.slotGrid.length} onPick={pickLevel} />

          <NowCard
            todos={todos}
            doneUntil={state.runwayLabel}
            disabled={busy || chosen !== null}
            onDownload={saveWaiting}
            onFind={() => void findNew()}
            onOpen={openSheet}
          />

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
              {mode === "feed" && (
                <button
                  className="btn choose-btn"
                  aria-pressed={chosen !== null}
                  onClick={() => (chosen ? stopChoosing() : startChoosing())}
                  title="Отметить несколько роликов и скачать их видео и обложки разом"
                >
                  {CHECK_ICON}
                  {chosen ? "Отменить выбор" : "Выбрать"}
                </button>
              )}
            </div>
          </div>

          {(urgent.length > 0 || notes.length > 0) && (
          <div className="notices">
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
          )}

          {mode === "calendar" ? (
            <>
              {!hintHidden && (
                <p className="board-hint closable">
                  <span>
                    Перетащите ролик на другой слот — мышью или пальцем (нажмите и чуть подержите). Запланированные на YouTube переносятся там же, ориентиры меняются местами в очереди выхода. Можно и
                    без перетаскивания: нажмите запланированный ролик, потом слот.
                  </span>
                  <button type="button" className="btn small ghost" onClick={hideHint} aria-label="Скрыть подсказку">
                    ✕
                  </button>
                </p>
              )}
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
              {chosen && <p className="board-hint">Нажимайте на ролики — отмеченные ✓ скачаются вместе: видео и обложки. Ролики без готового видео не выбираются.</p>}
              <FeedView
                state={state}
                rows={rows}
                selected={selected}
                onOpen={openSheet}
                chosen={chosen}
                onToggle={toggleChosen}
                // В режиме выбора — всё: «Все с видео» отмечает и то, что ниже.
                limitDays={filter === "ahead" && !expanded && !chosen ? FEED_DAYS : undefined}
                onMore={() => setExpanded(true)}
              />
            </>
          )}
          {/* Полоска выбора закрывает низ ленты — запас, чтобы последние ролики было видно. */}
          {choosingBar && <div className="selectbar-space" aria-hidden="true" />}
        </main>
        {current && (
          <>
            <div className="backdrop" onClick={closeSheet} />
            <VideoSheet key={current.code} row={current} state={state} onClose={closeSheet} />
          </>
        )}
        {chosen && saving && (
          <>
            <div className="backdrop" onClick={() => setSaving(false)} />
            <DownloadSheet rows={chosenRows} onClose={() => setSaving(false)} onRemove={toggleChosen} />
          </>
        )}
      </div>

      {choosingBar && !pickedRow && (
        <div className="selectbar" role="status">
          <span>{chosenRows.length ? `Выбрано: ${chosenRows.length} · ≈ ${mb(chosenBytes)}` : "Отметьте ролики для скачивания"}</span>
          <div className="selectbar-actions">
            {visibleWithFiles.length > 0 && (
              <button className="btn small" onClick={toggleVisible}>
                {allVisibleChosen ? "Снять все" : `Все с видео (${visibleWithFiles.length})`}
              </button>
            )}
            <button className="btn small go" disabled={!chosenRows.length} onClick={() => setSaving(true)}>
              ⬇ Скачать
            </button>
            <button className="btn small" onClick={stopChoosing}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {pickedRow && (
        <div className="pickbar" role="status">
          <span>
            Куда перенести {pickedRow.code} ({pickedRow.dateLabel} {pickedRow.timeLabel})? Нажмите на слот.
          </span>
          <button className="btn small" onClick={() => openSheet(pickedRow.code)}>
            Подробнее
          </button>
          <button className="btn small" onClick={() => setPicked(null)}>
            Отмена
          </button>
        </div>
      )}
      {toast && !pickedRow && !choosingBar && (
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
