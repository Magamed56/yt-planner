"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  captionAction,
  draftAction,
  fillNewUploadsAction,
  moveVideoAction,
  rebuildAction,
  saveScriptAction,
  scriptForEditAction,
  scriptTextAction,
  undoMoveAction,
  videosAction,
  type ActionResult,
  type ScriptText,
} from "@/app/actions";
import { DEFAULT_REBUILD, editLock, rebuildLabel, THEME_LABEL, THEMES, VOICE_LABEL, VOICES, type RebuildOptions } from "@/lib/rebuild";
import { checkScriptEdit, parseTags, SCRIPT_LIMITS, type SceneEdit, type ScriptEdit } from "@/lib/script-edit";
import type { PanelState, Row, SlotCell } from "@/lib/state";
import { STAGE_LABEL, shiftDateKey } from "@/lib/stages";
import Dots from "./Dots";
import SaveToPhone from "./SaveToPhone";
import Thumb from "./Thumb";

type Undo = { videoId: string; publishAt: string }[];
type Editing = { sha: string; edit: ScriptEdit; tags: string; problems: string[] };

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} МБ`;

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
  const locked = busy || Boolean(row.running);
  // Править сценарий и пересобирать — только пока ролик не загружен в YouTube.
  const lock = editLock(row, state.youtubeError);

  async function run(action: () => Promise<ActionResult>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await action();
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
  const slotAt = (key: string, time: string) => state.slotGrid.find((c) => c.dateKey === key && c.time === time) ?? null;
  const prev = row.dateKey ? slotAt(shiftDateKey(row.dateKey, -1), row.timeLabel) : null;
  const next = row.dateKey ? slotAt(shiftDateKey(row.dateKey, 1), row.timeLabel) : null;
  const isCurrent = (c: SlotCell) => row.when !== null && Date.parse(c.iso) === Date.parse(row.when);
  function moveTo(c: SlotCell) {
    if (!row.youtube || isCurrent(c)) return;
    const other = c.occupant && c.occupant !== row.code ? c.occupant : null;
    const ask = other ? `${c.dateLabel} ${c.time} занят: ${other}. Поменять местами — ${other} выйдет ${row.dateLabel} в ${row.timeLabel}?` : undefined;
    void run(() => moveVideoAction(row.youtube!.videoId, c.iso), ask);
  }
  const days: { key: string; label: string; cells: SlotCell[] }[] = [];
  for (const c of state.slotGrid) {
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
    <aside className={`sheet stage-${row.stage}`} aria-label={`Ролик ${row.code}`}>
      <div className="sheet-head">
        <Thumb src={row.cover} code={row.code} className="big" />
        <div className="sheet-title">
          <span className="badge">
            {row.code} · {STAGE_LABEL[row.stage]}
          </span>
          <h3>{row.title}</h3>
          <div className="muted small">
            {row.pillar} · {whenText}
          </div>
          <Dots stage={row.stage} />
        </div>
        <button className="btn ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      {row.running && <p>⚙ {row.running}…</p>}
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

      <section>
        <h4>Что дальше</h4>
        {row.stage === "topic" && (
          <>
            <p>Сценария ещё нет — его напишет Claude по хуку, углу подачи и фактам из плана.</p>
            <div className="btn-row">
              <button className="btn primary" disabled={locked} onClick={() => run(() => videosAction([row.code]), `Сценарий и видео для ${row.code}: Claude пишет сценарий (платно), сборка ≈ 10 минут в GitHub Actions. Запустить?`)}>
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
              <button className="btn primary" disabled={locked} onClick={() => run(() => videosAction([row.code]), `Собрать видео ${row.code} (≈ 8–10 минут в GitHub Actions)?`)}>
                Собрать видео
              </button>
              <a className="btn" href={`${gh}/edit/${state.branch}/video-studio/${row.scriptPath}`} target="_blank" rel="noreferrer">
                ✏️ Править на GitHub
              </a>
            </div>
          </>
        )}
        {row.stage === "video" &&
          (row.release ? (
            <>
              <ol>
                <li>Скачайте видео — имя файла уже с кодом: {row.release.mp4.name}.</li>
                <li>YouTube Studio → «Создать» → «Добавить видео» (в приложении YouTube — «+»). Ничего не заполняйте.</li>
                <li>Через пару минут на главном экране — «Найти новые загрузки»: встанут название, описание, теги и время.</li>
              </ol>
              <div className="btn-row">
                <a className="btn primary" href={`/api/asset/${row.release.mp4.id}`}>
                  ⬇ Видео · {mb(row.release.mp4.size)}
                </a>
                <a className="btn" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
                  YouTube Studio ↗
                </a>
              </div>
              <SaveToPhone id={row.release.mp4.id} name={row.release.mp4.name} size={row.release.mp4.size} what="видео" />
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
              <p className="muted small">Текстов для него нет (ролик собран не через Actions) — заполните в Studio вручную.</p>
            )}
          </>
        )}
        {row.stage === "scheduled" && (
          <>
            <p className="muted small">Одно нажатие — тот же слот на соседний день. Если там другой ролик, они поменяются местами.</p>
            <div className="move-quick">
              <button className="btn" disabled={busy || !prev} onClick={() => prev && moveTo(prev)}>
                ◀ {prev ? `${prev.dateLabel}${prev.occupant ? ` (${prev.occupant})` : ""}` : "раньше нельзя"}
              </button>
              <button className="btn" disabled={busy || !next} onClick={() => next && moveTo(next)}>
                {next ? `${next.dateLabel}${next.occupant ? ` (${next.occupant})` : ""}` : "дальше 2 недель — в Studio"} ▶
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
          <div className="btn-row">
            <a className="btn" href={`https://youtube.com/shorts/${row.youtube.videoId}`} target="_blank" rel="noreferrer">
              Смотреть ↗
            </a>
          </div>
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
          <h4>Посмотреть</h4>
          <Preview mp4Id={row.release.mp4.id} poster={cover ? `/api/asset/${cover.id}` : row.cover} />
        </section>
      )}

      {!lock && (row.stage === "script" || row.stage === "video") && (
        <section>
          <details className="rebuild">
            <summary>{row.stage === "video" ? "Пересобрать: другой голос, палитра, музыка" : "Собрать с другим голосом, палитрой, без музыки"}</summary>
            <p className="muted small">Новое видео появится в карточке вместо прежнего (прежнее останется в своём релизе). ≈ 8–10 минут в GitHub Actions.</p>
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
                onClick={() => run(() => rebuildAction(row.code, rebuild), `${row.stage === "video" ? "Пересобрать" : "Собрать"} ${row.code}: ${rebuildLabel(rebuild)}? ≈ 8–10 минут в GitHub Actions.`)}
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
          <p className="muted small">Instagram ждёт токен EAA (проверка Meta) — пока Reels с телефона: видео, обложка и подпись.</p>
          <div className="btn-row">
            <a className="btn small" href={`/api/asset/${row.release.mp4.id}`}>
              ⬇ Видео
            </a>
            {cover && (
              <a className="btn small" href={`/api/asset/${cover.id}`}>
                ⬇ Обложка Reels
              </a>
            )}
            {row.release.thumb && (
              <a className="btn small" href={`/api/asset/${row.release.thumb.id}`}>
                ⬇ Обложка YouTube
              </a>
            )}
            {row.release.caption && (
              <button className="btn small" disabled={busy} onClick={copyCaption}>
                📋 Подпись
              </button>
            )}
            <a className="btn small ghost" href={row.release.url} target="_blank" rel="noreferrer">
              Релиз ↗
            </a>
          </div>
          {/* На телефоне — сразу в «Фото» (кнопки видны только там, где можно делиться файлами). */}
          {row.stage !== "video" && <SaveToPhone id={row.release.mp4.id} name={row.release.mp4.name} size={row.release.mp4.size} what="видео" />}
          {cover && <SaveToPhone id={cover.id} name={cover.name} size={cover.size} what="обложку Reels" />}
          {row.release.thumb && <SaveToPhone id={row.release.thumb.id} name={row.release.thumb.name} size={row.release.thumb.size} what="обложку YouTube" />}
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
                    onClick={() => run(() => rebuildAction(row.code, DEFAULT_REBUILD), `Собрать ${row.code} по исправленному сценарию (≈ 8–10 минут в GitHub Actions)?`)}
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
