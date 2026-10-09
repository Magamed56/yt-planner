"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  checkKeysAction,
  draftAction,
  fillApplyAction,
  fillPreviewAction,
  runAutopilotAction,
  saveAutopilotAction,
  videosAction,
  type ActionResult,
  type FillPreview,
} from "@/app/actions";
import { pickCleanup } from "@/lib/ops";
import type { AutopilotSettings, PanelState, RunInfo } from "@/lib/state";
import { STAGE_LABEL, codesLabel } from "@/lib/stages";
import AppShell from "./AppShell";
import RunProgressBar from "./RunProgressBar";

const KEEP_OPTIONS = [0, 3, 7, 14, 30, 60, 90, 180];
const sameSettings = (a: AutopilotSettings, b: AutopilotSettings) =>
  a.enabled === b.enabled && a.days === b.days && a.retryFailed === b.retryFailed && a.keepReleaseDays === b.keepReleaseDays && a.scriptReserve === b.scriptReserve;
const mbText = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_048_576))} МБ`;

// Цвет точки — итог запуска: идёт, успех, ошибка, отменён.
const runColor = (r: RunInfo) =>
  r.active ? "var(--accent)" : r.conclusion === "success" ? "var(--ok)" : r.conclusion === "failure" ? "var(--error)" : "var(--dim)";
const runIcon = (r: RunInfo) => (
  <span
    title={r.active ? "идёт" : (r.conclusion ?? "")}
    style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: runColor(r) }}
  />
);

export default function RunsView({ state }: { state: PanelState }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const upcoming = state.rows.filter((r) => r.stage === "topic" || r.stage === "script").slice(0, 12);
  const [picked, setPicked] = useState<string[]>(() => upcoming.filter((r) => !r.running).slice(0, 2).map((r) => r.code));
  const pickedTopics = picked.filter((c) => upcoming.find((r) => r.code === c)?.stage === "topic");

  const [preview, setPreview] = useState<FillPreview | null>(null);
  const [fillPicked, setFillPicked] = useState<string[]>([]);
  const [auto, setAuto] = useState(state.autopilot);
  const autoChanged = !sameSettings(auto, state.autopilot);
  // Что удалит уборка при выбранном сроке — считается тут же, до «Сохранить» (время — серверное).
  const cleanup = pickCleanup(state.releaseVideos, auto.keepReleaseDays, Date.parse(state.generatedAt));
  const keepOptions = KEEP_OPTIONS.includes(auto.keepReleaseDays) ? KEEP_OPTIONS : [...KEEP_OPTIONS, auto.keepReleaseDays].sort((a, b) => a - b);

  const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  async function run(key: string, action: () => Promise<ActionResult>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    try {
      const r = await action();
      setToast({ text: r.message, ok: r.ok });
      if (r.ok) router.refresh();
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy("fill");
    try {
      const r = await fillPreviewAction();
      if ("items" in r) {
        setPreview(r as FillPreview);
        // По умолчанию — только впервые получающие время; правку уже заполненных текстов отмечают руками.
        setFillPicked((r as FillPreview).items.filter((i) => i.needsTime).map((i) => i.code));
      } else setToast({ text: r.message, ok: false });
    } finally {
      setBusy(null);
    }
  }

  function apply() {
    if (!preview) return;
    const rewrites = preview.items.filter((i) => fillPicked.includes(i.code) && i.textsChanged && !i.needsTime).map((i) => i.code);
    const warn = rewrites.length ? `\n\nВнимание: у ${codesLabel(rewrites)} перепишутся уже заполненные тексты на YouTube.` : "";
    void run("fill", () => fillApplyAction(fillPicked), `Поставить тексты и время выхода: ${codesLabel(fillPicked)}?${warn}`);
  }

  const missingKeys = state.missingSecrets;

  return (
    <AppShell
      active="runs"
      updated={state.updatedLabel}
      activeRuns={state.runs.filter((r) => r.active).length}
      runwayDays={state.runwayDays}
      runwayLabel={state.scheduleEndLabel}
    >
      <main className="page">
        <section className="card" id="produce">
          <h2>Сценарии и видео</h2>
          <p className="muted small">
            Ближайшие темы без видео. «Сделать видео» пишет недостающие сценарии (Claude, по хуку и фактам плана) и собирает ролики в релиз — около 8–10
            минут на ролик в GitHub Actions. Видео потом скачивается из карточки ролика.
          </p>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={!picked.length || busy !== null}
              onClick={() => run("produce", () => videosAction(picked), `Сделать видео: ${codesLabel(picked)}? Сценарии пишет Claude (платно), сборка ≈ 8–10 минут на ролик.`)}
            >
              Сделать видео ({picked.length})
            </button>
            <button
              className="btn"
              disabled={!pickedTopics.length || busy !== null}
              onClick={() => run("produce", () => draftAction(pickedTopics), `Только сценарии: ${codesLabel(pickedTopics)}? Это платно (Claude).`)}
            >
              Только сценарии ({pickedTopics.length})
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="muted">У всех тем плана уже есть видео.</p>
          ) : (
            <div className="pick">
              {upcoming.map((r) => (
                <label key={r.code}>
                  <input type="checkbox" checked={picked.includes(r.code)} disabled={Boolean(r.running)} onChange={() => setPicked(toggle(picked, r.code))} />
                  <b>{r.code}</b>
                  <span>{r.title}</span>
                  <span className="sub">
                    {r.dateLabel} {r.timeLabel} · {STAGE_LABEL[r.stage]}
                    {r.running ? ` · ⚙ ${r.running}` : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="card" id="fill">
          <h2>YouTube: тексты и время выхода</h2>
          <p className="muted small">
            Подробная проверка: «Проверить» ничего не меняет — показывает разницу построчно; «Применить» сразу ставит тексты и время отмеченным роликам (тем же
            кодом, что youtube-fill), уже стоящее время не сдвигается. Новые загрузки проще заполнить кнопкой «Найти новые загрузки» на главном экране.
          </p>
          <button className="btn" onClick={check} disabled={busy !== null}>
            {busy === "fill" ? "Проверяю…" : "Проверить"}
          </button>
          {preview && (
            <>
              {preview.items.length === 0 ? (
                <p>Заполнять нечего — на YouTube всё как в файлах.</p>
              ) : (
                <div className="pick">
                  {preview.items.map((it) => (
                    <label key={it.code}>
                      <input type="checkbox" checked={fillPicked.includes(it.code)} onChange={() => setFillPicked(toggle(fillPicked, it.code))} />
                      <b>{it.code}</b>
                      <span>{it.title}</span>
                      <span className="sub">
                        {it.needsTime ? `выход: ${it.whenLabel}` : it.kept ? `время уже стоит: ${it.whenLabel}` : "время не трогаем"}
                        {it.textsChanged && (it.needsTime ? " · тексты из файла" : " · ⚠ перепишет уже заполненные тексты")}
                        {it.changes.length > 0 && !it.needsTime && (
                          <ul className="changes">
                            {it.changes.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="muted small">
                {[
                  preview.upToDate.length ? `уже в порядке: ${codesLabel(preview.upToDate)}` : "",
                  preview.missing.length ? `ещё не загружены: ${codesLabel(preview.missing)}` : "",
                  preview.pending.length ? `ещё обрабатываются: ${codesLabel(preview.pending)}` : "",
                  preview.duplicates.length ? `загружены дважды: ${codesLabel(preview.duplicates)}` : "",
                  preview.broken.length ? `загрузка не удалась: ${codesLabel(preview.broken)}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {preview.items.length > 0 && (
                <button className="btn primary" disabled={!fillPicked.length || busy !== null} onClick={apply}>
                  Применить ({fillPicked.length})
                </button>
              )}
            </>
          )}
        </section>

        <section className="card" id="autopilot">
          <h2>Автопилот</h2>
          <p className="muted small">
            Раз в день (около 06:00 МСК) смотрит ролики, которые выходят в ближайшие дни: недостающим пишет сценарии и собирает видео. В Studio не грузит — напоминает
            в очереди. За раз — не больше 6 роликов (бесплатный Gemini TTS ~10 озвучек в сутки).
          </p>
          <div className="field">
            <label>
              <input type="checkbox" checked={auto.enabled} onChange={(e) => setAuto({ ...auto, enabled: e.target.checked })} /> Включён
            </label>
            <label>
              Готовить за{" "}
              <select value={auto.days} onChange={(e) => setAuto({ ...auto, days: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>{" "}
              дн. до выхода
            </label>
            <label>
              Запас сценариев{" "}
              <select value={auto.scriptReserve} onChange={(e) => setAuto({ ...auto, scriptReserve: Number(e.target.value) })}>
                {Array.from({ length: 11 }, (_, n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "нет" : n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">
            Запас сценариев: у ближайших N тем без видео сценарий пишется заранее (Claude, платно) — его можно проверить и поправить в карточке ролика до сборки.
          </p>
          <div className="field">
            <label>
              <input type="checkbox" checked={auto.retryFailed} onChange={(e) => setAuto({ ...auto, retryFailed: e.target.checked })} /> Повторять упавшие сборки
            </label>
            <label>
              Хранить видео в релизах{" "}
              <select value={auto.keepReleaseDays} onChange={(e) => setAuto({ ...auto, keepReleaseDays: Number(e.target.value) })}>
                {keepOptions.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "всегда" : `${d} дн. после выхода`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">
            Это работает и при выключенном автопилоте. Повтор: запуск, упавший за последние сутки, перезапускается один раз (весь — готовые в нём ролики соберутся
            заново). Уборка: у вышедших на YouTube роликов из релиза удаляется только mp4 — обложки, субтитры и тексты остаются; релизы невышедших не трогаются.
            Reels с телефона выкладывайте до удаления.
          </p>
          {auto.keepReleaseDays > 0 && (
            <p className="small">
              {cleanup.length
                ? `Сейчас удалилось бы видео: ${codesLabel([...new Set(cleanup.map((f) => f.code))], 20)} — файлов ${cleanup.length}, ${mbText(cleanup.reduce((n, f) => n + f.size, 0))}.`
                : `Сейчас удалять нечего: видео роликов, вышедших больше ${auto.keepReleaseDays} дн. назад, в релизах нет.`}
              {state.youtubeError ? " YouTube недоступен — уборка ждёт, пока он ответит." : ""}
            </p>
          )}
          <div className="btn-row">
            <button className="btn primary" disabled={!autoChanged || busy !== null} onClick={() => run("auto", () => saveAutopilotAction(auto))}>
              Сохранить
            </button>
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "auto",
                  runAutopilotAction,
                  `Проверить сейчас и сделать то, что сделал бы автопилот (по сохранённым настройкам): недостающие видео${state.autopilot.scriptReserve ? ", запас сценариев" : ""}${state.autopilot.retryFailed ? ", повтор упавших сборок" : ""}${state.autopilot.keepReleaseDays ? ", уборку видео из релизов" : ""}?`,
                )
              }
            >
              Запустить сейчас
            </button>
          </div>
          {state.autopilotLast && (
            <p className="muted small">
              Последний раз: {state.autopilotLast.atLabel} — {state.autopilotLast.action}
              {state.autopilotLast.note ? `: ${state.autopilotLast.note}` : ""}
            </p>
          )}
        </section>

        <section className="card" id="runs">
          <h2>Запуски в GitHub Actions</h2>
          {state.runs.length === 0 ? (
            <p className="muted">Запусков пока не было.</p>
          ) : (
            <div className="runs">
              {state.runs.slice(0, 15).map((r) => (
                <div className="run" key={r.id}>
                  <span>{runIcon(r)}</span>
                  <span>
                    {r.title} <span className="when">· {r.createdLabel}</span>
                  </span>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    лог ↗
                  </a>
                  {r.active && r.progress && <RunProgressBar progress={r.progress} />}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card" id="keys">
          <h2>Ключи в GitHub</h2>
          {missingKeys === null ? (
            <p className="muted small">Не видно, какие секреты заданы: дайте токену панели право Secrets: Read.</p>
          ) : missingKeys.length ? (
            <p>
              Нет: {missingKeys.join(", ")}.{" "}
              <a href={`https://github.com/${state.repo}/settings/secrets/actions`} target="_blank" rel="noreferrer">
                Добавить ↗
              </a>
            </p>
          ) : (
            <p className="muted small">Все нужные секреты заданы.</p>
          )}
          <button className="btn" disabled={busy !== null} onClick={() => run("keys", checkKeysAction)}>
            Проверка ключей
          </button>
        </section>
      </main>
      {toast && (
        <div className={`toast${toast.ok ? "" : " err"}`} role="status">
          <span>{toast.text}</span>
          <button className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
            ✕
          </button>
        </div>
      )}
    </AppShell>
  );
}
