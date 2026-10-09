"use client";
// «Скачать выбранные»: несколько роликов из ленты — видео и обложки одним заходом. Место то же,
// что у карточки ролика: снизу на телефоне, справа на компьютере.
import type { Row } from "@/lib/state";
import { STAGE_LABEL, plural } from "@/lib/stages";
import { frameOf } from "./CoverMedia";
import FilesSaver from "./FilesSaver";
import Thumb from "./Thumb";

export default function DownloadSheet({ rows, onClose, onRemove }: { rows: Row[]; onClose: () => void; onRemove: (code: string) => void }) {
  const items = rows.flatMap((r) => (r.release ? [{ code: r.code, release: r.release }] : []));
  return (
    <aside className="sheet" aria-label="Скачать выбранные ролики">
      <div className="sheet-head">
        <div className="sheet-title">
          <span className="badge accent">Скачать</span>
          <h3>
            {rows.length} {plural(rows.length, "ролик", "ролика", "роликов")}
          </h3>
          <div className="muted small">Видео и обложки — в именах файлов код ролика.</div>
        </div>
        <button className="btn ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>

      <section>
        {items.length ? (
          // Новый набор роликов — новый заход: уже скачанное в память относится к прежнему.
          <FilesSaver key={items.map((i) => i.code).join(",")} items={items} />
        ) : (
          <p className="muted">Выберите в ленте ролики с готовым видео.</p>
        )}
      </section>

      <section>
        <h4>Выбрано</h4>
        <ul className="save-list">
          {rows.map((r) => (
            <li key={r.code} className={`stage-${r.stage}`}>
              <Thumb src={r.cover} video={frameOf(r)} code={r.code} />
              <span className="save-item">
                <b>
                  {r.code} · {r.title}
                </b>
                <span className="muted small">
                  {STAGE_LABEL[r.stage]}
                  {r.dateLabel ? ` · ${r.dateLabel} ${r.timeLabel}` : ""}
                </span>
              </span>
              <button className="btn small ghost" onClick={() => onRemove(r.code)} aria-label={`Убрать ${r.code}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
