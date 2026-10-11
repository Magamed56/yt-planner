"use client";
// Лист ролика прямо на «Доске», без перехода: на телефоне — снизу на 70 % высоты (тянется вверх
// до полного, закрывается свайпом вниз или касанием фона), на компьютере — панель справа 380 px,
// доска видна. Русский ролик, Instagram и TikTok — карточка очереди (VideoSheet); у Instagram и
// TikTok сверху — «загрузил» и подпись instagram.txt. Английский — тексты для Studio, время по
// Нью-Йорку и Москве, видео и отметка «запланирован в Studio» (как на странице English).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { captionAction, studioMarkAction, type ActionResult } from "@/app/actions";
import type { BoardData, BoardStatus, EnVideo, PlacedCard, ZoneKey } from "@/lib/board";
import { markTime, STATUS_LABEL } from "@/lib/board-view";
import { writeClipboard } from "@/lib/clipboard";
import type { Row } from "@/lib/state";
import { ZoneIcon } from "./BoardIcons";
import FilesSaver from "./FilesSaver";
import VideoSheet from "./VideoSheet";
import s from "./board.module.css";

interface Props {
  data: BoardData;
  zone: ZoneKey;
  code: string;
  card: PlacedCard | null;
  zoneTitle: string;
  status: BoardStatus | null; // с учётом только что нажатой отметки
  marked: boolean | undefined; // кнопка «загрузил»: undefined — её нет
  busy: boolean;
  desktop: boolean;
  onClose: () => void;
  onMark: (on: boolean) => void; // Instagram, TikTok: «загрузил» / «снять» (время спросит полотно)
  onEnMark: (code: string, on: boolean, at: string | null) => void;
  onToast: (text: string, ok: boolean) => void;
}

const failText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function BoardSheet(p: Props) {
  const { data, zone, code, card } = p;
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(0); // сдвиг пальцем: + вниз, − вверх
  const start = useRef<{ y: number; t: number; id: number } | null>(null);
  const box = useRef<HTMLElement>(null);
  // Открылся — фокус в лист: клавиатура и экранный диктор сразу в нём.
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, []);

  // Шапка листа на телефоне — ручка: вниз — закрыть, вверх — во весь экран.
  function onDown(e: React.PointerEvent<HTMLElement>) {
    if (p.desktop || (e.target as HTMLElement).closest("button, a")) return;
    start.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent<HTMLElement>) {
    if (start.current?.id === e.pointerId) setDrag(e.clientY - start.current.y);
  }
  function onUp(e: React.PointerEvent<HTMLElement>) {
    const st = start.current;
    if (!st || st.id !== e.pointerId) return;
    start.current = null;
    const dy = e.clientY - st.y;
    const speed = dy / Math.max(1, performance.now() - st.t); // точек в мс
    setDrag(0);
    if (dy > 90 || (dy > 20 && speed > 0.6)) {
      if (full && dy < 260) setFull(false);
      else p.onClose();
    } else if (dy < -50) setFull(true);
  }

  const row = zone === "en" ? null : (data.state.rows.find((r) => r.code === code) ?? null);
  const en = zone === "en" ? (data.en.videos.find((v) => v.code === code) ?? null) : null;
  const sheetStyle: React.CSSProperties | undefined =
    p.desktop || !drag ? undefined : drag > 0 ? { transform: `translateY(${drag}px)`, transition: "none" } : { maxHeight: "none", height: `calc(${full ? "100dvh" : "70dvh"} + ${-drag}px)`, transition: "none" };

  return (
    <>
      {!p.desktop && <div className={s.sheetBackdrop} onClick={p.onClose} aria-hidden="true" />}
      <section
        ref={box}
        tabIndex={-1}
        className={`${s.sheet} ${full ? s.sheetFull : ""}`}
        style={sheetStyle}
        role="dialog"
        aria-modal={!p.desktop}
        aria-label={`${p.zoneTitle} · ${code}`}
      >
        <header className={s.sheetHead} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {!p.desktop && <span className={s.grab} aria-hidden="true" />}
          <ZoneIcon zone={zone} size={20} />
          <span className={s.sheetTitle}>
            {p.zoneTitle} · <b>{code}</b>
          </span>
          <button type="button" className={`btn small ghost ${s.sheetClose}`} onClick={p.onClose} aria-label="Закрыть лист ролика">
            ✕
          </button>
        </header>
        <div className={s.sheetBody}>
          {(zone === "instagram" || zone === "tiktok") && card && <SocialBlock {...p} card={card} row={row} />}
          {zone === "en" ? (
            en && card ? (
              <EnSheet v={en} card={card} data={data} status={p.status ?? card.status} onEnMark={p.onEnMark} onToast={p.onToast} />
            ) : (
              <p className="muted">Английского ролика {code} в релизах нет — обновите страницу.</p>
            )
          ) : row ? (
            <VideoSheet key={code} row={row} state={data.state} onClose={p.onClose} />
          ) : (
            <p className="muted">Ролика {code} нет в очереди — обновите страницу.</p>
          )}
        </div>
      </section>
    </>
  );
}

// Instagram и TikTok: отметка «загрузил» и подпись instagram.txt — сверху листа.
function SocialBlock(p: Props & { card: PlacedCard; row: Row | null }) {
  const { card, row } = p;
  const [caption, setCaption] = useState<string | null>(null);
  const status = p.status ?? card.status;
  const t = markTime(card, Date.parse(p.data.nowIso));

  async function copyCaption() {
    const id = row?.release?.caption?.id;
    if (!id) return;
    const text = captionAction(id).then((r) => {
      if ("text" in r) return r.text;
      throw new Error(r.message);
    });
    const copied = await writeClipboard(text);
    try {
      setCaption(await text);
      p.onToast(copied ? "Подпись скопирована." : "Телефон не дал скопировать — подпись ниже, выделите её.", copied);
    } catch (e) {
      p.onToast(failText(e), false);
    }
  }

  return (
    <section className={s.social} aria-label={`${p.zoneTitle}: отметка и подпись`}>
      <div className={s.socialRow}>
        <span className={s.pill} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        <span className="small">
          {card.dateLabel} {card.exact ? "" : "≈"}
          {card.time} {card.exact ? "" : "· по слоту русского канала"}
        </span>
      </div>
      {card.note && <p className={`small ${s.socialNote}`}>{card.note}</p>}
      {p.marked === undefined ? (
        <p className="small muted">
          {p.data.youtubeError
            ? "YouTube не ответил — время ролика только ориентир, «загрузил» скрыта до обновления."
            : row?.hold
              ? "Ждёт пересборки — старую версию не выкладывайте."
              : "Отметки не прочитались — обновите страницу."}
        </p>
      ) : (
        <div className="btn-row">
          {p.marked ? (
            <button type="button" className="btn small" disabled={p.busy} onClick={() => p.onMark(false)}>
              {p.busy ? "Сохраняю…" : `Снять отметку «загрузил»`}
            </button>
          ) : (
            <button type="button" className="btn small primary" disabled={p.busy} onClick={() => p.onMark(true)}>
              {p.busy ? "Сохраняю…" : `Загрузил в ${p.zoneTitle}${t.kind === "choose" ? "…" : ""}`}
            </button>
          )}
        </div>
      )}
      {row?.release?.caption && (
        <div className="btn-row">
          <button type="button" className="btn small" onClick={() => void copyCaption()}>
            📋 Скопировать подпись
          </button>
        </div>
      )}
      {caption && <div className="caption">{caption}</div>}
    </section>
  );
}

// Английский ролик: тексты для Studio, время по Нью-Йорку и Москве, видео, «запланирован в Studio».
function EnSheet({ v, card, data, status, onEnMark, onToast }: { v: EnVideo; card: PlacedCard; data: BoardData; status: BoardStatus; onEnMark: Props["onEnMark"]; onToast: Props["onToast"] }) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ what: string; text: string } | null>(null);
  const inStudio = status === "published" || status === "scheduled";
  const msk = new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(card.at)).replace(",", "");
  const cover = v.cover ? `/api/asset/${v.cover.id}/file` : v.thumb ? `/api/asset/${v.thumb.id}/file` : null;
  const [coverFailed, setCoverFailed] = useState(false);
  const t = v.texts;

  async function mark(on: boolean) {
    setBusy(true);
    const at = on ? card.at : null;
    const r: ActionResult = await studioMarkAction("en", v.code, at).catch((e: unknown) => ({ ok: false, message: failText(e) }));
    setBusy(false);
    onToast(r.message, r.ok);
    if (r.ok) onEnMark(v.code, on, at);
  }
  async function copy(what: string, text: string) {
    if (await writeClipboard(text)) {
      setManual(null);
      onToast(`Скопировано: ${what}.`, true);
    } else {
      setManual({ what, text });
      onToast("Телефон не дал скопировать — текст ниже.", false);
    }
  }

  return (
    <div className={s.en}>
      <div className={s.enHead}>
        {/* eslint-disable-next-line @next/next/no-img-element -- обложка из релиза */}
        {cover && !coverFailed ? <img className={s.enCover} src={cover} alt="" onError={() => setCoverFailed(true)} /> : <span className={s.enCover}>{v.code}</span>}
        <div>
          <span className={s.pill} data-status={status}>
            {STATUS_LABEL[status]}
          </span>
          <h3>{t?.title ?? v.title}</h3>
          <p className="small">
            <b>
              {card.dateLabel} {card.time}
            </b>{" "}
            {data.en.zone} · <b>{msk}</b> по Москве
          </p>
          {!card.exact && <p className="small muted">Время — по плану выхода; поставьте его в Studio и отметьте ниже.</p>}
        </div>
      </div>
      {data.en.canMark && (
        <div className="btn-row">
          <button type="button" className={`btn small${inStudio ? "" : " primary"}`} aria-pressed={inStudio} disabled={busy} onClick={() => void mark(!inStudio)}>
            {busy ? "Сохраняю…" : inStudio ? "Снять отметку" : "Запланирован в Studio ✓"}
          </button>
        </div>
      )}
      <h4 className={s.enLabel}>Скопировать для YouTube</h4>
      <div className="btn-row">
        <button type="button" className="btn small" onClick={() => void copy("название", t?.title ?? v.title)}>
          Название
        </button>
        {t?.description && (
          <button type="button" className="btn small" onClick={() => void copy("описание", t.description)}>
            Описание
          </button>
        )}
        {t && t.tags.length > 0 && (
          <button type="button" className="btn small" onClick={() => void copy("теги", t.tags.join(", "))}>
            Теги
          </button>
        )}
      </div>
      {manual && (
        <div>
          <p className="small flag">Не скопировалось ({manual.what}) — выделите текст:</p>
          <div className="caption">{manual.text}</div>
        </div>
      )}
      <h4 className={s.enLabel}>Видео</h4>
      <FilesSaver items={[{ code: v.file, release: { mp4: v.mp4, cover: v.cover, thumb: v.thumb } }]} fixed={["video"]} label="Скачать видео" compact />
      {t && (
        <details className={s.enTexts}>
          <summary>Тексты для Studio</summary>
          <dl>
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
                <dt>Теги</dt>
                <dd>{t.tags.join(", ")}</dd>
              </>
            )}
          </dl>
        </details>
      )}
      <div className="btn-row">
        <a className="btn small ghost" href={v.url} target="_blank" rel="noreferrer">
          Релиз ↗
        </a>
        <Link className="btn small ghost" href="/lang/en">
          Все английские ролики →
        </Link>
      </div>
    </div>
  );
}
