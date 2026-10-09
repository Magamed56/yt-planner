"use client";
// «Сейчас» на главной: что сделать руками прямо сейчас — до трёх дел, у каждого одна кнопка,
// которая делает это здесь же. Тот же список уходит утренним уведомлением (lib/todo.ts).
import Link from "next/link";
import { plural } from "@/lib/stages";
import type { Todo } from "@/lib/todo";

const LEVEL_MARK: Record<Todo["level"], { sign: string; label: string }> = {
  error: { sign: "✕", label: "Срочно" },
  warn: { sign: "!", label: "Важно" },
  info: { sign: "•", label: "Когда будет время" },
};
const SHOWN = 3;
const MAX_CHIPS = 8;

export interface NowHandlers {
  onDownload: (codes: string[]) => void;
  onFind: () => void;
  onOpen: (code: string) => void;
}

function TodoItem({ t, disabled, h }: { t: Todo; disabled: boolean; h: NowHandlers }) {
  const a = t.action;
  const mark = LEVEL_MARK[t.level];
  return (
    <li className={`now-item ${t.level}`}>
      <span className="now-mark" aria-hidden="true">
        {mark.sign}
      </span>
      <div className="now-body">
        <b>
          <span className="sr-only">{mark.label}: </span>
          {t.title}
        </b>
        {t.codes.length > 0 && (
          <div className="now-codes">
            {t.codes.slice(0, MAX_CHIPS).map((c) => (
              <button key={c} className="code-chip" disabled={disabled} onClick={() => h.onOpen(c)} title={`Открыть карточку ${c}`}>
                {c}
              </button>
            ))}
            {t.codes.length > MAX_CHIPS && <span className="small muted">и ещё {t.codes.length - MAX_CHIPS}</span>}
          </div>
        )}
        {t.detail && <span className="small muted">{t.detail}</span>}
        {(a || t.secondary) && (
          <div className="now-actions">
            {a?.kind === "download" && (
              <button className="btn small primary" disabled={disabled} onClick={() => h.onDownload(a.codes)}>
                {a.label}
              </button>
            )}
            {a?.kind === "find" && (
              <button className="btn small primary" disabled={disabled} onClick={h.onFind}>
                {a.label}
              </button>
            )}
            {a?.kind === "open" && (
              <button className="btn small primary" disabled={disabled} onClick={() => h.onOpen(a.code)}>
                {a.label}
              </button>
            )}
            {a?.kind === "href" && (
              <Link className="btn small primary" href={a.href} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
                {a.label}
              </Link>
            )}
            {t.secondary && (
              <a className="link-btn" href={t.secondary.href} target="_blank" rel="noreferrer">
                {t.secondary.label}
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function NowCard({ todos, doneUntil, disabled, ...h }: { todos: Todo[]; doneUntil: string | null; disabled: boolean } & NowHandlers) {
  if (!todos.length) {
    return (
      <section className="now done" aria-label="Сейчас">
        <span className="now-mark" aria-hidden="true">
          ✓
        </span>
        <b>{doneUntil ? `Всё готово до ${doneUntil}` : "Дел на сейчас нет"}</b>
      </section>
    );
  }
  const rest = todos.slice(SHOWN);
  return (
    <section className="now" aria-label="Сейчас">
      <div className="now-head">
        <span className="section-label">Сейчас</span>
        <span className="small muted">
          {todos.length} {plural(todos.length, "дело", "дела", "дел")}
        </span>
      </div>
      <ul className="now-list">
        {todos.slice(0, SHOWN).map((t) => (
          <TodoItem key={t.id} t={t} disabled={disabled} h={h} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="now-more">
          <summary>Ещё {rest.length}</summary>
          <ul className="now-list">
            {rest.map((t) => (
              <TodoItem key={t.id} t={t} disabled={disabled} h={h} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
