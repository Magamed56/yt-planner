"use client";
// Подсказки экрана «Статистика»: слабый старт и новые названия, лучшее время выхода, плейлисты
// рубрик. Всё посчитано на сервере (lib/insights, lib/titles); здесь — показ и кнопки.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionResult } from "@/app/actions";
import type { StatsExtras } from "@/app/stats/load";
import { applyTitleAction, playlistApplyAction, playlistAutoAction, playlistPreviewAction, titleIdeasAction, type PlaylistPreview } from "@/app/stats/actions";
import type { TimingAdvice, TimingGroup } from "@/lib/insights";
import { codesLabel, plural } from "@/lib/stages";
import type { TitleIdeaView } from "@/lib/titles";
import s from "./stats-tools.module.css";
import Thumb from "./Thumb";

const videosWord = (n: number) => `${n} ${plural(n, "ролик", "ролика", "роликов")}`;
// «по 1 ролику», «по 39 роликам»
const byVideos = (n: number) => `${n} ${plural(n, "ролику", "роликам", "роликам")}`;

// Запуск действия с подтверждением, сообщением внизу экрана и обновлением страницы.
function useRunner() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  async function run(key: string, action: () => Promise<ActionResult>, confirmText?: string): Promise<ActionResult | null> {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(key);
    try {
      const r = await action();
      setToast({ text: r.message, ok: r.ok });
      if (r.ok) router.refresh();
      return r;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setToast({ text, ok: false });
      return { ok: false, message: text };
    } finally {
      setBusy(null);
    }
  }
  const toastEl = toast && (
    <div className={`toast${toast.ok ? "" : " err"}`} role="status">
      <span>{toast.text}</span>
      <button className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
        ✕
      </button>
    </div>
  );
  return { busy, setBusy, setToast, run, toastEl };
}

// ---- слабый старт ----

export function WeakStartCard({ extras }: { extras: StatsExtras }) {
  const { weak, ideas, ideasError, titlesRunning } = extras;
  const { busy, run, toastEl } = useRunner();
  const ideasOf = new Map(ideas.map((v) => [v.code, v]));
  const askable = weak.flagged.filter((f) => f.code && !titlesRunning.includes(f.code)).map((f) => f.code!);
  // Идеи — сначала у роликов со слабым стартом, потом остальные свежие.
  const flaggedCodes = new Set(weak.flagged.map((f) => f.code));
  const shownIdeas = [...ideas.filter((v) => flaggedCodes.has(v.code)), ...ideas.filter((v) => !flaggedCodes.has(v.code))];

  const ask = (codes: string[]) =>
    run(`ask:${codes.join(",")}`, () => titleIdeasAction(codes), `Придумать новые названия для ${codesLabel(codes)}? Запустится workflow в GitHub Actions (LLM, как у сценариев) — 1–3 минуты.`);

  function apply(v: TitleIdeaView, title: string, back = false) {
    const text = back
      ? `Вернуть ${v.code} прежнее название?\n\nСейчас: «${v.title}»\nСтанет: «${title}»`
      : `Сменить название ${v.code} на YouTube?\n\nБыло: «${v.title}»\nСтанет: «${title}»\n\nПрежнее название сохранено в content/title-ideas.json — его можно вернуть кнопкой «Вернуть прежнее».`;
    void run(`apply:${v.code}`, () => applyTitleAction(v.code, v.videoId, title), text);
  }

  return (
    <section className="card wide" id="weak">
      <h2>Слабый старт</h2>
      <p className="muted small">
        Ролики, которые вышли 1–3 суток назад и набирают в сутки меньше половины обычного — медианы остальных Shorts канала за 30 дней
        {weak.baseline !== null ? ` (сейчас ≈ ${weak.baselineLabel} в сутки по ${byVideos(weak.sample)})` : ""}. Сравниваем, когда для сравнения есть хотя бы 5
        роликов. Пока ролик молодой, помочь может новое название.
      </p>
      {!weak.enough ? (
        <p className="muted small">Мало данных: нужно хотя бы 5 роликов Shorts старше суток за последние 30 дней, сейчас — {weak.sample}.</p>
      ) : weak.flagged.length === 0 ? (
        <p className="muted small">Слабых стартов нет{weak.candidates ? ` — у ${videosWord(weak.candidates)} 1–3 суток всё в норме` : ""}.</p>
      ) : (
        <>
          <ul className={s.list}>
            {weak.flagged.map((f) => {
              const running = f.code ? titlesRunning.includes(f.code) : false;
              return (
                <li key={f.videoId} className={s.item}>
                  <a className={s.head} href={`https://youtube.com/shorts/${f.videoId}`} target="_blank" rel="noreferrer">
                    <Thumb src={f.thumbnailUrl} code={f.code ?? "—"} />
                    <span className={s.title}>
                      <b>{f.title}</b>
                      <span className="muted small">{[f.code, f.pillarTitle, `${f.ageLabel} с выхода`].filter(Boolean).join(" · ")}</span>
                      <span className="small">
                        {f.perDayLabel} в сутки — <span className={s.low}>{f.percent} % от обычного</span>
                      </span>
                    </span>
                  </a>
                  <div className={s.row}>
                    {!f.code ? (
                      <span className="muted small">Не из плана — названия подбираются только для роликов плана.</span>
                    ) : running ? (
                      <span className="muted small">⚙ Подбираем названия — обновите страницу через пару минут.</span>
                    ) : (
                      <button className="btn small" disabled={busy !== null} onClick={() => ask([f.code!])}>
                        {ideasOf.has(f.code) ? "Ещё варианты" : "Придумать названия"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {askable.length > 1 && (
            <div className="btn-row">
              <button className="btn small" disabled={busy !== null} onClick={() => ask(askable)}>
                Придумать для всех ({askable.length})
              </button>
            </div>
          )}
        </>
      )}

      {shownIdeas.length > 0 && (
        <>
          <h3 className={s.sub}>Идеи названий</h3>
          {shownIdeas.map((v) => (
            <div key={v.code} className={s.block}>
              <h3>
                {v.code} · {v.title}
              </h3>
              <p className="muted small">
                Придуманы {v.atLabel}. Название тогда: «{v.before}».
              </p>
              {v.ideas.length ? (
                <ul className={s.ideas}>
                  {v.ideas.map((t) => (
                    <li key={t}>
                      <span>{t}</span>
                      <button className="btn small primary" disabled={busy !== null} onClick={() => apply(v, t)}>
                        Применить
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Одна из идей уже стоит на YouTube.</p>
              )}
              {v.before && v.before !== v.title && (
                <div className="btn-row">
                  <button className="btn small ghost" disabled={busy !== null} onClick={() => apply(v, v.before, true)}>
                    Вернуть прежнее
                  </button>
                </div>
              )}
            </div>
          ))}
          <p className="muted small">Название меняется сразу (videos.update — 50 единиц квоты); описание, теги и язык ролика остаются прежними.</p>
        </>
      )}
      {ideasError && <p className="error-text small">content/title-ideas.json: {ideasError}</p>}
      {toastEl}
    </section>
  );
}

// ---- лучшее время выхода ----

function Bars({ groups }: { groups: TimingGroup[] }) {
  return (
    <ol className="ranks">
      {groups.map((g) => (
        <li key={g.key} className={g.median === null ? "none" : ""}>
          <span className="rank-name">
            {g.label}
            <small>{g.videos ? videosWord(g.videos) : "нет роликов"}</small>
          </span>
          <span className="rank-bar" aria-hidden="true">
            <i style={{ width: `${g.share * 100}%` }} />
          </span>
          <span className="rank-val">{g.medianLabel}</span>
        </li>
      ))}
    </ol>
  );
}

function Advice({ a }: { a: TimingAdvice }) {
  return (
    <p className="small">
      {a.text}
      <span className={`${s.badge}${a.confidence === "high" ? ` ${s.high}` : a.confidence === "medium" ? ` ${s.medium}` : ""}`}>{a.confidenceLabel}</span>
    </p>
  );
}

export function TimingCard({ extras }: { extras: StatsExtras }) {
  const { timing } = extras;
  return (
    <section className="card" id="timing">
      <h2>Лучшее время выхода</h2>
      <p className="muted small">
        Медиана просмотров в сутки у роликов старше 2 суток ({timing.eligible}) — по слотам канала и дням недели в его часовом поясе.
      </p>
      <h3 className={s.sub}>Слоты</h3>
      <Bars groups={timing.slots} />
      <Advice a={timing.slotAdvice} />
      {timing.offSlot > 0 && <p className="muted small">Вышли не в слот (±1 ч): {timing.offSlot} — в сравнение слотов не попали.</p>}
      <h3 className={s.sub}>Дни недели</h3>
      <Bars groups={timing.weekdays} />
      <Advice a={timing.weekdayAdvice} />
      <p className="muted small">Это подсказка: расписание само не меняется. Слоты — в channel.json (schedule.publishTimesLocal), сейчас {extras.slotTimes.join(" и ")}.</p>
    </section>
  );
}

// ---- плейлисты рубрик ----

export function PlaylistsCard({ extras }: { extras: StatsExtras }) {
  const { playlists } = extras;
  const { busy, setBusy, setToast, run, toastEl } = useRunner();
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [auto, setAuto] = useState(playlists.auto);

  async function check() {
    setBusy("check");
    try {
      const r = await playlistPreviewAction();
      if ("create" in r) setPreview(r as PlaylistPreview);
      else setToast({ text: r.message, ok: false });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview) return;
    const what = [
      preview.create.length ? `создать ${preview.create.length} ${plural(preview.create.length, "плейлист", "плейлиста", "плейлистов")}` : "",
      preview.addCount ? `добавить ${videosWord(preview.addCount)}` : "",
    ]
      .filter(Boolean)
      .join(" и ");
    const r = await run("apply", () => playlistApplyAction(), `Плейлисты рубрик: ${what}? Квота — ${preview.quota}.`);
    if (r) setPreview(null);
  }

  async function toggleAuto(next: boolean) {
    setAuto(next);
    const r = await run("auto", () => playlistAutoAction(next));
    if (!r?.ok) setAuto(!next);
  }

  return (
    <section className="card" id="playlists">
      <h2>Плейлисты рубрик</h2>
      <p className="muted small">
        На каждую рубрику плана — свой публичный плейлист (например, «Космос — {playlists.channelName}»): досмотрел ролик — YouTube предлагает следующий из той же темы. В
        плейлисты попадают вышедшие и запланированные ролики; повторный запуск добавляет только новые.
      </p>
      {playlists.count > 0 && <p className="muted small">Плейлистов в настройке: {playlists.count}.</p>}
      <div className="btn-row">
        <button className="btn" disabled={busy !== null} onClick={check}>
          {busy === "check" ? "Проверяю…" : "Проверить"}
        </button>
        {preview && (
          <button className="btn primary" disabled={busy !== null || preview.inserts === 0} onClick={apply}>
            Применить
          </button>
        )}
      </div>
      {preview && (
        <div className={s.preview}>
          <p>{preview.create.length ? `Будет создано: ${preview.create.map((t) => `«${t}»`).join(", ")}.` : "Новых плейлистов не будет."}</p>
          <p>{preview.addCount ? `Будет добавлено: ${videosWord(preview.addCount)}.` : "Добавлять нечего — все ролики уже в своих плейлистах."}</p>
          {preview.add.length > 0 && (
            <ul>
              {preview.add.map((a) => (
                <li key={a.title}>
                  {a.title}: {codesLabel(a.codes)}
                </li>
              ))}
            </ul>
          )}
          {preview.already > 0 && <p className="muted small">Уже в плейлистах: {videosWord(preview.already)}.</p>}
          {preview.inserts > 0 && (
            <p className="small">
              Квота: {preview.quota} (по 50 за плейлист и за ролик; не больше {preview.maxInserts} вставок за раз).
            </p>
          )}
          {preview.deferred > 0 && <p className="small">Ещё {videosWord(preview.deferred)} не влезли в лимит — добавятся следующим «Применить».</p>}
        </div>
      )}
      <label className={s.check}>
        <input type="checkbox" checked={auto} disabled={busy !== null} onChange={(e) => void toggleAuto(e.target.checked)} />
        Добавлять новые ролики сами — при «Найти новые загрузки» (+50 единиц квоты на ролик)
      </label>
      {playlists.error && <p className="error-text small">Настройка PANEL_PLAYLISTS: {playlists.error}</p>}
      {toastEl}
    </section>
  );
}
