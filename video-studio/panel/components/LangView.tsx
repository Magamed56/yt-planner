"use client";
// Канал на другом языке: ролики из релизов (по плану выхода, без плана — свежие коды первыми) —
// видео и обложку на телефон, название, описание, теги и подпись Reels — в буфер одним нажатием,
// время выхода — по поясу канала и телефона; сверху — оформление канала из бренд-кита
// (BrandKitCard). Выкладывает владелец сам: у панели нет ключа YouTube этого канала — время в
// Studio ставит он, статистики здесь нет.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { captionAction, studioMarkAction } from "@/app/actions";
import type { SaveItem } from "@/lib/downloads";
import { nextToUpload, slotLabel, type VideoSlot } from "@/lib/lang-slots";
import type { LangPageData } from "@/lib/lang-videos";
import { codesLabel, plural } from "@/lib/stages";
import AppShell from "./AppShell";
import BrandKitCard from "./BrandKitCard";
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

// Пояс телефона серверу неизвестен: до загрузки страницы — пусто (разметка совпадает с
// серверной), потом — время устройства.
const noSubscribe = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "device";
const useDeviceZone = () => useSyncExternalStore(noSubscribe, deviceZone, () => "");

interface SlotView {
  slot: VideoSlot;
  zone: string; // «по Нью-Йорку»
  next: boolean; // ближайший к загрузке
  inStudio: boolean; // с учётом только что нажатой кнопки
  canMark: boolean; // отметки прочитались — кнопку показываем
  busy: boolean;
  onMark: (on: boolean) => void;
}

// Когда выйдет ролик: главное — время телефона (его и ставить в Studio), ниже — по поясу канала.
function SlotBox({ slot, zone, next, inStudio, canMark, busy, onMark }: SlotView) {
  const device = useDeviceZone();
  const phone = device ? slotLabel(new Date(slot.at)) : null;
  const same = phone === slot.label;
  return (
    <div className={`${s.when}${next ? ` ${s.whenNext}` : ""}`}>
      <div className={s.whenTop}>
        <span className={s.whenKicker}>{next ? "➜ Следующий к загрузке" : "Выход"}</span>
        {inStudio ? (
          <span className={`badge ${s.inStudio}`}>✓ {slot.past ? "вышел" : "в Studio"}</span>
        ) : (
          slot.past && <span className={`badge ${s.pastBadge}`}>прошло</span>
        )}
      </div>
      {same ? (
        <div className={s.whenMain}>
          <b>{slot.label}</b> <span className="small muted">{zone} — как на телефоне</span>
        </div>
      ) : (
        <>
          <div className={s.whenMain}>
            <b>{phone ?? "…"}</b> <span className="small muted">на вашем телефоне</span>
          </div>
          <div className="small muted">
            {slot.label} {zone}
          </div>
        </>
      )}
      {slot.past && !inStudio && canMark && <p className="small flag">Слот прошёл, а отметки нет: если ролик не выложен — выложите сейчас, следующие не сдвигаются.</p>}
      {canMark && (
        <button className={`btn small${inStudio ? " ghost" : ""}`} aria-pressed={inStudio} disabled={busy} onClick={() => onMark(!inStudio)}>
          {busy ? "Сохраняю…" : inStudio ? "Снять отметку" : "Запланирован в Studio ✓"}
        </button>
      )}
    </div>
  );
}

const releaseOf = (v: Video): SaveItem => ({ code: v.file, release: { mp4: v.mp4, cover: v.cover, thumb: v.thumb } });
const coverSrc = (v: Video) => (v.cover ? `/api/asset/${v.cover.id}/file` : v.thumb ? `/api/asset/${v.thumb.id}/file` : null);

function VideoCard({
  v,
  onCopy,
  manual,
  when,
}: {
  v: Video;
  onCopy: (key: string, what: string, text: string | (() => Promise<string>)) => void;
  manual: { what: string; text: string } | null;
  when: SlotView | null;
}) {
  const item = releaseOf(v);
  const t = v.texts;
  return (
    <article className={`card ${s.video}${when?.next ? ` ${s.next}` : ""}`}>
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

      {when && <SlotBox {...when} />}

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
  const { channel, videos, plan } = data;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  // Только что нажатые отметки — поверх данных сервера, пока страница не обновилась.
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [seen, setSeen] = useState(data.shell.generatedAt);
  if (seen !== data.shell.generatedAt) {
    setSeen(data.shell.generatedAt);
    setMarked({});
  }
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

  const inStudio = (code: string) => marked[code] ?? plan.slots[code]?.inStudio === true;
  const nextCode = nextToUpload(plan.order, plan.slots, inStudio);

  async function mark(v: Video, on: boolean) {
    const slot = plan.slots[v.code];
    if (!slot || busy) return;
    setBusy(v.code);
    const r = await studioMarkAction(data.lang, v.code, on ? slot.at : null).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy(null);
    show(r.message, r.ok);
    if (!r.ok) return;
    setMarked((m) => ({ ...m, [v.code]: on }));
    startTransition(() => router.refresh());
  }

  const whenOf = (v: Video): SlotView | null => {
    const slot = plan.slots[v.code];
    if (!slot) return null;
    return { slot, zone: plan.zone, next: v.code === nextCode, inStudio: inStudio(v.code), canMark: plan.marks, busy: busy === v.code, onMark: (on) => void mark(v, on) };
  };
  // Вышедшие и отмеченные — в конец, свёрнуто: список начинается с того, что ещё грузить.
  const done = videos.filter((v) => plan.slots[v.code]?.past && inStudio(v.code));
  const todo = videos.filter((v) => !done.includes(v));
  const card = (v: Video) => <VideoCard key={v.file} v={v} onCopy={copy} manual={manual?.key === v.file ? manual : null} when={whenOf(v)} />;

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

        {data.brand && (
          <BrandKitCard kit={data.brand} channel={channel} mainChannel={data.mainChannel} onCopy={copy} manual={manual?.key === channel.name ? manual : null} />
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
                  да (голос ИИ). Видимость — «Запланировать»: дата и время «на вашем телефоне» из карточки.
                </li>
                <li>Reels: «Обложка» и «📋 Подпись». Теги ставятся только в Studio на компьютере («Теги» — там же, в «Скопировать для YouTube»).</li>
              </ol>
              <p className="small muted">
                Сама панель на этом канале ничего не ставит: ключа YouTube к нему нет. Время выхода — в карточке ролика (план из {channel.file}), названия
                файлов начинаются с {data.lang}-код.
              </p>
            </details>

            {plan.order.length > 0 && (
              <div className="notice info">
                <span>
                  🗓 При загрузке в Studio канала «{channel.name}» выберите «Запланировать» и поставьте время по вашему телефону из списка.
                  {plan.marks ? " Поставили — «Запланирован в Studio ✓»: подсветится следующий." : ""}
                </span>
              </div>
            )}
            {plan.problem && (
              <div className="notice warn">
                <span>
                  Время выхода не посчитано: {plan.problem} <span className="small muted">({channel.file})</span>
                </span>
              </div>
            )}

            <div className={s.list}>{todo.map(card)}</div>

            {done.length > 0 && (
              <details className={`card ${s.howto}`}>
                <summary>Уже вышли ({done.length})</summary>
                <div className={`${s.list} ${s.doneList}`}>{done.map(card)}</div>
              </details>
            )}

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
