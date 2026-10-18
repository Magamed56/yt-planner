"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  captionAction,
  draftAction,
  fillNewUploadsAction,
  firstCommentPreviewAction,
  moveVideoAction,
  postFirstCommentAction,
  rebuildAction,
  saveScriptAction,
  scriptForEditAction,
  scriptTextAction,
  undoMoveAction,
  videosAction,
  type ActionResult,
  type ScriptText,
} from "@/app/actions";
import { COMMENT_MAX, type OwnComment } from "@/lib/first-comment";
import { DEFAULT_REBUILD, editLock, rebuildLabel, THEME_LABEL, THEMES, VOICE_LABEL, VOICES, type RebuildOptions } from "@/lib/rebuild";
import { holdLabel } from "@/lib/rebuild-hold";
import { checkScriptEdit, parseTags, SCRIPT_LIMITS, type SceneEdit, type ScriptEdit } from "@/lib/script-edit";
import type { PanelState, Row, SlotCell } from "@/lib/state";
import { STAGE_LABEL, shiftDateKey } from "@/lib/stages";
import { frameOf } from "./CoverMedia";
import Dots from "./Dots";
import FilesSaver from "./FilesSaver";
import { notePending, usePending } from "@/lib/pending";
import ReleaseChecks from "./ReleaseChecks";
import RunProgressBar from "./RunProgressBar";
import Thumb from "./Thumb";

type Undo = { videoId: string; publishAt: string }[];
type CommentDraft = { text: string; existing: OwnComment | null; posted: string | null };
type Editing = { sha: string; edit: ScriptEdit; tags: string; problems: string[] };

const KIND_LABEL: Record<string, string> = { hook: "хук", statement: "мысль", list: "список", stat: "цифра", quote: "цитата", media: "кадр", cta: "призыв" };

// Плеер прямо в карточке: файл из релиза через /api/asset/<id>/file — video/mp4 с диапазонами
// (206), иначе Safari на iPhone не играет. preload="none" — ничего не качается, пока не нажали ▶.
function Preview({ mp4Id, poster }: { mp4Id: number; poster: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <video key={attempt} className="preview" controls playsInline preload="none" poster={poster ?? undefined}>
        <source src={`/api/asset/${mp4Id}/file${attempt ? `?r=${attempt}` : ""}`} type="video/mp4" onError={() => setFailed(true)} />
      </video>
      {failed && (
        <p className="small flag">
          Видео не открылось — GitHub не ответил вовремя.{" "}
          <button
            className="btn small"
            onClick={() => {
              setFailed(false);
              setAttempt(attempt + 1);
            }}
          >
            Ещё раз
          </button>
        </p>
      )}
    </>
  );
}

// Форма правки: название, описание, теги и тексты сцен. Структура сцен (вид, цифры, визуал) — как была.
function ScriptForm({ value, busy, onChange, onSave, onCancel }: { value: Editing; busy: boolean; onChange: (v: Editing) => void; onSave: () => void; onCancel: () => void }) {
  const { edit } = value;
  const setEdit = (patch: Partial<ScriptEdit>) => onChange({ ...value, edit: { ...edit, ...patch } });
  const setScene = (i: number, patch: Partial<SceneEdit>) => setEdit({ scenes: edit.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="script-form">
      <label>
        Название <span className="muted">{edit.title.trim().length}/{SCRIPT_LIMITS.title}</span>
        <input value={edit.title} onChange={(e) => setEdit({ title: e.target.value })} />
      </label>
      <label>
        Описание
        <textarea rows={4} value={edit.description} onChange={(e) => setEdit({ description: e.target.value })} />
      </label>
      <label>
        Теги через запятую
        <input value={value.tags} onChange={(e) => onChange({ ...value, tags: e.target.value })} />
      </label>
      {edit.scenes.map((s, i) => (
        <fieldset key={s.id || i}>
          <legend>
            {i + 1}. {KIND_LABEL[s.kind] ?? s.kind}
          </legend>
          <label>
            Диктор
            <textarea rows={3} value={s.narration} onChange={(e) => setScene(i, { narration: e.target.value })} />
          </label>
          <label>
            На экране <span className="muted">до 7 слов, акцент — *слово*</span>
            <input value={s.onScreen} onChange={(e) => setScene(i, { onScreen: e.target.value })} />
          </label>
          {s.kind === "list" && (
            <label>
              Пункты списка — по одному в строке (2–4)
              <textarea rows={4} value={(s.items ?? []).join("\n")} onChange={(e) => setScene(i, { items: e.target.value.split("\n") })} />
            </label>
          )}
        </fieldset>
      ))}
      {value.problems.length > 0 && (
        <ul className="problems">
          {value.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={onSave}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button className="btn" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

// Первый комментарий: черновик (вопрос из призыва + источники плана) → правка → отправка. Повторно
// не отправит: сервер сначала ищет комментарий канала под роликом.
function FirstComment({ row, busy, setBusy, onToast }: { row: Row; busy: boolean; setBusy: (b: boolean) => void; onToast: (text: string, ok: boolean) => void }) {
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const videoId = row.youtube!.videoId;

  async function open() {
    setBusy(true);
    try {
      const r = await firstCommentPreviewAction(row.code, videoId, row.scriptPath);
      if ("text" in r) setDraft({ text: r.text, existing: r.existing, posted: null });
      else onToast(r.message, false);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!draft || !window.confirm(`Опубликовать комментарий от имени канала под ${row.code}? Удалить его потом можно только в YouTube.`)) return;
    setBusy(true);
    try {
      const r = await postFirstCommentAction(videoId, draft.text);
      onToast(r.message, r.ok);
      const url = "url" in r ? r.url : null;
      if (r.ok) setDraft({ ...draft, posted: url ?? (row.long ? `https://youtube.com/watch?v=${videoId}` : `https://youtube.com/shorts/${videoId}`) });
      else if (url) setDraft({ ...draft, existing: { id: "", text: "", url } });
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={open}>
          💬 Первый комментарий
        </button>
      </div>
    );
  }
  if (draft.posted || draft.existing) {
    const url = draft.posted ?? draft.existing!.url;
    return (
      <>
        <p className="small">
          {draft.posted ? "✓ Комментарий опубликован — закрепите его в приложении YouTube (⋮ → «Закрепить»)." : "Комментарий канала под роликом уже есть — второй не нужен."}{" "}
          <a href={url} target="_blank" rel="noreferrer">
            Открыть ↗
          </a>
        </p>
        {!draft.posted && draft.existing?.text && <div className="caption">{draft.existing.text}</div>}
      </>
    );
  }
  return (
    <div className="script-form">
      <label>
        Первый комментарий{" "}
        <span className="muted">
          {draft.text.trim().length}/{COMMENT_MAX}
        </span>
        <textarea rows={6} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
      </label>
      <p className="muted small">Вопрос — из призыва сценария, источники — из фактов плана. Можно поправить перед отправкой.</p>
      <div className="btn-row">
        <button className="btn primary" disabled={busy || !draft.text.trim()} onClick={send}>
          {busy ? "Отправляю…" : "Опубликовать"}
        </button>
        <button className="btn" disabled={busy} onClick={() => setDraft(null)}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function VideoSheet({ row, state, onClose }: { row: Row; state: PanelState; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: Undo } | null>(null);
  const [script, setScript] = useState<ScriptText | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [showSlots, setShowSlots] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [scriptSaved, setScriptSaved] = useState(false);
  const [rebuild, setRebuild] = useState<RebuildOptions>(DEFAULT_REBUILD);
  const pending = usePending();
  const locked = busy || Boolean(row.running) || pending.has(row.code); // только что запущен — ждём GitHub
  const runOf = row.running ? (state.runs.find((r) => r.active && r.codes.includes(row.code)) ?? null) : null;
  // Править сценарий и пересобирать — только пока ролик не загружен в YouTube.
  const lock = editLock(row, state.youtubeError);

  async function run(action: () => Promise<ActionResult>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await action();
      notePending(r);
      setToast({ text: r.message, ok: r.ok, undo: "undo" in r ? (r.undo as Undo | undefined) : undefined });
      if (r.ok) router.refresh();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function loadScript() {
    if (!row.scriptPath) return;
    setBusy(true);
    const r = await scriptTextAction(row.scriptPath).finally(() => setBusy(false));
    if ("scenes" in r) setScript(r as ScriptText);
    else setToast({ text: r.message, ok: false });
  }

  async function openEditor() {
    if (!row.scriptPath) return;
    setBusy(true);
    try {
      const r = await scriptForEditAction(row.scriptPath);
      if ("edit" in r) setEditing({ sha: r.sha, edit: r.edit, tags: r.edit.tags.join(", "), problems: [] });
      else setToast({ text: r.message, ok: false });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor() {
    if (!editing) return;
    const edit = { ...editing.edit, tags: parseTags(editing.tags) };
    // Та же проверка, что на сервере, — сразу, без запроса.
    const problems = checkScriptEdit(edit);
    if (problems.length) return setEditing({ ...editing, problems });
    setBusy(true);
    try {
      const r = await saveScriptAction(row.code, editing.sha, edit);
      setToast({ text: r.message, ok: r.ok });
      if (r.ok) {
        setEditing(null);
        setScript(null); // показанный текст устарел
        if ("saved" in r && r.saved) setScriptSaved(true);
      }
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption() {
    if (!row.release?.caption) return;
    setBusy(true);
    const r = await captionAction(row.release.caption.id).finally(() => setBusy(false));
    if (!("text" in r)) return setToast({ text: r.message, ok: false });
    setCaption(r.text);
    try {
      await navigator.clipboard.writeText(r.text);
      setToast({ text: "Подпись скопирована.", ok: true });
    } catch {
      setToast({ text: "Скопируйте подпись вручную — она ниже.", ok: true });
    }
  }

  // Перенос: свободный слот — сразу (с «Отменить»), занятый — обмен местами после вопроса.
  // «Разбор» — по своим слотам (вт/чт/сб 21:00): «соседний» — предыдущий и следующий из них.
  const grid = row.long ? (state.longSlotGrid ?? []) : state.slotGrid;
  const slotAt = (key: string, time: string) => grid.find((c) => c.dateKey === key && c.time === time) ?? null;
  const isCurrent = (c: SlotCell) => row.when !== null && Date.parse(c.iso) === Date.parse(row.when);
  const at = row.when ? Date.parse(row.when) : Number.NaN;
  const prev = !row.dateKey ? null : row.long ? ([...grid].reverse().find((c) => Date.parse(c.iso) < at) ?? null) : slotAt(shiftDateKey(row.dateKey, -1), row.timeLabel);
  const next = !row.dateKey ? null : row.long ? (grid.find((c) => Date.parse(c.iso) > at) ?? null) : slotAt(shiftDateKey(row.dateKey, 1), row.timeLabel);
  const watchUrl = (id: string) => (row.long ? `https://youtube.com/watch?v=${id}` : `https://youtube.com/shorts/${id}`);
  const buildTime = row.long ? "≈ 40–60 минут" : "≈ 8–10 минут";
  function moveTo(c: SlotCell) {
    if (!row.youtube || isCurrent(c)) return;
    const other = c.occupant && c.occupant !== row.code ? c.occupant : null;
    const ask = other ? `${c.dateLabel} ${c.time} занят: ${other}. Поменять местами — ${other} выйдет ${row.dateLabel} в ${row.timeLabel}?` : undefined;
    void run(() => moveVideoAction(row.youtube!.videoId, c.iso), ask);
  }
  const days: { key: string; label: string; cells: SlotCell[] }[] = [];
  // Список слотов — на три недели: дальше удобнее перетаскиванием в календаре.
  for (const c of grid.filter((x) => x.dateKey <= shiftDateKey(state.todayKey, 20))) {
    let d = days.at(-1);
    if (!d || d.key !== c.dateKey) {
      d = { key: c.dateKey, label: c.dateLabel, cells: [] };
      days.push(d);
    }
    d.cells.push(c);
  }

  const whenText = row.when
    ? `${row.stage === "published" ? "вышел" : row.whenExact ? "выход" : "ориентир"}: ${row.dateLabel} ${row.timeLabel}`
    : "время выхода неизвестно";
  const gh = `https://github.com/${state.repo}`;
  const cover = row.release?.cover ?? null;

  return (
    <aside className={`sheet stage-${row.stage}${row.hold ? ` hold${row.hold.rebuilding ? " rebuilding" : ""}` : ""}`} aria-label={`Ролик ${row.code}`}>
      <div className="sheet-head">
        <Thumb src={row.cover} video={frameOf(row)} code={row.code} className="big" />
        <div className="sheet-title">
          <span className={`badge${row.long ? " long" : ""}`}>
            {row.code}
            {row.long ? " · «Разбор» 16:9" : ""} · {row.hold ? holdLabel(row.hold) : STAGE_LABEL[row.stage]}
          </span>
          <h3>{row.title}</h3>
          <div className="muted small">
            {row.pillar} · {whenText}
          </div>
          {row.stage === "published" && row.stats && (
            <div className="views-line" title="просмотры · лайки · комментарии">
              👁 {row.stats.viewsLabel}
              {row.stats.likesLabel !== null && ` · 👍 ${row.stats.likesLabel}`}
              {row.stats.commentsLabel !== null && ` · 💬 ${row.stats.commentsLabel}`}
              {row.stats.verdict && <div className="small muted">{row.stats.ratio ? `${row.stats.ratio.toFixed(1).replace(".", ",")}× к обычному · ${row.stats.basis}` : row.stats.basis}</div>}
            </div>
          )}
          <Dots stage={row.stage} />
        </div>
        <button className="btn ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      {row.running && (
        <div className="sheet-running">
          <p>⚙ {row.running}…</p>
          {runOf?.progress && <RunProgressBar progress={runOf.progress} runId={runOf.id} />}
        </div>
      )}
      {row.flags.map((f) => (
        <p key={f} className="flag">
          ⚠ {f}
        </p>
      ))}
      {row.textsDiffer && (
        <p className="muted small">
          Тексты на YouTube отличаются от файла (правили в Studio?). Заполнение их не тронет, пока вы сами не отметите ролик в «Запуски» → «Проверить» — там видна
          разница построчно.
        </p>
      )}

      {/* До загрузки — первым делом: что не так с роликом. Уже на YouTube — ниже, у плеера. Ждущему
          пересборки проверка старой версии ни к чему. */}
      {row.release && row.stage === "video" && !row.hold && (
        <ReleaseChecks release={row.release} voice={row.voice ?? null} realPhotos={row.realPhotos ?? false} missingSecrets={state.missingSecrets} title="Перед загрузкой проверьте" />
      )}

      <section>
        <h4>Что дальше</h4>
        {row.stage === "topic" && (
          <>
            <p>Сценария ещё нет — его напишет Claude по хуку, углу подачи и фактам из плана.</p>
            <div className="btn-row">
              <button className="btn primary" disabled={locked} onClick={() => run(() => videosAction([row.code]), `Сценарий и видео для ${row.code}: Claude пишет сценарий (платно), сборка ${row.long ? buildTime : "≈ 10 минут"} в GitHub Actions. Запустить?`)}>
                Сценарий и видео
              </button>
              <button className="btn" disabled={locked} onClick={() => run(() => draftAction([row.code]), `Только сценарий для ${row.code} (Claude, платно)?`)}>
                Только сценарий
              </button>
            </div>
          </>
        )}
        {row.stage === "script" && (
          <>
            <p>Сценарий готов. Проверьте факты и соберите видео.</p>
            <div className="btn-row">
              <button className="btn primary" disabled={locked} onClick={() => run(() => videosAction([row.code]), `Собрать видео ${row.code} (${buildTime} в GitHub Actions)?`)}>
                Собрать видео
              </button>
              <a className="btn" href={`${gh}/edit/${state.branch}/video-studio/${row.scriptPath}`} target="_blank" rel="noreferrer">
                ✏️ Править на GitHub
              </a>
            </div>
          </>
        )}
        {/* Ждёт пересборки (content/rebuild.json): старую версию не грузить. Скачать её всё же можно —
            вторым планом и с предупреждением. */}
        {row.stage === "video" && row.hold && (
          <>
            <p className="flag">
              {row.hold.rebuilding ? "⚙ Пересобирается — старую версию в Studio не загружайте, новое видео появится здесь само." : "⚠ Ждёт пересборки — старую версию в Studio не загружайте."}
            </p>
            <p className="muted small">
              {row.hold.reason ? `Причина: ${row.hold.reason}. ` : ""}Как только появится релиз, собранный после {row.hold.sinceLabel}, ролик сам вернётся в «Загрузить в Studio».
            </p>
            {!row.hold.rebuilding && !lock && (
              <div className="btn-row">
                <button
                  className="btn primary"
                  disabled={locked}
                  onClick={() => run(() => rebuildAction(row.code, DEFAULT_REBUILD), `Пересобрать ${row.code} (${buildTime} в GitHub Actions)? Старая версия останется в своём релизе.`)}
                >
                  Пересобрать
                </button>
              </div>
            )}
            {row.release && (
              <details className="old-version">
                <summary>Скачать старую версию</summary>
                <p className="flag small">⚠ Это версия до пересборки{row.hold.reason ? ` (${row.hold.reason})` : ""}. Для Studio дождитесь новой.</p>
                <FilesSaver items={[{ code: row.code, release: row.release }]} subtle />
              </details>
            )}
          </>
        )}
        {row.stage === "video" &&
          !row.hold &&
          (row.release ? (
            <>
              <ol>
                <li>Скачайте видео и обложки — в именах файлов уже есть код: {row.release.mp4.name}.</li>
                <li>YouTube Studio → «Создать» → «Добавить видео» (в приложении YouTube — «+»). Ничего не заполняйте.</li>
                <li>Через пару минут на главном экране — «Найти новые загрузки»: встанут название, описание, теги и время{row.long ? ", а «Разбору» — ещё и обложка 16:9 из релиза" : ""}.</li>
              </ol>
              <FilesSaver items={[{ code: row.code, release: row.release }]} />
              <div className="btn-row">
                <a className="btn" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
                  YouTube Studio ↗
                </a>
              </div>
            </>
          ) : (
            <p>
              Видео собрано на компьютере (неделя 1), в GitHub его нет. Загрузите файл <b>{row.code}-….mp4</b> в YouTube Studio, затем на главном экране —
              «Найти новые загрузки».
            </p>
          ))}
        {row.stage === "studio" && (
          <>
            <p>Ролик в Studio, но время выхода не стоит.</p>
            {row.hasTexts ? (
              <div className="btn-row">
                <button
                  className="btn primary"
                  disabled={locked}
                  onClick={() => run(() => fillNewUploadsAction([row.code]), `Поставить ${row.code} название, описание, теги и время выхода (ближайший свободный слот)?`)}
                >
                  Поставить тексты и время
                </button>
              </div>
            ) : (
              <p className="muted small">Текстов для него нет ни в content/videos.json, ни в релизе — заполните в Studio вручную.</p>
            )}
          </>
        )}
        {row.stage === "scheduled" && (
          <>
            <p className="muted small">{row.long ? "Одно нажатие — соседний слот «Разборов» (вт/чт/сб 21:00)." : "Одно нажатие — тот же слот на соседний день."} Если там другой ролик, они поменяются местами.</p>
            <div className="move-quick">
              <button className="btn" disabled={busy || !prev} onClick={() => prev && moveTo(prev)}>
                ◀ {prev ? `${prev.dateLabel}${prev.occupant ? ` (${prev.occupant})` : ""}` : "раньше нельзя"}
              </button>
              <button className="btn" disabled={busy || !next} onClick={() => next && moveTo(next)}>
                {next ? `${next.dateLabel}${next.occupant ? ` (${next.occupant})` : ""}` : "дальше 60 дней — в Studio"} ▶
              </button>
            </div>
            <div className="btn-row">
              <button className="btn small" onClick={() => setShowSlots(!showSlots)}>
                {showSlots ? "Скрыть слоты" : "Выбрать слот"}
              </button>
            </div>
            {showSlots && (
              <div className="slots">
                {days.map((d) => (
                  <div className="slot-day" key={d.key}>
                    <span className="small muted">{d.label}</span>
                    {d.cells.map((c) => (
                      <button key={c.iso} className={`slot${c.occupant ? "" : " free"}${isCurrent(c) ? " current" : ""}`} disabled={busy || isCurrent(c)} onClick={() => moveTo(c)}>
                        {c.time} · {isCurrent(c) ? "этот" : (c.occupant ?? "свободно")}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {row.stage === "published" && row.youtube && (
          <>
            <div className="btn-row">
              <a className="btn" href={watchUrl(row.youtube.videoId)} target="_blank" rel="noreferrer">
                Смотреть ↗
              </a>
            </div>
            <FirstComment key={row.code} row={row} busy={busy} setBusy={setBusy} onToast={(text, ok) => setToast({ text, ok })} />
          </>
        )}
        {row.youtube && (
          <div className="btn-row">
            <a className="btn ghost" href={`https://studio.youtube.com/video/${row.youtube.videoId}/edit`} target="_blank" rel="noreferrer">
              Открыть в Studio ↗
            </a>
          </div>
        )}
      </section>

      {row.release && (
        <section>
          <h4>{row.hold ? "Посмотреть старую версию" : "Посмотреть"}</h4>
          <Preview mp4Id={row.release.mp4.id} poster={cover ? `/api/asset/${cover.id}/file` : row.cover} />
        </section>
      )}
      {/* Вышедший ролик уже не заменить — проверку не грузим. */}
      {row.release && (row.stage === "studio" || row.stage === "scheduled") && (
        <ReleaseChecks release={row.release} voice={row.voice ?? null} realPhotos={row.realPhotos ?? false} missingSecrets={state.missingSecrets} title="Проверка ролика" />
      )}

      {!lock && (row.stage === "script" || row.stage === "video") && (
        <section>
          <details className="rebuild">
            <summary>{row.stage === "video" ? "Пересобрать: другой голос, палитра, музыка" : "Собрать с другим голосом, палитрой, без музыки"}</summary>
            <p className="muted small">Новое видео появится в карточке вместо прежнего (прежнее останется в своём релизе). {buildTime} в GitHub Actions.</p>
            <div className="rebuild-fields">
              <label>
                Голос
                <select value={rebuild.voice} onChange={(e) => setRebuild({ ...rebuild, voice: e.target.value })}>
                  {VOICES.map((v) => (
                    <option key={v} value={v}>
                      {VOICE_LABEL[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Имя голоса
                <input placeholder="необязательно: Charon, ru-RU-SvetlanaNeural" value={rebuild.voiceName} onChange={(e) => setRebuild({ ...rebuild, voiceName: e.target.value })} />
              </label>
              <label>
                Палитра
                <select value={rebuild.theme} onChange={(e) => setRebuild({ ...rebuild, theme: e.target.value })}>
                  {THEMES.map((t) => (
                    <option key={t} value={t}>
                      {THEME_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={rebuild.music} onChange={(e) => setRebuild({ ...rebuild, music: e.target.checked })} /> Фоновая музыка
              </label>
            </div>
            <div className="btn-row">
              <button
                className="btn"
                disabled={locked}
                onClick={() => run(() => rebuildAction(row.code, rebuild), `${row.stage === "video" ? "Пересобрать" : "Собрать"} ${row.code}: ${rebuildLabel(rebuild)}? ${buildTime} в GitHub Actions.`)}
              >
                {row.stage === "video" ? "Пересобрать" : "Собрать"}
              </button>
            </div>
          </details>
        </section>
      )}

      {row.release && (
        <section>
          <h4>Файлы ролика</h4>
          {!row.long && <p className="muted small">Instagram ждёт токен EAA (проверка Meta) — пока Reels с телефона: видео, обложка 9:16 и подпись.</p>}
          {/* На этапе «видео» те же файлы — выше, в «Что дальше». */}
          {row.stage !== "video" && <FilesSaver items={[{ code: row.code, release: row.release }]} />}
          <div className="btn-row">
            {row.release.caption && (
              <button className="btn small" disabled={busy} onClick={copyCaption}>
                📋 Подпись
              </button>
            )}
            <a className="btn small ghost" href={row.release.url} target="_blank" rel="noreferrer">
              Релиз ↗
            </a>
          </div>
          {caption && <div className="caption">{caption}</div>}
        </section>
      )}

      <section>
        <h4>Из плана</h4>
        {row.hook && (
          <p>
            <b>Хук:</b> {row.hook}
          </p>
        )}
        {row.angle && (
          <p>
            <b>Угол:</b> {row.angle}
          </p>
        )}
        <details>
          <summary>Факты и источники ({row.facts.length})</summary>
          <ul className="facts">
            {row.facts.map((f, i) => (
              <li key={i}>
                {f.claim}
                <span className="source">{f.source}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {row.scriptPath && (
        <section>
          <h4>Сценарий</h4>
          {editing ? (
            <ScriptForm value={editing} busy={busy} onChange={setEditing} onSave={saveEditor} onCancel={() => setEditing(null)} />
          ) : (
            <>
              {script && (
                <div className="scenes">
                  {script.scenes.map((s, i) => (
                    <p key={i}>{s.narration}</p>
                  ))}
                </div>
              )}
              <div className="btn-row">
                {!script && (
                  <button className="btn small" disabled={busy} onClick={loadScript}>
                    Показать текст
                  </button>
                )}
                {!lock && (
                  <button className="btn small" disabled={locked} onClick={openEditor}>
                    ✏️ Править
                  </button>
                )}
                {scriptSaved && !lock && (
                  <button
                    className="btn small primary"
                    disabled={locked}
                    onClick={() => run(() => rebuildAction(row.code, DEFAULT_REBUILD), `Собрать ${row.code} по исправленному сценарию (${buildTime} в GitHub Actions)?`)}
                  >
                    {row.stage === "script" ? "Собрать видео" : "Собрать заново"}
                  </button>
                )}
              </div>
              {lock && <p className="muted small">{lock}</p>}
            </>
          )}
          <p className="small">
            <a href={`${gh}/blob/${state.branch}/video-studio/${row.scriptPath}`} target="_blank" rel="noreferrer">
              {row.scriptPath} ↗
            </a>
          </p>
        </section>
      )}

      {toast && (
        <div className={`toast${toast.ok ? "" : " err"}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => {
                const undo = toast.undo!;
                void run(() => undoMoveAction(undo));
              }}
            >
              Отменить
            </button>
          )}
          <button className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
            ✕
          </button>
        </div>
      )}
    </aside>
  );
}
