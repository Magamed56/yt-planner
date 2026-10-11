"use client";
import { useState } from "react";
import type { PanelState, Row } from "@/lib/state";
import { holdLabel } from "@/lib/rebuild-hold";
import { RATIO_CLASS, STAGE_LABEL, plural } from "@/lib/stages";
import CoverMedia, { frameOf } from "./CoverMedia";
import { usePending } from "@/lib/pending";
import RunProgressBar from "./RunProgressBar";

// Подпись на обложке: этап и, если нужно, что сделать. Ждущий пересборки — не «загрузить»: его
// старая версия с ошибкой (content/rebuild.json).
function chipText(r: Row, queued: boolean): string {
  if (r.hold?.rebuilding) return holdLabel(r.hold);
  if (r.running) return r.running;
  if (queued) return "в очереди…";
  if (r.hold) return holdLabel(r.hold);
  if (r.stage === "video") return "Видео — загрузить в Studio";
  if (r.stage === "studio") return "В Studio — нужно время";
  return STAGE_LABEL[r.stage];
}

// Отметка выбора на обложке: «on» — выбран, «off» — можно выбрать, «none» — файлов нет.
type Mark = "on" | "off" | "none" | null;

function Cover({ row, mark, queued }: { row: Row; mark: Mark; queued: boolean }) {
  const [empty, setEmpty] = useState(false);
  const st = row.stage === "published" ? row.stats : null;
  const views = st ? (
    <span className="views-badge" title={st.basis ? `просмотры · ${st.basis}` : "просмотры"}>
      👁 {st.viewsLabel}
      {st.ratioLabel && <span className={`ratio ${RATIO_CLASS[st.verdict ?? "typical"]}`}>{st.ratioLabel}</span>}
    </span>
  ) : null;
  const check = mark && (
    <span className={`check ${mark}`} aria-hidden="true">
      {mark === "on" ? "✓" : mark === "none" ? (row.hold ? "старая версия" : "нет файлов") : ""}
    </span>
  );
  const blank = (
    <>
      {row.code}
      <small>{row.hold ? holdLabel(row.hold) : row.localVideo ? "файл на компьютере" : STAGE_LABEL[row.stage]}</small>
    </>
  );
  // Ни обложка, ни кадр не открылись — плитка пустая: с кодом и этапом.
  const hasMedia = Boolean(row.cover || frameOf(row)) && !empty;
  return (
    <span className={`cover${hasMedia ? "" : " empty"}`}>
      {hasMedia ? <CoverMedia src={row.cover} video={frameOf(row)} onFail={() => setEmpty(true)} /> : blank}
      <span className="time">{row.timeLabel}</span>
      {row.long && <span className="long-badge">Разбор</span>}
      {views}
      {hasMedia && <span className="chip-stage">{chipText(row, queued)}</span>}
      {!hasMedia && queued && !row.running && <span className="chip-stage">в очереди…</span>}
      {check}
    </span>
  );
}


// Лента: день — две обложки (12:00 и 19:00), как ролики встанут на канале; во вт/чт/сб — ещё
// «Разбор» в 21:00 (значок «Разбор», обложка 16:9). В режиме выбора нажатие отмечает ролик для
// скачивания (только с файлами в релизе и не ждущий пересборки), карточка не открывается.
export default function FeedView({
  state,
  rows,
  selected,
  onOpen,
  chosen = null,
  onToggle,
  limitDays,
  onMore,
}: {
  state: PanelState;
  rows: Row[];
  selected: string | null;
  onOpen: (code: string) => void;
  chosen?: Set<string> | null; // null — режим выбора выключен
  onToggle?: (code: string) => void;
  limitDays?: number; // показать столько ближайших дней, остальное — кнопкой
  onMore?: () => void;
}) {
  const pending = usePending(); // до раннего return: порядок хуков не меняется
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
  const runOf = (code: string) => state.runs.find((x) => x.active && x.codes.includes(code)) ?? null;
  // Свободно — только будущий слот, на который на YouTube ничего не стоит (вышедший сегодня
  // в 12:00 в «Впереди» не виден, но слот занят).
  const freeAt = new Map<string, { time: string; long: boolean }[]>();
  const addFree = (grid: PanelState["slotGrid"] | undefined, long: boolean) => {
    for (const c of grid ?? []) if (c.occupant === null) freeAt.set(c.dateKey, [...(freeAt.get(c.dateKey) ?? []), { time: c.time, long }]);
  };
  addFree(state.slotGrid, false);
  // Свободные 21:00 «Разборов» — только когда «Разборы» уже в плане, иначе это шум.
  if (state.rows.some((r) => r.long)) addFree(state.longSlotGrid, true);
  const shown = limitDays && days.length > limitDays ? days.slice(0, limitDays) : days;
  const rest = days.slice(shown.length);
  const restCount = rest.reduce((n, d) => n + d.rows.length, 0);
  const restUntil = /\d{2}\.\d{2}/.exec([...rest].reverse().find((d) => d.key !== "none")?.rows[0]?.dateLabel ?? "")?.[0];

  return (
    <div className="feed">
      {shown.map((d) => {
        const taken = new Set(d.rows.map((r) => r.timeLabel));
        const free = d.future && d.key !== "none" ? (freeAt.get(d.key) ?? []).filter((s) => !taken.has(s.time)).sort((a, b) => a.time.localeCompare(b.time)) : [];
        return (
          <section key={d.key} className={`feed-day${d.today ? " today" : ""}`}>
            <h2>
              <span className="dot" />
              {d.label}
              {d.approx && <span className="approx">ориентир</span>}
            </h2>
            <div className="feed-cards">
              {d.rows.map((r) => {
                const mark: Mark = chosen ? (!r.release || r.hold ? "none" : chosen.has(r.code) ? "on" : "off") : null;
                const hint = r.flags[0] ?? (r.hold && !r.hold.rebuilding ? "старую версию не загружайте" : null);
                return (
                  <button
                    key={r.code}
                    className={`vcard stage-${r.stage}${r.hold ? ` hold${r.hold.rebuilding ? " rebuilding" : ""}` : ""}${r.long ? " long" : ""}${r.code === selected && !chosen ? " active" : ""}${mark === "on" ? " chosen" : ""}${mark === "none" ? " nofiles" : ""}`}
                    aria-pressed={chosen ? mark === "on" : undefined}
                    disabled={mark === "none"}
                    onClick={() => (chosen ? onToggle?.(r.code) : onOpen(r.code))}
                  >
                    <Cover row={r} mark={mark} queued={pending.has(r.code)} />
                    <span className="code">{r.code}</span>
                    <span className="title">{r.title}</span>
                    {r.running && runOf(r.code)?.progress && <RunProgressBar progress={runOf(r.code)!.progress!} runId={runOf(r.code)!.id} compact />}
                    {hint && <span className="hint">{hint}</span>}
                  </button>
                );
              })}
              {free.map((s) => (
                <div key={s.time} className={`vcard free${s.long ? " long" : ""}`}>
                  <span className="cover empty">
                    свободно
                    <small>{s.long ? `${s.time} · «Разбор»` : s.time}</small>
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {restCount > 0 && (
        <button type="button" className="btn feed-more" onClick={onMore}>
          Ещё {restCount} {plural(restCount, "ролик", "ролика", "роликов")}
          {restUntil ? ` до ${restUntil}` : ""} →
        </button>
      )}
    </div>
  );
}
