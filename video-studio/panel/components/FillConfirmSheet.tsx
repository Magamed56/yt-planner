"use client";
// «Найти новые загрузки» нашла ролики — список здесь же, а не окно браузера: какой ролик в какой
// слот встанет, отметки и замечания («YouTube ещё обрабатывает 08b»). Одна кнопка ставит тексты и
// время отмеченным; перед записью сервер ещё раз проверит, что слот свободен.
import { useState } from "react";
import type { NewUpload } from "@/app/actions";
import { plural } from "@/lib/stages";
import Thumb from "./Thumb";

export default function FillConfirmSheet({ found, notes, busy, onApply, onClose }: { found: NewUpload[]; notes: string[]; busy: boolean; onApply: (items: NewUpload[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(() => new Set(found.map((f) => f.code)));
  const chosen = found.filter((f) => picked.has(f.code));
  const toggle = (code: string) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPicked(next);
  };
  return (
    <aside className="sheet" aria-label="Новые загрузки в Studio">
      <div className="sheet-head">
        <div className="sheet-title">
          <span className="badge accent">Найдено</span>
          <h3>
            {found.length} {plural(found.length, "новая загрузка", "новые загрузки", "новых загрузок")}
          </h3>
          <div className="muted small">Поставить название, описание, теги и время выхода — как в плане.</div>
        </div>
        <button className="btn ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <section>
        <ul className="save-list fill-list">
          {found.map((f) => (
            <li key={f.code}>
              <label className="fill-row">
                <input type="checkbox" checked={picked.has(f.code)} disabled={busy} onChange={() => toggle(f.code)} />
                <Thumb src={f.cover} code={f.code} />
                <span className="save-item">
                  <b>
                    {f.code} · {f.title}
                  </b>
                  <span className="small">{f.whenLabel ? `→ ${f.whenLabel}` : "без времени (слотов не осталось)"}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {notes.map((n) => (
          <p key={n} className="muted small">
            {n}
          </p>
        ))}
        <div className="btn-row">
          <button className="btn primary" disabled={busy || !chosen.length} onClick={() => onApply(chosen)}>
            {busy ? "Ставлю…" : `Поставить тексты и время (${chosen.length})`}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </section>
    </aside>
  );
}
