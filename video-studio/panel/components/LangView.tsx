"use client";
// Канал на другом языке: ролики из релизов (свежие коды первыми) — видео и обложку на телефон,
// название, описание, теги и подпись Reels — в буфер одним нажатием. Выкладывает владелец сам:
// у панели нет ключа YouTube этого канала, расписания и статистики здесь нет.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { captionAction } from "@/app/actions";
import type { SaveItem } from "@/lib/downloads";
import type { LangPageData } from "@/lib/lang-videos";
import { codesLabel, plural } from "@/lib/stages";
import AppShell from "./AppShell";
import FilesSaver from "./FilesSaver";
import Thumb from "./Thumb";
import s from "./lang.module.css";

type Video = LangPageData["videos"][number];

// Текст в буфер. Готовый — сразу. Тот, что ещё грузится с сервера (подпись Instagram), — через
// ClipboardItem с обещанием: Safari на iPhone пишет в буфер только сразу после касания и иначе
// отказал бы, пока ждём ответ. Не вышло — false: покажем текст, чтобы скопировать руками.
async function writeClipboard(text: string | Promise<string>): Promise<boolean> {
  try {
    if (typeof text === "string") {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
        blob.catch(() => {}); // ошибку сервера покажет вызывающий
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
        return true;
      } catch {
        // браузер не принял обещание — ниже обычным способом
      }
    }
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}

const releaseOf = (v: Video): SaveItem => ({ code: v.file, release: { mp4: v.mp4, cover: v.cover, thumb: v.thumb } });
const coverSrc = (v: Video) => (v.cover ? `/api/asset/${v.cover.id}/file` : v.thumb ? `/api/asset/${v.thumb.id}/file` : null);

function VideoCard({ v, onCopy, manual }: { v: Video; onCopy: (key: string, what: string, text: string | (() => Promise<string>)) => void; manual: { what: string; text: string } | null }) {
  const item = releaseOf(v);
  const t = v.texts;
  return (
    <article className={`card ${s.video}`}>
      <div className={s.head}>
        <Thumb src={coverSrc(v)} video={`/api/asset/${v.mp4.id}/file`} code={v.code} className={s.cover} />
        <div className={s.info}>
          <div className={s.meta}>
            <span className="badge accent">{v.file}</span>
            <span className="small muted">собран {v.builtLabel}</span>
          </div>
          <h3 className={s.title}>{v.title}</h3>
          <Link href={`/?v=${v.code}`} className="small">
            Русский оригинал: {v.code} →
          </Link>
        </div>
      </div>

      {/* Главное — видео в «Фото»; остальное — кнопки второго плана: тексты YouTube, затем Reels. */}
      <div className={s.main}>
        <FilesSaver items={[item]} fixed={["video"]} label="Видео" compact />
      </div>

      <div className={s.group}>
        <span className={s.groupLabel}>📋 Скопировать для YouTube</span>
        <div className={s.grid}>
          <button className="btn small" aria-label="Скопировать название" onClick={() => onCopy(v.file, "название", t?.title ?? v.title)}>
            Название
          </button>
          {t?.description && (
            <button className="btn small" aria-label="Скопировать описание" onClick={() => onCopy(v.file, "описание", t.description)}>
              Описание
            </button>
          )}
          {t && t.tags.length > 0 && (
            <button className="btn small" aria-label="Скопировать теги" onClick={() => onCopy(v.file, "теги", t.tags.join(", "))}>
              Теги
            </button>
          )}
        </div>
      </div>
      {(v.cover || v.caption) && (
        <div className={s.group}>
          <span className={s.groupLabel}>Для Instagram Reels</span>
          <div className={`${s.grid} ${s.two}`}>
            {v.cover && <FilesSaver items={[item]} fixed={["cover"]} label="Обложка" compact subtle />}
            {v.caption && (
              <button
                className="btn small"
                aria-label="Скопировать подпись Instagram"
                onClick={() =>
                  onCopy(v.file, "подпись Instagram", () =>
                    captionAction(v.caption!.id).then((r) => {
                      if ("text" in r) return r.text;
                      throw new Error(r.message);
                    }),
                  )
                }
              >
                📋 Подпись
              </button>
            )}
          </div>
        </div>
      )}
      {manual && (
        <div className={s.manual}>
          <p className="small flag">Не скопировалось ({manual.what}) — выделите текст и скопируйте:</p>
          <div className="caption">{manual.text}</div>
        </div>
      )}

      <details className={s.more}>
        <summary>Тексты для Studio и все файлы</summary>
        {t ? (
          <dl className={s.texts}>
            <dt>Название</dt>
            <dd>{t.title}</dd>
            {t.description && (
              <>
                <dt>Описание</dt>
                <dd className="caption">{t.description}</dd>
              </>
            )}
            {t.tags.length > 0 && (
              <>
                <dt>Теги (Studio на компьютере → «Теги»)</dt>
                <dd>{t.tags.join(", ")}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="small muted">Текстов в релизе нет — возьмите их из description.txt на GitHub.</p>
        )}
        <FilesSaver items={[item]} />
        <div className="btn-row">
          <a className="btn small ghost" href={v.url} target="_blank" rel="noreferrer">
            Релиз ↗
          </a>
        </div>
      </details>
    </article>
  );
}

export default function LangView({ data }: { data: LangPageData }) {
  const { channel, videos } = data;
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [manual, setManual] = useState<{ key: string; what: string; text: string } | null>(null);
  // Подписи Instagram, уже взятые с сервера: второе нажатие копирует сразу.
  const loaded = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function show(text: string, ok: boolean) {
    setToast({ text, ok });
    if (timer.current) clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setToast(null), 2500);
  }

  async function copy(key: string, what: string, source: string | (() => Promise<string>)) {
    const id = `${key}:${what}`;
    const ready = typeof source === "string" ? source : (loaded.current.get(id) ?? null);
    const pending = ready ?? (source as () => Promise<string>)();
    const copied = await writeClipboard(pending);
    let text: string;
    try {
      text = await pending;
    } catch (e) {
      return show(e instanceof Error ? e.message : String(e), false);
    }
    loaded.current.set(id, text);
    if (copied) {
      setManual(null);
      show(`Скопировано: ${what} (${key}).`, true);
    } else {
      setManual({ key, what, text });
      show("Телефон не дал скопировать — текст показан в карточке.", false);
    }
  }

  const count = videos.length;
  return (
    <AppShell active={`lang:${data.lang}`} updated={data.shell.updated} generatedAt={data.shell.generatedAt} activeRuns={data.shell.activeRuns} activeIds={data.shell.activeIds}>
      <main className="page">
        <div className="page-head titled">
          <div>
            <h1>{channel.name}</h1>
            <span className="small muted">
              {channel.label}
              {channel.handle ? ` · @${channel.handle}` : ""} · {count ? `${count} ${plural(count, "ролик", "ролика", "роликов")} в релизах` : "роликов пока нет"}
            </span>
          </div>
          <div className="actions">
            {channel.youtube && (
              <a className="btn small" href={channel.youtube} target="_blank" rel="noreferrer">
                Канал ↗
              </a>
            )}
            <a className="btn small ghost" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
              YouTube Studio ↗
            </a>
          </div>
        </div>

        {data.langs.length > 1 && (
          <nav className={`chips ${s.langs}`} aria-label="Языки">
            {data.langs.map((l) => (
              <Link key={l.code} href={`/lang/${l.code}`} className={`chip${l.code === data.lang ? " active" : ""}`}>
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        {channel.placeholder && (
          <div className="notice warn">
            <span>
              Канал ещё не создан или не настроен: пришлите название и @адрес — заменим заготовку
              <span className="small muted"> ({channel.file})</span>
            </span>
          </div>
        )}
        {data.running.map((r) => (
          <div key={r.url} className="notice info">
            <span>
              ⚙ {r.codes.length > 1 ? "Собираются" : "Собирается"} {r.codes.length ? codesLabel(r.codes) : "ролик"} (запуск {r.createdLabel}) — появятся здесь сами, ≈ 10 минут на ролик.{" "}
              <a href={r.url} target="_blank" rel="noreferrer">
                Запуск ↗
              </a>
            </span>
          </div>
        ))}
        {data.failed && (
          <div className="notice error">
            <span>
              Последняя сборка{data.failed.codes.length ? ` ${codesLabel(data.failed.codes)}` : ""} ({data.failed.createdLabel}) не удалась
              {data.failed.stage ? ` на этапе «${data.failed.stage}»` : ""} —{" "}
              <a href={data.failed.url} target="_blank" rel="noreferrer">
                откройте лог ↗
              </a>
              .
            </span>
          </div>
        )}

        {count === 0 ? (
          <section className="card">
            <h2>Как собрать ролики</h2>
            <p>{data.empty}</p>
            <p className="small muted">
              Коды — темы плана, например 01a,01b,02a: русский сценарий переводится (scripts/{data.lang}/), без него сценарий пишется сразу на языке
              канала; ролик собирается заново, файл — {data.lang}-01a-….mp4.
              {data.geminiVoice ? " Голос Gemini делит дневную квоту с русским каналом (~10 озвучек в сутки) — собирайте по 3–6 за раз." : ""}
            </p>
            <div className="btn-row">
              <a className="btn primary" href={data.actionsUrl} target="_blank" rel="noreferrer">
                Открыть Actions ↗
              </a>
            </div>
          </section>
        ) : (
          <>
            <details className={`card ${s.howto}`}>
              <summary>Как выложить с телефона — 4 шага</summary>
              <ol className="steps">
                <li>
                  «📱 Видео» → в меню телефона «Сохранить видео»: ролик ляжет в «Фото» без пережатия (на Android и компьютере — скачается файлом).
                </li>
                <li>
                  YouTube → аватар → «Сменить аккаунт» → канал «{channel.name}» → «+» → «Видео» → этот ролик.
                </li>
                <li>
                  «Скопировать для YouTube» → «Название», затем «Описание» — вставить в поля. «Для детей» — нет; «Изменённый или синтетический контент» —
                  да (голос ИИ).
                </li>
                <li>Reels: «Обложка» и «📋 Подпись». Теги ставятся только в Studio на компьютере («Теги» — там же, в «Скопировать для YouTube»).</li>
              </ol>
              <p className="small muted">Время выхода и тексты на этом канале панель не ставит: ключа YouTube к нему нет. Названия файлов начинаются с {data.lang}-код.</p>
            </details>

            <div className={s.list}>
              {videos.map((v) => (
                <VideoCard key={v.file} v={v} onCopy={copy} manual={manual?.key === v.file ? manual : null} />
              ))}
            </div>

            {count > 1 && (
              <details className={`card ${s.howto}`}>
                <summary>Все ролики сразу ({count})</summary>
                <FilesSaver items={videos.map(releaseOf)} />
              </details>
            )}
          </>
        )}

        {toast && (
          <div className={`toast${toast.ok ? "" : " err"}`} role="status">
            <span>{toast.text}</span>
            <button className="btn small ghost" onClick={() => setToast(null)} aria-label="Скрыть">
              ✕
            </button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
